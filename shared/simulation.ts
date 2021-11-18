import * as Snowglobe from "@hastearcade/snowglobe"
import * as Harmony from "harmony-ecs"
import Rapier from "rapier3d-node"
import * as Game from "./game"
import * as Input from "./input"
import * as Model from "./model"
import * as Net from "./net"

const CAST_SHAPE_V = new Rapier.Capsule(
  Game.PLAYER_ACTOR_HEIGHT * 0.5,
  Game.PLAYER_ACTOR_RADIUS,
)
const CAST_SHAPE_H = new Rapier.Capsule(
  Game.PLAYER_ACTOR_HEIGHT * 0.49,
  Game.PLAYER_ACTOR_RADIUS,
)

export type Simulation = Snowglobe.World<
  SimulationCommand,
  SimulationSnapshot,
  SimulationDisplay
>
export type SimulationCommand = Snowglobe.Command & ArrayBuffer
export type SimulationSnapshot = Snowglobe.Snapshot & ArrayBuffer
export type SimulationDisplay = Snowglobe.DisplayState &
  Harmony.SparseMap.SparseMap<PlayerActorDisplay, Harmony.Entity.Id>

type PlayerActorDisplay = {
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
}

enum SimulationCommandType {
  Input,
}

function detectCollisionNaive(
  physics: Rapier.World,
  body: Rapier.RigidBody,
  forceVector: Rapier.Vector3,
  shape: Rapier.Shape,
  distance: number,
) {
  const translation = body.translation()
  const rotation = body.rotation()
  const hit = physics.castShape(
    translation,
    rotation,
    forceVector,
    shape,
    distance,
    Game.CollisionMask.ActorMask,
  )

  return hit
}

export const config = Snowglobe.makeConfig({
  timestepSeconds: Game.TIMESTEP,
  tweeningMethod: Snowglobe.TweeningMethod.Interpolated,
})

const tempVector = new Rapier.Vector3(0, 0, 0)
const tempQuaternion = new Rapier.Quaternion(0, 0, 0, 1)

function setVec(
  vector: Rapier.Vector3,
  x = 0,
  y = 0,
  z = 0,
  out = new Rapier.Vector3(0, 0, 0),
) {
  out.x = x
  out.y = y
  out.z = z
  return out
}

function setQuat(
  quat: Rapier.Quaternion,
  x = 0,
  y = 0,
  z = 0,
  w = 0,
  out = new Rapier.Quaternion(0, 0, 0, 1),
) {
  out.x = x
  out.y = y
  out.z = z
  out.w = w
  return out
}

