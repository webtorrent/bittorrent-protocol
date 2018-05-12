module.exports = Wire

var arrayRemove = require('unordered-array-remove')
var bencode = require('bencode')
var BitField = require('bitfield')
var Buffer = require('safe-buffer').Buffer
var crypto = require('crypto')
var debug = require('debug')('bittorrent-protocol')
var extend = require('xtend')
var inherits = require('inherits')
var randombytes = require('randombytes')
var sha1 = require('simple-sha1')
var speedometer = require('speedometer')
var stream = require('readable-stream')
var xor = require('buffer-xor')
var RC4 = require('rc4')

var BITFIELD_GROW = 400000
var KEEP_ALIVE_TIMEOUT = 55000

var MESSAGE_PROTOCOL = Buffer.from('\u0013BitTorrent protocol')
var MESSAGE_KEEP_ALIVE = Buffer.from([0x00, 0x00, 0x00, 0x00])
var MESSAGE_CHOKE = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00])
var MESSAGE_UNCHOKE = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01])
var MESSAGE_INTERESTED = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02])
var MESSAGE_UNINTERESTED = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03])

var MESSAGE_RESERVED = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
var MESSAGE_PORT = [0x00, 0x00, 0x00, 0x03, 0x09, 0x00, 0x00]

var DH_PRIME = 'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a63a36210000000000090563'
var DH_GENERATOR = 2
var VC = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
var CRYPTO_PROVIDE = Buffer.from([0x00, 0x00, 0x01, 0x02])
var CRYPTO_SELECT = Buffer.from([0x00, 0x00, 0x00, 0x02]) // always try to choose RC4 encryption instead of plaintext

function Request (piece, offset, length, callback) {
  this.piece = piece
  this.offset = offset
  this.length = length
  this.callback = callback
}

inherits(Wire, stream.Duplex)

function Wire (type = null, retries = 0, peEnabled = false) {
  if (!(this instanceof Wire)) return new Wire()
  stream.Duplex.call(this)

  this._debugId = randombytes(4).toString('hex')
  this._debug('new wire')

  this.peerId = null // remote peer id (hex string)
  this.peerIdBuffer = null // remote peer id (buffer)
  this.type = type // connection type ('webrtc', 'tcpIncoming', 'tcpOutgoing', 'webSeed')

  this.amChoking = true // are we choking the peer?
  this.amInterested = false // are we interested in the peer?

  this.peerChoking = true // is the peer choking us?
  this.peerInterested = false // is the peer interested in us?

  // The largest torrent that I know of (the Geocities archive) is ~641 GB and has
  // ~41,000 pieces. Therefore, cap bitfield to 10x larger (400,000 bits) to support all
  // possible torrents but prevent malicious peers from growing bitfield to fill memory.
  this.peerPieces = new BitField(0, {grow: BITFIELD_GROW})

  this.peerExtensions = {}

  this.requests = [] // outgoing
  this.peerRequests = [] // incoming

  this.extendedMapping = {} // number -> string, ex: 1 -> 'ut_metadata'
  this.peerExtendedMapping = {} // string -> number, ex: 9 -> 'ut_metadata'

  // The extended handshake to send, minus the "m" field, which gets automatically
  // filled from `this.extendedMapping`
  this.extendedHandshake = {}

  this.peerExtendedHandshake = {} // remote peer's extended handshake

  this._ext = {} // string -> function, ex 'ut_metadata' -> ut_metadata()
  this._nextExt = 1

  this.uploaded = 0
  this.downloaded = 0
  this.uploadSpeed = speedometer()
  this.downloadSpeed = speedometer()

  this._keepAliveInterval = null
  this._timeout = null
  this._timeoutMs = 0

  this.destroyed = false // was the wire ended by calling `destroy`?
  this._finished = false

  this._parserSize = 0 // number of needed bytes to parse next message from remote peer
  this._parser = null // function to call once `this._parserSize` bytes are available

  this._buffer = [] // incomplete message data
  this._bufferSize = 0 // cached total length of buffers in `this._buffer`

  this._peEnabled = peEnabled
  this._dh = crypto.createDiffieHellman(DH_PRIME, 'hex', DH_GENERATOR) // crypto object used to generate keys/secret
  this._myPubKey = this._dh.generateKeys('hex') // my DH public key
  this._peerPubKey = null // peer's DH public key
  this._sharedSecret = null // shared DH secret
  this._peerCryptoProvide = [] // encryption methods provided by peer; we expect this to always contain 0x02
  this._cryptoHandshakeDone = false

  this._cryptoSyncPattern = null // the pattern to search for when resynchronizing after receiving pe1/pe2
  this._waitMaxBytes = null // the maximum number of bytes resynchronization must occur within
  this._encryptionMethod = null // 1 for plaintext, 2 for RC4
  this._encryptGenerator = null // RC4 keystream generator for encryption
  this._decryptGenerator = null // RC4 keystream generator for decryption
  this._setGenerators = false // a flag for whether setEncrypt() has successfully completed

  this.on('finish', this._onFinish)
  this._debug('type:', this.type)

  if (this.type === 'tcpIncoming' && this._peEnabled) {
    // If we are not the initiator, we should wait to see if the client begins
    // with PE/MSE handshake or the standard bittorrent handshake.
    this._determineHandshakeType()
  } else if (this.type === 'tcpOutgoing' && this._peEnabled && retries === 0) {
    this._parsePe2()
  } else {
    this._parseHandshake(null)
  }
}

