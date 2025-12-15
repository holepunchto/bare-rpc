const c = require('compact-encoding')
const errors = require('./errors')

module.exports = class RPCOutgoingEvent {
  constructor(rpc, command) {
    this.rpc = rpc
    this.command = command
    this.sent = false
  }

  send(data, encoding) {
    if (this.sent) {
      throw errors.ALREADY_SENT('Event has already been sent')
    }

    encoding =
      encoding && encoding !== 'buffer'
        ? c.from(encoding)
        : typeof data === 'string'
          ? c.raw.utf8
          : null

    this.sent = true

    this.rpc._sendEvent(this, encoding ? c.encode(encoding, data) : data)
  }
}
