import crypto from 'crypto'
import { concat, hex2arr, arr2hex, arr2text, text2arr, randomBytes, equal } from 'uint8-util'

// true if Node's crypto supports RC4 (avoids slower JS fallback) Node 17+ (requires `--openssl-legacy-provider`)
export const nativeRC4 = (() => {
  try {
    crypto.createCipheriv('rc4', Buffer.alloc(16), '')
    return true
  } catch {
    return false
  }
})()

function createRC4Cipher (key) {
  if (nativeRC4) {
    const c = crypto.createCipheriv('rc4', key, '')
    c.update(Buffer.alloc(1024))
    return buf => c.update(buf)
  }
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff
    const tmp = s[i]
    s[i] = s[j]
    s[j] = tmp
  }
  let ii = 0
  let jj = 0
  for (let i = 0; i < 1024; i++) {
    ii = (ii + 1) & 0xff
    jj = (jj + s[ii]) & 0xff
    const tmp = s[ii]
    s[ii] = s[jj]
    s[jj] = tmp
  }
  return buf => {
    for (let i = 0; i < buf.length; i++) {
      ii = (ii + 1) & 0xff
      jj = (jj + s[ii]) & 0xff
      const tmp = s[ii]
      s[ii] = s[jj]
      s[jj] = tmp
      buf[i] ^= s[(s[ii] + s[jj]) & 0xff]
    }
    return buf
  }
}

const DH_PRIME = 'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a63a36210000000000090563'
const DH_GENERATOR = 2

const REQ1_STR = text2arr('req1')
const REQ2_STR = text2arr('req2')
const REQ3_STR = text2arr('req3')
const KEYA_STR = text2arr('keyA')
const KEYB_STR = text2arr('keyB')

const VC = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

const SYNC_MAX_BYTES = 512

function xor (a, b) {
  for (let len = a.length; len--;) a[len] ^= b[len]
  return a
}

function sha1 (...buffers) {
  const h = crypto.createHash('sha1')
  for (const buf of buffers) h.update(buf)
  return h.digest()
}

function getUint32 (buffer, at = 0) {
  return (buffer[at] << 24) | (buffer[at + 1] << 16) | (buffer[at + 2] << 8) | buffer[at + 3]
}

function getUint16 (buffer, at = 0) {
  return (buffer[at] << 8) | buffer[at + 1]
}

export class MessageStreamEncryptor {
  // PE/MSE handshake flow
  //
  //   step 1  A => B    Diffie Hellman Ya, PadA
  //   step 2  B => A    Diffie Hellman Yb, PadB
  //   step 3  A => B    HASH('req1',S), HASH('req2',SKEY) XOR HASH('req3',S), ENCRYPT(VC, crypto_provide, len(PadC), PadC, len(IA))
  //   step 4  B => A    ENCRYPT(VC, crypto_select, len(padD), padD)
  //   step 5+ A <=> B   ENCRYPT2(Payload Stream)
  //
  // Initiator (outgoing, peer A):
  //   1. startAsInitiator() => generateStepA1() => send step 1 (Ya + PadA), wait for step 2 (Yb + PadB), plaintext handshake, or timeout
  //   2. handleStepA2() => compute S, init ciphers
  //   3. generateStepA3() => send step 3, then _handlePe4() resyncs on ENCRYPT(VC)
  //   4. _onPe4Select/Padding() => decode crypto_select, _finalizeCryptoHandshake()
  //   5. payload ENCRYPT2() active
  //
  // Responder (incoming, peer B):
  //   1. handleIncoming() => handleStepB1() store Ya
  //   2. generateStepB2() => send step 2 (Yb + PadB), compute S
  //   3. _handlePe3() => resync on HASH('req1',S), extract XOR'd SKEY hash => emit 'crypto-infohash'
  //   4. setInfoHash() => _initializeCiphers('B'), _handlePe3Encrypted(), decodes VC | crypto_provide | len(PadC) | PadC | len(IA) | IA
  //   5. _onPe3IaLen / _onPe3Ia => optionally process embedded payload (IA)
  //   6. _advanceEncryption() => generateStepB4() => send step 4, _finalizeCryptoHandshake()
  //   7. payload ENCRYPT2() active
  constructor (wireOrKey, skeyHex) {
    if (typeof wireOrKey === 'string' || wireOrKey === null || wireOrKey === undefined) {
      this.wire = null
      this.skeyHex = wireOrKey || null
    } else {
      this.wire = wireOrKey
      this.skeyHex = skeyHex || null
    }
    this.state = 'idle' // idle | sentPe1 | gotPe2 | sentPe3 | gotPe3 | done
    this._dh = null
    this._isEncrypted = false
    this.S = null
    this.encryptCipher = null
    this.decryptCipher = null
    this.ya = null
    this.encryptionMethod = null
    this.cryptoHandshakeDone = false
    this._peerCryptoProvide = 0
  }

