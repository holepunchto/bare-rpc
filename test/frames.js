// Frames from a peer that cannot be trusted to send valid ones. Every test feeds
// crafted bytes into the duplex that the RPC wraps and reads the outcome back
// through the public API.
const test = require('brittle')
const c = require('compact-encoding')
const { Duplex, PassThrough, Writable } = require('bare-stream')
const RPC = require('..')
const m = require('../lib/messages')
const { type, stream: s } = require('../lib/constants')

const PROBE = 0xbeef

const error = { message: 'boom', code: 'E', errno: 1 }

test('frame larger than maxFrameSize fails before its body arrives', async (t) => {
  const peer = createPeer({ maxFrameSize: 64 })

  peer.push(lengthPrefix(61))

  const err = await peer.failure
  t.is(err.code, 'FRAME_TOO_LARGE')
  t.ok(peer.rpc.idle)
})

test('maxFrameSize includes the length prefix', async (t) => {
  const size = 64

  const accepted = createPeer({ maxFrameSize: size })
  accepted.push(event(PROBE, Buffer.alloc(size - eventOverhead(size))))
  t.is((await accepted.probe).length, size - eventOverhead(size))

  const rejected = createPeer({ maxFrameSize: size })
  rejected.push(event(PROBE, Buffer.alloc(size - eventOverhead(size) + 1)))
  t.is((await rejected.failure).code, 'FRAME_TOO_LARGE')
})

test('maxFrameSize defaults to 16 MiB', async (t) => {
  const size = 16 * 1024 * 1024

  const accepted = createPeer()
  accepted.push(event(PROBE, Buffer.alloc(size - eventOverhead(size))))
  t.is((await accepted.probe).length, size - eventOverhead(size))

  const rejected = createPeer()
  rejected.push(lengthPrefix(size - 4 + 1))
  t.is((await rejected.failure).code, 'FRAME_TOO_LARGE')
})

test('undecodable frames fail the connection', async (t) => {
  const cases = [
    ['00000000', 'INVALID_MESSAGE', 'frame too short for its header'],
    ['020000000107', 'INVALID_MESSAGE', 'request header runs past the frame'],
    ['0300000001ff01', 'INVALID_MESSAGE', 'bad varint'],
    ['06000000010001000a61', 'INVALID_MESSAGE', 'data length runs past the frame'],
    ['050000000201010009', 'INVALID_MESSAGE', 'error length runs past the frame'],
    ['020000000301', 'INVALID_MESSAGE', 'stream flags run past the frame'],
    ['020000006300', 'UNKNOWN_MESSAGE', 'unknown message type']
  ]

  for (const [hex, code, reason] of cases) {
    const peer = createPeer()
    peer.push(Buffer.concat([Buffer.from(hex, 'hex'), event(PROBE)]))
    peer.push(event(PROBE))

    t.is((await peer.failure).code, code, reason)
    t.absent(peer.probed, `${reason}: no later frame is handled`)
  }
})

test('frame truncated by the end of the stream fails the connection', async (t) => {
  const peer = createPeer()

  peer.push(Buffer.from('0400000001', 'hex'))
  peer.push(null)

  t.is((await peer.failure).code, 'INVALID_MESSAGE')
})

