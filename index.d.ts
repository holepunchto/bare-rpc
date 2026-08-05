import Buffer, { BufferEncoding } from 'bare-buffer'
import { Readable, ReadableOptions, Writable, WritableOptions, Duplex } from 'bare-stream'

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

interface RPCIncomingEvent {
  readonly rpc: RPC
  /** The command that the request was created with. A command is a unique number. */
  readonly command: number
  /** The data buffer sent with the request. */
  readonly data: Buffer | null
}

declare class RPCIncomingEvent {
  /**
   * @param rpc - The `RPC` instance the event arrived on.
   * @param command - The command number the event was sent with.
   * @param data - The payload buffer sent with the event.
   */
  constructor(rpc: RPC, command: number, data: Buffer)
}

interface RPCIncomingRequest {
  readonly rpc: RPC
  readonly id: number
  readonly command: number
  readonly data: Buffer | null
  /** A boolean for whether the request has been sent. */
  readonly sent: boolean
  /** A boolean for whether the request has received a reply. */
  readonly received: boolean

  /**
   * Send a reply to the request. `data` may be a buffer or a string encoded using `encoding`.
   * @param data - The payload to send: a `Buffer`, or a string encoded using `encoding`. Omit to send no data.
   * @param encoding - The encoding used when `data` is a string (defaults to `utf8`).
   * @throws {ALREADY_SENT} a response has already been sent for this request.
   */
  reply(data?: Buffer | string | null, encoding?: BufferEncoding): void

  /**
   * Create a [`Writable`](https://github.com/mafintosh/streamx#writable-stream) stream for sending the streamed reply to the request.
   * @param opts - Options for the returned [`Writable`](https://github.com/mafintosh/streamx#writable-stream) stream.
   * @throws {ALREADY_SENT} a response has already been sent for this request.
   */
  createResponseStream(opts?: WritableOptions): RPCOutgoingStream
  /**
   * Create a [`Readable`](https://github.com/mafintosh/streamx#readable-stream) stream for receiving the request's streamed data.
   * @param opts - Options for the returned [`Readable`](https://github.com/mafintosh/streamx#readable-stream) stream.
   * @throws {ALREADY_RECEIVED} the request has already been received.
   */
  createRequestStream(opts?: ReadableOptions): RPCIncomingStream
}

declare class RPCIncomingRequest {
  /**
   * @param rpc - The `RPC` instance the request arrived on.
   * @param id - The request id, used to correlate the reply with the request.
   * @param command - The command number the request was sent with.
   * @param data - The payload buffer sent with the request.
   */
  constructor(rpc: RPC, id: number, command: number, data: Buffer)
}

interface RPCOutgoingEvent {
  readonly rpc: RPC
  readonly command: number
  readonly sent: boolean

  /**
   * @param data - The payload to send: a `Buffer`, or a string encoded using `encoding`. Omit to send no data.
   * @param encoding - The encoding used when `data` is a string (defaults to `utf8`).
   * @throws {ALREADY_SENT} the event has already been sent.
   */
  send(data?: Buffer | string | null, encoding?: BufferEncoding): void
}

declare class RPCOutgoingEvent {
  /**
   * @param rpc - The `RPC` instance to send the event on.
   * @param command - The command number to send.
   */
  constructor(rpc: RPC, command: number)
}

interface RPCOutgoingRequest {
  readonly rpc: RPC
  readonly id: number
  readonly command: number
  readonly sent: boolean
  readonly received: boolean

  /**
   * @param data - The payload to send: a `Buffer`, or a string encoded using `encoding`. Omit to send no data.
   * @param encoding - The encoding used when `data` is a string (defaults to `utf8`).
   * @throws {ALREADY_SENT} the request has already been sent.
   */
  send(data?: Buffer | string | null, encoding?: BufferEncoding): void

  /**
   * Await the reply from the remote end to the request. `encoding` can be defined for decoding the response `data` buffer back into a string.
   * @param encoding - If given, decodes the reply payload to a string using this encoding; omit to receive the raw `Buffer`.
   * @returns a promise that resolves with the remote end's reply payload, or rejects with the channel's teardown error if it closes before a reply arrives.
   * @throws {ALREADY_RECEIVED} a reply is already being received for this request.
   */
  reply(encoding?: BufferEncoding): Promise<Buffer | string | null>

