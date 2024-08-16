const { Readable } = require('bare-stream')

module.exports = class RPCIncomingStream extends Readable {
  constructor (rpc, request, type) {
    super()

    this._rpc = rpc
    this._request = request
    this._type = type
  }
}
