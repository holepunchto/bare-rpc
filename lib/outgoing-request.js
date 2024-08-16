const errors = require('./errors')

module.exports = class RPCOutgoingRequest {
  constructor (rpc, command) {
    this.rpc = rpc
    this.id = -1
    this.command = command
    this.sent = false

    this._resolve = null
    this._reject = null
    this._promise = null

    this._requestStream = null
    this._responseStream = null
  }

  send (data) {
    if (this.sent) throw errors.ALREADY_SENT('Request has already been sent')
    this.sent = true

    const { promise, resolve, reject } = Promise.withResolvers()

    this._promise = promise
    this._resolve = resolve
    this._reject = reject

    this.rpc._sendRequest(this, typeof data === 'string' ? Buffer.from(data) : data)
  }

  reply () {
    return this._promise
  }

  createRequestStream () {
    if (this.sent) throw errors.ALREADY_SENT('Request has already been sent')
    this.sent = true

    this.rpc._createRequestStream(this, true)

    return this._requestStream
  }

  createResponseStream () {
    this.rpc._createResponseStream(this, false)

    return this._responseStream
  }
}
