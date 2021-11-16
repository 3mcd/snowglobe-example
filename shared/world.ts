import * as Harmony from "harmony-ecs"
import Rapier from "rapier3d-node"
import * as Snowglobe from "snowglobe"
import * as Net from "./net"
import * as Model from "./model"

export type World = Snowglobe.World<Command, Snapshot, DisplayState> & {
  ecs: Harmony.World.World
}
export type Command = Snowglobe.Command & {
  entity: number
  on: PlayerInput
  off: PlayerInput
}

export type Snapshot = Snowglobe.Snapshot & {
  translation: Rapier.Vector3
  rotation: Rapier.Quaternion
  // angvel: Rapier.Vector3
  // linvel: Rapier.Vector3
  input: number
  force: Rapier.Vector3
  grounded: number
}

export type DisplayState = Snowglobe.DisplayState & {
  translation: Rapier.Vector3
  rotation: Rapier.Quaternion
}

const ENTITY_COUNT = 1_000
const TIMESTEP = 1 / 60
const GRAVITY = { x: 0, y: -9.81, z: 0 }

export const config = Snowglobe.makeConfig({
  timestepSeconds: TIMESTEP,
  tweeningMethod: Snowglobe.TweeningMethod.Interpolated,
})

export enum PlayerInput {
  Up = 2 ** 0,
  Right = 2 ** 1,
  Down = 2 ** 2,
  Left = 2 ** 3,
  Jump = 2 ** 4,
}

function hasInput(mask: number, inputs: PlayerInput) {
  return (mask & inputs) === inputs
}

export function make(): World {
  const ecs = Harmony.World.make(ENTITY_COUNT)
  const simulation = new Rapier.World(GRAVITY)
  const Body = Harmony.Schema.make(ecs, {})
  const Input = Harmony.Schema.makeBinary(ecs, Harmony.Format.uint8)
  const Force = Harmony.Schema.makeBinary(ecs, Model.Vector3)
  const Grounded = Harmony.Schema.makeBinary(ecs, Harmony.Format.uint8)
  const Player = [Body, Input, Force, Grounded] as const
  const players = Harmony.Query.make(ecs, Player)

  function makePlayer(x = 0, y = 0, z = 0) {
    const body = simulation.createRigidBody(
      new Rapier.RigidBodyDesc(
        Rapier.RigidBodyType.KinematicVelocityBased,
      ).setTranslation(x, y, z),
    )
    simulation.createCollider(
      Rapier.ColliderDesc.capsule(1, 1)
        .setActiveCollisionTypes(
          Rapier.ActiveCollisionTypes.DEFAULT |
            Rapier.ActiveCollisionTypes.KINEMATIC_STATIC,
        )
        .setActiveEvents(
          Rapier.ActiveEvents.CONTACT_EVENTS | Rapier.ActiveEvents.INTERSECTION_EVENTS,
        ),
      body.handle,
    )
    return Harmony.Entity.make(ecs, Player, [body])
  }

  function makeGround() {
    const body = simulation.createRigidBody(
      new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static).setTranslation(0, 0, 0),
    )
    const collider = simulation.createCollider(
      Rapier.ColliderDesc.cuboid(100, 0.5, 100)
        .setActiveCollisionTypes(
          Rapier.ActiveCollisionTypes.DEFAULT |
            Rapier.ActiveCollisionTypes.KINEMATIC_STATIC,
        )
        .setActiveEvents(
          Rapier.ActiveEvents.CONTACT_EVENTS | Rapier.ActiveEvents.INTERSECTION_EVENTS,
        )
        .setSensor(true),
      body.handle,
    )
    return collider.handle
  }

  makePlayer(0, 20, 0)
  const groundHandle = makeGround()

  return {
    ecs,
    step() {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, input, force, grounded]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          const i = input[k]
          const linvel = b.linvel()
          const up = +hasInput(i, PlayerInput.Up)
          const down = +hasInput(i, PlayerInput.Down)
          const left = +hasInput(i, PlayerInput.Left)
          const right = +hasInput(i, PlayerInput.Right)
          if (grounded[k]) {
            if (hasInput(i, PlayerInput.Jump)) {
              force.y[k] += 500 * TIMESTEP
              input[k] &= ~PlayerInput.Jump
            }
            force.y[k] = Math.max(force.y[k], 0)
          } else {
            force.y[k] -= 9.81 * TIMESTEP
          }
          linvel.x += (up - down) * 2
          linvel.y += force.y[k]
          linvel.z += (left - right) * 2
          b.setLinvel(linvel, true)
        }
      }
      simulation.timestep = TIMESTEP
      simulation.step()
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, , , grounded]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          grounded[k] = +simulation.intersectionPair(b.collider(0), groundHandle)
        }
      }
    },
    snapshot(): Snapshot {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, input, force, grounded]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          return {
            translation: b.translation(),
            rotation: b.rotation(),
            // angvel: b.angvel(),
            // linvel: b.linvel(),
            input: input[k],
            clone: Net.clone,
            force: { x: force.x[k], y: force.y[k], z: force.z[k] },
            grounded: grounded[k],
          }
        }
      }
      throw new Error("No entity for snapshot")
    },
    displayState() {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          return {
            translation: b.translation(),
            rotation: b.rotation(),
            clone: Net.clone,
          }
        }
      }
      throw new Error("No entity for display state")
    },
    commandIsValid() {
      return true
    },
    applyCommand({ entity, on, off }: Command) {
      for (const [entities, [, input]] of players) {
        for (let i = 0; i < entities.length; i++) {
          const e = entities[i]
          if (e === entity) {
            input[i] |= on
            input[i] &= ~off
            break
          }
        }
      }
    },
    applySnapshot(snapshot: Snapshot) {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, input, force, grounded]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          b.setTranslation(snapshot.translation, true)
          b.setRotation(snapshot.rotation, true)
          // b.setAngvel(snapshot.angvel, true)
          // b.setLinvel(snapshot.linvel, true)
          input[k] = snapshot.input
          force.x[k] = snapshot.force.x
          force.y[k] = snapshot.force.y
          force.z[k] = snapshot.force.z
          grounded[k] = snapshot.grounded
        }
      }
    },
  }
}
