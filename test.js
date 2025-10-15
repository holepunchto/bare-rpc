const test = require('brittle')
const c = require('compact-encoding')
const { PassThrough } = require('bare-stream')
const IPC = require('bare-ipc')
const RPC = require('.')

test('basic', async (t) => {
  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.from('ping'))

    req.reply('pong')
  })

  const req = rpc.request(42)
  req.send('ping')

  t.alike(await req.reply(), Buffer.from('pong'))
})

test('string encoding', async (t) => {
  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.from('ping'))

    req.reply('pong')
  })

  const req = rpc.request(42)
  req.send('cGluZw==', 'base64')

  t.alike(await req.reply('utf8'), 'pong')
})

test('empty request', async (t) => {
  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)
    t.is(req.data, null)

    req.reply('pong')
  })

  const req = rpc.request(42)
  req.send()

  t.alike(await req.reply(), Buffer.from('pong'))
})

test('empty response', async (t) => {
  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.from('ping'))

    req.reply()
  })

  const req = rpc.request(42)
  req.send('ping')

  t.alike(await req.reply(), null)
})

test('compact encoding', async (t) => {
  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)
    t.alike(c.decode(c.any, req.data), { hello: 'world' })

    req.reply(['hello', 'world'], c.any)
  })

  const req = rpc.request(42)
  req.send({ hello: 'world' }, c.any)

  t.alike(await req.reply(c.any), ['hello', 'world'])
})

test('request stream', async (t) => {
  t.plan(4)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)

    const stream = req.createRequestStream()
    stream
      .on('data', (data) => t.alike(data, Buffer.from('foo')))
      .on('end', () => {
        t.pass('stream ended')

        req.reply('bar')
      })
  })

  const req = rpc.request(42)

  const stream = req.createRequestStream()
  stream.end('foo')

  t.alike(await req.reply(), Buffer.from('bar'))
})

test('request stream, force destroy by initiator', async (t) => {
  t.plan(3)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)

    const stream = req.createRequestStream()
    stream.on('close', () => {
      t.pass('stream closed')

      req.reply('foo')
    })
  })

  const req = rpc.request(42)

  const stream = req.createRequestStream()

  setImmediate(() => stream.destroy())

  t.alike(await req.reply(), Buffer.from('foo'))
})

test('request stream, force destroy by initiatee', async (t) => {
  t.plan(3)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)

    const stream = req.createRequestStream()

    setImmediate(() => stream.destroy())

    req.reply('foo')
  })

  const req = rpc.request(42)

  const stream = req.createRequestStream()
  stream.on('close', () => t.pass('stream closed'))

  t.alike(await req.reply(), Buffer.from('foo'))
})

test('response stream', async (t) => {
  t.plan(4)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.from('foo'))

    const reply = req.createResponseStream()
    reply.end('bar')
  })

  const req = rpc.request(42)
  req.send('foo')

  const reply = req.createResponseStream()
  reply
    .on('data', (data) => t.alike(data, Buffer.from('bar')))
    .on('end', () => t.pass('stream ended'))
})

test('response stream, force destroy by initiator', async (t) => {
  t.plan(3)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.from('foo'))

    const reply = req.createResponseStream()

    setImmediate(() => reply.destroy())
  })

  const req = rpc.request(42)
  req.send('foo')

  const reply = req.createResponseStream()
  reply.on('close', () => t.pass('stream closed'))
})

test('response stream, force destroy by initiatee', async (t) => {
  t.plan(3)

  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.from('foo'))

    const reply = req.createResponseStream()

    reply.on('close', () => t.pass('stream closed'))
  })

  const req = rpc.request(42)
  req.send('foo')

  const reply = req.createResponseStream()

  setImmediate(() => reply.destroy())
})

test('request and response stream', async (t) => {
  t.plan(4)

  const rpc = new RPC(new PassThrough(), (req) => {
    const reply = req.createResponseStream()
    const stream = req.createRequestStream()

    stream
      .on('data', (data) => {
        t.alike(data, Buffer.from('foo'))
        reply.end('bar')
      })
      .on('close', () => t.pass('request stream closed'))
  })

  const req = rpc.request(42)

  const reply = req.createResponseStream()
  const stream = req.createRequestStream()

  stream.end('foo')

  reply
    .on('data', (data) => {
      t.alike(data, Buffer.from('bar'))
    })
    .on('close', () => t.pass('response stream closed'))
})

test('command router', async (t) => {
  t.plan(2)

  const router = new RPC.CommandRouter()

  router.respond(42, (req, data) => {
    t.alike(data, Buffer.from('ping'))

    return Buffer.from('pong')
  })

  const rpc = new RPC(new PassThrough(), router)

  const req = rpc.request(42)
  req.send('ping')

  t.alike(await req.reply(), Buffer.from('pong'))
})

test('throw in request handler', async (t) => {
  const rpc = new RPC(new PassThrough(), () => {
    throw new Error('Nope')
  })

  const req = rpc.request(42)
  req.send('ping')

  await t.exception(req.reply(), /Nope/)
})

