module.exports = class RPCError extends Error {
  constructor(msg, code, fn = RPCError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'RPCError'
  }

  static UNKNOWN_MESSAGE(msg) {
    return new RPCError(msg, 'UNKNOWN_MESSAGE', RPCError.UNKNOWN_MESSAGE)
  }

  static ALREADY_SENT(msg) {
    return new RPCError(msg, 'ALREADY_SENT', RPCError.ALREADY_SENT)
  }
}
