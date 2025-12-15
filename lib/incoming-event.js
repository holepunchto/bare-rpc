module.exports = class RPCIncomingEvent {
  constructor(rpc, command, data) {
    this.rpc = rpc
    this.command = command
    this.data = data
  }
}
