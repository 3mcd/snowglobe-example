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
      const { entity, on, off } = message
      const data = new ArrayBuffer(9)
      const view = new DataView(data)
      view.setUint8(0, messageType)
      view.setInt16(1, Snowglobe.getTimestamp(message))
      view.setUint32(3, entity)
      view.setUint8(7, on)
      view.setUint8(8, off)
      return data
    }
    case Snowglobe.NetworkMessageType.SnapshotMessage: {
      const data = new ArrayBuffer(1 + 2 + 8 * 3 + 8 * 4 + 8 * 3 + 1 + 1)
      const view = new DataView(data)
      let offset = 0
      view.setUint8(offset, messageType)
      offset += 1
      view.setInt16(offset, Snowglobe.getTimestamp(message))
      offset += 2
      const { x, y, z } = message.translation
      const { x: qx, y: qy, z: qz, w: qw } = message.rotation
      // const { x: avx, y: avy, z: avz } = message.angvel
      // const { x: vx, y: vy, z: vz } = message.linvel
      const { x: fx, y: fy, z: fz } = message.force
      // translation
      view.setFloat64(offset, x)
      offset += 8
      view.setFloat64(offset, y)
      offset += 8
      view.setFloat64(offset, z)
      offset += 8
      // rotation
      view.setFloat64(offset, qx)
      offset += 8
      view.setFloat64(offset, qy)
      offset += 8
      view.setFloat64(offset, qz)
      offset += 8
      view.setFloat64(offset, qw)
      offset += 8
      // // angvel
      // view.setFloat64(offset, avx)
      // offset += 8
      // view.setFloat64(offset, avy)
      // offset += 8
      // view.setFloat64(offset, avz)
      // offset += 8
      // // linvel
      // view.setFloat64(offset, vx)
      // offset += 8
      // view.setFloat64(offset, vy)
      // offset += 8
      // view.setFloat64(offset, vz)
      // offset += 8
      // force
      view.setFloat64(offset, fx)
      offset += 8
      view.setFloat64(offset, fy)
      offset += 8
      view.setFloat64(offset, fz)
      offset += 8
      // grounded
      view.setUint8(offset, message.grounded)
      offset += 1
      // input
      view.setUint8(offset, message.input)
      offset += 1
      return data
    }
  }
}

function decode(
  messageType: Snowglobe.NetworkMessageType,
  data: ArrayBuffer,
  offset = 0,
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
        {
          entity: view.getUint32(offset + 2),
          on: view.getUint8(offset + 6),
          off: view.getUint8(offset + 7),
          clone,
        },
        timestamp as Snowglobe.Timestamp,
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
      const qx = view.getFloat64(offset)
      offset += 8
      const qy = view.getFloat64(offset)
      offset += 8
      const qz = view.getFloat64(offset)
      offset += 8
      const qw = view.getFloat64(offset)
      offset += 8
      // const avx = view.getFloat64(offset)
      // offset += 8
      // const avy = view.getFloat64(offset)
      // offset += 8
      // const avz = view.getFloat64(offset)
      // offset += 8
      // const vx = view.getFloat64(offset)
      // offset += 8
      // const vy = view.getFloat64(offset)
      // offset += 8
      // const vz = view.getFloat64(offset)
      // offset += 8
      const fx = view.getFloat64(offset)
      offset += 8
      const fy = view.getFloat64(offset)
      offset += 8
      const fz = view.getFloat64(offset)
      offset += 8
      const grounded = view.getUint8(offset)
      offset += 1
      const input = view.getUint8(offset)
      offset += 1
      message = Snowglobe.setTimestamp(
        {
          translation: { x, y, z },
          rotation: { x: qx, y: qy, z: qz, w: qw },
          // angvel: { x: avx, y: avy, z: avz },
          // linvel: { x: vx, y: vy, z: vz },
          force: { x: fx, y: fy, z: fz },
          grounded,
          input,
          clone,
        },
        timestamp as Snowglobe.Timestamp,
      )
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
      const snap = Harmony.SparseMap.get(
        incoming,
        Snowglobe.NetworkMessageType.SnapshotMessage,
      ).pop()
      return snap
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
