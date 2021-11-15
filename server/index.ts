import * as Loop from "@javelin/hrtime-loop"
import * as Snowglobe from "snowglobe"
import { WebSocketServer } from "ws"
import * as Net from "../shared/net"
import * as World from "../shared/world"

let nextConnectionHandle = 0
const connections = new Map<number, Net.Connection>()

const wss = new WebSocketServer({ port: 8000 })
const net = Net.makeNet(connections)
const config = Snowglobe.makeConfig()
const server = new Snowglobe.Server(World.make(), config, 0)

wss.on("connection", socket => {
  const connectionHandle = nextConnectionHandle++
  const connection = Net.makeConnection(socket, connectionHandle)
  connections.set(connectionHandle, connection)
  socket.binaryType = "arraybuffer"
  socket.on("close", () => connections.delete(connectionHandle))
})

const loop = Loop.createHrtimeLoop(clock => {
  server.update(clock.dt / 1000, Number(clock.now) / 1000, net)
}, (1 / 60) * 1000)

loop.start()
