const c = require('compact-encoding')
const errors = require('./errors')
const RPCIncoming = require('./incoming')

module.exports = class RPCIncomingRequest extends RPCIncoming {
  constructor(rpc, id, command, data) {
    super(rpc)

    this.id = id
    this.command = command
    this.data = data
    this.sent = false
    this.received = false

    this._requestStream = null
    this._responseStream = null

    this._cancelled = false
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
}
