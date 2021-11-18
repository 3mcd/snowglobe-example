import * as Harmony from "harmony-ecs"

export const Vector3 = {
  x: Harmony.Format.float64,
  y: Harmony.Format.float64,
  z: Harmony.Format.float64,
}

export const Quaternion = {
  ...Vector3,
  w: Harmony.Format.float64,
}

export function make(ecs: Harmony.World.World) {
  const Capsule = Harmony.Schema.make(ecs, {})
  const Input = Harmony.Schema.makeBinary(ecs, Harmony.Format.uint8)
  const Force = Harmony.Schema.makeBinary(ecs, Vector3)
  const Plane = Harmony.Schema.make(ecs, {})
  const Box = Harmony.Schema.make(ecs, {})
  return {
    schemas: { Capsule, Input, Force },
    prefabs: {
      Player: [Capsule, Input, Force] as const,
      Ground: [Plane],
      Wall: [Box],
    },
  }
}

export type Model = ReturnType<typeof make>
