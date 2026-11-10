const safetyCatch = require('safety-catch')
const b4a = require('b4a')
const c = require('compact-encoding')
const { isEnding } = require('bare-stream')
const m = require('./lib/messages')
const errors = require('./lib/errors')
const { type: t, stream: s } = require('./lib/constants')
const IncomingEvent = require('./lib/incoming-event')
const IncomingRequest = require('./lib/incoming-request')
const IncomingStream = require('./lib/incoming-stream')
const OutgoingEvent = require('./lib/outgoing-event')
const OutgoingRequest = require('./lib/outgoing-request')
const OutgoingStream = require('./lib/outgoing-stream')
const CommandRouter = require('./lib/command-router')

const DEFAULT_MAX_FRAME_SIZE = 16 * 1024 * 1024
const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024
const MAX_PENDING_RESPONSES = 1024

const streamFlags = new Set()

for (const direction of [s.REQUEST, s.RESPONSE]) {
  for (const action of [
    s.OPEN,
    s.CLOSE,
    s.CLOSE | s.ERROR,
    s.PAUSE,
    s.RESUME,
    s.DATA,
    s.END,
    s.DESTROY,
    s.DESTROY | s.ERROR
  ]) {
    streamFlags.add(direction | action)
  }
}

module.exports = exports = class RPC {
  constructor(stream, onrequest = null, opts = {}) {
    const {
      maxFrameSize = DEFAULT_MAX_FRAME_SIZE,
      maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES,
      AbortController = null
    } = opts

    this._stream = stream
    this._maxFrameSize = maxFrameSize
    this._maxBufferedBytes = maxBufferedBytes
    this._AbortController = AbortController
    this._id = 0

    this._outgoingRequests = new Map()
    this._outgoingResponses = new Map()
    this._incomingRequests = new Map()
    this._incomingResponses = new Map()
    this._pendingResponses = new Set()
    this._handling = new Set()
    this._unansweredRequests = new Map()
    this._highestRequestId = 0

    this._buffer = []
    this._buffered = 0
    this._frame = -1
    this._draining = []

    this._closed = false
    this._error = null

    if (onrequest === null) {
      onrequest = new CommandRouter()
    }

    if (typeof onrequest === 'function') {
      onrequest = onrequest.bind(this)
    } else {
      onrequest = onrequest._onrequest.bind(onrequest)
    }

    this._onrequest = onrequest
    this._onerror = this._onerror.bind(this)
    this._onclose = this._onclose.bind(this)
    this._ondata = this._ondata.bind(this)
    this._onend = this._onend.bind(this)
    this._ondrain = this._ondrain.bind(this)

    this._stream
      .on('error', this._onerror)
      .on('close', this._onclose)
      .on('data', this._ondata)
      .on('end', this._onend)
      .on('drain', this._ondrain)
  }

  // Whether there are no requests or responses currently in flight. Useful for
  // determining when it is safe to tear down the underlying stream.
  get idle() {
    return (
      this._outgoingRequests.size === 0 &&
      this._outgoingResponses.size === 0 &&
      this._incomingRequests.size === 0 &&
      this._incomingResponses.size === 0 &&
      this._pendingResponses.size === 0
    )
  }

  event(command) {
    return new OutgoingEvent(this, command)
  }

  request(command, opts) {
    return new OutgoingRequest(this, ++this._id, command, opts)
  }

  _sendMessage(message, cb) {
    // Once the underlying stream is being torn down there is nowhere left to
    // write, so drop the message and settle the callback immediately. This
    // keeps stream teardown from stalling on a drain that will never arrive.
    if (this._stream.destroying) {
      if (cb) cb(null)
      return
    }

    const header = c.encode(m.header, message)

    let flushed = this._stream.write(header)

    if (message.data && m.hasData(message)) flushed = this._stream.write(message.data)

    if (cb) {
      if (flushed) cb(null)
      else this._draining.push(cb)
    }
  }

  _sendEvent(request, data = null) {
    this._sendMessage({
      type: t.REQUEST,
      id: 0,
      command: request.command,
      stream: 0,
      data
    })
  }

  _sendRequest(request, data = null) {
    // Once the channel has been torn down there is nowhere left to send the
    // request. Skip registering it so that it never leaks into the maps; the
    // awaiting reply is rejected through `RPCOutgoingRequest.reply()` instead.
    if (this._requestError(request) !== null) return

    this._trackOutgoingRequest(request)

    this._sendMessage({
      type: t.REQUEST,
      id: request.id,
      command: request.command,
      stream: 0,
      data
    })
  }

  _createRequestStream(request, isInitiator, opts) {
    if (isInitiator) {
      request._requestStream = new OutgoingStream(this, request, t.REQUEST, opts)

      // Once the channel has been torn down or the request cancelled there is
      // nowhere left to open the stream, so destroy it right away rather than
      // leave it hanging.
      const err = this._requestError(request)
      if (err !== null) return request._requestStream.destroy(err)

      this._trackOutgoingRequest(request)

      // Announce the stream right away rather than when it opens, so that the
      // remote end also learns of a stream that is destroyed before it opens.
      request._requestStream._sendOpen()

      request._requestStream.on('close', () => this._gcOutgoingRequest(request))
    } else {
      request._requestStream = new IncomingStream(this, request, t.REQUEST, opts)

      const err = this._requestError(request)
      if (err !== null) return request._requestStream.destroy(err)

      this._incomingRequests.set(request.id, request)

      request._requestStream.on('close', () => this._incomingRequests.delete(request.id))
    }
  }

  _sendResponse(request, data) {
    // Once the channel has been torn down or the request cancelled there is
    // no one left to read the response, so drop it rather than write a message
    // that would only be discarded. The reply is fire-and-forget, so there is
    // nothing to settle.
    if (!this._isUnanswered(request)) return

    this._onanswered(request)

    this._sendMessage({
      type: t.RESPONSE,
      id: request.id,
      stream: 0,
      error: null,
      data
    })
  }

  _createResponseStream(request, isInitiator, opts) {
    if (isInitiator) {
      request._responseStream = new OutgoingStream(this, request, t.RESPONSE, opts)

      // Once the channel has been torn down or the request cancelled there is
      // nowhere left to open the stream, so destroy it right away rather than
      // leave it hanging.
      const err = this._requestError(request)
      if (err !== null) return request._responseStream.destroy(err)

      this._outgoingResponses.set(request.id, request)

      request._responseStream._sendOpen()

      if (this._onanswered(request)) request._responseStream._continueOpen()

      request._responseStream.on('close', () => this._outgoingResponses.delete(request.id))
    } else {
      request._responseStream = new IncomingStream(this, request, t.RESPONSE, opts)

      const err = this._requestError(request)
      if (err !== null) return request._responseStream.destroy(err)

      this._incomingResponses.set(request.id, request)

      request._responseStream.on('close', () => {
        this._incomingResponses.delete(request.id)

        request._responded = true
        this._gcOutgoingRequest(request)
      })
    }
  }

  _sendError(request, err) {
    if (!this._isUnanswered(request)) return

    this._onanswered(request)

    this._sendMessage({
      type: t.RESPONSE,
      id: request.id,
      stream: 0,
      error: m.toError(err),
      data: null
    })
  }

  _isUnanswered(request) {
    return this._unansweredRequests.get(request.id) === request
  }

  // Returns whether the remote end had already opened its response stream.
  _onanswered(request) {
    this._unansweredRequests.delete(request.id)
    return this._pendingResponses.delete(request.id)
  }

  _gcOutgoingRequest(request) {
    // The entry must stay reachable for as long as an incoming message might
    // still target it; until the response has settled and, if the request was
    // streamed, until the outgoing request stream has closed. Either can be the
    // last to arrive, so only remove the entry once both have completed.
    if (!request._responded) return

    // The request has its answer, so it can no longer be cancelled or time out.
    request._detach()

    if (request._requestStream !== null && !request._requestStream.destroyed) return

    this._outgoingRequests.delete(request.id)
  }

  _trackOutgoingRequest(request) {
    this._outgoingRequests.set(request.id, request)

    request._attach()
  }

  _untrackOutgoingRequest(request) {
    this._outgoingRequests.delete(request.id)

    request._detach()
  }

  // The error that keeps a request from using the channel, or `null` if it may.
  _requestError(request) {
    return this._closed ? this._error : request._reason
  }

  _cancelRequest(request, reason) {
    // A request that has its answer has finished, even while its request stream
    // is still open, and so does one that was sent but is no longer tracked.
    if (request._reason !== null || request._responded) return
    if (request.sent && this._outgoingRequests.get(request.id) !== request) return

    request._reason = reason

    if (request.sent) {
      request._cancelled = true

      this._untrackOutgoingRequest(request)

      this._sendMessage({ type: t.CANCEL, id: request.id, error: cancelError(reason), data: null })
    }

    request._reject(reason)

    destroyStreams(request, reason)
  }

  _onerror(err) {
    this._teardown(err)
  }

  _onclose() {
    // A clean close of the underlying stream leaves in-flight requests and
    // responses with nowhere to complete, so tear them down as if the channel
    // had errored.
    this._teardown(errors.CHANNEL_CLOSED('Channel closed'))
  }

  _teardown(err) {
    // Mark the channel as closed so that any calls made from here on are
    // rejected or destroyed immediately rather than left hanging.
    this._closed = true
    this._error = err

    this._ondrain(err)

    // Reject any request awaiting a plain reply. Requests whose response is
    // delivered over a stream are torn down through that stream below.
    for (const request of this._outgoingRequests.values()) {
      request._detach()

      if (request.received && request._responseStream === null) request._reject(err)
    }

    for (const request of this._unansweredRequests.values()) request._abort(err)
    for (const request of this._handling) request._abort(err)

    // Collect the streams first, deduplicating as a single request may appear
    // in more than one map, then destroy them once the maps have been cleared.
    const streams = new Set()

    for (const request of this._outgoingRequests.values()) {
      if (request._requestStream !== null) streams.add(request._requestStream)
    }

    for (const request of this._incomingRequests.values()) {
      request._abort(err)

      if (request._requestStream !== null) streams.add(request._requestStream)
    }

    for (const request of this._outgoingResponses.values()) {
      request._abort(err)

      if (request._responseStream !== null) streams.add(request._responseStream)
    }

    for (const request of this._incomingResponses.values()) {
      if (request._responseStream !== null) streams.add(request._responseStream)
    }

    this._outgoingRequests.clear()
    this._outgoingResponses.clear()
    this._incomingRequests.clear()
    this._incomingResponses.clear()
    this._pendingResponses.clear()
    this._unansweredRequests.clear()

    for (const stream of streams) stream.destroy(err)
  }

  _fail(err) {
    this._stream.destroy(err)
  }

  _ondata(data) {
    if (this._stream.destroying) return

    this._buffer.push(data)
    this._buffered += data.byteLength

    if (this._frame === -1) {
      this._onbeforeframe()
    } else {
      this._onafterframe()
    }
  }

  _onend() {
    if (this._buffered > 0) this._fail(errors.INVALID_MESSAGE('Truncated frame'))
  }

  _onbeforeframe() {
    while (this._buffered >= 4 && !this._stream.destroying) {
      const buffer = this._buffer.length === 1 ? this._buffer[0] : b4a.concat(this._buffer)

      this._buffer = [buffer]
      this._frame = 4 + c.uint32.decode(c.state(0, 4, buffer))

      if (this._frame > this._maxFrameSize) {
        return this._fail(
          errors.FRAME_TOO_LARGE(
            `Frame of ${this._frame} bytes exceeds the limit of ${this._maxFrameSize} bytes`
          )
        )
      }

      if (this._buffered < this._frame) return

      this._onframe()
    }
  }

  _onafterframe() {
    if (this._buffered < this._frame) return

    this._onframe()
    this._onbeforeframe()
  }

  _onframe() {
    const buffer = this._buffer.length === 1 ? this._buffer[0] : b4a.concat(this._buffer)

    const frame = this._frame

    this._buffered -= frame
    this._buffer = this._buffered > 0 ? [buffer.subarray(frame)] : []
    this._frame = -1

    this._onmessage(buffer.subarray(0, frame))
  }

  _onmessage(buffer) {
    let message
    try {
      message = m.message.decode(c.state(0, buffer.length, buffer))
    } catch (err) {
      return this._fail(
        err instanceof errors ? err : errors.INVALID_MESSAGE(`Malformed message: ${err.message}`)
      )
    }

    const violation = protocolViolation(message)

    if (violation !== null) return this._fail(errors.INVALID_MESSAGE(violation))

    // Handling a message can run user code, such as stream listeners, so route
    // anything it throws through the connection failure path rather than let it
    // escape into the underlying stream.
    try {
      switch (message.type) {
        case t.REQUEST:
          this._onrequestmessage(message)
          break
        case t.RESPONSE:
          this._onresponse(message)
          break
        case t.STREAM:
          this._onstream(message)
          break
        case t.CANCEL:
          this._oncancel(message)
      }
    } catch (err) {
      this._fail(err)
    }
  }

  async _onrequestmessage(message) {
    // A repeated id can only be caught while its request is tracked here, which
    // is also the only time it could corrupt any state.
    if (
      this._unansweredRequests.has(message.id) ||
      this._incomingRequests.has(message.id) ||
      this._outgoingResponses.has(message.id)
    ) {
      return this._fail(errors.INVALID_MESSAGE(`Request '${message.id}' is already in flight`))
    }

    let request

    if (message.id === 0) {
      request = new IncomingEvent(this, message.command, message.data)
    } else {
      request = new IncomingRequest(this, message.id, message.command, message.data)

      this._unansweredRequests.set(message.id, request)
      this._highestRequestId = Math.max(this._highestRequestId, message.id)
    }

    this._handling.add(request)

    try {
      await this._onrequest(request)
    } catch (err) {
      safetyCatch(err)

      if (message.id === 0) this._stream.destroy(err)
      else if (request._responseStream !== null) request._responseStream.destroy(err)
      else if (!request.sent) this._sendError(request, err)
    } finally {
      this._handling.delete(request)
    }
  }

  _onresponse(message) {
    const request = this._outgoingRequests.get(message.id)
    if (request === undefined) return

    if (message.error) {
      this._settle(request, message.error, null)

      if (request._responseStream !== null) request._responseStream.destroy(message.error)

      this._releaseRequestStream(request, message.error)
    } else if (message.stream === 0) {
      this._settle(request, null, message.data)

      const stream = request._responseStream

      if (isPushable(stream)) {
        if (message.data.byteLength > 0) stream.push(message.data)
        stream.push(null)
      }

      this._releaseRequestStream(request, null)
    } else if (request._responseStream === null) {
      const err = errors.UNEXPECTED_STREAM(`Request '${request.id}' was answered with a stream`)

      this._settle(request, err, null)

      this._sendMessage({
        type: t.STREAM,
        id: request.id,
        stream: s.RESPONSE | s.DESTROY,
        error: null,
        data: null
      })

      this._releaseRequestStream(request, err)
    }
  }

  _settle(request, err, data) {
    request._responded = true
    this._gcOutgoingRequest(request)

    if (err) request._reject(err)
    else request._resolve(data)
  }

  // Once the request is answered, a request stream that the remote end never
  // opened will never be read, and would otherwise wait for its open forever.
  _releaseRequestStream(request, err) {
    const stream = request._requestStream

    if (stream !== null && !stream._acknowledged) stream.destroy(err)
  }

  _oncancel(message) {
    const request =
      this._unansweredRequests.get(message.id) ??
      this._incomingRequests.get(message.id) ??
      this._outgoingResponses.get(message.id)

    if (request === undefined) return

    request._cancelled = true

    this._onanswered(request)

    request._abort(message.error)

    destroyStreams(request, message.error)
  }

  _onstream(message) {
    if (message.stream & s.OPEN) this._onstreamopen(message)
    else if (message.stream & s.CLOSE) this._onstreamclose(message)
    else if (message.stream & s.PAUSE) this._onstreampause(message)
    else if (message.stream & s.RESUME) this._onstreamresume(message)
    else if (message.stream & s.DATA) this._onstreamdata(message)
    else if (message.stream & s.END) this._onstreamend(message)
    else if (message.stream & s.DESTROY) this._onstreamdestroy(message)
  }

  _onstreamopen(message) {
    if (message.stream & s.REQUEST) {
      const stream = this._outgoingStream(message)
      if (stream !== null) stream._continueOpen()
    } else {
      const request = this._outgoingResponses.get(message.id)

      if (request !== undefined) return request._responseStream._continueOpen()

      // The remote end opens its response stream as soon as it is created,
      // which may be before its request arrives or before the handler here
      // creates the response stream. Remember the open until the response
      // stream is created, the request is answered, or the remote end destroys
      // its stream. Any other open is for a request that has already been
      // answered.
      if (this._pendingResponses.has(message.id)) return

      if (!this._unansweredRequests.has(message.id) && message.id <= this._highestRequestId) {
        return
      }

      if (this._pendingResponses.size >= MAX_PENDING_RESPONSES) {
        return this._fail(errors.INVALID_MESSAGE('Too many response streams opened early'))
      }

      this._pendingResponses.add(message.id)
    }
  }

  _onstreamclose(message) {
    const stream = this._incomingStream(message)
    if (stream === null) return

    if (message.error) stream.destroy(message.error)
    else stream.push(null)
  }

  _onstreampause(message) {
    const stream = this._outgoingStream(message)
    if (stream !== null) stream.cork()
  }

  _onstreamresume(message) {
    const stream = this._outgoingStream(message)
    if (stream !== null) stream.uncork()
  }

  _onstreamdata(message) {
    const stream = this._incomingStream(message)
    if (!isPushable(stream)) return

    const flushed = stream.push(message.data)

    if (stream._readableState.buffered > this._maxBufferedBytes) {
      return this._fail(
        errors.STREAM_OVERFLOW(
          `Stream buffered more than the limit of ${this._maxBufferedBytes} bytes`
        )
      )
    }

    if (flushed === false) {
      this._sendMessage({
        type: t.STREAM,
        id: stream._request.id,
        stream: stream._mask | s.PAUSE,
        error: null,
        data: null
      })
    }
  }

  _onstreamend(message) {
    const stream = this._incomingStream(message)
    if (stream !== null) stream.push(null)
  }

  _onstreamdestroy(message) {
    if (message.stream & s.RESPONSE) this._pendingResponses.delete(message.id)

    const stream = this._outgoingStream(message)
    if (stream !== null) stream.destroy(message.error)
  }

  _incomingStream(message) {
    return findStream(message, this._incomingRequests, this._incomingResponses)
  }

  _outgoingStream(message) {
    return findStream(message, this._outgoingRequests, this._outgoingResponses)
  }

  _ondrain(err = null) {
    const draining = this._draining

    this._draining = []

    for (const cb of draining) cb(err)
  }
}

