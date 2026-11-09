const c = require('compact-encoding')
const errors = require('./errors')

module.exports = class RPCOutgoingRequest {
  constructor(rpc, id, command, opts = {}) {
    const { signal = null, timeout = 0 } = opts

    this.rpc = rpc
    this.id = id
    this.command = command
    this.sent = false
    this.received = false

    this._responded = false
    this._reason = null

    this._signal = signal
    this._timeout = timeout
    this._timer = null
    this._onabort = null

    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    this._promise.catch(noop)

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

    this._abortIfSignalled()

    this.sent = true

    this.rpc._sendRequest(this, encoding ? c.encode(encoding, data) : data)
  }

  cancel(reason) {
    this.rpc._cancelRequest(this, reason ?? errors.CANCELLED('Request was cancelled'))
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

    this._abortIfSignalled()

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

  _abortIfSignalled() {
    if (this._signal !== null && this._signal.aborted) this.cancel(this._signal.reason)
  }

  _attach() {
    if (this._signal !== null) {
      this._onabort = () => this.cancel(this._signal.reason)
      this._signal.addEventListener('abort', this._onabort)
    }

    if (this._timeout > 0) this._timer = setTimeout(ontimeout, this._timeout, this)
  }

  _detach() {
    if (this._onabort !== null) {
      this._signal.removeEventListener('abort', this._onabort)
      this._onabort = null
    }

    if (this._timer !== null) {
      clearTimeout(this._timer)
      this._timer = null
    }
  }
}

function ontimeout(request) {
  request.cancel(errors.TIMEOUT(`Request timed out after ${request._timeout} ms`))
}

function noop() {}
