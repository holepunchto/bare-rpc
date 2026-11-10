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

  static UNKNOWN_COMMAND(msg) {
    return new RPCError(msg, 'UNKNOWN_COMMAND', RPCError.UNKNOWN_COMMAND)
  }

  static INVALID_MESSAGE(msg) {
    return new RPCError(msg, 'INVALID_MESSAGE', RPCError.INVALID_MESSAGE)
  }

  static FRAME_TOO_LARGE(msg) {
    return new RPCError(msg, 'FRAME_TOO_LARGE', RPCError.FRAME_TOO_LARGE)
  }

  static ALREADY_SENT(msg) {
    return new RPCError(msg, 'ALREADY_SENT', RPCError.ALREADY_SENT)
  }

  static ALREADY_RECEIVED(msg) {
    return new RPCError(msg, 'ALREADY_RECEIVED', RPCError.ALREADY_RECEIVED)
  }

  static CHANNEL_CLOSED(msg) {
    return new RPCError(msg, 'CHANNEL_CLOSED', RPCError.CHANNEL_CLOSED)
  }

  static UNEXPECTED_STREAM(msg) {
    return new RPCError(msg, 'UNEXPECTED_STREAM', RPCError.UNEXPECTED_STREAM)
  }

  static STREAM_OVERFLOW(msg) {
    return new RPCError(msg, 'STREAM_OVERFLOW', RPCError.STREAM_OVERFLOW)
  }

  static CANCELLED(msg) {
    return new RPCError(msg, 'CANCELLED', RPCError.CANCELLED)
  }

  static TIMEOUT(msg) {
    return new RPCError(msg, 'TIMEOUT', RPCError.TIMEOUT)
  }
}
