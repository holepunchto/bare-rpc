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
    ERROR: 0x40,
    REQUEST: 0x80,
    RESPONSE: 0x100
  }
}
