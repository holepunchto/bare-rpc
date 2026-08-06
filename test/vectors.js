// Conformance against hrpc-test's shared vectors.
//
// This package is the reference implementation of the wire format the C, Swift
// and Python ports are held to, so a change that moves a byte should fail here,
// in the PR that causes it, rather than downstream months later.
const test = require('brittle')
const c = require('compact-encoding')
const { families, loadFamily, loadNegative, loadSequence } = require('hrpc-test')

const m = require('../lib/messages')

for (const family of families) {
  test(`vectors: ${family} decodes to the committed descriptors`, (t) => {
    const { frames, messages } = loadFamily(family)
    t.is(frames.length, messages.length, 'one frame per message')

    for (let i = 0; i < frames.length; i++) {
      t.alike(project(decodeFrame(frames[i])), messages[i].descriptor, messages[i].note)
    }
  })

  test(`vectors: ${family} encodes to the committed frames`, (t) => {
    const { frames, messages } = loadFamily(family)

    for (let i = 0; i < frames.length; i++) {
      t.is(toHex(encodeFrame(messages[i].descriptor)), frames[i], messages[i].note)
    }
  })
}

test('vectors: negative frames are rejected', (t) => {
  for (const { hex, reason } of loadNegative()) {
    t.exception.all(() => decodeFrame(hex), reason)
  }
})

test('vectors: a concatenated stream re-splits by length prefix', (t) => {
  const { concatenated, count } = loadSequence()
  const buf = Buffer.from(concatenated, 'hex')
  const state = c.state(0, buf.length, buf)

  let seen = 0
  while (state.start < state.end) {
    t.ok(m.message.decode(state), `frame ${seen}`)
    seen++
  }

  t.is(seen, count, 'all frames re-split')
})

function decodeFrame(hex) {
  const buf = Buffer.from(hex, 'hex')
  return m.message.decode(c.state(0, buf.length, buf))
}

// c.encode(m.header, ...) sizes the frame length to include the payload but
// does not write it, so the payload is concatenated on
function encodeFrame(descriptor) {
  const data = typeof descriptor.data === 'string' ? Buffer.from(descriptor.data, 'hex') : null
  const header = c.encode(m.header, { ...descriptor, data })

  return data ? Buffer.concat([header, data]) : Buffer.from(header)
}

// The shape messages.json stores. A decoded error is a real Error whose message
// is non-enumerable, so it is read across explicitly rather than spread
function project(decoded) {
  const out = { ...decoded, data: Buffer.isBuffer(decoded.data) ? toHex(decoded.data) : null }

  if (out.error) {
    out.error = {
      message: decoded.error.message,
      code: decoded.error.code ?? '',
      errno: decoded.error.errno
    }
  }

  return out
}

function toHex(buf) {
  return Buffer.from(buf).toString('hex')
}
