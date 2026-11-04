const c = require('compact-encoding')
const errors = require('./errors')

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

    if (req.id === undefined) {
      if (responder !== undefined) await this._dispatch(responder, req)
      return
    }

    if (responder === undefined) throw errors.UNKNOWN_COMMAND(`Unknown command ${req.command}`)

    let data = await this._dispatch(responder, req)

    if (req.sent) return

    const { responseEncoding } = responder

    if (responseEncoding) data = c.encode(responseEncoding, data)

    req.reply(data)
  }

  _dispatch(responder, req) {
    const { onrequest, requestEncoding } = responder

    let data = req.data

    if (requestEncoding) data = c.decode(requestEncoding, data)

    return onrequest(req, data)
  }
}
