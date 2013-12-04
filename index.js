module.exports = Wire

var bitfield = require('bitfield')
var bncode = require('bncode')
var stream = require('stream')
var util = require('util')

var MESSAGE_PROTOCOL     = new Buffer([0x13,0x42,0x69,0x74,0x54,0x6f,0x72,0x72,0x65,0x6e,0x74,0x20,0x70,0x72,0x6f,0x74,0x6f,0x63,0x6f,0x6c])
var MESSAGE_KEEP_ALIVE   = new Buffer([0x00,0x00,0x00,0x00])
var MESSAGE_CHOKE        = new Buffer([0x00,0x00,0x00,0x01,0x00])
var MESSAGE_UNCHOKE      = new Buffer([0x00,0x00,0x00,0x01,0x01])
var MESSAGE_INTERESTED   = new Buffer([0x00,0x00,0x00,0x01,0x02])
var MESSAGE_UNINTERESTED = new Buffer([0x00,0x00,0x00,0x01,0x03])
var MESSAGE_RESERVED     = [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]
var MESSAGE_PORT         = [0x00,0x00,0x00,0x03,0x09,0x00,0x00]

function pull (requests, piece, offset, length) {
  for (var i = 0; i < requests.length; i++) {
    var req = requests[i]
    if (req.piece !== piece || req.offset !== offset || req.length !== length) continue
    if (i === 0) requests.shift()
    else requests.splice(i, 1)
    return req
  }
  return null
}

function Request (piece, offset, length, callback) {
  this.piece = piece
  this.offset = offset
  this.length = length
  this.callback = callback
  this.timeout = null
}

util.inherits(Wire, stream.Duplex)

function Wire () {
  var self = this
  if (!(this instanceof Wire)) return new Wire()
  stream.Duplex.call(this, { objectMode: true })

  self.amChoking = true
  self.amInterested = false
  self.peerChoking = true
  self.peerInterested = false
  self.peerPieces = []
  self.peerExtensions = {}
  self.peerAddress = null // external
  self.peerSpeed = null   // external

  self.uploaded = 0
  self.downloaded = 0

  self.requests = []
  self.peerRequests = []

  self._keepAlive = null
  self._finished = false

  self.on('finish', function () {
    self._finished = true
    self.push(null) // cannot be half open
    clearInterval(self._keepAlive)
    self._parse(Number.MAX_VALUE, function () {})
    while (self.peerRequests.length) self.peerRequests.pop()
    while (self.requests.length) self._callback(self.requests.shift(), new Error('wire is closed'), null)
  })

  var ontimeout = function () {
    self._callback(self.requests.shift(), new Error('request has timed out'), null)
    self.emit('timeout')
  }

  self._timeout = 0
  self._ontimeout = ontimeout

  var onmessagelength = function (buffer) {
    var length = buffer.readUInt32BE(0)
    if (length) return self._parse(length, onmessage)
    self._parse(4, onmessagelength)
    self.emit('keep-alive')
  }

  var onmessage = function (buffer) {
    self._parse(4, onmessagelength)
    switch (buffer[0]) {
      case 0:
        return self._onchoke()
      case 1:
        return self._onunchoke()
      case 2:
        return self._oninterested()
      case 3:
        return self._onuninterested()
      case 4:
        return self._onhave(buffer.readUInt32BE(1))
      case 5:
        return self._onbitfield(buffer.slice(1))
      case 6:
        return self._onrequest(buffer.readUInt32BE(1),
            buffer.readUInt32BE(5), buffer.readUInt32BE(9))
      case 7:
        return self._onpiece(buffer.readUInt32BE(1),
            buffer.readUInt32BE(5), buffer.slice(9))
      case 8:
        return self._oncancel(buffer.readUInt32BE(1),
            buffer.readUInt32BE(5), buffer.readUInt32BE(9))
      case 9:
        return self._onport(buffer.readUInt16BE(1))
      case 20:
        return self._onextended(bncode.decode(buffer))
    }
    self.emit('unknownmessage', buffer)
  }

  self._buffer = []
  self._bufferSize = 0
  self._parser = null
  self._parserSize = 0

  self._parse(1, function (buffer) {
    var pstrlen = buffer.readUInt8(0)
    self._parse(pstrlen + 48, function (handshake) {
      handshake = handshake.slice(pstrlen)
      self._onhandshake(handshake.slice(8, 28), handshake.slice(28, 48), {
        dht: !!(handshake[7] & 1)
      })
      self._parse(4, onmessagelength)
    })
  })
}

