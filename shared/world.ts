import * as Harmony from "harmony-ecs"
import Rapier from "rapier3d-node"
import * as Snowglobe from "snowglobe"

export type World = Snowglobe.World<Command, Snapshot, DisplayState>
export type Command = Snowglobe.Command & [entity: number, jump: number]
export type Snapshot = Snowglobe.Snapshot &
  Harmony.SparseMap.SparseMap<
    [translation: Rapier.Vector3, jump: number],
    Harmony.Entity.Id
  >
export type DisplayState = Snowglobe.DisplayState &
  Harmony.SparseMap.SparseMap<Rapier.Vector3, Harmony.Entity.Id>

const ENTITY_COUNT = 1_000
const GRAVITY = { x: 0, y: -9.81, z: 0 }

function lerp(a: Rapier.Vector3, b: Rapier.Vector3, t: number) {
  const ax = a.x
  const ay = a.y
  const az = a.z
  const out = new Rapier.Vector3(0, 0, 0)
  out.x = ax + t * (b.x - ax)
  out.y = ay + t * (b.y - ay)
  out.y = az + t * (b.z - az)
  return out
}

export function interpolate(left: DisplayState, right: DisplayState, t: number) {
  const displayState = Harmony.SparseMap.make<Rapier.Vector, Harmony.Entity.Id>()
  Harmony.SparseMap.forEach(left, (tl, entity) => {
    const tr = Harmony.SparseMap.get(right, entity)
    Harmony.SparseMap.set(displayState, entity, lerp(tl, tr, t))
  })
  return displayState
}

export function make(): Snowglobe.World<Command, Snapshot, DisplayState> {
  const ecs = Harmony.World.make(ENTITY_COUNT)
  const simulation = new Rapier.World(GRAVITY)
  const Body = Harmony.Schema.make(ecs, {})
  const Jump = Harmony.Schema.make(ecs, Harmony.Format.uint8)
  const Player = [Body, Jump] as const
  const players = Harmony.Query.make(ecs, Player)

  function makePlayer(x = 0, y = 0, z = 0) {
    const body = simulation.createRigidBody(
      new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Dynamic).setTranslation(x, y, z),
    )
    simulation.createCollider(Rapier.ColliderDesc.capsule(1, 1), body.handle)
    return Harmony.Entity.make(ecs, Player, [body])
  }

  function makeGround() {
    const body = simulation.createRigidBody(
      new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static).setTranslation(0, 0, 0),
    )
    simulation.createCollider(Rapier.ColliderDesc.cuboid(100, 0.5, 100), body.handle)
  }

  makePlayer(5, 20, 5)
  makePlayer(0, 25, 0)
  makeGround()

  return {
    step() {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, jump]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          const j = jump[k]
          if (j) {
            b.applyImpulse(new Rapier.Vector3(0, 20, 0), true)
            jump[k] = 0
          }
        }
      }
      simulation.step()
    },
    snapshot(): Snapshot {
      const map = Harmony.SparseMap.make<[Rapier.Vector3, number], Harmony.Entity.Id>()
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, jump]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          Harmony.SparseMap.set(map, entities[k], [
            (body[k] as Rapier.RigidBody).translation(),
            jump[k],
          ])
        }
      }
      const snapshot = {
        ...map,
        clone: () => ({
          ...snapshot,
          values: snapshot.values.map(([translation, jump]) => [
            { ...translation },
            jump,
          ]),
        }),
      }
      return snapshot
    },
    displayState() {
      const map = Harmony.SparseMap.make<Rapier.Vector3, Harmony.Entity.Id>()
      for (let i = 0; i < players.length; i++) {
        const [entities, [body]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          Harmony.SparseMap.set(
            map,
            entities[k],
            (body[k] as Rapier.RigidBody).translation(),
          )
        }
      }
      const displayState = {
        ...map,
        clone: () => ({
          ...displayState,
          values: displayState.values.map(t => ({ ...t })),
        }),
      }
      return displayState
    },
    commandIsValid() {
      return true
    },
    applyCommand([entity, jump]: Command) {
      Harmony.Entity.set(ecs, entity, [Jump], [jump])
    },
    applySnapshot(snapshot: Snapshot) {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, jump]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const data = Harmony.SparseMap.get(snapshot, entities[k])
          if (data) {
            ;(body[k] as Rapier.RigidBody).setTranslation(data[0], true)
            jump[k] = data[1]
          }
        }
      }
    },
  }
}
