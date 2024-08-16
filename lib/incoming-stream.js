const { Readable } = require('bare-stream')
const { type: t, stream: s } = require('./constants')

module.exports = class RPCIncomingStream extends Readable {
  constructor (rpc, request, type) {
    super()

    this._rpc = rpc
    this._request = request
    this._type = type
    this._mask = type === t.REQUEST ? s.REQUEST : s.RESPONSE

    this._pendingOpen = null
  }

  _open (cb) {
    this._rpc._sendMessage({
      type: t.STREAM,
      id: this._request.id,
      stream: this._mask | s.OPEN,
      data: null
    })

    cb(null)
  }
}