/**
 * Set whether to send a "keep-alive" ping (sent every 55s)
 * @param {boolean} enable
 */
Wire.prototype.setKeepAlive = function (enable) {
  var self = this
  self._debug('setKeepAlive %s', enable)
  clearInterval(self._keepAliveInterval)
  if (enable === false) return
  self._keepAliveInterval = setInterval(function () {
    self.keepAlive()
  }, KEEP_ALIVE_TIMEOUT)
}

/**
 * Set the amount of time to wait before considering a request to be "timed out"
 * @param {number} ms
 * @param {boolean=} unref (should the timer be unref'd? default: false)
 */
Wire.prototype.setTimeout = function (ms, unref) {
  this._debug('setTimeout ms=%d unref=%s', ms, unref)
  this._clearTimeout()
  this._timeoutMs = ms
  this._timeoutUnref = !!unref
  this._updateTimeout()
}

Wire.prototype.destroy = function () {
  if (this.destroyed) return
  this.destroyed = true
  this._debug('destroy')
  this.emit('close')
  this.end()
}

Wire.prototype.end = function () {
  this._debug('end')
  this._onUninterested()
  this._onChoke()
  stream.Duplex.prototype.end.apply(this, arguments)
}

/**
 * Use the specified protocol extension.
 * @param  {function} Extension
 */
Wire.prototype.use = function (Extension) {
  var name = Extension.prototype.name
  if (!name) {
    throw new Error('Extension class requires a "name" property on the prototype')
  }
  this._debug('use extension.name=%s', name)

  var ext = this._nextExt
  var handler = new Extension(this)

  function noop () {}

  if (typeof handler.onHandshake !== 'function') {
    handler.onHandshake = noop
  }
  if (typeof handler.onExtendedHandshake !== 'function') {
    handler.onExtendedHandshake = noop
  }
  if (typeof handler.onMessage !== 'function') {
    handler.onMessage = noop
  }

  this.extendedMapping[ext] = name
  this._ext[name] = handler
  this[name] = handler

  this._nextExt += 1
}

//
// OUTGOING MESSAGES
//

/**
 * Message "keep-alive": <len=0000>
 */
Wire.prototype.keepAlive = function () {
  this._debug('keep-alive')
  this._push(MESSAGE_KEEP_ALIVE)
}

Wire.prototype.sendPe1 = function () {
  var padALen = Math.floor(Math.random() * 513)
  var padA = randombytes(padALen)
  this._push(Buffer.concat([Buffer.from(this._myPubKey, 'hex'), padA]))
}

Wire.prototype.sendPe2 = function () {
  var padBLen = Math.floor(Math.random() * 513)
  var padB = randombytes(padBLen)
  this._push(Buffer.concat([Buffer.from(this._myPubKey, 'hex'), padB]))
}

Wire.prototype.sendPe3 = function (infoHash) {
  this.setEncrypt(this._sharedSecret, infoHash)

  var hash1Buffer = Buffer.from(sha1.sync(Buffer.from(this._utfToHex('req1') + this._sharedSecret, 'hex')), 'hex')

  var hash2Buffer = Buffer.from(sha1.sync(Buffer.from(this._utfToHex('req2') + infoHash, 'hex')), 'hex')
  var hash3Buffer = Buffer.from(sha1.sync(Buffer.from(this._utfToHex('req3') + this._sharedSecret, 'hex')), 'hex')
  var hashesXorBuffer = xor(hash2Buffer, hash3Buffer)

  var padCLen = randombytes(2).readUInt16BE(0) % 512
  var padCBuffer = randombytes(padCLen)

  var vcAndProvideBuffer = Buffer.alloc(8 + 4 + 2 + padCLen + 2)
  VC.copy(vcAndProvideBuffer)
  CRYPTO_PROVIDE.copy(vcAndProvideBuffer, 8)

  vcAndProvideBuffer.writeInt16BE(padCLen, 12) // pad C length
  padCBuffer.copy(vcAndProvideBuffer, 14)
  vcAndProvideBuffer.writeInt16BE(0, 14 + padCLen) // IA length
  vcAndProvideBuffer = this._encryptHandshake(vcAndProvideBuffer)

  this._push(Buffer.concat([hash1Buffer, hashesXorBuffer, vcAndProvideBuffer]))
}

