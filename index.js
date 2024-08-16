const safetyCatch = require('safety-catch')
const c = require('compact-encoding')
const m = require('./lib/messages')
const { type, stream } = require('./lib/constants')
const IncomingRequest = require('./lib/incoming-request')
const IncomingStream = require('./lib/incoming-stream')
const OutgoingRequest = require('./lib/outgoing-request')
const OutgoingStream = require('./lib/outgoing-stream')

module.exports = class RPC {
  constructor (stream, onrequest) {
    this._stream = stream

    this._id = 0
    this._responding = 0
    this._outgoing = new Map()
    this._incoming = new Map()

    this._buffer = null

    this._onrequest = onrequest.bind(this)
    this._ondata = this._ondata.bind(this)

    this._stream
      .on('data', this._ondata)
  }

  request (command) {
    return new OutgoingRequest(this, command)
  }

  _sendMessage (message) {
    this._stream.write(c.encode(m.message, message))
  }

  _sendRequest (request, data = null) {
    const id = request.id = ++this._id

    this._outgoing.set(id, request)

    this._sendMessage({
      type: type.REQUEST,
      id,
      command: request.command,
      stream: 0,
      data
    })
  }

  _createRequestStream (request, isInitiator) {
    if (isInitiator) {
      const id = request.id = ++this._id

      this._outgoing.set(id, request)

      request._requestStream = new OutgoingStream(this, request, type.REQUEST)
    } else {
      this._incoming.set(request.id, request)

      request._requestStream = new IncomingStream(this, request, type.REQUEST)

      request._requestStream.on('close', () => this._incoming.delete(request.id))
    }
  }

  _sendResponse (request, data) {
    this._sendMessage({
      type: type.RESPONSE,
      id: request.id,
      error: false,
      stream: 0,
      data
    })
  }

  _createResponseStream (request, isInitiator) {
    if (isInitiator) {
      request._responseStream = new OutgoingStream(this, request, stream.RESPONSE)
    } else {
      request._responseStream = new IncomingStream(this, request, stream.RESPONSE)
    }
  }

  _sendError (request, err) {
    this._sendMessage({
      type: type.RESPONSE,
      id: request.id,
      error: true,
      stream: 0,
      message: err.message,
      code: err.code || '',
      status: err.errno || 0
    })
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
        safetyCatch(err)

        return this._stream.destroy(err)
      }

      if (message === null) return

      switch (message.type) {
        case type.REQUEST: {
          const request = new IncomingRequest(this, message.id, message.command, message.data)

          try {
            this._onrequest(request)
          } catch (err) {
            safetyCatch(err)

            this._sendError(request, err)
          }
          break
        }
        case type.RESPONSE:
          try {
            this._onresponse(message)
          } catch (err) {
            safetyCatch(err)
          }
          break
        case type.STREAM:
          try {
            this._onstream(message)
          } catch (err) {
            safetyCatch(err)
          }
      }

      this._buffer = state.start === state.end ? null : this._buffer.subarray(state.start)
    }
  }

  _onresponse (message) {
    if (message.id === 0) return

    const request = this._outgoing.get(message.id)

    if (request === undefined) return

    if (message.error) {
      const err = new Error(`${message.message}`)
      err.code = message.code
      err.errno = message.status

      request._reject(err)
    } else if (message.stream === 0) {
      request._resolve(message.data)
    }
  }

  _onstream (message) {
    if (message.id === 0) return

    let target

    if (message.stream & stream.REQUEST) {
      const request = this._incoming.get(message.id)

      if (request === undefined) return

      target = request._requestStream
    } else if (message.stream & stream.RESPONSE) {
      const request = this._outgoing.get(message.id)

      if (request === undefined) return

      target = request._responseStream
    } else {
      return
    }

    if (message.stream & stream.DATA) {
      target.push(message.data)
    } else if (message.stream & stream.END) {
      target.push(null)
    }
  }
}
