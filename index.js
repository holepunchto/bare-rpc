const c = require('compact-encoding')
const m = require('./lib/messages')
const { type } = require('./lib/constants')
const IncomingRequest = require('./lib/incoming-request')
const OutgoingRequest = require('./lib/outgoing-request')

module.exports = class RPC {
  constructor (stream, onrequest) {
    this._stream = stream

    this._id = 0
    this._responding = 0
    this._requests = new Map()

    this._buffer = null

    this._onrequest = onrequest.bind(this)
    this._ondata = this._ondata.bind(this)

    this._stream
      .on('data', this._ondata)
  }

  request (command) {
    return new OutgoingRequest(this, command)
  }

  _send (request, data) {
    const id = ++this._id

    this._requests.set(id, request)

    this._stream.write(c.encode(m.message, {
      type: type.REQUEST,
      id,
      command: request.command,
      data
    }))
  }

  _reply (request, data) {
    this._stream.write(c.encode(m.message, {
      type: type.RESPONSE,
      id: request.id,
      error: false,
      data
    }))
  }

  _ondata (data) {
    if (this._buffer === null) this._buffer = data
    else this._buffer = Buffer.concat([this._buffer, data])

    while (this._buffer !== null) {
      const state = { start: 0, end: this._buffer.length, buffer: this._buffer }

      let message
      try {
        message = m.message.decode(state)
      } catch (err) {
        // TODO
      }

      if (message === null) return

      switch (message.type) {
        case type.REQUEST:
          this._onrequest(new IncomingRequest(this, message.id, message.command, message.data))
          break

        case type.RESPONSE:
          this._onresponse(message)
      }

      this._buffer = state.start === state.end ? null : this._buffer.subarray(state.start)
    }
  }

  _onresponse (message) {
    if (message.id === 0) return

    const request = this._requests.get(message.id)

    if (request === undefined) return

    if (message.error) {
      const err = new Error(`${message.message}`)
      err.code = message.code
      err.errno = message.status

      request._reject(err)
    } else {
      request._resolve(message.data)
    }
  }
}