test('protocol violations fail the connection', async (t) => {
  const cases = [
    [
      { type: type.RESPONSE, id: 0, stream: 0, error: null, data: Buffer.alloc(0) },
      'response id 0'
    ],
    [{ type: type.RESPONSE, id: 1, stream: s.OPEN, error }, 'response stream open with error'],
    [{ type: type.RESPONSE, id: 1, stream: s.CLOSE, error: null }, 'response stream flags'],
    [
      { type: type.STREAM, id: 0, stream: s.REQUEST | s.DATA, data: Buffer.alloc(1) },
      'stream id 0'
    ],
    [{ type: type.STREAM, id: 1, stream: s.REQUEST | s.RESPONSE | s.END }, 'both directions'],
    [{ type: type.STREAM, id: 1, stream: s.END }, 'no direction'],
    [{ type: type.STREAM, id: 1, stream: s.REQUEST }, 'no event'],
    [{ type: type.STREAM, id: 1, stream: s.RESPONSE | s.OPEN | s.END }, 'two events'],
    [{ type: type.STREAM, id: 1, stream: s.REQUEST | s.ERROR, error }, 'error without event'],
    [{ type: type.STREAM, id: 1, stream: s.REQUEST | s.END | 0x400 }, 'unknown flag'],
    [{ type: type.REQUEST, id: 1, command: 1, stream: s.REQUEST | s.OPEN }, 'request stream flags'],
    [{ type: type.REQUEST, id: 1, command: 1, stream: s.END }, 'request stream flags'],
    [{ type: type.REQUEST, id: 0, command: 1, stream: s.OPEN }, 'event with a stream']
  ]

  for (const [message, reason] of cases) {
    const peer = createPeer()
    peer.push(Buffer.concat([frame(message), event(PROBE)]))
    peer.push(event(PROBE))

    t.is((await peer.failure).code, 'INVALID_MESSAGE', reason)
    t.absent(peer.probed, `${reason}: no later frame is handled`)
  }
})

test('request reusing the id of a live request fails the connection', async (t) => {
  let requests = 0

  const peer = createPeer({}, (req) => {
    if (req.command === PROBE) return
    requests++
    req.createRequestStream().on('error', noop)
  })

  peer.push(frame({ type: type.REQUEST, id: 1, command: 1, stream: s.OPEN }))
  peer.push(frame({ type: type.REQUEST, id: 1, command: 1, stream: s.OPEN }))

  t.is((await peer.failure).code, 'INVALID_MESSAGE')
  t.is(requests, 1)
})

test('request reusing the id of a finished request is handled', async (t) => {
  const peer = createPeer({}, (req) => {
    if (req.command !== PROBE) req.reply('ok')
  })

  peer.push(request(1))
  peer.push(request(1))
  peer.push(event(PROBE))

  await peer.probe
  t.ok(peer.rpc.idle)
})

test('frames for unknown ids are ignored and keep no state', async (t) => {
  const peer = createPeer()

  peer.push(frame({ type: type.RESPONSE, id: 7, stream: 0, error: null, data: Buffer.alloc(1) }))
  peer.push(frame({ type: type.RESPONSE, id: 7, stream: s.OPEN, error: null }))

  for (const direction of [s.REQUEST, s.RESPONSE]) {
    for (const action of [s.CLOSE, s.PAUSE, s.RESUME, s.END, s.DESTROY]) {
      peer.push(frame({ type: type.STREAM, id: 7, stream: direction | action }))
    }

    peer.push(
      frame({ type: type.STREAM, id: 7, stream: direction | s.DATA, data: Buffer.alloc(1) })
    )
  }

  peer.push(frame({ type: type.STREAM, id: 7, stream: s.REQUEST | s.OPEN }))
  peer.push(event(PROBE))

  await peer.probe
  t.ok(peer.rpc.idle)
})

test('early open of a response stream is kept until the stream is created', (t) => {
  t.plan(2)

  const peer = createPeer({}, (req) => {
    if (req.command === PROBE) return
    setImmediate(() => {
      const stream = req.createResponseStream()
      stream.on('open', () => t.pass('response stream opened'))
      stream.on('close', () => t.ok(peer.rpc.idle))
      stream.end()
    })
  })

  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.OPEN }))
  peer.push(request(1))
})

test('early open of a response stream is dropped when the request is answered', async (t) => {
  const peer = createPeer({}, (req) => {
    if (req.command !== PROBE) req.reply('ok')
  })

  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.OPEN }))
  peer.push(request(1))
  peer.push(event(PROBE))

  await peer.probe
  t.ok(peer.rpc.idle)
})