Wire.prototype.sendPe4 = function (infoHash) {
  this.setEncrypt(this._sharedSecret, infoHash)

  var padDLen = randombytes(2).readUInt16BE(0) % 512
  var padDBuffer = randombytes(padDLen)
  var vcAndSelectBuffer = Buffer.alloc(8 + 4 + 2 + padDLen)
  VC.copy(vcAndSelectBuffer)
  CRYPTO_SELECT.copy(vcAndSelectBuffer, 8)
  vcAndSelectBuffer.writeInt16BE(padDLen, 12) // lenD?
  padDBuffer.copy(vcAndSelectBuffer, 14)
  vcAndSelectBuffer = this._encryptHandshake(vcAndSelectBuffer)
  this._push(vcAndSelectBuffer)
  this._cryptoHandshakeDone = true
  this._debug('completed crypto handshake')
}

/**
 * Message: "handshake" <pstrlen><pstr><reserved><info_hash><peer_id>
 * @param  {Buffer|string} infoHash (as Buffer or *hex* string)
 * @param  {Buffer|string} peerId
 * @param  {Object} extensions
 */
Wire.prototype.handshake = function (infoHash, peerId, extensions) {
  var infoHashBuffer, peerIdBuffer
  if (typeof infoHash === 'string') {
    infoHashBuffer = Buffer.from(infoHash, 'hex')
  } else {
    infoHashBuffer = infoHash
    infoHash = infoHashBuffer.toString('hex')
  }
  if (typeof peerId === 'string') {
    peerIdBuffer = Buffer.from(peerId, 'hex')
  } else {
    peerIdBuffer = peerId
    peerId = peerIdBuffer.toString('hex')
  }

  this._infoHash = infoHashBuffer

  if (infoHashBuffer.length !== 20 || peerIdBuffer.length !== 20) {
    throw new Error('infoHash and peerId MUST have length 20')
  }

  this._debug('handshake i=%s p=%s exts=%o', infoHash, peerId, extensions)

  var reserved = Buffer.from(MESSAGE_RESERVED)

  // enable extended message
  reserved[5] |= 0x10

  if (extensions && extensions.dht) reserved[7] |= 1

  this._push(Buffer.concat([MESSAGE_PROTOCOL, reserved, infoHashBuffer, peerIdBuffer]))
  this._handshakeSent = true

  if (this.peerExtensions.extended && !this._extendedHandshakeSent) {
    // Peer's handshake indicated support already
    // (incoming connection)
    this._sendExtendedHandshake()
  }
}

/* Peer supports BEP-0010, send extended handshake.
 *
 * This comes after the 'handshake' event to give the user a chance to populate
 * `this.extendedHandshake` and `this.extendedMapping` before the extended handshake
 * is sent to the remote peer.
 */
Wire.prototype._sendExtendedHandshake = function () {
  // Create extended message object from registered extensions
  var msg = extend(this.extendedHandshake)
  msg.m = {}
  for (var ext in this.extendedMapping) {
    var name = this.extendedMapping[ext]
    msg.m[name] = Number(ext)
  }

  // Send extended handshake
  this.extended(0, bencode.encode(msg))
  this._extendedHandshakeSent = true
}

/**
 * Message "choke": <len=0001><id=0>
 */
Wire.prototype.choke = function () {
  if (this.amChoking) return
  this.amChoking = true
  this._debug('choke')
  while (this.peerRequests.length) {
    this.peerRequests.pop()
  }
  this._push(MESSAGE_CHOKE)
}

/**
 * Message "unchoke": <len=0001><id=1>
 */
Wire.prototype.unchoke = function () {
  if (!this.amChoking) return
  this.amChoking = false
  this._debug('unchoke')
  this._push(MESSAGE_UNCHOKE)
}

/**
 * Message "interested": <len=0001><id=2>
 */
Wire.prototype.interested = function () {
  if (this.amInterested) return
  this.amInterested = true
  this._debug('interested')
  this._push(MESSAGE_INTERESTED)
}

/**
 * Message "uninterested": <len=0001><id=3>
 */
Wire.prototype.uninterested = function () {
  if (!this.amInterested) return
  this.amInterested = false
  this._debug('uninterested')
  this._push(MESSAGE_UNINTERESTED)
}

/**
 * Message "have": <len=0005><id=4><piece index>
 * @param  {number} index
 */
Wire.prototype.have = function (index) {
  this._debug('have %d', index)
  this._message(4, [index], null)
}

/**
 * Message "bitfield": <len=0001+X><id=5><bitfield>
 * @param  {BitField|Buffer} bitfield
 */
Wire.prototype.bitfield = function (bitfield) {
  this._debug('bitfield')
  if (!Buffer.isBuffer(bitfield)) bitfield = bitfield.buffer
  this._message(5, [], bitfield)
}

/**
 * Message "request": <len=0013><id=6><index><begin><length>
 * @param  {number}   index
 * @param  {number}   offset
 * @param  {number}   length
 * @param  {function} cb
 */
