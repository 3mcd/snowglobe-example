import * as Snowglobe from "@hastearcade/snowglobe"
import * as HrtimeLoop from "@javelin/hrtime-loop"
import * as Harmony from "harmony-ecs"
import * as Http from "http"
import * as Static from "node-static"
import Rapier from "rapier3d-node"
import * as Ws from "ws"
import * as Debug from "../shared/debug"
import * as Game from "../shared/game"
import * as Model from "../shared/model"
import * as Net from "../shared/net"
import * as World from "../shared/simulation"

function onRequest(request: Http.IncomingMessage, response: Http.ServerResponse) {
  function onRequestEnd() {
    fileServer.serve(request, response)
  }
  request.addListener("end", onRequestEnd).resume()
}

const fileServer = new Static.Server("./client/dist")
const httpServer = Http.createServer(onRequest)
const socketServer = new Ws.WebSocketServer({ server: httpServer })
const ecs = Harmony.World.make(Game.ENTITY_COUNT)
const model = Model.make(ecs)
const physics = new Rapier.World(Game.GRAVITY)
const snowglobeWorld = World.make(ecs, model, physics)
const snowglobeServer = new Snowglobe.Server(snowglobeWorld, World.config, 0)
const snowglobeConnections = new Map<number, Net.Connection>()
const snowglobeConnectionHandlesBySocket = new WeakMap<Ws.WebSocket, number>()
const snowglobeNetworkResource = Net.make(snowglobeConnections)

let nextConnectionHandle = 0

function broadcastSpawnClientActor() {}

function broadcastDestroyClientActor() {}

function spawnClientActor() {
  const body = Harmony.Entity.make(ecs, model.prefabs.Player, [])
}

function onSocketClose(this: Ws.WebSocket) {
  const connectionHandle = snowglobeConnectionHandlesBySocket.get(this)
  Debug.invariant(
    typeof connectionHandle === "number",
    "socket closed without a connection handle",
  )
  snowglobeConnections.delete(connectionHandle)
}

function onSocketConnect(socket: Ws.WebSocket) {
  const snowglobeConnectionHandle = nextConnectionHandle++
  const snowglobeConnection = Net.makeConnection(socket, snowglobeConnectionHandle)
  snowglobeConnections.set(snowglobeConnectionHandle, snowglobeConnection)
  snowglobeConnectionHandlesBySocket.set(socket, snowglobeConnectionHandle)
  socket.binaryType = "arraybuffer"
  socket.on("close", onSocketClose)
  spawnClientActor()
}

let timeSinceStartup = 0

function step(clock: HrtimeLoop.Clock) {
  const deltaSeconds = clock.dt / 1000
  snowglobeServer.update(deltaSeconds, timeSinceStartup, snowglobeNetworkResource)
  timeSinceStartup += deltaSeconds
}

const loop = HrtimeLoop.createHrtimeLoop(step, Game.TIMESTEP * 1000)

socketServer.on("connection", onSocketConnect)

loop.start()

httpServer.listen(process.env.PORT)
