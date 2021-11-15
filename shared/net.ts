import * as Harmony from "harmony-ecs"
import * as Snowglobe from "snowglobe"
import WebSocket from "ws"
import * as World from "../shared/world"

export function clone<$Object extends object>(this: $Object) {
  const timestamp = Snowglobe.getTimestamp(this as any)
  const cloned = Object.assign(JSON.parse(JSON.stringify(this)), { clone })
  if (timestamp !== undefined) {
    Snowglobe.setTimestamp(cloned, timestamp)
  }
  return cloned
}

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
      const { entity, jump } = message
      const data = new ArrayBuffer(8)
      const view = new DataView(data)
      view.setUint8(0, messageType)
      view.setInt16(1, Snowglobe.getTimestamp(message))
      view.setUint32(3, entity)
      view.setUint8(7, jump)
      return data
    }
    case Snowglobe.NetworkMessageType.SnapshotMessage: {
      const data = new ArrayBuffer(1 + 2 + 8 * 3 + 1)
      const view = new DataView(data)
      let offset = 0
      view.setUint8(offset, messageType)
      offset += 1
      view.setInt16(offset, Snowglobe.getTimestamp(message))
      offset += 2
      const { x, y, z } = message.translation
      view.setFloat64(offset, x)
      offset += 8
      view.setFloat64(offset, y)
      offset += 8
      view.setFloat64(offset, z)
      offset += 8
      view.setUint8(offset, message.jump)
      offset += 1
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
    case Snowglobe.NetworkMessageType.CommandMessage: {
      const timestamp = view.getInt16(offset)
      message = Snowglobe.setTimestamp(
        { entity: view.getUint32(offset + 2), jump: view.getUint8(offset + 6), clone },
        timestamp as any,
      )
      break
    }
    case Snowglobe.NetworkMessageType.SnapshotMessage: {
      const timestamp = view.getInt16(offset)
      offset += 2
      const x = view.getFloat64(offset)
      offset += 8
      const y = view.getFloat64(offset)
      offset += 8
      const z = view.getFloat64(offset)
      offset += 8
      const jump = view.getUint8(offset)
      offset += 1
      message = { translation: { x, y, z }, jump, clone }
      break
    }
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
      const command = Harmony.SparseMap.get(
        incoming,
        Snowglobe.NetworkMessageType.CommandMessage,
      ).pop()
      return command
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
        socket.send(message)
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
