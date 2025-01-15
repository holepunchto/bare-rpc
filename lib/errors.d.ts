declare class RPCError extends Error {
  static UNKNOWN_MESSAGE(msg: string): RPCError
  static ALREADY_SENT(msg: string): RPCError
}

export = RPCError
