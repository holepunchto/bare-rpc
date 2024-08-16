const safetyCatch = require('safety-catch')
const c = require('compact-encoding')
const m = require('./lib/messages')
const { type: t, stream: s } = require('./lib/constants')
const IncomingRequest = require('./lib/incoming-request')
const IncomingStream = require('./lib/incoming-stream')
const OutgoingRequest = require('./lib/outgoing-request')
const OutgoingStream = require('./lib/outgoing-stream')

module.exports = class RPC {
  constructor (stream, onrequest) {
    this._stream = stream

    this._id = 0
    this._requests = new Map()
    this._responses = new Map()
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

    this._requests.set(id, request)

    this._sendMessage({
      type: t.REQUEST,
      id,
      command: request.command,
      stream: 0,
      data
    })
  }

  _createRequestStream (request, isInitiator) {
    if (isInitiator) {
      const id = request.id = ++this._id

      this._requests.set(id, request)

      request._requestStream = new OutgoingStream(this, request, t.REQUEST)
    } else {
      this._incoming.set(request.id, request)

      const stream = request._requestStream = new IncomingStream(this, request, t.REQUEST)

      stream.on('close', () => this._incoming.delete(request.id))
    }
  }

  _sendResponse (request, data) {
    this._sendMessage({
      type: t.RESPONSE,
      id: request.id,
      stream: 0,
      error: null,
      data
    })
  }

  _createResponseStream (request, isInitiator) {
    if (isInitiator) {
      this._responses.set(request.id, request)

      request._responseStream = new OutgoingStream(this, request, t.RESPONSE)
    } else {
      this._incoming.set(request.id, request)

      const stream = request._responseStream = new IncomingStream(this, request, t.RESPONSE)

      stream.on('close', () => this._incoming.delete(request.id))
    }
  }

  _sendError (request, err) {
    this._sendMessage({
      type: t.RESPONSE,
      id: request.id,
      stream: 0,
      error: err,
      data: null
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
        case t.REQUEST: {
          const request = new IncomingRequest(this, message.id, message.command, message.data)

          try {
            this._onrequest(request)
          } catch (err) {
            safetyCatch(err)

            this._sendError(request, err)
          }
          break
        }
        case t.RESPONSE:
          try {
            this._onresponse(message)
          } catch (err) {
            safetyCatch(err)
          }
          break
        case t.STREAM:
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

    const request = this._requests.get(message.id)
    if (request === undefined) return

    if (message.error) {
      request._reject(message.error)
    } else if (message.stream === 0) {
      request._resolve(message.data)
    }
  }

  _onstream (message) {
    if (message.id === 0) return

    if (message.stream & s.OPEN) this._onstreamopen(message)
    else if (message.stream & s.CLOSE) this._onstreamclose(message)
    else if (message.stream & s.DATA) this._onstreamdata(message)
    else if (message.stream & s.END) this._onstreamend(message)
    else if (message.stream & s.DESTROY) this._onstreamdestroy(message)
  }

  _onstreamopen (message) {
    let stream

    if (message.stream & s.REQUEST) {
      const request = this._requests.get(message.id)
      if (request === undefined) return

      stream = request._requestStream
    } else if (message.stream & s.RESPONSE) {
      const request = this._responses.get(message.id)
      if (request === undefined) return

      stream = request._responseStream
    } else {
      return
    }

    stream._continueOpen()
  }

  _onstreamclose (message) {
    const request = this._incoming.get(message.id)
    if (request === undefined) return

    let stream

    if (message.stream & s.REQUEST) {
      stream = request._requestStream
    } else if (message.stream & s.RESPONSE) {
      stream = request._responseStream
    } else {
      return
    }

    if (message.error) stream.destroy(message.error)
    else stream.push(null)
  }

  _onstreamdata (message) {
    const request = this._incoming.get(message.id)
    if (request === undefined) return

    let stream

    if (message.stream & s.REQUEST) {
      stream = request._requestStream
    } else if (message.stream & s.RESPONSE) {
      stream = request._responseStream
    } else {
      return
    }

    if (stream.push(message.data) === false) {
      // TODO: Backpressure
    }
  }

  _onstreamend (message) {
    const request = this._incoming.get(message.id)
    if (request === undefined) return

    let stream

    if (message.stream & s.REQUEST) {
      stream = request._requestStream
    } else if (message.stream & s.RESPONSE) {
      stream = request._responseStream
    } else {
      return
    }

    stream.push(null)
  }

  _onstreamdestroy (message) {
    let stream

    if (message.stream & s.REQUEST) {
      const request = this._requests.get(message.id)
      if (request === undefined) return

      stream = request._requestStream
    } else if (message.stream & s.RESPONSE) {
      const request = this._responses.get(message.id)
      if (request === undefined) return

      stream = request._responseStream
    } else {
      return
    }

    stream.destroy(message.error)
  }
}