Wire.prototype.handshake = function (infoHash, peerId, extensions) {
  if (typeof infoHash === 'string') infoHash = new Buffer(infoHash, 'hex')
  if (typeof peerId === 'string') peerId = new Buffer(peerId)
  if (infoHash.length !== 20 || peerId.length !== 20) throw new Error('infoHash and peerId MUST have length 20')

  var reserved = new Buffer(MESSAGE_RESERVED)
  if (extensions && extensions.dht) reserved[7] |= 1
  reserved[5] |= 0x10 // enable extended message

  this._push(Buffer.concat([MESSAGE_PROTOCOL, reserved, infoHash, peerId]))
}

Wire.prototype.choke = function () {
  var self = this

  if (self.amChoking) return
  self.amChoking = true
  while (self.peerRequests.length) self.peerRequests.pop()
  self._push(MESSAGE_CHOKE)
}

Wire.prototype.unchoke = function () {
  var self = this
  if (!self.amChoking) return
  self.amChoking = false
  self._push(MESSAGE_UNCHOKE)
}

Wire.prototype.interested = function () {
  var self = this
  if (self.amInterested) return
  self.amInterested = true
  self._push(MESSAGE_INTERESTED)
}

Wire.prototype.uninterested = function () {
  var self = this
  if (!self.amInterested) return
  self.amInterested = false
  self._push(MESSAGE_UNINTERESTED)
}

Wire.prototype.have = function (i) {
  var self = this
  self._message(4, [i], null)
}

Wire.prototype.bitfield = function (bitfield) {
  var self = this
  if (bitfield.buffer) bitfield = bitfield.buffer // support bitfield objects
  self._message(5, [], bitfield)
}

Wire.prototype.request = function (i, offset, length, callback) {
  var self = this
  if (!callback) callback = function () {}
  if (self._finished)   return callback(new Error('wire is closed'))
  if (self.peerChoking) return callback(new Error('peer is choking'))
  self.requests.push(new Request(i, offset, length, callback))
  self._updateTimeout()
  self._message(6, [i, offset, length], null)
}

Wire.prototype.piece = function (i, offset, buffer) {
  var self = this
  self.uploaded += buffer.length
  self.emit('upload', buffer.length)
  self._message(7, [i, offset], buffer)
}

Wire.prototype.cancel = function (i, offset, length) {
  var self = this
  self._callback(pull(self.requests, i, offset, length), new Error('request was cancelled'), null)
  self._message(8, [i, offset, length], null)
}

Wire.prototype.extended = function (ext_number, msg) {
  var self = this
  var ext_id = new Buffer(1)
  ext_id.writeUInt8(ext_number, 0)
  self._message(20, [], Buffer.concat([ext_id, bncode.encode(msg)]))
}

Wire.prototype.port = function (port) {
  var self = this
  var message = new Buffer(MESSAGE_PORT)
  message.writeUInt16BE(port, 5)
  self._push(message)
}

Wire.prototype.setKeepAlive = function (bool) {
  var self = this
  clearInterval(self._keepAlive)
  if (bool === false) return
  self._keepAlive = setInterval(self._push.bind(self, MESSAGE_KEEP_ALIVE), 60000)
}

Wire.prototype.setTimeout = function (ms, fn) {
  var self = this
  if (self.requests.length) clearTimeout(self.requests[0].timeout)
  self._timeout = ms
  self._updateTimeout()
  if (fn) self.on('timeout', fn)
}

Wire.prototype.destroy = function () {
  var self = this
  self.emit('close')
  self.end()
}

// inbound

Wire.prototype._onhandshake = function (infoHash, peerId, extensions) {
  var self = this
  self.peerExtensions = extensions
  self.emit('handshake', infoHash, peerId, extensions)
}

