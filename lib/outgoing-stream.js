const { Writable } = require('bare-stream')
const { type: t, stream: s } = require('./constants')

module.exports = class RPCOutgoingStream extends Writable {
  constructor(rpc, request, type, opts) {
    super({ ...opts, eagerOpen: true })

    this._rpc = rpc
    this._request = request
    this._type = type
    this._mask = type === t.REQUEST ? s.REQUEST : s.RESPONSE

    this._pendingOpen = null
  }

  _open(cb) {
    let pending

    switch (this._type) {
      case t.REQUEST:
        pending = this._rpc._pendingRequests

        this._rpc._sendMessage({
          type: t.REQUEST,
          id: this._request.id,
          command: this._request.command,
          stream: s.OPEN,
          data: null
        })
        break

      case t.RESPONSE:
        pending = this._rpc._pendingResponses

        this._rpc._sendMessage({
          type: t.RESPONSE,
          id: this._request.id,
          error: false,
          stream: s.OPEN,
          data: null
        })
        break
    }

    if (pending.has(this._request.id)) {
      pending.delete(this._request.id)

      cb(null)
    } else {
      this._pendingOpen = cb
    }
  }

  _continueOpen() {
    if (this._pendingOpen === null) return
    const cb = this._pendingOpen
    this._pendingOpen = null
    cb()
  }

  _write(data, encoding, cb) {
    this._rpc._sendMessage({
      type: t.STREAM,
      id: this._request.id,
      stream: this._mask | s.DATA,
      error: null,
      data
    })

    cb(null)
  }

  _final(cb) {
    this._rpc._sendMessage({
      type: t.STREAM,
      id: this._request.id,
      stream: this._mask | s.END,
      error: null,
      data: null
    })

    cb(null)
  }

  _destroy(err, cb) {
    if (err) {
      this._rpc._sendMessage({
        type: t.STREAM,
        id: this._request.id,
        stream: this._mask | s.CLOSE | s.ERROR,
        error: err,
        data: null
      })
    } else {
      this._rpc._sendMessage({
        type: t.STREAM,
        id: this._request.id,
        stream: this._mask | s.CLOSE,
        error: null,
        data: null
      })
    }

    cb(null)
  }
}
