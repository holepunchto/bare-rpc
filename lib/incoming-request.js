const c = require('compact-encoding')
const errors = require('./errors')

module.exports = class RPCIncomingRequest {
  constructor(rpc, id, command, data) {
    this.rpc = rpc
    this.id = id
    this.command = command
    this.data = data
    this.sent = false
    this.received = false

    this._requestStream = null
    this._responseStream = null

    this._reason = null
    this._controller = null
  }

  get signal() {
    const { _AbortController: AbortController } = this.rpc

    if (AbortController === null) return null

    if (this._controller === null) {
      this._controller = new AbortController()

      if (this._reason !== null) this._controller.abort(this._reason)
    }

    return this._controller.signal
  }

  reply(data, encoding) {
    if (this.sent) {
      throw errors.ALREADY_SENT('Response has already been sent')
    }

    encoding =
      encoding && encoding !== 'buffer'
        ? c.from(encoding)
        : typeof data === 'string'
          ? c.raw.utf8
          : null

    this.sent = true

    this.rpc._sendResponse(this, encoding ? c.encode(encoding, data) : data)
  }

  createResponseStream(opts = {}) {
    if (this.sent) {
      throw errors.ALREADY_SENT('Response has already been sent')
    }

    this.sent = true

    this.rpc._createResponseStream(this, true, opts)

    return this._responseStream
  }

  createRequestStream(opts = {}) {
    if (this.received) {
      throw errors.ALREADY_RECEIVED('Request has already been received')
    }

    this.received = true

    this.rpc._createRequestStream(this, false, opts)

    return this._requestStream
  }

  _abort(reason) {
    if (this._reason !== null) return

    this._reason = reason

    if (this._controller !== null) this._controller.abort(reason)
  }
}
