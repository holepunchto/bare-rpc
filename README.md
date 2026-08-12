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

See the [full API reference](https://docs.pears.com/reference/bare/modules/bare-rpc).

## License

Apache-2.0
