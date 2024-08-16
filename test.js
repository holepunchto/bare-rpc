const test = require('brittle')
const { PassThrough } = require('bare-stream')
const RPC = require('.')

test('basic', async (t) => {
  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')
    t.alike(req.data, Buffer.from('ping'))

    req.reply('pong')
  })

  const req = rpc.request('heartbeat')
  req.send('ping')

  t.alike(await req.reply(), Buffer.from('pong'))
})

test('streams', async (t) => {
  t.plan(5)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')

    const stream = req.createRequestStream()
    stream
      .on('data', (data) => t.alike(data, Buffer.from('foo')))
      .on('end', () => {
        t.pass('stream ended')

        const reply = req.createResponseStream()
        reply.end('bar')
      })
  })

  const req = rpc.request('heartbeat')

  const stream = req.createRequestStream()
  stream.end('foo')

  const reply = req.createResponseStream()
  reply
    .on('data', (data) => t.alike(data, Buffer.from('bar')))
    .on('end', () => t.pass('stream ended'))
})
