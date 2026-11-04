declare class RPCError extends Error {
  static UNKNOWN_MESSAGE(msg: string): RPCError
  static UNKNOWN_COMMAND(msg: string): RPCError
  static INVALID_MESSAGE(msg: string): RPCError
  static FRAME_TOO_LARGE(msg: string): RPCError
  static ALREADY_SENT(msg: string): RPCError
  static ALREADY_RECEIVED(msg: string): RPCError
  static CHANNEL_CLOSED(msg: string): RPCError
  static UNEXPECTED_STREAM(msg: string): RPCError
  static STREAM_OVERFLOW(msg: string): RPCError
}

export = RPCError
