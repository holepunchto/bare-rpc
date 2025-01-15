const { Readable } = require('bare-stream')
const { type: t, stream: s } = require('./constants')

module.exports = class RPCIncomingStream extends Readable {
  constructor(rpc, request, type, opts) {
    super({ ...opts, eagerOpen: true })

    this._rpc = rpc
    this._request = request
    this._type = type
    this._mask = type === t.REQUEST ? s.REQUEST : s.RESPONSE

    this._pendingOpen = null
  }

  _open(cb) {
    this._rpc._sendMessage({
      type: t.STREAM,
      id: this._request.id,
      stream: this._mask | s.OPEN,
      error: null,
      data: null
    })

    cb(null)
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
    if (err) {
      this._rpc._sendMessage({
        type: t.STREAM,
        id: this._request.id,
        stream: this._mask | s.DESTROY | s.ERROR,
        error: err,
        data: null
      })
    } else {
      this._rpc._sendMessage({
        type: t.STREAM,
        id: this._request.id,
        stream: this._mask | s.DESTROY,
        error: null,
        data: null
      })
    }

    cb(null)
  }
}
