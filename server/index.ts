import * as Loop from "@javelin/hrtime-loop"
import * as Snowglobe from "snowglobe"
import { WebSocketServer } from "ws"
import * as Net from "../shared/net"
import * as World from "../shared/world"

let nextConnectionHandle = 0
const connections = new Map<number, Net.Connection>()

const wss = new WebSocketServer({ port: 8000 })
const net = Net.make(connections)
const world = World.make()
const server = new Snowglobe.Server(world, World.config, 0)

wss.on("connection", socket => {
  const connectionHandle = nextConnectionHandle++
  const connection = Net.makeConnection(socket, connectionHandle)
  connections.set(connectionHandle, connection)
  socket.binaryType = "arraybuffer"
  socket.on("close", () => connections.delete(connectionHandle))
})

let timeSinceStartup = 0

const loop = Loop.createHrtimeLoop(clock => {
  const deltaSeconds = clock.dt / 1000
  server.update(clock.dt / 1000, timeSinceStartup, net)
  timeSinceStartup += deltaSeconds

  // console.log(
  //   Math.floor(
  //     world.ecs.rootTable.edgesSet[0].edgesSet[1].store[0].data[0].translation().y,
  //   ),
  // )
}, (1 / 60) * 1000)

loop.start()
