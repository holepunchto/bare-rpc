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

test('request stream', async (t) => {
  t.plan(4)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')

    const stream = req.createRequestStream()
    stream
      .on('data', (data) => t.alike(data, Buffer.from('foo')))
      .on('end', () => {
        t.pass('stream ended')

        req.reply('bar')
      })
  })

  const req = rpc.request('heartbeat')

  const stream = req.createRequestStream()
  stream.end('foo')

  t.alike(await req.reply(), Buffer.from('bar'))
})

test('request stream, force destroy by initiator', async (t) => {
  t.plan(3)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')

    const stream = req.createRequestStream()
    stream
      .on('close', () => {
        t.pass('stream closed')

        req.reply('foo')
      })
  })

  const req = rpc.request('heartbeat')

  const stream = req.createRequestStream()

  setImmediate(() => stream.destroy())

  t.alike(await req.reply(), Buffer.from('foo'))
})

test('request stream, force destroy by initiatee', async (t) => {
  t.plan(3)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')

    const stream = req.createRequestStream()

    setImmediate(() => stream.destroy())

    req.reply('foo')
  })

  const req = rpc.request('heartbeat')

  const stream = req.createRequestStream()
  stream
    .on('close', () => t.pass('stream closed'))

  t.alike(await req.reply(), Buffer.from('foo'))
})

test('response stream', async (t) => {
  t.plan(4)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')
    t.alike(req.data, Buffer.from('foo'))

    const reply = req.createResponseStream()
    reply.end('bar')
  })

  const req = rpc.request('heartbeat')
  req.send('foo')

  const reply = req.createResponseStream()
  reply
    .on('data', (data) => t.alike(data, Buffer.from('bar')))
    .on('end', () => t.pass('stream ended'))
})

test('response stream, force destroy by initiator', async (t) => {
  t.plan(3)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')
    t.alike(req.data, Buffer.from('foo'))

    const reply = req.createResponseStream()

    setImmediate(() => reply.destroy())
  })

  const req = rpc.request('heartbeat')
  req.send('foo')

  const reply = req.createResponseStream()
  reply
    .on('close', () => t.pass('stream closed'))
})

test('response stream, force destroy by initiatee', async (t) => {
  t.plan(3)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')
    t.alike(req.data, Buffer.from('foo'))

    const reply = req.createResponseStream()

    reply
      .on('close', () => t.pass('stream closed'))
  })

  const req = rpc.request('heartbeat')
  req.send('foo')

  const reply = req.createResponseStream()

  setImmediate(() => reply.destroy())
})
