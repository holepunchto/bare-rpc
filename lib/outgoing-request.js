const c = require('compact-encoding')
const errors = require('./errors')

module.exports = class RPCOutgoingRequest {
  constructor(rpc, id, command) {
    this.rpc = rpc
    this.id = id
    this.command = command
    this.sent = false
    this.received = false

    this._responded = false

    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    this._requestStream = null
    this._responseStream = null
  }

  send(data, encoding) {
    if (this.sent) {
      throw errors.ALREADY_SENT('Request has already been sent')
    }

    encoding =
      encoding && encoding !== 'buffer'
        ? c.from(encoding)
        : typeof data === 'string'
          ? c.raw.utf8
          : null

    this.sent = true

    this.rpc._sendRequest(this, encoding ? c.encode(encoding, data) : data)
  }

  reply(encoding) {
    if (this.received) {
      throw errors.ALREADY_RECEIVED('Response is already being received')
    }

    encoding = encoding && encoding !== 'buffer' ? c.from(encoding) : null

    this.received = true

    // If the channel was torn down before a response arrived there is nothing
    // left to await, so reject with the teardown error rather than hang. This
    // covers both requests sent after teardown and requests still awaiting a
    // reply when teardown happens.
    if (this.rpc._closed && !this._responded) this._reject(this.rpc._error)

    return encoding ? this._promise.then((data) => c.decode(encoding, data)) : this._promise
  }

  createRequestStream(opts = {}) {
    if (this.sent) {
      throw errors.ALREADY_SENT('Request has already been sent')
    }

    this.sent = true

    this.rpc._createRequestStream(this, true, opts)

    return this._requestStream
  }

  createResponseStream(opts = {}) {
    if (this.received) {
      throw errors.ALREADY_RECEIVED('Response has already been received')
    }

    this.received = true

    this.rpc._createResponseStream(this, false, opts)

    return this._responseStream
  }
}