test('early open of a response stream is dropped when the peer destroys it', async (t) => {
  const peer = createPeer()

  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.OPEN }))
  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.DESTROY }))
  peer.push(event(PROBE))

  await peer.probe
  t.ok(peer.rpc.idle)
})

test('data after the end of a stream is ignored', async (t) => {
  const peer = createPeer()

  const req = peer.rpc.request(1)
  req.send()

  const received = []

  const stream = req.createResponseStream()

  peer.push(responseData(1, Buffer.from('a')))
  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.END }))
  peer.push(responseData(1, Buffer.from('b')))
  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.END }))
  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.CLOSE }))

  await new Promise((resolve) =>
    stream.on('data', (data) => received.push(data)).on('end', resolve)
  )
  await new Promise(setImmediate)

  t.alike(received, [Buffer.from('a')])
})

test('frames for a destroyed stream are ignored', async (t) => {
  const peer = createPeer()

  const req = peer.rpc.request(1)

  const requestStream = req.createRequestStream()
  const responseStream = req.createResponseStream()

  const errors = []
  requestStream.on('error', (err) => errors.push(err.code))
  responseStream.on('error', (err) => errors.push(err.code))

  peer.push(frame({ type: type.STREAM, id: 1, stream: s.REQUEST | s.DESTROY | s.ERROR, error }))
  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.CLOSE | s.ERROR, error }))

  for (const direction of [s.REQUEST, s.RESPONSE]) {
    for (const action of [s.OPEN, s.CLOSE, s.PAUSE, s.RESUME, s.END, s.DESTROY]) {
      peer.push(frame({ type: type.STREAM, id: 1, stream: direction | action }))
    }

    peer.push(
      frame({ type: type.STREAM, id: 1, stream: direction | s.DATA, data: Buffer.alloc(1) })
    )
    peer.push(frame({ type: type.STREAM, id: 1, stream: direction | s.DESTROY | s.ERROR, error }))
  }

  peer.push(event(PROBE))

  await peer.probe
  await new Promise(setImmediate)

  t.alike(errors, ['E', 'E'])
  t.ok(requestStream.destroyed)
  t.ok(responseStream.destroyed)
})

test('error response for a request whose reply is not awaited is not thrown', async (t) => {
  const peer = createPeer()

  const req = peer.rpc.request(1)
  req.send()

  peer.push(frame({ type: type.RESPONSE, id: 1, stream: 0, error }))
  peer.push(event(PROBE))

  await peer.probe

  await t.exception(req.reply(), { code: 'E' })
})

test('error thrown by user code during frame handling fails the connection', async (t) => {
  const peer = createPeer()

  const req = peer.rpc.request(1)

  const error = new Error('listener')

  const stream = req.createRequestStream()
  stream.on('error', noop).on('open', () => {
    throw error
  })

  await new Promise(setImmediate)

  peer.push(frame({ type: type.STREAM, id: 1, stream: s.REQUEST | s.OPEN }))

  t.is(await peer.failure, error)
})

test('stream awaiting the remote open closes when the connection fails', async (t) => {
  t.plan(2)

  const peer = createPeer()

  const stream = peer.rpc.request(1).createRequestStream()
  stream.on('error', (err) => t.is(err.code, 'INVALID_MESSAGE')).on('close', () => t.pass('closed'))

  await new Promise(setImmediate)

  peer.push(Buffer.from('00000000', 'hex'))
})

test('early open of a response stream after its request is kept', (t) => {
  t.plan(1)

  const peer = createPeer({}, (req) => {
    if (req.command === PROBE) return
    setImmediate(() => {
      const stream = req.createResponseStream()
      stream.on('open', () => t.pass('response stream opened')).end()
    })
  })

  peer.push(request(1))
  peer.push(request(2))
  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.OPEN }))
})

