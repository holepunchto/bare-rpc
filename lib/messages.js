const c = require('compact-encoding')
const { type: t } = require('./constants')
const errors = require('./errors')

const request = {
  preencode (state, m) {
    c.utf8.preencode(state, m.command)
    c.buffer.preencode(state, m.data)
    c.uint.preencode(state, 0) // Reserved
  },
  encode (state, m) {
    c.utf8.encode(state, m.command)
    c.buffer.encode(state, m.data)
    c.uint.encode(state, 0) // Reserved
  },
  decode (state, id) {
    const command = c.utf8.decode(state)
    const data = c.buffer.decode(state)
    c.uint.decode(state)

    return { type: t.REQUEST, id, command, data }
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

    if (m.error) error.preencode(state, m)
    else c.buffer.preencode(state, m.data)

    c.uint.preencode(state, 0) // Reserved
  },
  encode (state, m) {
    c.bool.encode(state, m.error)

    if (m.error) error.encode(state, m)
    else c.buffer.encode(state, m.data)

    c.uint.encode(state, 0) // Reserved
  },
  decode (state) {
    const error = c.bool.decode(state)

    let response
    if (error) response = error.decode(state)
    else response = { data: c.buffer.decode(state) }

    c.uint.decode(state)

    return { error, ...response }
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
        return { type: t.REQUEST, id, ...request.decode(state, id) }
      case t.RESPONSE:
        return { type: t.RESPONSE, id, ...response.decode(state, id) }
      default:
        throw errors.UNKNOWN_MESSAGE(`Unknown message '${type}'`)
    }
  }
}
