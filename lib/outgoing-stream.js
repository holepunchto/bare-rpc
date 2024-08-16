const { Writable } = require('bare-stream')
const { type, stream } = require('./constants')

module.exports = class RPCOutgoingStream extends Writable {
  constructor (rpc, request, type) {
    super()

    this._rpc = rpc
    this._request = request
    this._type = type
  }

  _open (cb) {
    switch (this._type) {
      case type.REQUEST:
        this._rpc._sendMessage({
          type: type.REQUEST,
          id: this._request.id,
          command: this._request.command,
          stream: stream.OPEN,
          data: null
        })
        break

      case type.RESPONSE:
        this._rpc._sendMessage({
          type: type.RESPONSE,
          id: this._request.id,
          error: false,
          stream: stream.OPEN,
          data: null
        })
        break
    }

    cb(null)
  }

  _write (data, encoding, cb) {
    this._rpc._sendMessage({
      type: type.STREAM,
      id: this._request.id,
      stream: stream.DATA | (this._type === type.REQUEST ? stream.REQUEST : stream.RESPONSE),
      data
    })

    cb(null)
  }

  _final (cb) {
    this._rpc._sendMessage({
      type: type.STREAM,
      id: this._request.id,
      stream: stream.END | (this._type === type.REQUEST ? stream.REQUEST : stream.RESPONSE),
      data: null
    })

    cb(null)
  }
}
