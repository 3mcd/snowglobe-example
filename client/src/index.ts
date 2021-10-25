import * as Three from "three"
import { World, Schema, Entity } from "harmony-ecs"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import CapsuleBufferGeometry from "./3d/CapsuleBufferGeometry"

const ws = new WebSocket("ws://localhost:8000")
const MAX_ENTITIES = 2_000

let frameId = 0
const frames: [ArrayBuffer, ArrayBuffer][] = []
const messages: ArrayBuffer[] = []
const canvas = document.getElementById("game") as HTMLCanvasElement
const renderer = new Three.WebGLRenderer({ antialias: true, canvas })
const camera = new Three.PerspectiveCamera(45, 1, 0.1, 2000000)
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

const world = World.make(MAX_ENTITIES)
const Mesh = Schema.make(world, {})
const Player = [Mesh] as const

function makePlayer(world: World.World, scene: Three.Scene) {
  const geometry = new CapsuleBufferGeometry(1, 1, 2, 10, 10, 10, 10)
  const material = new Three.MeshLambertMaterial({ color: 0xff0000 })
  const mesh = new Three.Mesh(geometry, material)
  scene.add(mesh)
  return Entity.make(world, Player, [mesh])
}

const player = makePlayer(world, scene)
const archetype = world.entityIndex[player]
const meshes = archetype.store.find(col => col.schema.id === Mesh)
const keys = ["x", "y", "z"]

makePlayer(world, scene)

ws.binaryType = "arraybuffer"
ws.addEventListener("message", message => {
  messages.push(message.data)
})

scene.add(camera)
camera.position.x = 20
camera.position.y = 20
camera.position.z = 20

function render() {
  controls.update()
  renderer.render(scene, camera)
}

function step() {
  render()
  requestAnimationFrame(step)
}

requestAnimationFrame(step)

setInterval(() => {
  for (let i = 0; i < messages.length; i++) {
    let cursor = 0
    const message = new Float64Array(messages[i])
    const frameId = message[cursor++]
    const count = message[cursor++]
    // rollback
    let frame: [ArrayBuffer, ArrayBuffer] = frames[0]

    while (frame[0][0] <= frameId) {
      frames.unshift()
    }

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      for (let j = 0; j < count; j++) {
        meshes.data[j].position[key] = message[cursor++]
      }
    }
  }
}, (1 / 60) * 1000)

document.addEventListener("keydown", e => {
  if (e.code === "Space") {
    ws.send(new ArrayBuffer(0))
  }
})
