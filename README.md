# bare-rpc

<https://github.com/holepunchto/librpc> ABI compatible RPC for Bare.

```
npm i bare-rpc
```

## Usage

This example wires two peers together over IPC and makes one request:

```js
import IPC from 'bare-ipc'
import RPC from 'bare-rpc'

const [a, b] = IPC.open().map((port) => port.connect())

const server = new RPC(a, (req) => req.reply('pong'))

const client = new RPC(b)

const req = client.request(1)
req.send('ping')

console.log((await req.reply()).toString()) // pong

a.destroy()
b.destroy()
```

`new RPC(stream, onrequest, opts)` runs a session over a duplex `stream`, such as a pipe, a socket or an IPC port. `onrequest` is a function that is called with each request and event of the peer, or a `CommandRouter`. `opts` takes `maxFrameSize` and `maxBufferedBytes`, as described under [Untrusted peers](#untrusted-peers).

See the [`bare-rpc` reference](https://docs.pears.com/reference/bare/modules/bare-rpc) for the full API.

## Command routing

A `CommandRouter` sends each request and event to the handler registered for its command. Pass it to `RPC` as `onrequest`:

```js
const router = new RPC.CommandRouter()

router.respond(1, (req, data) => Buffer.from('pong'))
router.respond(2, (req, data) => console.log(req.command))

const rpc = new RPC(stream, router)
```

A handler is called with the request and its data, and returns the data to reply with, unless it has answered the request itself. Events for a command go to the same handler, and its return value is ignored. A request for a command with no handler is rejected with the code `UNKNOWN_COMMAND`. An event for a command with no handler is dropped.

The data is decoded and the reply encoded with a [compact-encoding](https://github.com/holepunchto/compact-encoding), `c.raw` by default. Pass `valueEncoding` to `new CommandRouter()` to change the default, or `valueEncoding`, `requestEncoding` and `responseEncoding` to `respond(command, opts, handler)` for one command.

## Requests and responses

`rpc.request(command)` returns a request. Call `send(data)` on it to send it, and `await reply()` to get its reply. `rpc.event(command)` returns an event, which gets no reply. Call `send(data)` on it to send it. Each can be sent once, and a reply can be read once. Sending again throws an `RPCError` with the code `ALREADY_SENT`, and reading again throws one with the code `ALREADY_RECEIVED`.

Data can be a buffer, or a string that `send(data, encoding)` and `reply(data, encoding)` encode with `encoding`, `utf8` by default. `reply(encoding)` on a request you sent decodes the reply to a string.

A request of the peer is answered once, with `reply()` or `createResponseStream()`. Answering again throws an `RPCError` with the code `ALREADY_SENT`, and `req.sent` tells whether the request has been answered. Events reach `onrequest` as requests without `reply()`. Each request and event of the peer is handled on its own, so a slow async handler does not hold back the others.

If a request handler throws before it answers, the request is rejected with the `message` of the error, and its `code` and `errno` if it has them. If the handler had opened a response stream, the stream is destroyed with the error instead.

When the peer rejects a request, `reply()` rejects with an `Error` with the `message`, `code` and `errno` of the peer.

Without `onrequest`, every request is rejected with the code `UNKNOWN_COMMAND`, and events are dropped.

## Streaming requests and responses

A request can stream its body, its reply, or both:

- `createRequestStream()` returns a `Writable` for the body, and `await reply()` gets a single reply.
- `send(data)` sends a plain request, and `createResponseStream()` returns a `Readable` for the reply.
- `createRequestStream()` and `createResponseStream()` together stream both.

On the answering side, `req.createRequestStream()` returns a `Readable` for the body, and `req.createResponseStream()` returns a `Writable` for the reply. This handler echoes the body back:

```js
const server = new RPC(stream, (req) => {
  req.createRequestStream().pipe(req.createResponseStream())
})

const req = client.request(1)
const outgoing = req.createRequestStream()
const incoming = req.createResponseStream()

outgoing.end('ping')

for await (const chunk of incoming) console.log(chunk.toString()) // ping
```

A stream only carries data once both ends have opened it, so data written before then is held back until the peer has opened its end. The handler opens the body when it calls `req.createRequestStream()`. If the peer answers before it opens the body, the body is destroyed, with the error of the reply if it has one.

An incoming stream asks the peer to pause once it buffers its `highWaterMark`, which is 16 KiB by default, and to resume once it is read. While the peer has paused an outgoing stream, its writes are held back. If the peer keeps sending anyway, an incoming stream holds at most `maxBufferedBytes`, 16 MiB by default, before the session fails with an `RPCError` with the code `STREAM_OVERFLOW`.

The body of a request and the reply to a request can each be read once. Calling `createRequestStream()` on a request of the peer again, or `createResponseStream()` or `reply()` on a request you sent again, throws an `RPCError` with the code `ALREADY_RECEIVED`.

## Cancellation

A request you sent can be cancelled with `req.cancel(reason)`. Its reply rejects with `reason`, its streams are destroyed with it, and the peer is told to stop handling the request. `reason` defaults to an `RPCError` with the code `CANCELLED`. Cancelling a request that has finished does nothing, and cancelling one that has not been sent yet keeps it from being sent.

`rpc.request(command, opts)` can also cancel the request for you:

- `signal`: An `AbortSignal` that cancels the request with its reason when it aborts.
- `timeout`: Milliseconds after the request is sent to cancel it with an `RPCError` with the code `TIMEOUT`.

```js
const req = rpc.request(1, { timeout: 5000 })
req.send('ping')

await req.reply() // Rejects with the code TIMEOUT if no reply arrives within 5 seconds
```

On the answering side, `req.signal` is an `AbortSignal` that aborts when the peer cancels the request, with the `message`, `code` and `errno` it cancelled with. It also aborts when the session ends, with the error it ended with. Once the peer has cancelled the request, its streams are destroyed with that error, `reply()` sends nothing, and an error thrown by the handler is not sent either.

`RPC` does not create signals on its own. Pass an `AbortController` class as the `AbortController` option, such as the one from [`bare-abort-controller`](https://github.com/holepunchto/bare-abort-controller). Without it, `req.signal` is `null`.

```js
const AbortController = require('bare-abort-controller')

const rpc = new RPC(stream, router, { AbortController })

router.respond(1, async (req, data) => {
  return await search(data, { signal: req.signal })
})
```

Cancelling a request needs a peer that supports it. A peer without support fails the session with the code `UNKNOWN_MESSAGE` when it receives a cancel.

## Termination

The session ends with an `RPCError` with the code `CHANNEL_CLOSED` when `stream` closes. It fails with an error instead when:

- `stream` emits an error, with that error.
- `stream` ends partway through a frame, with the code `INVALID_MESSAGE`.
- An event handler throws, with that error.
- The peer sends a bad frame, as described under [Untrusted peers](#untrusted-peers).

Pending replies then reject with the error, and so do later replies. Open streams are destroyed with it, and so are streams created later. The signals of requests still being handled abort with it. Events sent after the end are dropped.

`RPC` does not close `stream` when the session ends cleanly. When it fails for any reason but an error of `stream`, `RPC` destroys `stream` with the error, so the frames still queued in it are not written. To end the session yourself, destroy `stream`. `rpc.idle` tells whether no requests or streams are in flight, so that it is safe to do so.

## Untrusted peers

`RPC` does not trust the peer to send valid frames. If a frame is larger than `maxFrameSize`, cannot be decoded, or breaks the protocol, the session fails with an `RPCError`. The code tells you why:

- `FRAME_TOO_LARGE`: The frame, with its 4-byte length prefix, is larger than `maxFrameSize`, 16 MiB by default. This is checked as soon as the length prefix arrives, before the rest of the frame is read.
- `UNKNOWN_MESSAGE`: The frame has a message type that `RPC` does not know.
- `INVALID_MESSAGE`: The frame cannot be decoded, `stream` ends partway through a frame, or the frame is one that a valid peer never sends. Examples are a response, stream or cancel message with an id of 0, a stream message with an invalid set of flags, and a new request that reuses the id of a request that is still in flight.
- `STREAM_OVERFLOW`: An incoming stream holds more than `maxBufferedBytes` of data that has not been read. This only happens when the peer keeps sending after it was asked to pause.

A frame that refers to a request or stream that has already finished, or that was never known, is ignored. The same goes for frames that arrive for a stream that has already ended or been destroyed.

If you read the reply as a stream but the peer replies without one, the reply arrives on the stream as a single chunk, unless it is empty, and the stream then ends. An error reply destroys the stream with the error instead.

If you expect a plain reply but the peer replies with a stream, `reply()` rejects with an `RPCError` with the code `UNEXPECTED_STREAM`. The session destroys the stream toward the peer and stays open.

## License

Apache-2.0
