import Buffer, { BufferEncoding } from 'bare-buffer'
import {
  Readable,
  ReadableOptions,
  Writable,
  WritableOptions,
  Duplex
} from 'bare-stream'

declare const constants: {
  type: { REQUEST: 1; RESPONSE: 2; STREAM: 3 }
  stream: {
    OPEN: number
    CLOSE: number
    PAUSE: number
    RESUME: number
    DATA: number
    END: number
    DESTROY: number
    ERROR: number
    REQUEST: number
    RESPONSE: number
  }
}

interface RPCIncomingRequest {
  readonly rpc: RPC
  readonly id: number
  readonly command: number
  readonly data: Buffer | null
  readonly sent: boolean
  readonly received: boolean

  reply(data?: Buffer | string | null, encoding?: BufferEncoding): void

  createResponseStream(opts?: WritableOptions): RPCOutgoingStream
  createRequestStream(opts?: ReadableOptions): RPCIncomingStream
}

declare class RPCIncomingRequest {
  constructor(rpc: RPC, id: number, command: number, data: Buffer)
}

interface RPCOutgoingRequest {
  readonly rpc: RPC
  readonly id: number
  readonly command: number
  readonly sent: boolean
  readonly received: boolean

  send(data?: Buffer | string | null, encoding?: BufferEncoding): void

  reply(encoding?: BufferEncoding): Promise<Buffer | string | null>

  createRequestStream(opts?: WritableOptions): RPCOutgoingStream
  createResponseStream(opts?: ReadableOptions): RPCIncomingStream
}

declare class RPCOutgoingRequest {
  constructor(rpc: RPC, command: number)
}

declare class RPCIncomingStream extends Readable {
  constructor(
    rpc: RPC,
    request: RPCIncomingRequest | RPCOutgoingRequest,
    type: typeof constants.type.REQUEST | typeof constants.type.RESPONSE,
    opts?: ReadableOptions
  )
}

declare class RPCOutgoingStream extends Writable {
  constructor(
    rpc: RPC,
    request: RPCIncomingRequest | RPCOutgoingRequest,
    type: typeof constants.type.REQUEST | typeof constants.type.RESPONSE,
    opts?: WritableOptions
  )
}

interface RPC {
  request(command: number): RPCOutgoingRequest
}

declare class RPC {
  constructor(
    stream: Duplex,
    onrequest: (req: RPCIncomingRequest) => void | Promise<void>
  )
}

declare namespace RPC {
  export {
    type RPCIncomingRequest as IncomingRequest,
    type RPCOutgoingRequest as OutgoingRequest,
    type RPCIncomingStream as IncomingStream,
    type RPCOutgoingStream as OutgoingStream
  }
}

export = RPC
