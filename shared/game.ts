import * as Rapier from "rapier3d-node"
import * as Harmony from "harmony-ecs"
import * as Model from "./model"

export const TIMESTEP = 1 / 60
export const ENTITY_COUNT = 1_000
export const GRAVITY = { x: 0, y: -9.81, z: 0 }
export const PLAYER_ACTOR_HEIGHT = 3
export const PLAYER_ACTOR_RADIUS = 1
export const DAMPING_GROUND = 0.15

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

export function makePlayerActor(
  ecs: Harmony.World.World,
  { prefabs }: Model.Model,
  physics: Rapier.World,
  x = 0,
  y = 0,
  z = 0,
) {
  const body = physics.createRigidBody(
    new Rapier.RigidBodyDesc(Rapier.RigidBodyType.KinematicPositionBased).setTranslation(
      x,
      y,
      z,
    ),
  )
  physics.createCollider(
    Rapier.ColliderDesc.capsule(PLAYER_ACTOR_HEIGHT / 2, PLAYER_ACTOR_RADIUS)
      .setActiveCollisionTypes(
        Rapier.ActiveCollisionTypes.DEFAULT |
          Rapier.ActiveCollisionTypes.KINEMATIC_STATIC,
      )
      .setCollisionGroups(CollisionMask.ActorMask),
    body.handle,
  )
  return Harmony.Entity.make(ecs, prefabs.Player, [body])
}

export function makeGround(
  ecs: Harmony.World.World,
  { prefabs }: Model.Model,
  physics: Rapier.World,
) {
  const body = physics.createRigidBody(
    new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static).setTranslation(0, 0, 0),
  )
  const collider = physics.createCollider(
    Rapier.ColliderDesc.cuboid(100, 0.5, 100)
      .setActiveCollisionTypes(
        Rapier.ActiveCollisionTypes.DEFAULT |
          Rapier.ActiveCollisionTypes.KINEMATIC_STATIC,
      )
      .setCollisionGroups(CollisionMask.TerrainMask)
      .setSensor(true),
    body.handle,
  )
  return Harmony.Entity.make(ecs, prefabs.Ground, [body])
}

export function makeWall(
  ecs: Harmony.World.World,
  { prefabs }: Model.Model,
  physics: Rapier.World,
  x = 0,
  z = 0,
) {
  const body = physics.createRigidBody(
    new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static).setTranslation(x, 1, z),
  )
  const collider = physics.createCollider(
    Rapier.ColliderDesc.cuboid(10, 1, 10)
      .setActiveCollisionTypes(
        Rapier.ActiveCollisionTypes.DEFAULT |
          Rapier.ActiveCollisionTypes.KINEMATIC_STATIC,
      )
      .setCollisionGroups(CollisionMask.TerrainMask)
      .setSensor(true),
    body.handle,
  )
  return Harmony.Entity.make(ecs, prefabs.Wall, [body])
}
