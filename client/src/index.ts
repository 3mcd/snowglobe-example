import * as Three from "three"
import { Schema, Entity } from "harmony-ecs"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import CapsuleBufferGeometry from "./3d/CapsuleBufferGeometry"
import * as Snowglobe from "snowglobe"
import * as Net from "../../shared/net"
import * as World from "../../shared/world"
import * as Harmony from "harmony-ecs"

const connections = new Map<number, Net.Connection>()
const ws = new WebSocket("ws://localhost:8000")
const net = Net.makeNet(connections)
const config = Snowglobe.makeConfig()
const client = new Snowglobe.Client(World.make, config, World.interpolate)

ws.binaryType = "arraybuffer"
ws.addEventListener("open", socket => connections.set(0, socket))
ws.addEventListener("close", socket => connections.delete(0))

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

const world = Harmony.World.make(1_000)
const Mesh = Schema.make(world, {})
const Player = [Mesh] as const

function makePlayer(world: World.World, scene: Three.Scene) {
  const geometry = new CapsuleBufferGeometry(1, 1, 2, 10, 10, 10, 10)
  const material = new Three.MeshLambertMaterial({ color: 0xff0000 })
  const mesh = new Three.Mesh(geometry, material)
  scene.add(mesh)
  return Entity.make(world, Player, [mesh])
}

makePlayer(world, scene)
makePlayer(world, scene)

scene.add(camera)
camera.position.x = 20
camera.position.y = 20
camera.position.z = 20

function render(displayState: World.DisplayState) {
  controls.update()
  renderer.render(scene, camera)
}

let startSeconds = 0
let prevSeconds: number

function step(now: number) {
  const nowSeconds = now / 1000
  // render()
  if (startSeconds === undefined) {
    startSeconds = nowSeconds
  }
  client.update(nowSeconds - prevSeconds, now - startSeconds, net)
  const displayState = client.displayState()
  render(displayState)
  prevSeconds = nowSeconds
  requestAnimationFrame(step)
}

requestAnimationFrame(step)

document.addEventListener("keydown", e => {
  if (e.code === "Space") {
    // ws.send(new ArrayBuffer(0))
  }
})