exports.CommandRouter = CommandRouter

// Messages that decode cleanly but that no valid peer ever sends, as derived
// from what the outgoing side encodes.
function protocolViolation(message) {
  switch (message.type) {
    case t.REQUEST:
      if (message.stream === 0) return null
      if (message.stream !== s.OPEN) return `Invalid request stream flags '${message.stream}'`
      if (message.id === 0) return 'Stream request without an id'
      return null

    case t.RESPONSE:
      if (message.id === 0) return 'Response without an id'
      if (message.stream === 0) return null
      if (message.stream !== s.OPEN || message.error) {
        return `Invalid response stream flags '${message.stream}'`
      }
      return null

    case t.STREAM:
      if (message.id === 0) return 'Stream message without an id'
      if (!streamFlags.has(message.stream)) return `Invalid stream flags '${message.stream}'`
      return null

    case t.CANCEL:
      if (message.id === 0) return 'Cancel without an id'
      return null
  }
}

function cancelError(reason) {
  const err = m.toError(reason)

  if (err.code !== undefined && err.code !== null) return err

  return {
    message: err.message,
    code: err.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED',
    errno: err.errno
  }
}

function destroyStreams(request, err) {
  if (request._requestStream !== null) request._requestStream.destroy(err)
  if (request._responseStream !== null) request._responseStream.destroy(err)
}

function findStream(message, requests, responses) {
  if (message.stream & s.REQUEST) {
    const request = requests.get(message.id)
    return request === undefined ? null : request._requestStream
  }

  const request = responses.get(message.id)
  return request === undefined ? null : request._responseStream
}

function isPushable(stream) {
  return stream !== null && !stream.destroying && !isEnding(stream)
}
