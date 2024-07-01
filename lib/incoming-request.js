module.exports = class RPCIncomingRequest {
  constructor (rpc, id, command, data) {
    this.rpc = rpc
    this.id = id
    this.command = command
    this.data = data
  }

  reply (data) {
    return this.rpc._reply(this, typeof data === 'string' ? Buffer.from(data) : data)
  }
}
