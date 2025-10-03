const c = require('compact-encoding')
const { type: t, stream: s } = require('./constants')
const errors = require('./errors')

const error = {
  preencode(state, m) {
    c.utf8.preencode(state, m.message)
    c.utf8.preencode(state, String(m.code) || '')
    c.int.preencode(state, Number(m.errno) || 0)
  },
  encode(state, m) {
    c.utf8.encode(state, m.message)
    c.utf8.encode(state, String(m.code) || '')
    c.int.encode(state, Number(m.errno) || 0)
  },
  decode(state) {
    const err = new Error(`${c.utf8.decode(state)}`)
    err.code = c.utf8.decode(state)
    err.errno = c.int.decode(state)
    return err
  }
}

exports.header = {
  preencode(state, m) {
    c.uint32.preencode(state, 0) // Frame
    c.uint.preencode(state, m.type)
    c.uint.preencode(state, m.id)

    let hasData = false

    switch (m.type) {
      case t.REQUEST:
        c.uint.preencode(state, m.command)
        c.uint.preencode(state, m.stream)
        if (m.stream === 0) hasData = true
        break

      case t.RESPONSE:
        c.bool.preencode(state, !!m.error)
        c.uint.preencode(state, m.stream)

        if (m.error) error.preencode(state, m.error)
        else if (m.stream === 0) hasData = true
        break

      case t.STREAM:
        c.uint.preencode(state, m.stream)

        if (m.stream & s.ERROR) error.preencode(state, m.error)
        else if (m.stream & s.DATA) hasData = true
        break
    }

    if (hasData) c.uint.preencode(state, m.data ? m.data.byteLength : 0)
  },
  encode(state, m) {
    const frame = state.start

    c.uint32.encode(state, 0) // Frame

    const start = state.start

    c.uint.encode(state, m.type)
    c.uint.encode(state, m.id)

    let hasData = false

    switch (m.type) {
      case t.REQUEST:
        c.uint.encode(state, m.command)
        c.uint.encode(state, m.stream)
        if (m.stream === 0) hasData = true
        break

      case t.RESPONSE:
        c.bool.encode(state, !!m.error)
        c.uint.encode(state, m.stream)

        if (m.error) error.encode(state, m.error)
        else if (m.stream === 0) hasData = true
        break

      case t.STREAM:
        c.uint.encode(state, m.stream)

        if (m.stream & s.ERROR) error.encode(state, m.error)
        else if (m.stream & s.DATA) hasData = true
        break
    }

    if (hasData) c.uint.encode(state, m.data ? m.data.byteLength : 0)

    const end = state.start

    state.start = frame

    c.uint32.encode(
      state,
      end - start + (hasData && m.data ? m.data.byteLength : 0)
    )

    state.start = end
  }
}

exports.message = {
  decode(state) {
    const frame = c.uint32.decode(state)

    if (state.end - state.start < frame) throw new RangeError('Out of bounds')

    const type = c.uint.decode(state)
    const id = c.uint.decode(state)

    switch (type) {
      case t.REQUEST: {
        const command = c.uint.decode(state)
        const stream = c.uint.decode(state)
        const data = stream === 0 ? c.buffer.decode(state) : null

        return { type, id, command, stream, data }
      }

      case t.RESPONSE: {
        const err = c.bool.decode(state)
        const stream = c.uint.decode(state)

        if (err) {
          return { type, id, stream, error: error.decode(state), data: null }
        }

        if (stream === 0) {
          return { type, id, stream, error: null, data: c.buffer.decode(state) }
        }

        return { type, id, stream, error: null, data: null }
      }

      case t.STREAM:
        const stream = c.uint.decode(state)

        if (stream & s.ERROR) {
          return { type, id, stream, error: error.decode(state), data: null }
        }

        if (stream & s.DATA) {
          return { type, id, stream, error: null, data: c.buffer.decode(state) }
        }

        return { type, id, stream, error: null, data: null }

      default:
        throw errors.UNKNOWN_MESSAGE(`Unknown message '${type}'`)
    }
  }
}
