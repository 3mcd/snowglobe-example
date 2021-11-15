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