test('throw in async request handler', async (t) => {
  const rpc = new RPC(new PassThrough(), async () => {
    throw new Error('Nope')
  })

  const req = rpc.request(42)
  req.send('ping')

  await t.exception(req.reply(), /Nope/)
})

test('throw an error with number code', async (t) => {
  const error = new Error('Nope')
  error.code = 30
  const rpc = new RPC(new PassThrough(), () => {
    throw error
  })

  const req = rpc.request(42)
  req.send('ping')

  await t.exception(req.reply(), /Nope/)
})

test('throw an error with string errno', async (t) => {
  const error = new Error('Nope')
  error.errno = '21'
  const rpc = new RPC(new PassThrough(), () => {
    throw error
  })

  const req = rpc.request(42)
  req.send('ping')

  await t.exception(req.reply(), /Nope/)
})

test('request and reply, ipc', async (t) => {
  const ports = IPC.open()

  const a = ports[0].connect()
  t.teardown(() => a.destroy())

  const b = ports[1].connect()
  t.teardown(() => b.destroy())

  new RPC(a, async (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.from('ping'))

    req.reply('pong')
  })

  const rpc = new RPC(b, () => {})

  const req = rpc.request(42)
  req.send('ping')

  t.alike(await req.reply(), Buffer.from('pong'))
})

test('request stream, ipc', async (t) => {
  t.plan(4)

  const ports = IPC.open()

  const a = ports[0].connect()
  a.id = 'a'
  t.teardown(() => a.destroy())

  const b = ports[1].connect()
  b.id = 'b'
  t.teardown(() => b.destroy())

  new RPC(a, (req) => {
    t.is(req.command, 42)

    const stream = req.createRequestStream()
    stream
      .on('data', (data) => t.alike(data, Buffer.from('foo')))
      .on('end', () => {
        t.pass('stream ended')

        req.reply('bar')
      })
  })

  const rpc = new RPC(b, () => {})

  const req = rpc.request(42)

  const stream = req.createRequestStream()
  stream.end('foo')

  t.alike(await req.reply(), Buffer.from('bar'))
})

test('response stream, ipc', async (t) => {
  t.plan(4)

  const ports = IPC.open()

  const a = ports[0].connect()
  a.id = 'a'
  t.teardown(() => a.destroy())

  const b = ports[1].connect()
  b.id = 'b'
  t.teardown(() => b.destroy())

  new RPC(a, async (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.from('foo'))

    const reply = req.createResponseStream()
    reply.end('bar')
  })

  const rpc = new RPC(b, () => {})

  const req = rpc.request(42)
  req.send('foo')

  const reply = req.createResponseStream()
  reply
    .on('data', (data) => t.alike(data, Buffer.from('bar')))
    .on('end', () => t.pass('stream ended'))
})

test('large request and reply, ipc', async (t) => {
  const ports = IPC.open()

  const a = ports[0].connect()
  t.teardown(() => a.destroy())

  const b = ports[1].connect()
  t.teardown(() => b.destroy())

  new RPC(a, async (req) => {
    t.is(req.command, 42)
    t.alike(req.data, Buffer.alloc(4 * 1024 * 1024, 'ping'))

    req.reply(Buffer.alloc(4 * 1024 * 1024, 'pong'))
  })

  const rpc = new RPC(b, () => {})

  const req = rpc.request(42)
  req.send(Buffer.alloc(4 * 1024 * 1024, 'ping'))

  t.alike(await req.reply(), Buffer.alloc(4 * 1024 * 1024, 'pong'))
})

test('large request and reply stream, ipc', async (t) => {
  t.plan(2)

  const ports = IPC.open()

  const a = ports[0].connect()
  t.teardown(() => a.destroy())

  const b = ports[1].connect()
  t.teardown(() => b.destroy())

  new RPC(a, async (req) => {
    t.is(req.command, 42)

    req.createRequestStream().pipe(req.createResponseStream())
  })

  const rpc = new RPC(b, () => {})

  const req = rpc.request(42)

  const stream = req.createRequestStream()

  stream.end(Buffer.alloc(4 * 1024 * 1024, 'ping'))

  const reply = req.createResponseStream()

  reply.on('data', (data) => {
    t.alike(data, Buffer.alloc(4 * 1024 * 1024, 'ping'))
  })
})

test('request and reply stream backpressure, ipc', async (t) => {
  t.plan(3)

  const ports = IPC.open()

  const a = ports[0].connect()
  t.teardown(() => a.destroy())

  const b = ports[1].connect()
  t.teardown(() => b.destroy())

  new RPC(a, async (req) => {
    t.is(req.command, 42)

    const stream = req.createRequestStream()

    setTimeout(() => {
      stream.pipe(req.createResponseStream())
    }, 100)
  })

  const rpc = new RPC(b, () => {})

  const req = rpc.request(42)

  const stream = req.createRequestStream()

  const sent = []
  const received = []

  let backpressured

  for (let i = 0; i < 10000; i++) {
    const data = Buffer.from(`${i}`)
    sent.push(data)
    backpressured = stream.write(data) === false
  }

  stream.end()

  t.ok(backpressured)

  const reply = req.createResponseStream()

  reply
    .on('data', (data) => received.push(data))
    .on('end', () => t.alike(sent, received))
})
