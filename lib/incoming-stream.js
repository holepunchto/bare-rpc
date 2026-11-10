const { Readable } = require('bare-stream')
const { type: t, stream: s } = require('./constants')
const { toError } = require('./messages')

module.exports = class RPCIncomingStream extends Readable {
  constructor(rpc, request, type, opts) {
    super({ ...opts, eagerOpen: true })

    this._rpc = rpc
    this._request = request
    this._type = type
    this._mask = type === t.REQUEST ? s.REQUEST : s.RESPONSE

    this._opened = false
  }

  _open(cb) {
    this._opened = true

    this._rpc._sendMessage(
      {
        type: t.STREAM,
        id: this._request.id,
        stream: this._mask | s.OPEN,
        error: null,
        data: null
      },
      cb
    )
  }

  _read() {
    this._rpc._sendMessage({
      type: t.STREAM,
      id: this._request.id,
      stream: this._mask | s.RESUME,
      error: null,
      data: null
    })
  }

  _destroy(err, cb) {
    // A request cancelled before it was sent only has to take back an open
    // that already went out, as the remote end never learns of the cancel.
    if (this._request._reason !== null && (this._request._cancelled || !this._opened)) {
      cb(null)
    } else if (err) {
      this._rpc._sendMessage(
        {
          type: t.STREAM,
          id: this._request.id,
          stream: this._mask | s.DESTROY | s.ERROR,
          error: toError(err),
          data: null
        },
        cb
      )
    } else {
      this._rpc._sendMessage(
        {
          type: t.STREAM,
          id: this._request.id,
          stream: this._mask | s.DESTROY,
          error: null,
          data: null
        },
        cb
      )
    }
  }
}