Wire.prototype.request = function (index, offset, length, cb) {
  if (!cb) cb = function () {}
  if (this._finished) return cb(new Error('wire is closed'))
  if (this.peerChoking) return cb(new Error('peer is choking'))

  this._debug('request index=%d offset=%d length=%d', index, offset, length)

  this.requests.push(new Request(index, offset, length, cb))
  this._updateTimeout()
  this._message(6, [index, offset, length], null)
}

/**
 * Message "piece": <len=0009+X><id=7><index><begin><block>
 * @param  {number} index
 * @param  {number} offset
 * @param  {Buffer} buffer
 */
Wire.prototype.piece = function (index, offset, buffer) {
  this._debug('piece index=%d offset=%d', index, offset)
  this.uploaded += buffer.length
  this.uploadSpeed(buffer.length)
  this.emit('upload', buffer.length)
  this._message(7, [index, offset], buffer)
}

/**
 * Message "cancel": <len=0013><id=8><index><begin><length>
 * @param  {number} index
 * @param  {number} offset
 * @param  {number} length
 */
Wire.prototype.cancel = function (index, offset, length) {
  this._debug('cancel index=%d offset=%d length=%d', index, offset, length)
  this._callback(
    pull(this.requests, index, offset, length),
    new Error('request was cancelled'),
    null
  )
  this._message(8, [index, offset, length], null)
}

/**
 * Message: "port" <len=0003><id=9><listen-port>
 * @param {Number} port
 */
Wire.prototype.port = function (port) {
  this._debug('port %d', port)
  var message = Buffer.from(MESSAGE_PORT)
  message.writeUInt16BE(port, 5)
  this._push(message)
}

/**
 * Message: "extended" <len=0005+X><id=20><ext-number><payload>
 * @param  {number|string} ext
 * @param  {Object} obj
 */
Wire.prototype.extended = function (ext, obj) {
  this._debug('extended ext=%s', ext)
  if (typeof ext === 'string' && this.peerExtendedMapping[ext]) {
    ext = this.peerExtendedMapping[ext]
  }
  if (typeof ext === 'number') {
    var extId = Buffer.from([ext])
    var buf = Buffer.isBuffer(obj) ? obj : bencode.encode(obj)

    this._message(20, [], Buffer.concat([extId, buf]))
  } else {
    throw new Error('Unrecognized extension: ' + ext)
  }
}

/**
 * Sets the encryption method for this wire, as per PSE/ME specification
 *
 * @param {string} sharedSecret:  A hex-encoded string, which is the shared secret agreed
 *                                upon from DH key exchange
 * @returns boolean, true if encryption setting succeeds, false if it fails.
 */
Wire.prototype.setEncrypt = function (sharedSecret, infoHash) {
  var encryptKey
  var decryptKey
  var encryptKeyBuf
  var encryptKeyIntArray
  var decryptKeyBuf
  var decryptKeyIntArray
  switch (this.type) {
    case 'tcpIncoming':
      encryptKey = sha1.sync(Buffer.from(this._utfToHex('keyB') + sharedSecret + infoHash, 'hex'))
      decryptKey = sha1.sync(Buffer.from(this._utfToHex('keyA') + sharedSecret + infoHash, 'hex'))
      encryptKeyBuf = Buffer.from(encryptKey, 'hex')
      encryptKeyIntArray = []
      for (const value of encryptKeyBuf.values()) {
        encryptKeyIntArray.push(value)
      }
      decryptKeyBuf = Buffer.from(decryptKey, 'hex')
      decryptKeyIntArray = []
      for (const value of decryptKeyBuf.values()) {
        decryptKeyIntArray.push(value)
      }
      this._encryptGenerator = new RC4(encryptKeyIntArray)
      this._decryptGenerator = new RC4(decryptKeyIntArray)
      break
    case 'tcpOutgoing':
      encryptKey = sha1.sync(Buffer.from(this._utfToHex('keyA') + sharedSecret + infoHash, 'hex'))
      decryptKey = sha1.sync(Buffer.from(this._utfToHex('keyB') + sharedSecret + infoHash, 'hex'))
      encryptKeyBuf = Buffer.from(encryptKey, 'hex')
      encryptKeyIntArray = []
      for (const value of encryptKeyBuf.values()) {
        encryptKeyIntArray.push(value)
      }
      decryptKeyBuf = Buffer.from(decryptKey, 'hex')
      decryptKeyIntArray = []
      for (const value of decryptKeyBuf.values()) {
        decryptKeyIntArray.push(value)
      }
      this._encryptGenerator = new RC4(encryptKeyIntArray)
      this._decryptGenerator = new RC4(decryptKeyIntArray)
      break
    default:
      return false
  }

  // Discard the first 1024 bytes, as per MSE/PE implementation
  for (var i = 0; i < 1024; i++) {
    this._encryptGenerator.randomByte()
    this._decryptGenerator.randomByte()
  }

  this._setGenerators = true
  return true
}

