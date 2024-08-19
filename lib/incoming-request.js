const errors = require('./errors')

module.exports = class RPCIncomingRequest {
  constructor (rpc, id, command, data) {
    this.rpc = rpc
    this.id = id
    this.command = command
    this.data = data
    this.sent = false

    this._requestStream = null
    this._responseStream = null
  }

  reply (data) {
    if (this.sent) throw errors.ALREADY_SENT('Response has already been sent')
    this.sent = true

    this.rpc._sendResponse(this, typeof data === 'string' ? Buffer.from(data) : data)
  }

  createResponseStream (opts = {}) {
    if (this._responseStream === null) this.rpc._createResponseStream(this, true, opts)

    return this._responseStream
  }

  createRequestStream (opts = {}) {
    if (this._requestStream === null) this.rpc._createRequestStream(this, false, opts)

    return this._requestStream
  }
}
