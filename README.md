# bare-rpc

<https://github.com/holepunchto/librpc> ABI compatible RPC for Bare.

```
npm i bare-rpc
```

## Usage

```js
import RPC from 'bare-rpc'

// On one end
const rpc = new RPC(stream, (req) => {
  if (req.command === 42) {
    console.log(req.data.toString()) // ping
    req.reply('pong')
  }
})

// On the other end
const req = rpc.request(42)
req.send('ping')

const replyBuffer = await req.reply()
console.log(replyBuffer.toString()) // pong
```

## API

See the [`bare-rpc` reference](https://docs.pears.com/reference/bare/modules/bare-rpc).

## Untrusted peers

`bare-rpc` does not trust the remote end to send valid frames. If a frame is larger than `maxFrameSize`, cannot be decoded, or breaks the protocol, the connection fails: `stream` is destroyed with an `RPCError`, and every request and stream in flight is rejected or destroyed with that error. The error code tells you why:

- `FRAME_TOO_LARGE`: The length prefix is larger than `maxFrameSize`. This is checked before the rest of the frame is read.
- `UNKNOWN_MESSAGE`: The frame has a message type that `bare-rpc` does not know.
- `INVALID_MESSAGE`: The frame cannot be decoded, the stream ends partway through a frame, or the frame is one that a valid peer never sends. Examples are a response or stream message with an id of 0, a stream message with an invalid set of flags, and a new request that reuses the id of a request that is still in flight.

A frame that refers to a request or stream that has already finished, or that was never known, is ignored. The same goes for frames that arrive for a stream that has already ended or been destroyed.

If you read the response to a request as a stream but the remote end replies without one, the reply arrives on the response stream as a single chunk, unless it is empty, and the stream then ends. An error reply destroys the response stream with that error.

## License

Apache-2.0
