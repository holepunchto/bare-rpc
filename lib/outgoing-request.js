const b4a = require('b4a')
const errors = require('./errors')

module.exports = class RPCOutgoingRequest {
  constructor (rpc, command) {
    this.rpc = rpc
    this.id = -1
    this.command = command
    this.sent = false

    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    this._requestStream = null
    this._responseStream = null
  }

  send (data) {
    if (this.sent) throw errors.ALREADY_SENT('Request has already been sent')
    this.sent = true

    this.rpc._sendRequest(this, typeof data === 'string' ? b4a.from(data) : data)
  }

  reply () {
    return this._promise
  }

  createRequestStream (opts = {}) {
    if (this._requestStream === null) this.rpc._createRequestStream(this, true, opts)

    return this._requestStream
  }

  createResponseStream (opts = {}) {
    if (this._requestStream === null) this.rpc._createResponseStream(this, false, opts)

    return this._responseStream
  }
}