/**
 * Duplex stream method. Called whenever the remote peer stream wants data. No-op
 * since we'll just push data whenever we get it.
 */
Wire.prototype._read = function () {}

/**
 * Send a message to the remote peer.
 */
Wire.prototype._message = function (id, numbers, data) {
  var dataLength = data ? data.length : 0
  var buffer = Buffer.allocUnsafe(5 + (4 * numbers.length))

  buffer.writeUInt32BE(buffer.length + dataLength - 4, 0)
  buffer[4] = id
  for (var i = 0; i < numbers.length; i++) {
    buffer.writeUInt32BE(numbers[i], 5 + (4 * i))
  }
  this._push(buffer)
  if (data) this._push(data)
}

Wire.prototype._push = function (data) {
  if (this._finished) return
  if (this._encryptionMethod === 2 && this._cryptoHandshakeDone) {
    data = this._encrypt(data)
  }
  return this.push(data)
}

//
// INCOMING MESSAGES
//

Wire.prototype._onKeepAlive = function () {
  this._debug('got keep-alive')
  this.emit('keep-alive')
}

Wire.prototype._onPe1 = function (pubKeyBuffer) {
  this._peerPubKey = pubKeyBuffer.toString('hex')
  this._sharedSecret = this._dh.computeSecret(this._peerPubKey, 'hex', 'hex')
  this.emit('pe1')
}

Wire.prototype._onPe2 = function (pubKeyBuffer) {
  this._peerPubKey = pubKeyBuffer.toString('hex')
  this._sharedSecret = this._dh.computeSecret(this._peerPubKey, 'hex', 'hex')
  this.emit('pe2')
}

Wire.prototype._onPe3 = function (hashesXorBuffer) {
  var hash3 = sha1.sync(Buffer.from(this._utfToHex('req3') + this._sharedSecret, 'hex'))
  var sKeyHash = xor(hashesXorBuffer, Buffer.from(hash3, 'hex')).toString('hex')
  this.emit('pe3', sKeyHash)
}

Wire.prototype._onPe3Encrypted = function (vcBuffer, peerProvideBuffer, padCBuffer, iaBuffer) {
  var self = this
  if (!vcBuffer.equals(VC)) {
    self._debug('Error: verification constant did not match')
    self.destroy()
    return
  }

  for (const provideByte of peerProvideBuffer.values()) {
    if (provideByte !== 0) {
      this._peerCryptoProvide.push(provideByte)
    }
  }
  if (this._peerCryptoProvide.includes(2)) {
    this._encryptionMethod = 2
  } else {
    self._debug('Error: RC4 encryption method not provided by peer')
    self.destroy()
  }
}

Wire.prototype._onPe4 = function (peerSelectBuffer) {
  this._encryptionMethod = peerSelectBuffer.readUInt8(3)
  if (!CRYPTO_PROVIDE.includes(this._encryptionMethod)) {
    this._debug('Error: peer selected invalid crypto method')
    this.destroy()
  }
  this._cryptoHandshakeDone = true
  this._debug('crypto handshake done')
  this.emit('pe4')
}

Wire.prototype._onHandshake = function (infoHashBuffer, peerIdBuffer, extensions) {
  var infoHash = infoHashBuffer.toString('hex')
  var peerId = peerIdBuffer.toString('hex')

  this._debug('got handshake i=%s p=%s exts=%o', infoHash, peerId, extensions)

  this.peerId = peerId
  this.peerIdBuffer = peerIdBuffer
  this.peerExtensions = extensions

  this.emit('handshake', infoHash, peerId, extensions)

  var name
  for (name in this._ext) {
    this._ext[name].onHandshake(infoHash, peerId, extensions)
  }

  if (extensions.extended && this._handshakeSent &&
    !this._extendedHandshakeSent) {
    // outgoing connection
    this._sendExtendedHandshake()
  }
}

Wire.prototype._onChoke = function () {
  this.peerChoking = true
  this._debug('got choke')
  this.emit('choke')
  while (this.requests.length) {
    this._callback(this.requests.pop(), new Error('peer is choking'), null)
  }
}

Wire.prototype._onUnchoke = function () {
  this.peerChoking = false
  this._debug('got unchoke')
  this.emit('unchoke')
}

Wire.prototype._onInterested = function () {
  this.peerInterested = true
  this._debug('got interested')
  this.emit('interested')
}

Wire.prototype._onUninterested = function () {
  this.peerInterested = false
  this._debug('got uninterested')
  this.emit('uninterested')
}

Wire.prototype._onHave = function (index) {
  if (this.peerPieces.get(index)) return
  this._debug('got have %d', index)

  this.peerPieces.set(index, true)
  this.emit('have', index)
}

Wire.prototype._onBitField = function (buffer) {
  this.peerPieces = new BitField(buffer)
  this._debug('got bitfield')
  this.emit('bitfield', this.peerPieces)
}

