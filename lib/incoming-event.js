const RPCIncoming = require('./incoming')

module.exports = class RPCIncomingEvent extends RPCIncoming {
  constructor(rpc, command, data) {
    super(rpc)

    this.command = command
    this.data = data
  }
}
