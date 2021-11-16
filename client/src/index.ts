import * as Three from "three"
import { Schema, Entity } from "harmony-ecs"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import CapsuleBufferGeometry from "./3d/CapsuleBufferGeometry"
import * as Snowglobe from "snowglobe"
import * as Net from "../../shared/net"
import * as World from "../../shared/world"
import * as Harmony from "harmony-ecs"
import WebSocket from "isomorphic-ws"
import { init, Vector3 } from "@dimforge/rapier3d-compat"
import { Quaternion } from "three"

await init()

function lerp(a: Vector3, b: Vector3, t: number) {
  const ax = a.x
  const ay = a.y
  const az = a.z
  const out = new Vector3(0, 0, 0)
  out.x = ax + t * (b.x - ax)
  out.y = ay + t * (b.y - ay)
  out.z = az + t * (b.z - az)
  return out
}

const tmpQuatFrom = new Quaternion()
const tmpQuatTo = new Quaternion()

export function interpolate(
  left: World.DisplayState,
  right: World.DisplayState,
  t: number,
) {
  tmpQuatFrom.set(left.rotation.x, left.rotation.y, left.rotation.z, left.rotation.w)
  tmpQuatTo.set(right.rotation.x, right.rotation.y, right.rotation.z, right.rotation.w)
  const { x, y, z, w } = tmpQuatTo.slerp(tmpQuatFrom, t)
  return {
    translation: lerp(left.translation, right.translation, t),
    clone: Net.clone,
    rotation: { x, y, z, w },
  }
}

const connections = new Map<number, Net.Connection>()
const socket = new WebSocket(`ws://${window.location.hostname}:8000`)
const net = Net.make(connections)
const client = new Snowglobe.Client(World.make, World.config, interpolate)

socket.binaryType = "arraybuffer"
socket.addEventListener("open", () => connections.set(0, Net.makeConnection(socket, 0)))
socket.addEventListener("close", () => connections.delete(0))

const canvas = document.getElementById("game") as HTMLCanvasElement
const camera = new Three.PerspectiveCamera(45, 1, 0.1, 2000000)
const renderer = new Three.WebGLRenderer({ antialias: true, canvas })
const controls = new OrbitControls(camera, renderer.domElement)
const scene = new Three.Scene()

scene.add(new Three.AmbientLight(0x404040), new Three.DirectionalLight(0xffffff, 0.5))

function scale() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

window.addEventListener("resize", scale, false)
scale()

const { ecs: world } = World.make()
const Mesh = Schema.make(world, {})
const Drawable = [Mesh] as const
const drawables = Harmony.Query.make(world, Drawable)

function attachMesh(
  entity: Harmony.Entity.Id,
  world: Harmony.World.World,
  scene: Three.Scene,
) {
  const geometry = new CapsuleBufferGeometry(1, 1, 2, 10, 10, 10, 10)
  const material = new Three.MeshLambertMaterial({ color: 0xff0000 })
  const mesh = new Three.Mesh(geometry, material)
  scene.add(mesh)
  return Entity.set(world, entity, Drawable, [mesh])
}

attachMesh(4, world, scene)

scene.add(camera)
camera.position.x = 20
camera.position.y = 20
camera.position.z = 20

function render({ translation, rotation }: World.DisplayState) {
  for (const [entities, [mesh]] of drawables) {
    for (let i = 0; i < entities.length; i++) {
      ;(mesh[i] as Three.Mesh).position.set(translation.x, translation.y, translation.z)
      ;(mesh[i] as Three.Mesh).quaternion.set(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      )
      break
    }
  }
  controls.update()
  renderer.render(scene, camera)
}

let startSeconds = 0
let prevSeconds: number

function step(now: number) {
  const nowSeconds = now / 1000
  if (startSeconds === undefined) {
    startSeconds = nowSeconds
  }
  client.update(nowSeconds - (prevSeconds ?? nowSeconds), nowSeconds - startSeconds, net)
  const displayState = client.stage().ready?.displayState().displayState().clone()
  if (displayState) {
    render(displayState)
  }
  prevSeconds = nowSeconds
  requestAnimationFrame(step)
}

requestAnimationFrame(step)

document.addEventListener("keydown", e => {
  if (!e.repeat && e.code === "Space") {
    const command = { entity: 4, on: World.PlayerInput.Jump, off: 0, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
  if (e.code === "KeyW") {
    const command = { entity: 4, on: World.PlayerInput.Up, off: 0, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
  if (e.code === "KeyS") {
    const command = { entity: 4, on: World.PlayerInput.Down, off: 0, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
  if (e.code === "KeyA") {
    const command = { entity: 4, on: World.PlayerInput.Left, off: 0, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
  if (e.code === "KeyD") {
    const command = { entity: 4, on: World.PlayerInput.Right, off: 0, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
})

document.addEventListener("keyup", e => {
  if (e.code === "Space") {
    const command = { entity: 4, on: 0, off: World.PlayerInput.Jump, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
  if (e.code === "KeyW") {
    const command = { entity: 4, on: 0, off: World.PlayerInput.Up, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
  if (e.code === "KeyS") {
    const command = { entity: 4, on: 0, off: World.PlayerInput.Down, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
  if (e.code === "KeyA") {
    const command = { entity: 4, on: 0, off: World.PlayerInput.Left, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
  if (e.code === "KeyD") {
    const command = { entity: 4, on: 0, off: World.PlayerInput.Right, clone: Net.clone }
    client.stage().ready?.issueCommand(command, net)
  }
})