export function make(
  ecs: Harmony.World.World,
  model: Model.Model,
  physics: Rapier.World,
): Simulation {
  const players = Harmony.Query.make(ecs, model.prefabs.Player)
  const InputPrefab = [model.schemas.Input] as const
  const LocalPlayerState = [model.schemas.Force, model.schemas.Input] as const

  const BYTES_PER_PLAYER_ACTOR_SNAPSHOT =
    4 + // entity
    8 * 3 + // translation
    8 * 4 + // rotation
    8 * 3 + // force
    1 // input

  function snapshot() {
    const count = players.reduce((a, [entities]) => a + entities.length, 0)
    const data = new ArrayBuffer(
      1 + // type
        1 + // snowglobe type
        count * BYTES_PER_PLAYER_ACTOR_SNAPSHOT,
    )
    const view = new DataView(data)

    let offset = 0
    // type
    view.setUint8(offset++, Net.MessageType.Snowglobe)
    // snowglobe type
    view.setUint8(offset++, Snowglobe.NetworkMessageType.SnapshotMessage)

    for (const [entities, [b, i, f]] of players) {
      for (let _ = 0; _ < entities.length; _++) {
        const entity = entities[_]
        const body = b[_] as Rapier.RigidBody
        const { x, y, z } = body.translation()
        const { x: qx, y: qy, z: qz, w: qw } = body.rotation()
        // entity
        view.setInt32(offset, entity)
        offset += 4
        // translation
        view.setFloat64(offset, x)
        offset += 8
        view.setFloat64(offset, y)
        offset += 8
        view.setFloat64(offset, z)
        offset += 8
        // rotation
        view.setFloat64(offset, qx)
        offset += 8
        view.setFloat64(offset, qy)
        offset += 8
        view.setFloat64(offset, qz)
        offset += 8
        view.setFloat64(offset, qw)
        offset += 8
        // force
        view.setFloat64(offset, f.x[_])
        offset += 8
        view.setFloat64(offset, f.y[_])
        offset += 8
        view.setFloat64(offset, f.z[_])
        offset += 8
        // input
        view.setUint8(offset, i[_])
      }
    }
    return data as SimulationSnapshot
  }

  function applySnapshot(snapshot: SimulationSnapshot) {
    const view = new DataView(snapshot)

    let offset = 2

    while (offset < snapshot.byteLength) {
      // entity
      const entity = view.getInt32(offset)
      offset += 4

      const table = Harmony.World.tryGetEntityTable(ecs, entity)
      if (table === undefined) {
        offset += BYTES_PER_PLAYER_ACTOR_SNAPSHOT - 4
        continue
      }

      // translation
      const x = view.getFloat64(offset)
      offset += 8
      const y = view.getFloat64(offset)
      offset += 8
      const z = view.getFloat64(offset)
      offset += 8
      // rotation
      const qx = view.getFloat64(offset)
      offset += 8
      const qy = view.getFloat64(offset)
      offset += 8
      const qz = view.getFloat64(offset)
      offset += 8
      const qw = view.getFloat64(offset)
      offset += 8
      // force
      const fx = view.getFloat64(offset)
      offset += 8
      const fy = view.getFloat64(offset)
      offset += 8
      const fz = view.getFloat64(offset)
      offset += 8
      // input
      const input = view.getUint8(offset)
      offset += 1

      const tableIndex = table.entityIndex[entity]
      const tableColumn = table.store[table.layout[model.schemas.Capsule]]
      const capsule = tableColumn.data[tableIndex] as Rapier.RigidBody

      capsule.setTranslation(setVec(tempVector, x, y, z, tempVector), false)
      capsule.setRotation(setQuat(tempQuaternion, qx, qy, qz, qw, tempQuaternion), false)

      Harmony.Entity.set(ecs, entity, LocalPlayerState, [
        setVec(tempVector, fx, fy, fz, tempVector),
        input,
      ])
    }
  }

  function displayState() {
    const display = Harmony.SparseMap.make<PlayerActorDisplay, Harmony.Entity.Id>()
    for (const [entities, [b]] of players) {
      for (let _ = 0; _ < entities.length; _++) {
        const body = b[_] as Rapier.RigidBody
        const { x, y, z } = body.translation()
        const { x: qx, y: qy, z: qz, w: qw } = body.rotation()
        Harmony.SparseMap.set(display, entities[_], { x, y, z, qx, qy, qz, qw })
      }
    }
    Reflect.set(display, "clone", Net.clone)
    return display as SimulationDisplay
  }

  function applyCommand(command: SimulationCommand) {
    const commandType = command[0] as SimulationCommandType

    switch (commandType) {
      case SimulationCommandType.Input: {
        const entity = command[1]
        if (entity === undefined) {
          console.warn(
            `Failed to apply command: command subject ${entity} does not exist`,
          )
          return
        }
        const table = Harmony.World.tryGetEntityTable(ecs, entity)
        if (table === undefined) {
          console.warn(`Failed to apply command: command subject ${entity} not real`)
          return
        }
        const tableIndex = table.entityIndex[entity]
        const tableColumn = table.store[table.layout[model.schemas.Input]]
        let input = tableColumn.data[tableIndex] as number
        Harmony.Entity.set(ecs, entity, InputPrefab, [(input | command[2]) & ~command[3]])
        break
      }
      default:
        console.warn(`Received invalid command type ${commandType}`)
    }
  }

  function commandIsValid() {
    return true
  }

  function step() {
    for (let i = 0; i < players.length; i++) {
      const [entities, [body, input, force]] = players[i]
      for (let k = 0; k < entities.length; k++) {
        const i = input[k]
        const b = body[k] as Rapier.RigidBody
        const t = b.translation()
        const up = +Input.has(i, Input.Intent.Up)
        const down = +Input.has(i, Input.Intent.Down)
        const left = +Input.has(i, Input.Intent.Left)
        const right = +Input.has(i, Input.Intent.Right)

        let targetForceX = force.x[k]
        let targetForceY = force.y[k] - 9.81 * 0.002 // gravity
        let targetForceZ = force.z[k]

        // handle vertical (y-axis) collisions
        const toiVertical = detectCollisionNaive(
          physics,
          b,
          new Rapier.Vector3(0, targetForceY, 0),
          CAST_SHAPE_V,
          Game.PLAYER_ACTOR_HEIGHT / 2,
        )

        const grounded = toiVertical && Math.abs(toiVertical.normal1.y) > 0

        if (grounded) {
          // body is grounded – remove y forces and apply player input
          targetForceY = Input.has(i, Input.Intent.Jump) ? 0.3 : 0
          targetForceX = (force.x[k] + (right - left) * 0.05) * (1 - Game.DAMPING_GROUND)
          targetForceZ = (force.z[k] + (down - up) * 0.05) * (1 - Game.DAMPING_GROUND)
        }
        // TODO: mid-air motion (to help get over obstacles)

        // handle horizontal (x,z-axis) collisions
        const toiHorizontal = detectCollisionNaive(
          physics,
          b,
          new Rapier.Vector3(targetForceX, 0, targetForceZ),
          CAST_SHAPE_H,
          Game.PLAYER_ACTOR_RADIUS,
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
        input[k] &= ~Input.Intent.Jump

        // update kinematic body
        b.setNextKinematicTranslation(t)
      }
    }
    physics.timestep = Game.TIMESTEP
    physics.step()
  }

  return {
    applyCommand,
    applySnapshot,
    commandIsValid,
    displayState,
    snapshot,
    step,
  }
}