  get dh () {
    if (!this._dh) {
      this._dh = crypto.createDiffieHellman(DH_PRIME, 'hex', DH_GENERATOR)
    }
    return this._dh
  }

  //
  // INITIATOR STEPS
  //

  startAsInitiator (infoHash) {
    this.skeyHex = infoHash
    const step1 = this.generateStepA1()
    this.wire._push(step1)
    if (this.state === 'gotPe2') {
      this._advanceEncryption()
    } else {
      this.state = 'sentPe1'
    }
    this.wire._debug('PE: sent step 1 (initiator, gotPe2Already=%s)', this.state === 'gotPe2')
  }

  generateStepA1 () {
    const raw = this.dh.generateKeys()
    const ya = new Uint8Array(96)
    ya.set(raw, 96 - raw.length)
    const padA = randomBytes(Math.floor(Math.random() * 513))
    return concat([ya, padA])
  }

  handleStepA2 (step2Data) {
    const yb = step2Data.slice(0, 96)
    this.S = this.dh.computeSecret(yb)
    if (this.skeyHex) this._initializeCiphers('A')
  }

  generateStepA3 (cryptoProvide = 0x01 | 0x02) {
    const req1Hash = sha1(REQ1_STR, this.S)
    const req2Hash = sha1(REQ2_STR, hex2arr(this.skeyHex))
    const req3Hash = sha1(REQ3_STR, this.S)
    const xorHash = xor(req2Hash, req3Hash)

    const cryptoProvideBuf = Buffer.alloc(4)
    cryptoProvideBuf.writeUInt32BE(cryptoProvide, 0)

    const padC = randomBytes(Math.floor(Math.random() * 513))
    const lenPadC = Buffer.alloc(2)
    lenPadC.writeUInt16BE(padC.length, 0)
    const lenIA = Buffer.alloc(2)
    lenIA.writeUInt16BE(0, 0)

    const plaintext = concat([VC, cryptoProvideBuf, lenPadC, padC, lenIA])
    const encryptedPart = this.encryptCipher(plaintext)

    return concat([req1Hash, xorHash, encryptedPart])
  }

  //
  // RESPONDER STEPS
  //

  handleStepB1 (step1Data) {
    this.ya = step1Data.slice(0, 96)
  }

  generateStepB2 () {
    const raw = this.dh.generateKeys()
    const yb = new Uint8Array(96)
    yb.set(raw, 96 - raw.length)
    this.S = this.dh.computeSecret(this.ya)
    const padB = randomBytes(Math.floor(Math.random() * 513))
    return concat([yb, padB])
  }

  generateStepB4 (cryptoSelect = 0x02) {
    const cryptoSelectBuf = Buffer.alloc(4)
    cryptoSelectBuf.writeUInt32BE(cryptoSelect, 0)
    const padD = randomBytes(Math.floor(Math.random() * 513))
    const lenPadD = Buffer.alloc(2)
    lenPadD.writeUInt16BE(padD.length, 0)

    const plaintext = concat([VC, cryptoSelectBuf, lenPadD, padD])
    return this.encryptCipher(plaintext)
  }

  getSyncPattern () {
    return sha1(REQ1_STR, this.S)
  }