Wire.prototype._oninterested = function () {
  var self = this
  self.peerInterested = true
  self.emit('interested')
}

Wire.prototype._onuninterested = function () {
  var self = this
  self.peerInterested = false
  self.emit('uninterested')
}

Wire.prototype._onchoke = function () {
  var self = this
  self.peerChoking = true
  self.emit('choke')
  while (self.requests.length) self._callback(self.requests.shift(), new Error('peer is choking'), null)
}

Wire.prototype._onunchoke = function () {
  var self = this
  self.peerChoking = false
  self.emit('unchoke')
}

Wire.prototype._onbitfield = function (buffer) {
  var self = this
  var pieces = bitfield(buffer)
  for (var i = 0; i < 8 * buffer.length; i++) {
    self.peerPieces[i] = pieces.get(i)
  }
  self.emit('bitfield', buffer)
}

Wire.prototype._onhave = function (i) {
  var self = this
  self.peerPieces[i] = true
  self.emit('have', i)
}

Wire.prototype._onrequest = function (i, offset, length) {
  var self = this
  if (self.amChoking) return

  var respond = function (err, buffer) {
    if (err || request !== pull(self.peerRequests, i, offset, length)) return
    self.piece(i, offset, buffer)
  }

  var request = new Request(i, offset, length, respond)
  self.peerRequests.push(request)
  self.emit('request', i, offset, length, respond)
}

Wire.prototype._oncancel = function (i, offset, length) {
  var self = this
  pull(self.peerRequests, i, offset, length)
  self.emit('cancel', i, offset, length)
}

Wire.prototype._onpiece = function (i, offset, buffer) {
  var self = this
  self._callback(pull(self.requests, i, offset, buffer.length), null, buffer)
  self.downloaded += buffer.length
  self.emit('download', buffer.length)
  self.emit('piece', i, offset, buffer)
}

Wire.prototype._onport = function (port) {
  var self = this
  self.emit('port', port)
}

Wire.prototype._onextended = function (ext) {
  var self = this
  self.emit('extended', ext)
}

// helpers and streams

Wire.prototype._callback = function (request, err, buffer) {
  var self = this
  if (!request) return
  if (request.timeout) clearTimeout(request.timeout)
  if (!self.peerChoking && !self._finished) self._updateTimeout()
  request.callback(err, buffer)
}

Wire.prototype._updateTimeout = function () {
  var self = this
  if (!self._timeout || !self.requests.length || self.requests[0].timeout) return
  self.requests[0].timeout = setTimeout(self._ontimeout, self._timeout)
}

Wire.prototype._message = function (id, numbers, data) {
  var self = this
  var dataLength = data ? data.length : 0
  var buffer = new Buffer(5 + 4 * numbers.length)

  buffer.writeUInt32BE(buffer.length + dataLength - 4, 0)
  buffer[4] = id
  for (var i = 0; i < numbers.length; i++) {
    buffer.writeUInt32BE(numbers[i], 5 + 4 * i)
  }

  self._push(buffer)
  if (data) self._push(data)
}

Wire.prototype._push = function (data) {
  var self = this
  if (self._finished) return
  self.push(data)
}

Wire.prototype._parse = function (size, parser) {
  var self = this
  self._parserSize = size
  self._parser = parser
}

/**
 * Duplex stream method. Called whenever the upstream has data for us.
 * @param  {Buffer|string} data
 * @param  {string}   encoding
 * @param  {function} callback
 */
Wire.prototype._write = function (data, encoding, callback) {
  var self = this
  self._bufferSize += data.length
  self._buffer.push(data)

  while (self._bufferSize >= self._parserSize) {
    var buffer = (self._buffer.length === 1)
      ? self._buffer[0]
      : Buffer.concat(self._buffer)
    self._bufferSize -= self._parserSize
    self._buffer = self._bufferSize
      ? [buffer.slice(self._parserSize)]
      : []
    self._parser(buffer.slice(0, self._parserSize))
  }

  callback(null) // Signal that we're ready for more data
}

/**
 * Duplex stream method. Called whenever the downstream wants data.
 * No-op since we'll just push data whenever we get it and extra data will be
 * buffered in memory.
 */
Wire.prototype._read = function () {}
