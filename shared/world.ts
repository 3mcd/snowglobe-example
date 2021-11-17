import * as Harmony from "harmony-ecs"
import Rapier from "rapier3d-node"
import * as Snowglobe from "@hastearcade/snowglobe"
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
  input: number
  force: Rapier.Vector3
}

export type DisplayState = Snowglobe.DisplayState & {
  translation: Rapier.Vector3
  rotation: Rapier.Quaternion
}

const ENTITY_COUNT = 1_000
const TIMESTEP = 1 / 60
const GRAVITY = { x: 0, y: -9.81, z: 0 }
const DAMPING_GROUND = 0.15
const PLAYER_HEIGHT = 3
const PLAYER_RADIUS = 1

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

export enum CollisionGroup {
  Static = 0,
  Door = 1,
  Actor = 2,
  Portal = 3,
  Visible = 4,
  RayCast = 5,
  ShapeCast = 6,
}

export enum CollisionMask {
  IsStatic = 1 << (CollisionGroup.Static + 16),
  IsDoor = 1 << (CollisionGroup.Door + 16),
  IsActor = 1 << (CollisionGroup.Actor + 16),
  IsPortal = 1 << (CollisionGroup.Portal + 16),
  IsVisible = 1 << (CollisionGroup.Visible + 16),
  TouchStatic = 1 << CollisionGroup.Static,
  TouchActor = 1 << CollisionGroup.Actor,
  TouchDoor = 1 << CollisionGroup.Door,
  TouchPortal = 1 << CollisionGroup.Portal,
  TouchVisible = 1 << CollisionGroup.Visible,

  TerrainMask = CollisionMask.IsStatic |
    CollisionMask.IsVisible |
    CollisionMask.TouchActor,
  ActorMask = CollisionMask.IsActor | CollisionMask.TouchStatic | CollisionMask.TouchDoor,
  PickMask = CollisionMask.IsActor | CollisionMask.TouchVisible,
  PortalMask = CollisionMask.IsPortal | CollisionMask.TouchActor,
}

function hasInput(mask: number, inputs: PlayerInput) {
  return (mask & inputs) === inputs
}

const CAST_SHAPE_V = new Rapier.Capsule(PLAYER_HEIGHT * 0.5, PLAYER_RADIUS)
const CAST_SHAPE_H = new Rapier.Capsule(PLAYER_HEIGHT * 0.49, PLAYER_RADIUS)

function normalize(vector: Rapier.Vector3, out = vector) {
  const { x, y, z } = vector
  const length = Math.sqrt(x * x + y * y)
  out.x = x / length
  out.y = y / length
  out.z = z / length
  return out
}

function detectKinematicCollision(
  simulation: Rapier.World,
  body: Rapier.RigidBody,
  forceVector: Rapier.Vector3,
  shape: Rapier.Shape,
  distance: number,
) {
  const translation = body.translation()
  const rotation = body.rotation()
  const hit = simulation.castShape(
    translation,
    rotation,
    forceVector,
    shape,
    distance,
    CollisionMask.ActorMask,
  )

  return hit
}