  extractInfoHashFromXor (xorPart) {
    const req3Hash = sha1(REQ3_STR, this.S)
    const result = new Uint8Array(xorPart)
    xor(result, req3Hash)
    return arr2hex(result)
  }

  //
  // PE STATE MACHINE
  //

  handleIncoming () {
    this._detectHandshakeOrPe(
      handshake => this.wire._onHandshakeBuffer(handshake),
      pubKeyPrefix => {
        this.wire._parse(76, pubKeySuffix => {
          this.handleStepB1(concat([pubKeyPrefix, pubKeySuffix]))
          const step2 = this.generateStepB2()
          this.state = 'sentPe2'
          this._handlePe3()
          this.wire._debug('PE: handled step 1, sent step 2 (responder)')
          this.wire._push(step2)
        })
      }
    )
  }

  handleOutgoing () {
    this._detectHandshakeOrPe(
      handshake => {
        this.wire._debug('PE: peer sent plaintext handshake, falling back to no PE')
        this.state = 'done'
        this.encryptionMethod = null
        this.cryptoHandshakeDone = true
        this.wire.emit('crypto-handshake')
        this.wire._onHandshakeBuffer(handshake)
      },
      pubKeyPrefix => {
        this.wire._parse(76, pubKeySuffix => {
          const pubKey = concat([pubKeyPrefix, pubKeySuffix])
          this.handleStepA2(pubKey)
          this.state = 'gotPe2'
          this.wire._debug('PE: handled step 2 (initiator)')
          this._advanceEncryption()
        })
      }
    )
  }

  _advanceEncryption () {
    if (this.state === 'gotPe2' && this.skeyHex) {
      if (!this.encryptCipher) this._initializeCiphers('A')
      const provide = this.wire._peEnabled === 2 ? 0x02 : 0x01 | 0x02
      const step3 = this.generateStepA3(provide)
      this.state = 'sentPe3'
      this.wire._debug('PE: sent step 3 (initiator)')
      this._handlePe4()
      this.wire._push(step3)
    }
    if (this.state === 'gotPe3' && this.skeyHex) {
      const wantPlaintext = this.wire._peEnabled === 1
      const prefer = wantPlaintext ? 0x01 : 0x02
      const accept = wantPlaintext ? (0x01 | 0x02) : 0x02
      const cryptoSelect = (this._peerCryptoProvide & prefer) || (this._peerCryptoProvide & accept) || 0
      if (!cryptoSelect) {
        this.wire._debug('Error: no supported crypto method to select (peerProvide=0x%s)', this._peerCryptoProvide.toString(16))
        this.wire.destroy()
        return
      }
      const step4 = this.generateStepB4(cryptoSelect)
      this.wire._push(step4)
      this._finalizeCryptoHandshake(cryptoSelect)
      this.wire._debug('PE: sent step 4 (responder), crypto handshake done (method %s)', cryptoSelect)
      if (!this.wire.peerId) this.wire._parseHandshake(null)
      this.wire.emit('crypto-handshake')
    }
  }

  _finalizeCryptoHandshake (encMethod) {
    this.state = 'done'
    this.encryptionMethod = encMethod
    this.cryptoHandshakeDone = true
    if (encMethod === 2) this._isEncrypted = true
    if (this.wire._bufferSize > 0) {
      const buf = concat(this.wire._buffer, this.wire._bufferSize)
      this.wire._buffer = [this.decrypt(buf)]
    }
  }

  setInfoHash (infoHash) {
    this.skeyHex = infoHash.toLowerCase()
    this._initializeCiphers('B')
    this._handlePe3Encrypted()
    this.wire._pePending = false
    this.wire._processBuffer()
  }

  //
  // PARSING HELPERS
  //

  _detectHandshakeOrPe (onHandshake, onPe) {
    this.wire._parse(20, first20 => {
      if (first20[0] === 19 && arr2text(first20.slice(1, 20)) === 'BitTorrent protocol') {
        this.wire._parse(48, tail => onHandshake(concat([first20.slice(1), tail])))
      } else {
        onPe(first20)
      }
    })
  }

