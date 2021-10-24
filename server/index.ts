import * as Loop from "@javelin/hrtime-loop"
import * as ECS from "harmony-ecs"
import Rapier from "rapier3d-node"
import { WebSocketServer, WebSocket } from "ws"

const GRAVITY = Object.freeze({ x: 0, y: -9.81, z: 0 })
const MAX_ENTITIES = 2_000

const wss = new WebSocketServer({ port: 8000 })
const sim = new Rapier.World(GRAVITY)
const world = ECS.makeWorld(MAX_ENTITIES)

const Vector3 = {
  x: ECS.formats.float64,
  y: ECS.formats.float64,
  z: ECS.formats.float64,
}
const Position = ECS.makeBinarySchema(world, Vector3)
const Velocity = ECS.makeBinarySchema(world, Vector3)
const Body = ECS.makeSchema(world, {})
const Player = [Position, Velocity, Body] as const

const players = ECS.makeQuery(world, Player)

function physics() {
  sim.step()
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

function makePlayer(world: ECS.World, sim: Rapier.World, x = 0, y = 0, z = 0) {
  const body = sim.createRigidBody(
    new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Dynamic).setTranslation(x, y, z),
  )
  sim.createCollider(Rapier.ColliderDesc.cuboid(0.5, 0.5, 0.5), body.handle)
  return ECS.makeEntity(world, Player, [{ x, y, z }, { x: 0, y: 0, z: 0 }, body])
}

const player = makePlayer(world, sim, 5, 5, 5)
makePlayer(world, sim)

function serialize() {
  const archetype = world.entityIndex[player]
  const positions = archetype.table.find(col => col.schema.id === Position)
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

wss.on("connection", ws => {
  const index = sockets.push(ws) - 1
  ws.binaryType = "arraybuffer"
  ws.on("close", () => sockets.splice(index, 1))
})

loop.start()