test('early opens of response streams are capped', async (t) => {
  const accepted = createPeer()

  for (let id = 1; id <= 1024; id++) {
    accepted.push(frame({ type: type.STREAM, id, stream: s.RESPONSE | s.OPEN }))
  }

  accepted.push(event(PROBE))
  await accepted.probe

  t.absent(accepted.rpc.idle)

  for (let id = 1; id <= 1024; id++) {
    accepted.push(frame({ type: type.STREAM, id, stream: s.RESPONSE | s.DESTROY }))
  }

  accepted.push(event(PROBE))
  await new Promise(setImmediate)

  t.ok(accepted.rpc.idle)

  const hostile = createPeer()

  for (let id = 1; id <= 10000; id++) {
    hostile.push(frame({ type: type.STREAM, id, stream: s.RESPONSE | s.OPEN }))
  }

  t.is((await hostile.failure).code, 'INVALID_MESSAGE')

  await closed(hostile.stream)

  t.ok(hostile.rpc.idle)
})

test('request handler throwing a non-error sends an error response', async (t) => {
  for (const value of ['nope', null, undefined, 42, {}]) {
    const peer = createPeer({}, (req) => {
      if (req.command === PROBE) return
      throw value
    })

    peer.push(request(1))
    peer.push(event(PROBE))

    await peer.probe
    await new Promise(setImmediate)

    const response = writtenMessages(peer).at(-1)

    t.is(response.type, type.RESPONSE)
    t.is(response.error.message, String(value))
    t.is(response.error.code, '')
    t.is(response.error.errno, 0)
  }
})

test('error response for a streamed reply destroys the response stream', (t) => {
  t.plan(2)

  const peer = createPeer()

  const req = peer.rpc.request(1)
  req.send()

  const stream = req.createResponseStream()
  stream.on('error', (err) => t.is(err.code, 'E')).on('close', () => t.ok(peer.rpc.idle))

  peer.push(
    frame({
      type: type.RESPONSE,
      id: 1,
      stream: 0,
      error
    })
  )
})

test('stale open of a response stream is dropped', async (t) => {
  const peer = createPeer({}, (req) => {
    if (req.command !== PROBE) req.reply('ok')
  })

  peer.push(request(1))
  peer.push(request(2))
  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.OPEN }))
  peer.push(event(PROBE))

  await peer.probe
  t.ok(peer.rpc.idle)
})

test('destroying a stream with a non-error sends an error', async (t) => {
  const peer = createPeer()

  const req = peer.rpc.request(1)
  req.send()

  const requestStream = peer.rpc.request(2).createRequestStream().on('error', noop)
  const responseStream = req.createResponseStream().on('error', noop)

  await new Promise(setImmediate)

  requestStream.destroy('x')
  await closed(requestStream)

  t.is(writtenMessages(peer).at(-1).stream, s.REQUEST | s.CLOSE | s.ERROR)
  t.is(writtenMessages(peer).at(-1).error.message, 'x')

  responseStream.destroy(42)
  await closed(responseStream)

  t.is(writtenMessages(peer).at(-1).stream, s.RESPONSE | s.DESTROY | s.ERROR)
  t.is(writtenMessages(peer).at(-1).error.message, '42')
})

test('plain response for a streamed reply arrives on the response stream', async (t) => {
  for (const data of [Buffer.from('ok'), Buffer.alloc(0)]) {
    const peer = createPeer()

    const req = peer.rpc.request(1)
    req.send()

    const received = []

    const stream = req.createResponseStream()
    stream.on('data', (chunk) => received.push(chunk))

    peer.push(frame({ type: type.RESPONSE, id: 1, stream: 0, error: null, data }))

    await new Promise((resolve) => stream.on('end', resolve))
    await closed(stream)

    t.alike(received, data.byteLength > 0 ? [data] : [])
    t.ok(peer.rpc.idle)
  }
})

