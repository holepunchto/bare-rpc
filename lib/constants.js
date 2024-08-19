module.exports = {
  type: {
    REQUEST: 1,
    RESPONSE: 2,
    STREAM: 3
  },
  stream: {
    OPEN: 0x1,
    CLOSE: 0x2,
    PAUSE: 0x4,
    RESUME: 0x8,
    DATA: 0x10,
    END: 0x20,
    DESTROY: 0x40,
    ERROR: 0x80,
    REQUEST: 0x100,
    RESPONSE: 0x200
  }
}
