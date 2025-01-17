import Buffer, { BufferEncoding } from 'bare-buffer'
import {
  Readable,
  ReadableOptions,
  Writable,
  WritableOptions,
  PassThrough
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
  readonly command: string
  readonly data: Buffer
  readonly sent: boolean

  reply(data: Buffer | string, encoding?: BufferEncoding): void

  createResponseStream(opts?: WritableOptions): RPCOutgoingStream
  createRequestStream(opts?: ReadableOptions): RPCIncomingStream
}

declare class RPCIncomingRequest {
  constructor(rpc: RPC, id: number, command: string, data: Buffer)
}

interface RPCOutgoingRequest {
  readonly rpc: RPC
  readonly id: number
  readonly command: string
  readonly sent: boolean

  send(data: Buffer | string, encoding?: BufferEncoding): void

  reply(encoding?: BufferEncoding): Promise<Buffer>

  createRequestStream(opts?: WritableOptions): RPCOutgoingStream
  createResponseStream(opts?: ReadableOptions): RPCIncomingStream
}

declare class RPCOutgoingRequest {
  constructor(rpc: RPC, command: string)
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
  request(command: string): RPCOutgoingRequest
}

declare class RPC {
  constructor(stream: PassThrough, onrequest: (req: RPCIncomingRequest) => void)
}

export = RPC
