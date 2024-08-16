const { Writable } = require('bare-stream')
const { type: t, stream: s } = require('./constants')

module.exports = class RPCOutgoingStream extends Writable {
  constructor (rpc, request, type) {
    super()

    this._rpc = rpc
    this._request = request
    this._type = type
    this._mask = type === t.REQUEST ? s.REQUEST : s.RESPONSE

    this._pendingOpen = null
  }

  _open (cb) {
    this._pendingOpen = cb

    switch (this._type) {
      case t.REQUEST:
        this._rpc._sendMessage({
          type: t.REQUEST,
          id: this._request.id,
          command: this._request.command,
          stream: s.OPEN,
          data: null
        })
        break

      case t.RESPONSE:
        this._rpc._sendMessage({
          type: t.RESPONSE,
          id: this._request.id,
          error: false,
          stream: s.OPEN,
          data: null
        })
        break
    }
  }

  _continueOpen (err) {
    if (this._pendingOpen === null) return
    const cb = this._pendingOpen
    this._pendingOpen = null
    cb(err)
  }

  _write (data, encoding, cb) {
    this._rpc._sendMessage({
      type: t.STREAM,
      id: this._request.id,
      stream: this._mask | s.DATA,
      data
    })

    cb(null)
  }

  _final (cb) {
    this._rpc._sendMessage({
      type: t.STREAM,
      id: this._request.id,
      stream: this._mask | s.END,
      data: null
    })

    cb(null)
  }
}
