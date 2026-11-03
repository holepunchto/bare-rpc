const { Writable } = require('bare-stream')
const { type: t, stream: s } = require('./constants')
const { toError } = require('./messages')

module.exports = class RPCOutgoingStream extends Writable {
  constructor(rpc, request, type, opts) {
    super({ ...opts, eagerOpen: true })

    this._rpc = rpc
    this._request = request
    this._type = type
    this._mask = type === t.REQUEST ? s.REQUEST : s.RESPONSE

    this._pendingOpen = null
    this._acknowledged = false
    this._ended = false
  }

  _open(cb) {
    const onflushed = () => {
      if (this._acknowledged) cb(null)
      else this._pendingOpen = cb
    }

    switch (this._type) {
      case t.REQUEST:
        this._rpc._sendMessage(
          {
            type: t.REQUEST,
            id: this._request.id,
            command: this._request.command,
            stream: s.OPEN,
            data: null
          },
          onflushed
        )
        break

      case t.RESPONSE:
        this._rpc._sendMessage(
          {
            type: t.RESPONSE,
            id: this._request.id,
            error: false,
            stream: s.OPEN,
            data: null
          },
          onflushed
        )
        break
    }
  }

  _continueOpen() {
    this._acknowledged = true

    if (this._pendingOpen === null) return

    const cb = this._pendingOpen
    this._pendingOpen = null
    cb()
  }

  _predestroy() {
    this._continueOpen()
  }

  _write(data, encoding, cb) {
    this._rpc._sendMessage(
      {
        type: t.STREAM,
        id: this._request.id,
        stream: this._mask | s.DATA,
        error: null,
        data
      },
      cb
    )
  }

  _final(cb) {
    this._ended = true

    this._rpc._sendMessage(
      {
        type: t.STREAM,
        id: this._request.id,
        stream: this._mask | s.END,
        error: null,
        data: null
      },
      cb
    )
  }

  _destroy(err, cb) {
    if (this._ended) {
      cb(null)
    } else if (err) {
      this._rpc._sendMessage(
        {
          type: t.STREAM,
          id: this._request.id,
          stream: this._mask | s.CLOSE | s.ERROR,
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
          stream: this._mask | s.CLOSE,
          error: null,
          data: null
        },
        cb
      )
    }
  }
}
