import * as Rapier from "@dimforge/rapier3d-compat"
import * as Snowglobe from "@hastearcade/snowglobe"
import * as Harmony from "harmony-ecs"
import WebSocket from "isomorphic-ws"
import * as Three from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import * as Net from "../../shared/net"
import * as World from "../../shared/simulation"
import * as Game from "../../shared/game"
import * as Model from "../../shared/model"
import * as Input from "../../shared/input"
import { CapsuleBufferGeometry } from "./3d/CapsuleBufferGeometry"

await Rapier.init()

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

const tmpQuatL = new Three.Quaternion()
const tmpQuatR = new Three.Quaternion()

export function interpolate(
  left: World.SimulationDisplay,
  right: World.SimulationDisplay,
  t: number,
) {
  const display = Harmony.SparseMap.make() as World.SimulationDisplay
  Harmony.SparseMap.forEach(right, (drawR, entity) => {
    const drawL = Harmony.SparseMap.get(left, entity)
    if (drawL) {
      const { x, y, z } = lerp(drawL, drawR, t)
      tmpQuatL.set(drawL.qx, drawL.qy, drawL.qz, drawL.qw)
      tmpQuatR.set(drawR.qx, drawR.qy, drawR.qz, drawR.qw)
      const { x: qx, y: qy, z: qz, w: qw } = tmpQuatR.slerp(tmpQuatL, t)
      Harmony.SparseMap.set(display, entity, { x, y, z, qx, qy, qz, qw })
    }
  })
  Reflect.set(display, "clone", Net.clone)
  return display
}

function makeSimulationDependencies() {
  const ecs = Harmony.World.make(Game.ENTITY_COUNT)
  const model = Model.make(ecs)
  const physics = new Rapier.World(Game.GRAVITY)
  return [ecs, model, physics as any] as const
}

const socket = new WebSocket(`wss://${window.location.host}/ws`)
const snowglobeConnections = new Map<number, Net.Connection>()
const snowglobeNetworkResource = Net.make(snowglobeConnections)
const snowglobeClient = new Snowglobe.Client(
  function makeSnowglobeWorld() {
    return World.make(...makeSimulationDependencies())
  },
  World.config,
  interpolate,
)

socket.binaryType = "arraybuffer"
socket.addEventListener("open", () =>
  snowglobeConnections.set(0, Net.makeConnection(socket, 0)),
)
socket.addEventListener("close", () => snowglobeConnections.delete(0))

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

const [ecs] = makeSimulationDependencies()
const Mesh = Harmony.Schema.make(ecs, {})
const model = {
  schemas: {
    Mesh,
  },
  prefabs: {
    Drawable: [Mesh],
  },
}
const drawables = Harmony.Query.make(ecs, model.prefabs.Drawable)

function attachMesh(
  entity: Harmony.Entity.Id,
  world: Harmony.World.World,
  scene: Three.Scene,
) {
  const geometry = new CapsuleBufferGeometry(1, 1, 3, 10, 10, 10, 10)
  const material = new Three.MeshLambertMaterial({ color: 0xff0000 })
  const mesh = new Three.Mesh(geometry, material)
  scene.add(mesh)
  return Harmony.Entity.set(world, entity, model.prefabs.Drawable, [mesh])
}

const groundGeometry = new Three.BoxGeometry(200, 1, 200)
const groundMaterial = new Three.MeshLambertMaterial({
  color: 0x666666,
  side: Three.DoubleSide,
})
const ground = new Three.Mesh(groundGeometry, groundMaterial)

const obstacleGeometry = new Three.BoxGeometry(20, 2, 20)
const obstacleMaterial = new Three.MeshLambertMaterial({ color: 0x3333bb })
const obstacle1 = new Three.Mesh(obstacleGeometry, obstacleMaterial)
const obstacle2 = new Three.Mesh(obstacleGeometry, obstacleMaterial)

obstacle1.position.set(10, 1, 10)
obstacle2.position.set(25, 1, 25)

scene.add(camera)
scene.add(ground)
scene.add(obstacle1)
scene.add(obstacle2)
camera.position.y = 20
camera.position.z = 20

function render(display: World.SimulationDisplay) {
  for (const [entities, [m]] of drawables) {
    for (let _ = 0; _ < entities.length; _++) {
      const mesh = m[_] as Three.Mesh
      const draw = Harmony.SparseMap.get(display, entities[_])
      if (draw) {
        const { x, y, z, qx, qy, qz, qw } = draw
        mesh.position.set(x, y, z)
        mesh.quaternion.set(qx, qy, qz, qw)
      }
    }
  }
  controls.update()
  renderer.render(scene, camera)
}

let secondsSinceStartup = 0
let secondsSincePreviousTick: number

function step(now: number) {
  const secondsNow = now / 1000
  if (secondsSinceStartup === undefined) {
    secondsSinceStartup = secondsNow
  }
  snowglobeClient.update(
    secondsNow - (secondsSincePreviousTick ?? secondsNow),
    secondsNow - secondsSinceStartup,
    snowglobeNetworkResource,
  )
  const displayState = snowglobeClient
    .stage()
    .ready?.displayState()
    .displayState()
    .clone()
  if (displayState) {
    render(displayState)
  }
  secondsSincePreviousTick = secondsNow
  requestAnimationFrame(step)
}

requestAnimationFrame(step)

const inputs = {
  Space: { input: Input.Intent.Jump, repeat: false },
  KeyW: { input: Input.Intent.Up },
  KeyS: { input: Input.Intent.Down },
  KeyA: { input: Input.Intent.Left },
  KeyD: { input: Input.Intent.Right },
}

function makeInputCommand(entity: number, on: number, off: number) {
  const data = new ArrayBuffer(7)
  const view = new DataView(data)
  view.setUint8(0, Net.MessageType.Snowglobe)
  view.setUint8(1, Snowglobe.NetworkMessageType.CommandMessage)
  view.setInt32(2, entity)
  view.setUint8(6, on)
  view.setUint8(7, off)
  return data as World.SimulationCommand
}

document.addEventListener("keydown", e => {
  const config = inputs[e.code]
  if (!config || (config.repeat === false && e.repeat)) return
  snowglobeClient
    .stage()
    .ready?.issueCommand(makeInputCommand(123, config.input, 0), snowglobeNetworkResource)
})

document.addEventListener("keyup", e => {
  const config = inputs[e.code]
  if (!config) return
  snowglobeClient
    .stage()
    .ready?.issueCommand(makeInputCommand(123, 0, config.input), snowglobeNetworkResource)
})
