import * as Harmony from "harmony-ecs"
import * as Snowglobe from "snowglobe"
import WebSocket from "ws"
import * as World from "../shared/world"

export type Connection = Snowglobe.Connection<World.Command, World.Snapshot> & {
  open: boolean
}

function initChannels(
  channels: Harmony.SparseMap.SparseMap<ArrayBuffer[], Snowglobe.NetworkMessageType>,
) {
  Harmony.SparseMap.set(channels, Snowglobe.NetworkMessageType.ClockSyncMessage, [])
  Harmony.SparseMap.set(channels, Snowglobe.NetworkMessageType.CommandMessage, [])
  Harmony.SparseMap.set(channels, Snowglobe.NetworkMessageType.SnapshotMessage, [])
}

function encode(messageType: Snowglobe.NetworkMessageType, message: any) {
  switch (messageType) {
    case Snowglobe.NetworkMessageType.ClockSyncMessage: {
      const { clientId, clientSendSecondsSinceStartup, serverSecondsSinceStartup } =
        message
      const data = new ArrayBuffer(21)
      const view = new DataView(data)
      view.setUint8(0, messageType)
      view.setUint32(1, clientId)
      view.setFloat64(5, clientSendSecondsSinceStartup)
      view.setFloat64(13, serverSecondsSinceStartup)
      return data
    }
    case Snowglobe.NetworkMessageType.CommandMessage: {
      const [entity, jump] = message
      const data = new ArrayBuffer(6)
      const view = new DataView(data)
      view.setUint8(0, messageType)
      view.setUint32(1, entity)
      view.setUint8(5, jump)
      return data
    }
    case Snowglobe.NetworkMessageType.SnapshotMessage: {
      const data = new ArrayBuffer(1 + message.size * 29)
      const view = new DataView(data)
      let offset = 0
      view.setUint8(offset, messageType)
      offset += 1
      Harmony.SparseMap.forEach(message, ([{ x, y, z }, jump], entity) => {
        view.setUint32(offset, entity)
        offset += 4
        view.setFloat64(offset, x)
        offset += 8
        view.setFloat64(offset, y)
        offset += 8
        view.setFloat64(offset, z)
        offset += 8
        view.setUint8(offset, jump)
        offset += 1
      })
      return data
    }
  }
}

function decode(
  messageType: Snowglobe.NetworkMessageType,
  data: ArrayBuffer,
  offset = 0,
  end = data.byteLength,
) {
  const view = new DataView(data)
  let message: any
  switch (messageType) {
    case Snowglobe.NetworkMessageType.ClockSyncMessage: {
      const clientId = view.getUint32(offset)
      offset += 4
      const clientSendSecondsSinceStartup = view.getFloat64(offset)
      offset += 8
      const serverSecondsSinceStartup = view.getFloat64(offset)
      offset += 8
      message = {
        clientId,
        clientSendSecondsSinceStartup,
        serverSecondsSinceStartup,
      }
      break
    }
    case Snowglobe.NetworkMessageType.CommandMessage:
      message = Object.assign([view.getUint32(offset), view.getUint8(offset + 4)], {
        clone() {
          return message
        },
      })
      break
    case Snowglobe.NetworkMessageType.SnapshotMessage:
      message = {
        ...Harmony.SparseMap.make(),
        clone: () => ({
          ...message,
          values: message.values.map(([translation, jump]) => [{ ...translation }, jump]),
        }),
      } as World.Snapshot
      while (offset < end) {
        const entity = view.getUint32(offset)
        offset += 4
        const x = view.getFloat64(offset)
        offset += 8
        const y = view.getFloat64(offset)
        offset += 8
        const z = view.getFloat64(offset)
        offset += 8
        const jump = view.getUint8(offset)
        offset += 1
        Harmony.SparseMap.set(message, entity, [{ x, y, z }, jump])
      }
      break
  }

  return message
}

export function makeConnection(socket: WebSocket, connectionHandle: number): Connection {
  const incoming = Harmony.SparseMap.make<any[], Snowglobe.NetworkMessageType>()
  const outgoing = Harmony.SparseMap.make<ArrayBuffer[], Snowglobe.NetworkMessageType>()
  initChannels(incoming)
  initChannels(outgoing)
  let open = socket.readyState === socket.OPEN
  socket.onmessage = ({ data }) => {
    const view = new DataView(data as ArrayBuffer)
    const messageType = view.getUint8(0)
    const buffer = Harmony.SparseMap.get(incoming, messageType)
    buffer.unshift(decode(messageType, data as ArrayBuffer, 1))
  }
  socket.onopen = () => (open = true)
  socket.onclose = () => (open = false)

  return {
    recvClockSync() {
      return Harmony.SparseMap.get(
        incoming,
        Snowglobe.NetworkMessageType.ClockSyncMessage,
      ).pop()
    },
    recvCommand() {
      return Harmony.SparseMap.get(
        incoming,
        Snowglobe.NetworkMessageType.CommandMessage,
      ).pop()
    },
    recvSnapshot() {
      return Harmony.SparseMap.get(
        incoming,
        Snowglobe.NetworkMessageType.SnapshotMessage,
      ).pop()
    },
    send(messageType, message) {
      if (!open) {
        console.warn(`Failed to queue message: connection ${connectionHandle} not open.`)
        return
      }
      Harmony.SparseMap.get(outgoing, messageType).unshift(encode(messageType, message))
    },
    flush(messageType) {
      if (!open) {
        console.warn(`Failed to send message: connection ${connectionHandle} not open.`)
        return
      }
      const buffer = Harmony.SparseMap.get(outgoing, messageType)
      let message: ArrayBuffer
      while ((message = buffer.pop())) {
        let m = message
        setTimeout(() => {
          socket.send(m)
        }, 200)
      }
    },
    get open() {
      return open
    },
  }
}

export function make(
  connections: Map<number, Connection>,
): Snowglobe.NetworkResource<World.Command, World.Snapshot> {
  return {
    *connections(): IterableIterator<[number, Connection]> {
      for (const entry of connections.entries()) {
        if (entry[1].open) {
          yield entry
        }
      }
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
}
