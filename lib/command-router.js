const c = require('compact-encoding')

module.exports = class RPCCommandRouter {
  constructor(opts = {}) {
    const { valueEncoding = c.raw } = opts

    this._responders = new Map()
    this._defaultValueEncoding = valueEncoding
  }

  respond(command, opts = {}, onrequest) {
    if (typeof opts === 'function') {
      onrequest = opts
      opts = {}
    }

    const {
      valueEncoding = this._defaultValueEncoding,
      requestEncoding = valueEncoding,
      responseEncoding = valueEncoding
    } = opts

    this._responders.set(command, {
      onrequest,
      requestEncoding,
      responseEncoding
    })
  }

  async _onrequest(req) {
    const responder = this._responders.get(req.command)

    if (responder === undefined) return

    const { onrequest, requestEncoding, responseEncoding } = responder

    let data = req.data

    if (requestEncoding) data = c.decode(requestEncoding, data)

    data = await onrequest(req, data)

    if (req.sent) return

    if (responseEncoding) data = c.encode(responseEncoding, data)

    req.reply(data)
  }
}