Wire.prototype._onRequest = function (index, offset, length) {
  var self = this
  if (self.amChoking) return
  self._debug('got request index=%d offset=%d length=%d', index, offset, length)

  var respond = function (err, buffer) {
    if (request !== pull(self.peerRequests, index, offset, length)) return
    if (err) return self._debug('error satisfying request index=%d offset=%d length=%d (%s)', index, offset, length, err.message)
    self.piece(index, offset, buffer)
  }

  var request = new Request(index, offset, length, respond)
  self.peerRequests.push(request)
  self.emit('request', index, offset, length, respond)
}

Wire.prototype._onPiece = function (index, offset, buffer) {
  this._debug('got piece index=%d offset=%d', index, offset)
  this._callback(pull(this.requests, index, offset, buffer.length), null, buffer)
  this.downloaded += buffer.length
  this.downloadSpeed(buffer.length)
  this.emit('download', buffer.length)
  this.emit('piece', index, offset, buffer)
}

Wire.prototype._onCancel = function (index, offset, length) {
  this._debug('got cancel index=%d offset=%d length=%d', index, offset, length)
  pull(this.peerRequests, index, offset, length)
  this.emit('cancel', index, offset, length)
}

Wire.prototype._onPort = function (port) {
  this._debug('got port %d', port)
  this.emit('port', port)
}

Wire.prototype._onExtended = function (ext, buf) {
  if (ext === 0) {
    var info
    try {
      info = bencode.decode(buf)
    } catch (err) {
      this._debug('ignoring invalid extended handshake: %s', err.message || err)
    }

    if (!info) return
    this.peerExtendedHandshake = info

    var name
    if (typeof info.m === 'object') {
      for (name in info.m) {
        this.peerExtendedMapping[name] = Number(info.m[name].toString())
      }
    }
    for (name in this._ext) {
      if (this.peerExtendedMapping[name]) {
        this._ext[name].onExtendedHandshake(this.peerExtendedHandshake)
      }
    }
    this._debug('got extended handshake')
    this.emit('extended', 'handshake', this.peerExtendedHandshake)
  } else {
    if (this.extendedMapping[ext]) {
      ext = this.extendedMapping[ext] // friendly name for extension
      if (this._ext[ext]) {
        // there is an registered extension handler, so call it
        this._ext[ext].onMessage(buf)
      }
    }
    this._debug('got extended message ext=%s', ext)
    this.emit('extended', ext, buf)
  }
}

Wire.prototype._onTimeout = function () {
  this._debug('request timed out')
  this._callback(this.requests.shift(), new Error('request has timed out'), null)
  this.emit('timeout')
}

/**
 * Duplex stream method. Called whenever the remote peer has data for us. Data that the
 * remote peer sends gets buffered (i.e. not actually processed) until the right number
 * of bytes have arrived, determined by the last call to `this._parse(number, callback)`.
 * Once enough bytes have arrived to process the message, the callback function
 * (i.e. `this._parser`) gets called with the full buffer of data.
 * @param  {Buffer} data
 * @param  {string} encoding
 * @param  {function} cb
 */
Wire.prototype._write = function (data, encoding, cb) {
  var self = this

  if (self._encryptionMethod === 2 && self._cryptoHandshakeDone) {
    data = self._decrypt(data)
  }
  self._bufferSize += data.length
  self._buffer.push(data)
  if (self._buffer.length > 1) {
    self._buffer = [Buffer.concat(self._buffer)]
  }
  // now self._buffer is an array containing a single Buffer
  if (self._cryptoSyncPattern) {
    const index = self._buffer[0].indexOf(self._cryptoSyncPattern)
    if (index !== -1) {
      self._buffer[0] = self._buffer[0].slice(index + self._cryptoSyncPattern.length)
      self._bufferSize -= (index + self._cryptoSyncPattern.length)
      self._cryptoSyncPattern = null
    } else if (self._bufferSize + data.length > self._waitMaxBytes + self._cryptoSyncPattern.length) {
      self._debug('Error: could not resynchronize')
      self.destroy()
      return
    }
  }

  while (self._bufferSize >= self._parserSize && !self._cryptoSyncPattern) {
    var buffer = self._buffer[0]
    self._bufferSize -= self._parserSize
    self._buffer = self._bufferSize
      ? [buffer.slice(self._parserSize)]
      : []
    self._parser(buffer.slice(0, self._parserSize))
  }

  cb(null) // Signal that we're ready for more data
}

Wire.prototype._callback = function (request, err, buffer) {
  if (!request) return

  this._clearTimeout()

  if (!this.peerChoking && !this._finished) this._updateTimeout()
  request.callback(err, buffer)
}

Wire.prototype._clearTimeout = function () {
  if (!this._timeout) return

  clearTimeout(this._timeout)
  this._timeout = null
}