test('plain response for an ended response stream is not pushed', async (t) => {
  const peer = createPeer()

  const req = peer.rpc.request(1)
  req.send()

  const received = []

  const stream = req.createResponseStream()
  stream.on('data', (chunk) => received.push(chunk))

  peer.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.END }))
  peer.push(frame({ type: type.RESPONSE, id: 1, stream: 0, error: null, data: Buffer.from('ok') }))

  await new Promise((resolve) => stream.on('end', resolve))
  await closed(stream)

  t.alike(received, [])
  t.is(peer.error, null)
  t.ok(peer.rpc.idle)
})

test('request stream the responder never opens is released by the reply', async (t) => {
  for (const fail of [false, true]) {
    const rpc = new RPC(new PassThrough(), (req) => {
      if (fail) throw Object.assign(new Error('boom'), { code: 'E_BOOM' })
      req.reply('ok')
    })

    const req = rpc.request(1)

    const errors = []

    const stream = req.createRequestStream().on('error', (err) => errors.push(err.code))

    stream.write(Buffer.from('a'))
    stream.end()

    const drained = Writable.drained(stream)

    if (fail) await t.exception(req.reply(), { code: 'E_BOOM' })
    else t.alike(await req.reply(), Buffer.from('ok'))

    await closed(stream)
    await drained

    t.alike(errors, fail ? ['E_BOOM'] : [])
    t.ok(rpc.idle)
  }
})

test('stream ended without a close leaves no state', async (t) => {
  const responder = createPeer({}, (req) => {
    if (req.command === PROBE) return
    req
      .createRequestStream()
      .on('end', () => req.reply('ok'))
      .resume()
  })

  responder.push(frame({ type: type.REQUEST, id: 1, command: 1, stream: s.OPEN }))
  responder.push(
    frame({ type: type.STREAM, id: 1, stream: s.REQUEST | s.DATA, data: Buffer.from('a') })
  )
  responder.push(frame({ type: type.STREAM, id: 1, stream: s.REQUEST | s.END }))

  await new Promise(setImmediate)
  await new Promise(setImmediate)

  t.ok(responder.rpc.idle, 'request side')

  const requester = createPeer()

  const req = requester.rpc.request(1)
  req.send()

  const stream = req.createResponseStream().resume()

  requester.push(responseData(1, Buffer.from('a')))
  requester.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.END }))

  await closed(stream)

  t.ok(requester.rpc.idle, 'response side')
})

test('finished outgoing stream sends an end and no close', async (t) => {
  const requester = createPeer()

  const requestStream = requester.rpc.request(1).createRequestStream()

  await new Promise(setImmediate)

  requester.push(frame({ type: type.STREAM, id: 1, stream: s.REQUEST | s.OPEN }))
  requestStream.end('a')

  await closed(requestStream)

  t.alike(writtenFlags(requester), [s.OPEN, s.REQUEST | s.DATA, s.REQUEST | s.END])

  let responseStream = null

  const responder = createPeer({}, (req) => {
    if (req.command !== PROBE) responseStream = req.createResponseStream()
  })

  responder.push(frame({ type: type.REQUEST, id: 1, command: 1, stream: 0, data: Buffer.alloc(0) }))
  responder.push(frame({ type: type.STREAM, id: 1, stream: s.RESPONSE | s.OPEN }))

  await new Promise(setImmediate)

  responseStream.end('b')

  await closed(responseStream)

  t.alike(writtenFlags(responder), [s.OPEN, s.RESPONSE | s.DATA, s.RESPONSE | s.END])
})

test('command router answers an unknown command with an error', async (t) => {
  const rpc = new RPC(new PassThrough(), new RPC.CommandRouter())

  rpc.event(7).send()

  const req = rpc.request(7)
  req.send()

  const err = await req.reply().catch((err) => err)

  t.is(err.code, 'UNKNOWN_COMMAND')
  t.is(err.errno, 0)
  t.ok(rpc.idle)
})

