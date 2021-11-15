import * as Harmony from "harmony-ecs"
import Rapier from "rapier3d-node"
import * as Snowglobe from "snowglobe"
import * as Net from "./net"

export type World = Snowglobe.World<Command, Snapshot, DisplayState> & {
  ecs: Harmony.World.World
}
export type Command = Snowglobe.Command & { entity: number; jump: number }
export type Snapshot = Snowglobe.Snapshot & { translation: Rapier.Vector3; jump: number }
export type DisplayState = Snowglobe.DisplayState &
  Harmony.SparseMap.SparseMap<Rapier.Vector3, Harmony.Entity.Id>

const ENTITY_COUNT = 1_000
const TIMESTEP = 1 / 60
const GRAVITY = { x: 0, y: -9.81, z: 0 }

export const config = Snowglobe.makeConfig({
  timestepSeconds: TIMESTEP,
  tweeningMethod: Snowglobe.TweeningMethod.MostRecentlyPassed,
})

function lerp(a: Rapier.Vector3, b: Rapier.Vector3, t: number) {
  const ax = a.x
  const ay = a.y
  const az = a.z
  const out = new Rapier.Vector3(0, 0, 0)
  out.x = ax + t * (b.x - ax)
  out.y = ay + t * (b.y - ay)
  out.z = az + t * (b.z - az)
  return out
}

export function interpolate(left: DisplayState, right: DisplayState, t: number) {
  return right
  // const displayState = {
  //   ...Harmony.SparseMap.make<Rapier.Vector, Harmony.Entity.Id>(),
  //   clone: Net.clone,
  // }
  // Harmony.SparseMap.forEach(left, (tl, entity) => {
  //   const tr = Harmony.SparseMap.get(right, entity)
  //   Harmony.SparseMap.set(displayState, entity, lerp(tl, tr, t))
  // })
  // return displayState
}

export function make(): World {
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

  makePlayer(0, 20, 0)
  makeGround()

  return {
    ecs,
    step() {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, jump]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          const j = jump[k]
          if (j) {
            b.applyForce(new Rapier.Vector3(0, 4000, 0), true)
            jump[k] = 0
          }
        }
      }
      simulation.timestep = TIMESTEP
      simulation.step()
    },
    snapshot(): Snapshot {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, jump]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          return {
            translation: (body[k] as Rapier.RigidBody).translation(),
            jump: jump[k],
            clone: Net.clone,
          }
        }
      }
      throw new Error("No entity for snapshot")
    },
    displayState() {
      const snapshot = {
        ...Harmony.SparseMap.make<Rapier.Vector3, Harmony.Entity.Id>(),
        clone: Net.clone,
      }
      for (let i = 0; i < players.length; i++) {
        const [entities, [body]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          Harmony.SparseMap.set(
            snapshot,
            entities[k],
            (body[k] as Rapier.RigidBody).translation(),
          )
        }
      }
      return snapshot
    },
    commandIsValid() {
      return true
    },
    applyCommand({ entity, jump }: Command) {
      Harmony.Entity.set(ecs, entity, [Jump], [jump])
    },
    applySnapshot(snapshot: Snapshot) {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, jump]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          ;(body[k] as Rapier.RigidBody).setTranslation(snapshot.translation, true)
          jump[k] = snapshot.jump
        }
      }
    },
  }
}
