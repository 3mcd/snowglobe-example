import * as Loop from "@javelin/hrtime-loop"
import { Entity, formats, Query, Schema, World } from "harmony-ecs"
import Rapier from "rapier3d-node"
import { WebSocket, WebSocketServer } from "ws"

const GRAVITY = Object.freeze({ x: 0, y: -9.81, z: 0 })
const MAX_ENTITIES = 2_000

const wss = new WebSocketServer({ port: 8000 })
const simulation = new Rapier.World(GRAVITY)
const world = World.make(MAX_ENTITIES)

const Vector3 = {
  x: formats.float64,
  y: formats.float64,
  z: formats.float64,
}
const Position = Schema.makeBinary(world, Vector3)
const Velocity = Schema.makeBinary(world, Vector3)
const Body = Schema.make(world, {})
const Player = [Position, Velocity, Body] as const

const players = Query.make(world, Player)

function physics() {
  simulation.step()
  for (let i = 0; i < players.length; i++) {
    const [e, [p, v, b]] = players[i]
    for (let j = 0; j < e.length; j++) {
      const body = b[j] as Rapier.RigidBody
      const { x, y, z } = body.translation()
      const { x: vx, y: vy, z: vz } = body.linvel()
      p.x[j] = x
      p.y[j] = y
      p.z[j] = z
      v.x[j] = vx
      v.y[j] = vy
      v.z[j] = vz
    }
  }
}

function makePlayer(world: World.World, simulation: Rapier.World, x = 0, y = 0, z = 0) {
  const body = simulation.createRigidBody(
    new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Dynamic).setTranslation(x, y, z),
  )
  simulation.createCollider(Rapier.ColliderDesc.capsule(1, 1), body.handle)
  return Entity.make(world, Player, [{ x, y, z }, { x: 0, y: 0, z: 0 }, body])
}

function makeGround(world: World.World, simulation: Rapier.World) {
  const body = simulation.createRigidBody(
    new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static).setTranslation(0, 0, 0),
  )
  simulation.createCollider(Rapier.ColliderDesc.cuboid(100, 0.5, 100), body.handle)
}

const player = makePlayer(world, simulation, 5, 20, 5)
makePlayer(world, simulation, 0, 25, 0)
makeGround(world, simulation)

function serialize() {
  const archetype = world.entityIndex[player]
  const positions = archetype.store.find(col => col.schema.id === Position)
  const { schema, data } = positions
  const count = archetype.entities.length
  const keys = Object.keys(schema.shape)
  const array = new Float64Array(count * keys.length + 1)
  let k = 0
  array[k++] = count
  for (let i = 0; i < keys.length; i++) {
    const col = data[keys[i]]
    for (let j = 0; j < count; j++) {
      array[k++] = col[j]
    }
  }
  return array
}

let send = true

const sockets: WebSocket[] = []
const loop = Loop.createHrtimeLoop(() => {
  physics()
  if ((send = !send)) {
    const packet = serialize()
    for (let i = 0; i < sockets.length; i++) {
      sockets[i].send(packet)
    }
  }
}, (1 / 60) * 1000)

function onSocketMessage(socket: WebSocket, data: ArrayBuffer) {
  for (let i = 0; i < players.length; i++) {
    const [e, [, , b]] = players[i]
    for (let j = 0; j < e.length; j++) {
      const body = b[j] as Rapier.RigidBody
      body.applyImpulse(new Rapier.Vector3(0, 20, 0), true)
    }
  }
}

wss.on("connection", ws => {
  const index = sockets.push(ws) - 1
  ws.binaryType = "arraybuffer"
  ws.on("message", onSocketMessage)
  ws.on("close", () => sockets.splice(index, 1))
})

loop.start()
