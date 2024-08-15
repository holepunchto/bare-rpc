const c = require('compact-encoding')
const { type: t, stream: s } = require('./constants')
const errors = require('./errors')

const request = {
  preencode (state, m) {
    c.utf8.preencode(state, m.command)
    c.uint.preencode(state, m.stream)
    if (m.stream === 0) c.buffer.preencode(state, m.data)
  },
  encode (state, m) {
    c.utf8.encode(state, m.command)
    c.uint.encode(state, m.stream)
    if (m.stream === 0) c.buffer.encode(state, m.data)
  },
  decode (state, id) {
    const command = c.utf8.decode(state)
    const stream = c.uint.decode(state)
    const data = stream === 0 ? c.buffer.decode(state) : null

    return { type: t.REQUEST, id, command, stream, data }
  }
}

const error = {
  preencode (state, m) {
    c.utf8.preencode(state, m.message)
    c.utf8.preencode(state, m.code)
    c.int.preencode(state, m.status)
  },
  encode (state, m) {
    c.utf8.encode(state, m.message)
    c.utf8.encode(state, m.code)
    c.int.encode(state, m.status)
  },
  decode (state) {
    return {
      message: c.utf8.decode(state),
      code: c.utf8.decode(state),
      status: c.int.decode(state)
    }
  }
}

const response = {
  preencode (state, m) {
    c.bool.preencode(state, m.error)
    c.uint.preencode(state, m.stream)

    if (m.error) error.preencode(state, m)
    else if (m.stream === 0) c.buffer.preencode(state, m.data)
  },
  encode (state, m) {
    c.bool.encode(state, m.error)
    c.uint.encode(state, m.stream)

    if (m.error) error.encode(state, m)
    else if (m.stream === 0) c.buffer.encode(state, m.data)
  },
  decode (state) {
    const error = c.bool.decode(state)
    const stream = c.uint.decode(state)

    let response
    if (error) response = error.decode(state)
    else if (stream === 0) response = { data: c.buffer.decode(state) }

    return { error, stream, ...response }
  }
}

const stream = {
  preencode (state, m) {
    c.uint.preencode(state, m.stream)

    if (m.stream & s.ERROR) error.preencode(state, m)
    else if (m.stream & s.DATA) c.buffer.preencode(state, m.data)
  },
  encode (state, m) {
    c.uint.encode(state, m.stream)

    if (m.stream & s.ERROR) error.encode(state, m)
    else if (m.stream & s.DATA) c.buffer.encode(state, m.data)
  },
  decode (state) {
    const stream = c.uint.decode(state)

    let response
    if (stream & s.ERROR) response = error.decode(state)
    else if (stream & s.DATA) response = { data: c.buffer.decode(state) }

    return { stream, ...response }
  }
}

exports.message = {
  preencode (state, m) {
    c.uint32.preencode(state, 0) // Frame
    c.uint.preencode(state, m.type)
    c.uint.preencode(state, m.id)

    switch (m.type) {
      case t.REQUEST:
        request.preencode(state, m)
        break
      case t.RESPONSE:
        response.preencode(state, m)
        break
      case t.STREAM:
        stream.preencode(state, m)
        break
    }
  },
  encode (state, m) {
    const frame = state.start

    c.uint32.encode(state, 0) // Frame

    const start = state.start

    c.uint.encode(state, m.type)
    c.uint.encode(state, m.id)

    switch (m.type) {
      case t.REQUEST:
        request.encode(state, m)
        break
      case t.RESPONSE:
        response.encode(state, m)
        break
      case t.STREAM:
        stream.encode(state, m)
        break
    }

    const end = state.start

    state.start = frame

    c.uint32.encode(state, end - start)

    state.start = end
  },
  decode (state) {
    if (state.end - state.start < 4) return null

    const frame = c.uint32.decode(state)

    if (state.end - state.start < frame) return null

    const type = c.uint.decode(state)
    const id = c.uint.decode(state)

    switch (type) {
      case t.REQUEST:
        return { type, id, ...request.decode(state, id) }
      case t.RESPONSE:
        return { type, id, ...response.decode(state, id) }
      case t.STREAM:
        return { type, id, ...stream.decode(state, id) }
      default:
        throw errors.UNKNOWN_MESSAGE(`Unknown message '${type}'`)
    }
  }
}