  _handlePe3 () {
    const hash1Buffer = this.getSyncPattern()
    this.wire._parseUntil(hash1Buffer, SYNC_MAX_BYTES)
    this.wire._parse(20, buffer => {
      const infoHashHash = this.extractInfoHashFromXor(buffer)
      this.state = 'gotPe3'
      this.wire._debug('PE: handled step 3 XOR hash (responder)')
      this.wire._pePending = true
      this.wire.emit('crypto-infohash', infoHashHash)
    })
  }

  _handlePe3Encrypted () {
    this.wire._parse(14, buffer => this._onPe3Header(buffer))
  }

  _onPe3Header (buffer) {
    const decHeader = this.decryptCipher(buffer)
    if (!equal(decHeader.subarray(0, 8), VC)) {
      this.wire._debug('Error: VC verification failed in pe3 (got %d bytes)', decHeader.length)
      this.wire.destroy()
      return
    }
    this._peerCryptoProvide = getUint32(decHeader, 8)
    if (this._peerCryptoProvide === 0) {
      this.wire._debug('Error: no crypto methods provided by peer')
      this.wire.destroy()
      return
    }
    const padCLen = getUint16(decHeader, 12)
    this.wire._parse(padCLen, padCBuf => this._onPe3Padding(padCBuf))
  }

  _onPe3Padding (padCBuf) {
    this.decryptCipher(padCBuf)
    this.wire._parse(2, iaLenBuf => this._onPe3IaLen(iaLenBuf))
  }

  _onPe3IaLen (iaLenBuf) {
    const decIaLen = this.decryptCipher(iaLenBuf)
    const iaLen = getUint16(decIaLen, 0)
    if (iaLen > 0) {
      this.wire._parse(iaLen, iaBuffer => this._onPe3Ia(iaBuffer))
    } else {
      this._advanceEncryption()
    }
  }

  _onPe3Ia (iaBuffer) {
    const ia = this.decryptCipher(iaBuffer)
    this._advanceEncryption()
    if (ia.length > 0 && ia[0] === 19 && arr2text(ia.slice(1, 20)) === 'BitTorrent protocol') {
      this.wire._onHandshakeBuffer(ia.slice(1))
    }
  }

  _handlePe4 () {
    const vcBufferEncrypted = this.decryptCipher(new Uint8Array(VC))
    this.wire._parseUntil(vcBufferEncrypted, SYNC_MAX_BYTES)
    this.wire._parse(6, buffer => this._onPe4Select(buffer))
  }

  _onPe4Select (buffer) {
    const peerSelect = this.decryptCipher(buffer)
    const selectedMethod = getUint32(peerSelect, 0)
    if (selectedMethod !== 1 && selectedMethod !== 2) {
      this.wire._debug('Error: peer selected unknown crypto method %s', selectedMethod)
      this.wire.destroy()
      return
    }
    const padDLen = getUint16(peerSelect, 4)
    this.wire._parse(padDLen, padDBuf => this._onPe4Padding(padDBuf, selectedMethod))
  }

  _onPe4Padding (padDBuf, selectedMethod) {
    this.decryptCipher(padDBuf)
    this._finalizeCryptoHandshake(selectedMethod)
    this.wire._debug('PE: handled step 4, crypto handshake done (method %s)', selectedMethod)
    this.wire._parseHandshake(null)
    this.wire.emit('crypto-handshake')
  }

  //
  // PAYLOAD CRYPTO
  //

  encrypt (data) {
    if (!this._isEncrypted) return data
    return this.encryptCipher(data)
  }

  decrypt (data) {
    if (!this._isEncrypted) return data
    return this.decryptCipher(data)
  }

  _initializeCiphers (party) {
    const keyA = sha1(KEYA_STR, this.S, hex2arr(this.skeyHex))
    const keyB = sha1(KEYB_STR, this.S, hex2arr(this.skeyHex))

    const encryptKey = party === 'A' ? keyA : keyB
    const decryptKey = party === 'A' ? keyB : keyA

    this.encryptCipher = createRC4Cipher(encryptKey)
    this.decryptCipher = createRC4Cipher(decryptKey)
  }
}