test('command router leaves no state for a flood of unknown commands', async (t) => {
  const router = new RPC.CommandRouter()
  router.respond(1, () => Buffer.from('ok'))

  const peer = createPeer({}, router)

  for (let id = 1; id <= 1000; id++) {
    peer.push(request(id, 7))
  }

  await new Promise(setImmediate)

  const written = peer.written.length

  peer.push(request(1))

  await new Promise(setImmediate)

  t.is(peer.error, null, 'reusing an answered id is not a violation')
  t.ok(peer.written.length > written, 'the request is answered')
})

test('plain request answered with a stream destroys the stream and keeps the connection', async (t) => {
  const peer = createPeer()

  const req = peer.rpc.request(1)
  req.send()

  const reply = req.reply().catch((err) => err)

  peer.push(frame({ type: type.RESPONSE, id: 1, stream: s.OPEN, error: null }))

  t.is((await reply).code, 'UNEXPECTED_STREAM')

  const destroy = writtenMessages(peer).at(-1)
  t.is(destroy.type, type.STREAM)
  t.is(destroy.id, 1)
  t.is(destroy.stream, s.RESPONSE | s.DESTROY)

  peer.push(responseData(1, Buffer.from('a')))
  peer.push(event(PROBE))

  await peer.probe
  t.is(peer.error, null)
  t.ok(peer.rpc.idle)
})

test('request handler throwing after opening a response stream sends no second response', async (t) => {
  let responseStream = null

  const peer = createPeer({}, (req) => {
    if (req.command === PROBE) return
    responseStream = req.createResponseStream().on('error', noop)
    throw new Error('boom')
  })

  peer.push(request(1))

  await new Promise(setImmediate)
  await closed(responseStream)

  const messages = writtenMessages(peer)

  t.alike(
    messages.map((message) => [message.type, message.stream]),
    [
      [type.RESPONSE, s.OPEN],
      [type.STREAM, s.RESPONSE | s.CLOSE | s.ERROR]
    ]
  )
  t.is(messages.at(-1).error.message, 'boom')
  t.ok(peer.rpc.idle)
})

test('request handler throwing after replying sends no second response', async (t) => {
  const peer = createPeer({}, (req) => {
    if (req.command === PROBE) return
    req.reply('ok')
    throw new Error('boom')
  })

  peer.push(request(1))
  peer.push(event(PROBE))

  await peer.probe

  const messages = writtenMessages(peer)

  t.is(messages.length, 1)
  t.is(messages[0].type, type.RESPONSE)
  t.is(messages[0].error, null)
  t.alike(messages[0].data, Buffer.from('ok'))
  t.is(peer.error, null)
  t.ok(peer.rpc.idle)
})

test('stream buffering more than maxBufferedBytes of unread data fails the connection', async (t) => {
  const peer = createPeer({ maxBufferedBytes: 64 })

  const req = peer.rpc.request(1)
  req.send()

  const errors = []

  const stream = req.createResponseStream().on('error', (err) => errors.push(err.code))

  await new Promise(setImmediate)

  for (let i = 0; i < 4; i++) {
    peer.push(responseData(1, Buffer.alloc(64)))
    await new Promise(setImmediate)
    t.is(stream.read().byteLength, 64)
  }

  peer.push(responseData(1, Buffer.alloc(64)))
  peer.push(event(PROBE))

  await peer.probe
  t.is(peer.error, null, 'a stream at the limit is kept')

  peer.push(responseData(1, Buffer.alloc(1)))

  t.is((await peer.failure).code, 'STREAM_OVERFLOW')

  await closed(stream)

  t.alike(errors, ['STREAM_OVERFLOW'])
  t.ok(peer.rpc.idle)
})

