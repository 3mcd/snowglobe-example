import * as Loop from "@javelin/hrtime-loop"
import * as Snowglobe from "@hastearcade/snowglobe"
import { WebSocketServer } from "ws"
import * as Net from "../shared/net"
import * as World from "../shared/world"
import { createServer } from "http"
import * as Static from "node-static"

let nextConnectionHandle = 0
const connections = new Map<number, Net.Connection>()
const file = new Static.Server("./client/dist")
const http = createServer((req, res) => {
  req
    .addListener("end", function () {
      file.serve(req, res)
    })
    .resume()
})
const wss = new WebSocketServer({ server: http })
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
  server.update(deltaSeconds, timeSinceStartup, net)
  timeSinceStartup += deltaSeconds
}, (1 / 60) * 1000)

loop.start()

http.listen(process.env.PORT)
