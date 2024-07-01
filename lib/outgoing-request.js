module.exports = class RPCOutgoingRequest {
  constructor (rpc, command) {
    this.rpc = rpc
    this.command = command

    this._resolve = null
    this._reject = null
    this._promise = null
  }

  send (data) {
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    return this.rpc._send(this, typeof data === 'string' ? Buffer.from(data) : data)
  }

  reply () {
    return this._promise
  }
}