test('maxBufferedBytes defaults to 16 MiB', async (t) => {
  const half = 8 * 1024 * 1024

  const peer = createPeer()

  const req = peer.rpc.request(1)
  req.send()

  req.createResponseStream().on('error', noop)

  peer.push(responseData(1, Buffer.alloc(half)))
  peer.push(responseData(1, Buffer.alloc(half)))
  peer.push(event(PROBE))

  await peer.probe
  t.is(peer.error, null)

  peer.push(responseData(1, Buffer.alloc(1)))

  t.is((await peer.failure).code, 'STREAM_OVERFLOW')
})

test('fuzzed frames either fail the connection or leave it working', async (t) => {
  const random = prng(0x5eed)

  const corpus = [
    event(1, Buffer.from('ping')),
    frame({ type: type.REQUEST, id: 1, command: 1, stream: 0, data: Buffer.from('ping') }),
    frame({ type: type.REQUEST, id: 2, command: 1, stream: s.OPEN }),
    frame({ type: type.RESPONSE, id: 1, stream: 0, error: null, data: Buffer.from('pong') }),
    frame({ type: type.RESPONSE, id: 1, stream: s.OPEN, error: null }),
    frame({
      type: type.RESPONSE,
      id: 1,
      stream: 0,
      error
    })
  ]

  for (const direction of [s.REQUEST, s.RESPONSE]) {
    for (const action of [s.OPEN, s.CLOSE, s.PAUSE, s.RESUME, s.END, s.DESTROY]) {
      corpus.push(frame({ type: type.STREAM, id: 1, stream: direction | action }))
    }

    corpus.push(
      frame({ type: type.STREAM, id: 1, stream: direction | s.DATA, data: Buffer.alloc(3) })
    )
    corpus.push(
      frame({
        type: type.STREAM,
        id: 1,
        stream: direction | s.CLOSE | s.ERROR,
        error
      })
    )
  }

  const codes = new Set(['INVALID_MESSAGE', 'UNKNOWN_MESSAGE', 'FRAME_TOO_LARGE'])

  let failed = 0
  let survived = 0

  for (let i = 0; i < 1000; i++) {
    const peer = createPeer({ maxFrameSize: 1024 }, (req) => {
      if (req.id) req.reply('ok')
    })

    const req = peer.rpc.request(1)

    const requestStream = req.createRequestStream().on('error', noop)
    const responseStream = req.createResponseStream().on('error', noop)

    responseStream.resume()

    const frames = []

    for (let j = 1 + Math.floor(random() * 8); j > 0; j--) {
      frames.push(mutate(corpus[Math.floor(random() * corpus.length)], random))
    }

    const bytes = Buffer.concat(frames)

    peer.push(bytes)

    // A frame whose length runs past the fuzzed bytes absorbs the probes that
    // follow, so keep probing until one gets through or the connection fails.
    for (let j = 0; j < 200 && !peer.probed && peer.error === null; j++) {
      peer.push(event(PROBE))
      await new Promise(setImmediate)
    }

    if (peer.error !== null) {
      if (!codes.has(peer.error.code)) {
        t.fail(`unexpected failure ${peer.error.message} for ${bytes.toString('hex')}`)
      }

      await closed(peer.stream)

      failed++
    } else if (!peer.probed) {
      t.fail(`connection stalled for ${bytes.toString('hex')}`)
    } else {
      for (const id of openedResponseIds(Buffer.concat(peer.pushed))) {
        peer.push(frame({ type: type.STREAM, id, stream: s.RESPONSE | s.DESTROY }))
      }

      requestStream.destroy()
      responseStream.destroy()

      await closed(requestStream)
      await closed(responseStream)

      peer.push(event(PROBE))
      await new Promise(setImmediate)

      survived++
    }

    if (!peer.rpc.idle) t.fail(`state left behind for ${bytes.toString('hex')}`)
  }

  t.ok(failed > 0, `${failed} runs failed the connection`)
  t.ok(survived > 0, `${survived} runs kept it working`)
})

