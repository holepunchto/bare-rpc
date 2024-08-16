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

  createResponseStream () {
    if (this.sent) throw errors.ALREADY_SENT('Response has already been sent')
    this.sent = true

    this.rpc._createResponseStream(this, true)

    return this._responseStream
  }

  createRequestStream () {
    this.rpc._createRequestStream(this, false)

    return this._requestStream
  }
}
