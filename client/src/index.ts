import * as Three from "three"
import * as ECS from "harmony-ecs"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"

const ws = new WebSocket("ws://localhost:8000")
const MAX_ENTITIES = 2_000

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

const world = ECS.makeWorld(MAX_ENTITIES)
const Mesh = ECS.makeSchema(world, {})
const Player = [Mesh] as const

function makePlayer(world: ECS.World, scene: Three.Scene) {
  const geometry = new Three.BoxGeometry(0.5, 0.5, 0.5)
  const material = new Three.MeshLambertMaterial({ color: 0xff0000 })
  const mesh = new Three.Mesh(geometry, material)
  scene.add(mesh)
  return ECS.makeEntity(world, Player, [mesh])
}

const player = makePlayer(world, scene)
const archetype = world.entityIndex[player]
const meshes = archetype.table.find(col => col.schema.id === Mesh)
const keys = ["x", "y", "z"]

makePlayer(world, scene)

ws.binaryType = "arraybuffer"
ws.addEventListener("message", message => {
  const frame = new Float64Array(message.data)
  const count = frame[0]
  let k = 1
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    for (let j = 0; j < count; j++) {
      meshes.data[j].position[key] = frame[k++]
    }
  }
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
