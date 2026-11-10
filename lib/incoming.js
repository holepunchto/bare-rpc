module.exports = class RPCIncoming {
  constructor(rpc) {
    this.rpc = rpc

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

  _abort(reason) {
    if (this._reason !== null) return

    this._reason = reason

    if (this._controller !== null) this._controller.abort(reason)
  }
}