Wire.prototype._updateTimeout = function () {
  var self = this
  if (!self._timeoutMs || !self.requests.length || self._timeout) return

  self._timeout = setTimeout(function () {
    self._onTimeout()
  }, self._timeoutMs)
  if (self._timeoutUnref && self._timeout.unref) self._timeout.unref()
}

/**
 * Takes a number of bytes that the local peer is waiting to receive from the remote peer
 * in order to parse a complete message, and a callback function to be called once enough
 * bytes have arrived.
 * @param  {number} size
 * @param  {function} parser
 */
Wire.prototype._parse = function (size, parser) {
  this._parserSize = size
  this._parser = parser
}

Wire.prototype._parseUntil = function (pattern, maxBytes) {
  this._cryptoSyncPattern = pattern
  this._waitMaxBytes = maxBytes
}

/**
 * Handle the first 4 bytes of a message, to determine the length of bytes that must be
 * waited for in order to have the whole message.
 * @param  {Buffer} buffer
 */
Wire.prototype._onMessageLength = function (buffer) {
  var length = buffer.readUInt32BE(0)
  if (length > 0) {
    this._parse(length, this._onMessage)
  } else {
    this._onKeepAlive()
    this._parse(4, this._onMessageLength)
  }
}

/**
 * Handle a message from the remote peer.
 * @param  {Buffer} buffer
 */
Wire.prototype._onMessage = function (buffer) {
  this._parse(4, this._onMessageLength)
  switch (buffer[0]) {
    case 0:
      return this._onChoke()
    case 1:
      return this._onUnchoke()
    case 2:
      return this._onInterested()
    case 3:
      return this._onUninterested()
    case 4:
      return this._onHave(buffer.readUInt32BE(1))
    case 5:
      return this._onBitField(buffer.slice(1))
    case 6:
      return this._onRequest(buffer.readUInt32BE(1),
        buffer.readUInt32BE(5), buffer.readUInt32BE(9))
    case 7:
      return this._onPiece(buffer.readUInt32BE(1),
        buffer.readUInt32BE(5), buffer.slice(9))
    case 8:
      return this._onCancel(buffer.readUInt32BE(1),
        buffer.readUInt32BE(5), buffer.readUInt32BE(9))
    case 9:
      return this._onPort(buffer.readUInt16BE(1))
    case 20:
      return this._onExtended(buffer.readUInt8(1), buffer.slice(2))
    default:
      this._debug('got unknown message')
      return this.emit('unknownmessage', buffer)
  }
}

Wire.prototype._determineHandshakeType = function () {
  var self = this
  self._parse(1, function (pstrLenBuffer) {
    var pstrlen = pstrLenBuffer.readUInt8(0)
    if (pstrlen === 19) {
      self._parse(pstrlen + 48, self._onHandshakeBuffer)
    } else {
      this._parsePe1(pstrLenBuffer)
    }
  })
}

Wire.prototype._parsePe1 = function (pubKeyPrefix) {
  var self = this
  self._parse(95, function (pubKeySuffix) {
    self._onPe1(Buffer.concat([pubKeyPrefix, pubKeySuffix]))
    self._parsePe3()
  })
}

Wire.prototype._parsePe2 = function () {
  var self = this
  self._parse(96, function (pubKey) {
    self._onPe2(pubKey)
    while (!self._setGenerators) {
      // Wait until generators have been set
    }
    self._parsePe4()
  })
}

// Handles the unencrypted portion of step 4
Wire.prototype._parsePe3 = function () {
  var self = this
  var hash1Buffer = Buffer.from(sha1.sync(Buffer.from(this._utfToHex('req1') + this._sharedSecret, 'hex')), 'hex')
  // synchronize on HASH('req1', S)
  self._parseUntil(hash1Buffer, 512)
  self._parse(20, function (buffer) {
    self._onPe3(buffer)
    while (!self._setGenerators) {
      // Wait until generators have been set
    }
    self._parsePe3Encrypted()
  })
}

Wire.prototype._parsePe3Encrypted = function () {
  var self = this
  self._parse(14, function (buffer) {
    var vcBuffer = self._decryptHandshake(buffer.slice(0, 8))
    var peerProvideBuffer = self._decryptHandshake(buffer.slice(8, 12))
    var padCLen = self._decryptHandshake(buffer.slice(12, 14)).readUInt16BE(0)
    self._parse(padCLen, function (padCBuffer) {
      padCBuffer = self._decryptHandshake(padCBuffer)
      self._parse(2, function (iaLenBuf) {
        var iaLen = self._decryptHandshake(iaLenBuf).readUInt16BE(0)
        self._parse(iaLen, function (iaBuffer) {
          iaBuffer = self._decryptHandshake(iaBuffer)
          self._onPe3Encrypted(vcBuffer, peerProvideBuffer, padCBuffer, iaBuffer)
          var pstrlen = iaLen ? iaBuffer.readUInt8(0) : null
          var protocol = iaLen ? iaBuffer.slice(1, 20) : null
          if (pstrlen === 19 && protocol.toString() === 'BitTorrent protocol') {
            self._onHandshakeBuffer(iaBuffer.slice(1))
          } else {
            self._parseHandshake()
          }
        })
      })
    })
  })
}