function createPeer(opts = {}, onrequest = noop) {
  let onprobe
  let onfailure

  const peer = {
    rpc: null,
    stream: null,
    probed: false,
    error: null,
    pushed: [],
    written: [],
    probe: new Promise((resolve) => {
      onprobe = resolve
    }),
    failure: new Promise((resolve) => {
      onfailure = resolve
    }),
    push(data) {
      if (data !== null) peer.pushed.push(data)
      peer.stream.push(data)
    }
  }

  peer.stream = new Duplex({
    write(data, encoding, cb) {
      peer.written.push(data)
      cb(null)
    }
  })

  peer.stream.on('error', (err) => {
    peer.error = err
    onfailure(err)
  })

  peer.rpc = new RPC(
    peer.stream,
    (req) => {
      if (req.command === PROBE && req.id === undefined) {
        peer.probed = true
        onprobe(req.data)
      }

      return typeof onrequest === 'function' ? onrequest(req) : onrequest._onrequest(req)
    },
    opts
  )

  return peer
}

function writtenMessages(peer) {
  const bytes = Buffer.concat(peer.written)
  const messages = []

  for (let start = 0; start < bytes.length;) {
    const end = start + 4 + bytes.readUInt32LE(start)
    messages.push(m.message.decode(c.state(0, end - start, bytes.subarray(start, end))))
    start = end
  }

  return messages
}

function writtenFlags(peer) {
  return writtenMessages(peer).map((message) => message.stream)
}

function frame(message) {
  const header = c.encode(m.header, message)
  return message.data && m.hasData(message) ? Buffer.concat([header, message.data]) : header
}

function request(id, command = 1) {
  return frame({ type: type.REQUEST, id, command, stream: 0, data: Buffer.alloc(0) })
}

function responseData(id, data) {
  return frame({ type: type.STREAM, id, stream: s.RESPONSE | s.DATA, data })
}

function event(command, data = Buffer.alloc(0)) {
  return frame({ type: type.REQUEST, id: 0, command, stream: 0, data })
}

function eventOverhead(size) {
  return c.encode(m.header, {
    type: type.REQUEST,
    id: 0,
    command: PROBE,
    stream: 0,
    data: { byteLength: size }
  }).byteLength
}

function lengthPrefix(length) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(length)
  return buffer
}

function mutate(original, random) {
  const buffer = Buffer.from(original)

  if (random() < 0.8) return buffer

  switch (Math.floor(random() * 5)) {
    case 0:
      buffer[Math.floor(random() * buffer.length)] = Math.floor(random() * 256)
      return buffer
    case 1:
      buffer[4 + Math.floor(random() * (buffer.length - 4))] ^= 1 << Math.floor(random() * 8)
      return buffer
    case 2:
      return buffer.subarray(0, Math.floor(random() * buffer.length))
    case 3: {
      const body = Buffer.alloc(Math.floor(random() * 16))
      for (let i = 0; i < body.length; i++) body[i] = Math.floor(random() * 256)
      return Buffer.concat([lengthPrefix(body.length), body])
    }
    default:
      buffer[4] = Math.floor(random() * 5)
      return buffer
  }
}

function openedResponseIds(bytes) {
  const ids = []

  for (let start = 0; start + 4 <= bytes.length;) {
    const end = start + 4 + bytes.readUInt32LE(start)
    if (end > bytes.length) break

    try {
      const message = m.message.decode(c.state(0, end - start, bytes.subarray(start, end)))
      if (message.type === type.STREAM && message.stream === (s.RESPONSE | s.OPEN) && message.id) {
        ids.push(message.id)
      }
    } catch {
      break
    }

    start = end
  }

  return ids
}

function closed(stream) {
  if (stream.destroyed) return
  return new Promise((resolve) => stream.once('close', resolve))
}

// Mulberry32, so that a failing run can be replayed from its seed.
function prng(seed) {
  return function random() {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), seed | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function noop() {}
