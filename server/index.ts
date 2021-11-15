import * as Loop from "@javelin/hrtime-loop"
import * as Snowglobe from "snowglobe"
import { WebSocket, WebSocketServer } from "ws"
import * as World from "../shared/world"
import * as Harmony from "harmony-ecs"

const wss = new WebSocketServer({ port: 8000 })
const config = Snowglobe.makeConfig()
const server = new Snowglobe.Server(World.make(), config, 0)
const connections = new Map<number, Snowglobe.Connection<World.Command, World.Snapshot>>()
const net: Snowglobe.NetworkResource<World.Command, World.Snapshot> = {
  connections() {
    return connections.entries()
  },
  sendMessage(handle, messageType, message) {
    const connection = connections.get(handle)
    connection.send(messageType, message)
    connection.flush(messageType)
  },
  broadcastMessage(messageType, message) {
    connections.forEach(connection => {
      connection.send(messageType, message)
      connection.flush(messageType)
    })
  },
}

function initChannels(
  channels: Harmony.SparseMap.SparseMap<ArrayBuffer[], Snowglobe.NetworkMessageType>,
) {
  Harmony.SparseMap.set(channels, Snowglobe.NetworkMessageType.ClockSyncMessage, [])
  Harmony.SparseMap.set(channels, Snowglobe.NetworkMessageType.CommandMessage, [])
  Harmony.SparseMap.set(channels, Snowglobe.NetworkMessageType.SnapshotMessage, [])
}

function serialize(messageType: Snowglobe.NetworkMessageType, message: any) {
  switch (messageType) {
    case Snowglobe.NetworkMessageType.ClockSyncMessage: {
      const { clientId, clientSecondsSinceStartup, serverSecondsSinceStartup } = message
      const data = new ArrayBuffer(25)
      const view = new DataView(data)
      view.setUint8(0, messageType)
      view.setFloat64(1, clientId)
      view.setFloat64(9, clientSecondsSinceStartup)
      view.setFloat64(17, serverSecondsSinceStartup)
      return data
    }
    case Snowglobe.NetworkMessageType.CommandMessage: {
      const [entity, jump] = message
      const data = new ArrayBuffer(10)
      const view = new DataView(data)
      view.setUint8(0, messageType)
      view.setFloat64(1, entity)
      view.setUint8(9, jump)
      return data
    }
    case Snowglobe.NetworkMessageType.SnapshotMessage:
      return new Float64Array([
        messageType,
        message.clientId,
        message.clientSecondsSinceStartup,
        message.serverSecondsSinceStartup,
      ])
  }
}

function makeConnection(
  ws: WebSocket,
): Snowglobe.Connection<World.Command, World.Snapshot> {
  const incoming = Harmony.SparseMap.make<ArrayBuffer[], Snowglobe.NetworkMessageType>()
  const outgoing = Harmony.SparseMap.make<ArrayBuffer[], Snowglobe.NetworkMessageType>()
  initChannels(incoming)
  initChannels(outgoing)
  ws.on("message", (data: ArrayBuffer) => {
    const view = new DataView(data)
    const type = view.getUint8(0)
  })
  return {
    recvClockSync() {},
    recvCommand() {},
    recvSnapshot() {},
    send(messageType, message) {
      Harmony.SparseMap.get(outgoing, messageType).push(serialize(messageType, message))
    },
    flush(messageType) {
      Harmony.SparseMap.get(outgoing, messageType).forEach(message => {
        ws.send(message)
      })
    },
  }
}

let send = true

const sockets: WebSocket[] = []
const loop = Loop.createHrtimeLoop(clock => {
  connections.forEach(connection => {})
  server.update(clock.dt / 1000, Number(clock.now) / 1000, net)
}, (1 / 60) * 1000)

function onSocketMessage(socket: WebSocket, data: ArrayBuffer) {}

wss.on("connection", ws => {
  const index = sockets.push(ws) - 1
  ws.binaryType = "arraybuffer"
  ws.on("message", onSocketMessage)
  ws.on("close", () => sockets.splice(index, 1))
})

loop.start()