Wire.prototype._parsePe4 = function () {
  var self = this
  // synchronize on ENCRYPT(VC).
  // since we encrypt using bitwise xor, decryption and encryption are the same operation.
  // calling _decryptHandshake here advances the decrypt generator keystream forward 8 bytes
  var vcBufferEncrypted = self._decryptHandshake(VC)
  self._parseUntil(vcBufferEncrypted, 512)
  self._parse(6, function (buffer) {
    var peerSelectBuffer = self._decryptHandshake(buffer.slice(0, 4))
    var padDLen = self._decryptHandshake(buffer.slice(4, 6)).readUInt16BE(0)
    self._parse(padDLen, function (padDBuf) {
      self._decryptHandshake(padDBuf)
      self._onPe4(peerSelectBuffer)
      self._parseHandshake(null)
    })
  })
}

/**
 * Reads the handshake as specified by the bittorrent wire protocol.
 */
Wire.prototype._parseHandshake = function () {
  var self = this
  self._parse(1, function (buffer) {
    var pstrlen = buffer.readUInt8(0)
    if (pstrlen !== 19) {
      self._debug('Error: wire not speaking BitTorrent protocol (%s)', pstrlen.toString())
      self.end()
      return
    }
    self._parse(pstrlen + 48, self._onHandshakeBuffer)
  })
}

Wire.prototype._onHandshakeBuffer = function (handshake) {
  var self = this
  var protocol = handshake.slice(0, 19)
  if (protocol.toString() !== 'BitTorrent protocol') {
    self._debug('Error: wire not speaking BitTorrent protocol (%s)', protocol.toString())
    self.end()
    return
  }
  handshake = handshake.slice(19)
  self._onHandshake(handshake.slice(8, 28), handshake.slice(28, 48), {
    dht: !!(handshake[7] & 0x01), // see bep_0005
    extended: !!(handshake[5] & 0x10) // see bep_0010
  })
  self._parse(4, self._onMessageLength)
}

Wire.prototype._onFinish = function () {
  this._finished = true

  this.push(null) // stream cannot be half open, so signal the end of it
  while (this.read()) {} // consume and discard the rest of the stream data

  clearInterval(this._keepAliveInterval)
  this._parse(Number.MAX_VALUE, function () {})
  while (this.peerRequests.length) {
    this.peerRequests.pop()
  }
  while (this.requests.length) {
    this._callback(this.requests.pop(), new Error('wire was closed'), null)
  }
}

Wire.prototype._debug = function () {
  var args = [].slice.call(arguments)
  args[0] = '[' + this._debugId + '] ' + args[0]
  debug.apply(null, args)
}

function pull (requests, piece, offset, length) {
  for (var i = 0; i < requests.length; i++) {
    var req = requests[i]
    if (req.piece === piece && req.offset === offset && req.length === length) {
      arrayRemove(requests, i)
      return req
    }
  }
  return null
}

Wire.prototype._encryptHandshake = function (buf) {
  var crypt = Buffer.from(buf)
  if (!this._encryptGenerator) {
    this._debug('Warning: Encrypting without any generator')
    return crypt
  }

  for (var i = 0; i < buf.length; i++) {
    var keystream = this._encryptGenerator.randomByte()
    crypt[i] = crypt[i] ^ keystream
  }

  return crypt
}

Wire.prototype._encrypt = function (buf) {
  var crypt = Buffer.from(buf)

  if (!this._encryptGenerator || this._encryptionMethod !== 2) {
    return crypt
  }
  for (var i = 0; i < buf.length; i++) {
    var keystream = this._encryptGenerator.randomByte()
    crypt[i] = crypt[i] ^ keystream
  }

  return crypt
}

Wire.prototype._decryptHandshake = function (buf) {
  var decrypt = Buffer.from(buf)

  if (!this._decryptGenerator) {
    this._debug('Warning: Decrypting without any generator')
    return decrypt
  }
  for (var i = 0; i < buf.length; i++) {
    var keystream = this._decryptGenerator.randomByte()
    decrypt[i] = decrypt[i] ^ keystream
  }

  return decrypt
}

Wire.prototype._decrypt = function (buf) {
  var decrypt = Buffer.from(buf)

  if (!this._decryptGenerator || this._encryptionMethod !== 2) {
    return decrypt
  }
  for (var i = 0; i < buf.length; i++) {
    var keystream = this._decryptGenerator.randomByte()
    decrypt[i] = decrypt[i] ^ keystream
  }

  return decrypt
}

Wire.prototype._utfToHex = function (str) {
  return Buffer.from(str, 'utf8').toString('hex')
}
