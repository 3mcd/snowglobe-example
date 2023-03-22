import { init, Vector3 } from "@dimforge/rapier3d-compat"
import * as Snowglobe from "@hastearcade/snowglobe"
import * as Harmony from "harmony-ecs"
import { Entity, Schema } from "harmony-ecs"
import WebSocket from "isomorphic-ws"
import * as Three from "three"
import { Quaternion } from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import * as Net from "../../shared/net"
import * as World from "../../shared/world"
import CapsuleBufferGeometry from "./3d/CapsuleBufferGeometry"

await init()

// only one, hardcoded entity at the moment
const ENTITY = 3

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
  const geometry = new CapsuleBufferGeometry(1, 1, 3, 10, 10, 10, 10)
  const material = new Three.MeshLambertMaterial({ color: 0xff0000 })
  const mesh = new Three.Mesh(geometry, material)
  scene.add(mesh)
  return Entity.set(world, entity, Drawable, [mesh])
}

attachMesh(ENTITY, world, scene)

const groundGeometry = new Three.BoxGeometry(200, 1, 200)
const groundMaterial = new Three.MeshLambertMaterial({
  color: 0x666666,
  side: Three.DoubleSide,
})
const ground = new Three.Mesh(groundGeometry, groundMaterial)

const obstacleGeometry = new Three.BoxGeometry(20, 2, 20)
const obstacleMaterial = new Three.MeshLambertMaterial({
  color: 0x3333bb,
})
const obstacle = new Three.Mesh(obstacleGeometry, obstacleMaterial)

const obstacle2Geometry = new Three.BoxGeometry(10, 2, 10)
const obstacle2Material = new Three.MeshLambertMaterial({
  color: 0x3333bb,
})
const obstacle2 = new Three.Mesh(obstacleGeometry, obstacleMaterial)

obstacle.position.set(10, 1, 10)
obstacle2.position.set(25, 1, 25)

scene.add(camera)
scene.add(ground)
scene.add(obstacle)
scene.add(obstacle2)
camera.position.y = 20
camera.position.z = 20

function render({ translation, rotation }: World.DisplayState) {
  for (const [entities, [mesh]] of drawables) {
    for (let i = 0; i < entities.length; i++) {
      const m = mesh[i] as Three.Mesh
      m.position.set(translation.x, translation.y, translation.z)
      m.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
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

const inputs = {
  Space: { input: World.PlayerInput.Jump, repeat: false },
  KeyW: { input: World.PlayerInput.Up },
  KeyS: { input: World.PlayerInput.Down },
  KeyA: { input: World.PlayerInput.Left },
  KeyD: { input: World.PlayerInput.Right },
}

function makeInputCommand(entity: number, on: number, off: number) {
  return {
    entity,
    on,
    off,
    clone: Net.clone,
  }
}

document.addEventListener("keydown", e => {
  const config = inputs[e.code]
  if (!config || (config.repeat === false && e.repeat)) return
  client.stage().ready?.issueCommand(makeInputCommand(ENTITY, config.input, 0), net)
})

document.addEventListener("keyup", e => {
  const config = inputs[e.code]
  if (!config) return
  client.stage().ready?.issueCommand(makeInputCommand(ENTITY, 0, config.input), net)
})