export function make(): World {
  const ecs = Harmony.World.make(ENTITY_COUNT)
  const simulation = new Rapier.World(GRAVITY)
  const Body = Harmony.Schema.make(ecs, {})
  const Input = Harmony.Schema.makeBinary(ecs, Harmony.Format.uint8)
  const Force = Harmony.Schema.makeBinary(ecs, Model.Vector3)
  const Player = [Body, Input, Force] as const
  const players = Harmony.Query.make(ecs, Player)

  function makePlayer(x = 0, y = 0, z = 0) {
    const body = simulation.createRigidBody(
      new Rapier.RigidBodyDesc(
        Rapier.RigidBodyType.KinematicPositionBased,
      ).setTranslation(x, y, z),
    )

    simulation.createCollider(
      Rapier.ColliderDesc.capsule(PLAYER_HEIGHT / 2, PLAYER_RADIUS)
        .setActiveCollisionTypes(
          Rapier.ActiveCollisionTypes.DEFAULT |
            Rapier.ActiveCollisionTypes.KINEMATIC_STATIC,
        )
        .setCollisionGroups(CollisionMask.ActorMask),
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
        .setCollisionGroups(CollisionMask.TerrainMask)
        .setSensor(true),
      body.handle,
    )
    return collider.handle
  }

  function makeObstacle(x: number, z: number, hx: number, hz: number) {
    const body = simulation.createRigidBody(
      new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static).setTranslation(x, 1, z),
    )
    const collider = simulation.createCollider(
      Rapier.ColliderDesc.cuboid(10, 1, 10)
        .setActiveCollisionTypes(
          Rapier.ActiveCollisionTypes.DEFAULT |
            Rapier.ActiveCollisionTypes.KINEMATIC_STATIC,
        )
        .setCollisionGroups(CollisionMask.TerrainMask)
        .setSensor(true),
      body.handle,
    )
    return collider.handle
  }

  makeGround()
  makePlayer(0, 20, 0)
  makeObstacle(10, 10, 10, 10)
  makeObstacle(25, 25, 5, 5)

  return {
    ecs,
    step() {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, input, force]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const i = input[k]
          const b = body[k] as Rapier.RigidBody
          const t = b.translation()
          const up = +hasInput(i, PlayerInput.Up)
          const down = +hasInput(i, PlayerInput.Down)
          const left = +hasInput(i, PlayerInput.Left)
          const right = +hasInput(i, PlayerInput.Right)
          const hmov = normalize(new Rapier.Vector3(right - left, 0, down - up))

          let targetForceX = force.x[k]
          let targetForceY = force.y[k] - 9.81 * 0.002 // gravity
          let targetForceZ = force.z[k]

          // handle vertical (y-axis) collisions
          const toiVertical = detectKinematicCollision(
            simulation,
            b,
            new Rapier.Vector3(0, targetForceY, 0),
            CAST_SHAPE_V,
            PLAYER_HEIGHT / 2,
          )

          const grounded = toiVertical && Math.abs(toiVertical.normal1.y) > 0

          if (grounded) {
            // body is grounded – remove y forces and apply player input
            targetForceY = hasInput(i, PlayerInput.Jump) ? 0.3 : 0
            targetForceX = (force.x[k] + (right - left) * 0.05) * (1 - DAMPING_GROUND)
            targetForceZ = (force.z[k] + (down - up) * 0.05) * (1 - DAMPING_GROUND)
          }
          // TODO: mid-air motion (to help get over obstacles)

          // handle horizontal (x,z-axis) collisions
          const toiHorizontal = detectKinematicCollision(
            simulation,
            b,
            new Rapier.Vector3(targetForceX, 0, targetForceZ),
            CAST_SHAPE_H,
            PLAYER_RADIUS,
          )

          if (toiHorizontal) {
            // inhibit movement along axis where collision is occurring
            const { x, z } = toiHorizontal.normal1
            if (Math.abs(x) > 0.1) targetForceX = 0
            if (Math.abs(z) > 0.1) targetForceZ = 0
          }

          // integrate the updated forces
          t.x += force.x[k] = targetForceX
          t.y += force.y[k] = targetForceY
          t.z += force.z[k] = targetForceZ

          // disable repeating jump input
          input[k] &= ~PlayerInput.Jump

          // update kinematic body
          b.setNextKinematicTranslation(t)
        }
      }
      simulation.timestep = TIMESTEP
      simulation.step()
    },
    snapshot(): Snapshot {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, input, force]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          return {
            translation: b.translation(),
            rotation: b.rotation(),
            force: { x: force.x[k], y: force.y[k], z: force.z[k] },
            input: input[k],
            clone: Net.clone,
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
        for (let k = 0; k < entities.length; k++) {
          const e = entities[k]
          if (e === entity) {
            input[k] |= on
            input[k] &= ~off
            break
          }
        }
      }
    },
    applySnapshot(snapshot: Snapshot) {
      for (let i = 0; i < players.length; i++) {
        const [entities, [body, input, force]] = players[i]
        for (let k = 0; k < entities.length; k++) {
          const b = body[k] as Rapier.RigidBody
          // hard-snap physics state
          b.setTranslation(snapshot.translation, true)
          b.setRotation(snapshot.rotation, true)
          force.x[k] = snapshot.force.x
          force.y[k] = snapshot.force.y
          force.z[k] = snapshot.force.z
          input[k] = snapshot.input
        }
      }
    },
  }
}