  /**
   * Create a [`Writable`](https://github.com/mafintosh/streamx#writable-stream) stream for sending data with the request.
   * @param opts - Options for the returned [`Writable`](https://github.com/mafintosh/streamx#writable-stream) stream.
   * @throws {ALREADY_SENT} the request has already been sent.
   */
  createRequestStream(opts?: WritableOptions): RPCOutgoingStream
  /**
   * Create a [`Readable`](https://github.com/mafintosh/streamx#readable-stream) stream for receiving data in reply to the request.
   * @param opts - Options for the returned [`Readable`](https://github.com/mafintosh/streamx#readable-stream) stream.
   * @throws {ALREADY_RECEIVED} the response has already been received.
   */
  createResponseStream(opts?: ReadableOptions): RPCIncomingStream
}

declare class RPCOutgoingRequest {
  /**
   * @param rpc - The `RPC` instance to send the request on.
   * @param id - The request id, used to correlate the reply with the request.
   * @param command - The command number to send.
   */
  constructor(rpc: RPC, id: number, command: number)
}

declare class RPCIncomingStream extends Readable {
  /**
   * @param rpc - The `RPC` instance the stream belongs to.
   * @param request - The request the stream carries data for.
   * @param type - Whether the stream carries the request body (`constants.type.REQUEST`) or the response body (`constants.type.RESPONSE`).
   * @param opts - Options for the underlying [`Readable`](https://github.com/mafintosh/streamx#readable-stream) stream.
   */
  constructor(
    rpc: RPC,
    request: RPCIncomingRequest | RPCOutgoingRequest,
    type: typeof constants.type.REQUEST | typeof constants.type.RESPONSE,
    opts?: ReadableOptions
  )
}

declare class RPCOutgoingStream extends Writable {
  /**
   * @param rpc - The `RPC` instance the stream belongs to.
   * @param request - The request the stream carries data for.
   * @param type - Whether the stream carries the request body (`constants.type.REQUEST`) or the response body (`constants.type.RESPONSE`).
   * @param opts - Options for the underlying [`Writable`](https://github.com/mafintosh/streamx#writable-stream) stream.
   */
  constructor(
    rpc: RPC,
    request: RPCIncomingRequest | RPCOutgoingRequest,
    type: typeof constants.type.REQUEST | typeof constants.type.RESPONSE,
    opts?: WritableOptions
  )
}

interface RPC {
  /** Whether there are no requests or responses currently in flight. Useful for determining when it is safe to tear down the underlying stream. */
  readonly idle: boolean

  /**
   * @param command - A unique number identifying the event; the remote end differentiates events by it.
   * @returns an `RPCOutgoingEvent`; call `send()` on it to dispatch the one-way event.
   */
  event(command: number): RPCOutgoingEvent
  /**
   * @param command - A unique number identifying the request; the remote end differentiates requests by it.
   * @returns an `RPCOutgoingRequest`; call `send()` on it to dispatch the request and `await reply()` for the response.
   */
  request(command: number): RPCOutgoingRequest
}

declare class RPC {
  /**
   * @param stream - The duplex stream to frame RPC messages over, such as a pipe or socket.
   * @param onrequest - Callback run for each incoming request or event, receiving an `RPCIncomingRequest` (or `RPCIncomingEvent`) to inspect and `reply()` to. Defaults to a no-op.
   */
  constructor(stream: Duplex, onrequest: (req: RPCIncomingRequest) => void | Promise<void>)
}

/** Create an RPC instance using a duplex `stream`. `onrequest` is an optional callback run when a remote request is received. This is where processing and responding to an RPC request happens. `onrequest` receives a `RPCIncomingRequest` as an argument. */
declare namespace RPC {
  export {
    type RPCIncomingEvent as IncomingEvent,
    type RPCOutgoingEvent as OutgoingEvent,
    type RPCIncomingRequest as IncomingRequest,
    type RPCOutgoingRequest as OutgoingRequest,
    type RPCIncomingStream as IncomingStream,
    type RPCOutgoingStream as OutgoingStream
  }
}

export = RPC
