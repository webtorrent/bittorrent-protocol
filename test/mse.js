import crypto from 'crypto'
import test from 'tape'
import Wire from '../index.js'
import { concat, arr2hex, arr2text, hex2arr, randomBytes, equal, text2arr } from 'uint8-util'
import { MessageStreamEncryptor } from '../mse.js'

const VC = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

function btHandshakeBuf (infoHash, peerId) {
  return concat([text2arr('\u0013BitTorrent protocol'), new Uint8Array(8), hex2arr(infoHash), hex2arr(peerId)])
}

function piped (levelA, levelB = levelA) {
  const wireA = new Wire('tcpOutgoing', levelA)
  const wireB = new Wire('tcpIncoming', levelB)
  wireA.pipe(wireB).pipe(wireA)
  return { wireA, wireB }
}

function startCrypto (wireA, wireB, infoHash) {
  wireB.once('crypto-infohash', () => wireB.setInfoHash(infoHash))
  wireA.startEncryption(infoHash)
}

function onBoth (wireA, wireB, event, fn) {
  let count = 0
  const cb = () => { count++; if (count === 2) fn() }
  wireA.once(event, cb)
  wireB.once(event, cb)
}

function hex (len = 20) { return arr2hex(randomBytes(len)) }

function fallbackTest (t, type, level, infoHash, peerId, setup) {
  const wire = new Wire(type, level)
  const handshake = btHandshakeBuf(infoHash, peerId)
  if (setup) setup(wire)
  wire.once('handshake', (gotIH, gotPI) => {
    t.equal(gotIH, infoHash, 'received peer infoHash')
    t.equal(gotPI, peerId, 'received peer peerId')
  })
  wire._write(handshake, () => { t.pass('handshake processed without error') })
  return wire
}

test('PE: wire-to-wire full handshake', t => {
  t.plan(2)

  const infoHash = hex()
  const { wireA, wireB } = piped(2)

  wireA.once('crypto-handshake', () => t.pass('initiator crypto handshake done'))
  wireB.once('crypto-handshake', () => t.pass('responder crypto handshake done'))

  startCrypto(wireA, wireB, infoHash)
})

test('PE: handshake state transitions', t => {
  t.plan(8)

  const infoHash = hex()
  const { wireA, wireB } = piped(2)

  t.equal(wireA._peState, 'idle', 'initiator starts idle')
  t.equal(wireB._peState, 'idle', 'responder starts idle')

  wireA.once('crypto-handshake', () => {
    t.equal(wireA._peState, 'done', 'initiator peState done')
    t.equal(wireA._encryptionMethod, 2, 'initiator using RC4')
    t.ok(wireA._cryptoHandshakeDone, 'initiator crypto handshake flagged')
  })

  wireB.once('crypto-handshake', () => {
    t.equal(wireB._peState, 'done', 'responder peState done')
    t.equal(wireB._encryptionMethod, 2, 'responder using RC4')
    t.ok(wireB._cryptoHandshakeDone, 'responder crypto handshake flagged')
  })

  startCrypto(wireA, wireB, infoHash)
})

test('PE: wire-to-wire with BT handshake exchange', t => {
  t.plan(4)

  const infoHash = hex()
  const peerIdA = hex()
  const peerIdB = hex()

  const { wireA, wireB } = piped(2)

  onBoth(wireA, wireB, 'crypto-handshake', () => {
    wireA.handshake(infoHash, peerIdA, { dht: false, fast: true })
    wireB.handshake(infoHash, peerIdB, { dht: false, fast: true })
  })

  wireA.once('handshake', (gotIH, gotPI) => {
    t.equal(gotIH, infoHash, 'initiator received correct infoHash')
    t.equal(gotPI, peerIdB, 'initiator received correct peerId')
  })

  wireB.once('handshake', (gotIH, gotPI) => {
    t.equal(gotIH, infoHash, 'responder received correct infoHash')
    t.equal(gotPI, peerIdA, 'responder received correct peerId')
  })

  startCrypto(wireA, wireB, infoHash)
})

test('PE: encrypted message exchange', t => {
  t.plan(4)

  const infoHash = hex()
  const peerIdA = hex()
  const peerIdB = hex()

  const { wireA, wireB } = piped(2)

  startCrypto(wireA, wireB, infoHash)

  onBoth(wireA, wireB, 'crypto-handshake', () => {
    wireA.handshake(infoHash, peerIdA, { dht: false, fast: true })
    wireB.handshake(infoHash, peerIdB, { dht: false, fast: true })
  })

  let gotHandshake = 0
  function onHandshake () {
    gotHandshake++
    if (gotHandshake < 2) return
    wireA.keepAlive()
    wireB.once('keep-alive', () => t.pass('wireB received keep-alive over encrypted channel'))
    wireB.keepAlive()
    wireA.once('keep-alive', () => t.pass('wireA received keep-alive over encrypted channel'))
  }
  wireA.once('handshake', (gotIH, gotPI) => {
    t.equal(gotIH, infoHash, 'initiator received correct infoHash')
    t.equal(gotPI, peerIdB, 'initiator received correct peerId')
    onHandshake()
  })
  wireB.once('handshake', onHandshake)
})

test('PE: crypto-infohash correct hash', t => {
  t.plan(3)

  const infoHash = hex()
  const expectedHashHash = arr2hex(crypto.createHash('sha1').update(concat([text2arr('req2'), hex2arr(infoHash)])).digest())
  const { wireA, wireB } = piped(2)

  wireB.once('crypto-infohash', ih => {
    t.equal(ih, expectedHashHash, 'crypto-infohash matches HASH(\'req2\', SKEY)')
    wireB.setInfoHash(infoHash)
  })

  wireA.once('crypto-handshake', () => t.pass('handshake completed'))
  wireB.once('crypto-handshake', () => t.pass('handshake completed'))

  wireA.startEncryption(infoHash)
})

test('PE: fallback without protocol encryption', t => {
  t.plan(4)

  const infoHash = hex()
  const peerIdA = hex()
  const peerIdB = hex()

  const { wireA, wireB } = piped(0)

  wireB.once('handshake', () => wireB.handshake(infoHash, peerIdB))
  wireA.once('handshake', (ih, pid) => {
    t.equal(ih, infoHash, 'initiator received handshake')
    t.equal(pid, peerIdB, 'initiator received correct peerId')
    t.equal(wireA._peState, 'idle', 'initiator peState stayed idle (no PE)')
    t.notOk(wireA._encryptor, 'initiator has no encryptor without PE')
  })

  wireA.handshake(infoHash, peerIdA)
})

test('PE: plaintext fallback without encryption', t => {
  t.plan(1)

  const infoHash = hex()
  const peerIdA = hex()
  const peerIdB = hex()

  const { wireA, wireB } = piped(0)

  wireB.once('handshake', () => wireB.handshake(infoHash, peerIdB))
  wireA.once('handshake', () => t.pass('handshake succeeded without PE'))

  wireA.handshake(infoHash, peerIdA)
})

const MESSAGE_PROTOCOL = text2arr('\u0013BitTorrent protocol')

test('PE: MessageStreamEncryptor key exchange and encrypt/decrypt', t => {
  const infoHash = hex()

  const initEnc = new MessageStreamEncryptor(infoHash)
  const respEnc = new MessageStreamEncryptor(infoHash)

  const step1 = initEnc.generateStepA1()
  t.ok(step1.length >= 96, 'step1 (Ya + padA) >= 96 bytes')

  respEnc.handleStepB1(step1)
  const step2 = respEnc.generateStepB2()
  t.ok(step2.length >= 96, 'step2 (Yb + padB) >= 96 bytes')
  t.ok(respEnc.S, 'responder computed shared secret S')
  t.ok(respEnc.dh, 'responder has DH keys')

  initEnc.handleStepA2(step2)
  t.ok(initEnc.S, 'initiator computed shared secret S')
  t.ok(initEnc.encryptCipher, 'initiator initialized encrypt cipher')
  t.ok(initEnc.decryptCipher, 'initiator initialized decrypt cipher')

  const step3 = initEnc.generateStepA3()
  t.ok(step3.length >= 40, 'step3 (req1 + xor + encrypted) >= 40 bytes')

  respEnc.skeyHex = infoHash
  respEnc._initializeCiphers('B')

  // Manually process step3 using production methods
  const syncPattern = respEnc.getSyncPattern()
  const syncIndex = Buffer.from(step3).indexOf(syncPattern)
  t.notEqual(syncIndex, -1, 'sync pattern found in step3')

  const xorPart = step3.slice(syncIndex + 20, syncIndex + 40)
  const infoHashHash = respEnc.extractInfoHashFromXor(xorPart)
  t.equal(typeof infoHashHash, 'string', 'infoHashHash is a hex string')
  t.equal(infoHashHash.length, 40, 'infoHashHash is 40 hex chars')

  const encryptedRest = step3.slice(syncIndex + 40)
  const decrypted = respEnc.decryptCipher(encryptedRest)
  const vc = decrypted.slice(0, 8)
  t.ok(equal(vc, VC), 'responder VC verification passed')

  const cryptoProvide = (decrypted[8] << 24) | (decrypted[9] << 16) | (decrypted[10] << 8) | decrypted[11]
  t.ok((cryptoProvide & 0x02) !== 0, 'RC4 crypto method provided')
  respEnc._isEncrypted = true

  const step4 = respEnc.generateStepB4()
  t.ok(step4.length >= 14, 'step4 (encrypted VC + select + len(padD) + padD) >= 14 bytes')

  const decStep4 = initEnc.decryptCipher(step4)
  const vc4 = decStep4.slice(0, 8)
  t.ok(equal(vc4, VC), 'initiator VC verification passed')
  const selectedCrypto = (decStep4[8] << 24) | (decStep4[9] << 16) | (decStep4[10] << 8) | decStep4[11]
  t.equal(selectedCrypto, 0x02, 'initiator got RC4 selection')
  const padDLen = (decStep4[12] << 8) | decStep4[13]
  t.equal(typeof padDLen, 'number', 'initiator processed step4, got padD length')
  initEnc._isEncrypted = true

  const plaintext = new Uint8Array([1, 2, 3, 4, 5])
  const encrypted = respEnc.encrypt(new Uint8Array(plaintext))
  t.notOk(equal(encrypted, plaintext), 'encrypted data differs from plaintext')
  const decrypted2 = initEnc.decrypt(encrypted)
  t.ok(equal(decrypted2, plaintext), 'decrypted data matches original plaintext')

  t.end()
})

test('PE: handshake embedded in IA payload', t => {
  const infoHash = hex()
  const peerId = hex()
  const infoHashBytes = hex2arr(infoHash)
  const peerIdBytes = hex2arr(peerId)

  const initEnc = new MessageStreamEncryptor(infoHash)
  const respEnc = new MessageStreamEncryptor(infoHash)

  const step1 = initEnc.generateStepA1()
  respEnc.handleStepB1(step1)
  const step2 = respEnc.generateStepB2()
  initEnc.handleStepA2(step2)

  const btHandshake = concat([
    MESSAGE_PROTOCOL,
    new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    infoHashBytes,
    peerIdBytes
  ])

  // Build step3 manually with embedded IA (production never embeds IA,
  // but the responder must handle it when received)
  const req1Hash = crypto.createHash('sha1').update(concat([text2arr('req1'), initEnc.S])).digest()
  const req2Hash = crypto.createHash('sha1').update(concat([text2arr('req2'), hex2arr(infoHash)])).digest()
  const req3Hash = crypto.createHash('sha1').update(concat([text2arr('req3'), initEnc.S])).digest()
  const xorHash = new Uint8Array(20)
  for (let i = 0; i < 20; i++) xorHash[i] = req2Hash[i] ^ req3Hash[i]

  const cryptoProvideBuf = new Uint8Array([0x00, 0x00, 0x00, 0x03]) // RC4 + plaintext
  const padC = randomBytes(Math.floor(Math.random() * 513))
  const lenPadC = new Uint8Array([(padC.length >> 8) & 0xff, padC.length & 0xff])
  const lenIA = new Uint8Array([(btHandshake.length >> 8) & 0xff, btHandshake.length & 0xff])
  const plaintext = concat([VC, cryptoProvideBuf, lenPadC, padC, lenIA])
  const encryptedPart = initEnc.encryptCipher(plaintext)
  const encryptedIA = initEnc.encryptCipher(btHandshake)
  const step3 = concat([req1Hash, xorHash, encryptedPart, encryptedIA])

  respEnc.skeyHex = infoHash
  respEnc._initializeCiphers('B')

  // Process step3 using production methods
  const syncPattern = respEnc.getSyncPattern()
  const syncIndex = Buffer.from(step3).indexOf(syncPattern)
  t.notEqual(syncIndex, -1, 'sync pattern found in step3')

  const encryptedRest = step3.slice(syncIndex + 40)
  const decrypted = respEnc.decryptCipher(encryptedRest)
  const vc = decrypted.slice(0, 8)
  t.ok(equal(vc, VC), 'responder VC verification passed')

  const padCLen = (decrypted[12] << 8) | decrypted[13]
  const iaLenOffset = 14 + padCLen
  const iaLen = (decrypted[iaLenOffset] << 8) | decrypted[iaLenOffset + 1]
  const ia = decrypted.slice(iaLenOffset + 2, iaLenOffset + 2 + iaLen)

  t.ok(ia.length > 0, 'IA payload is non-empty')
  t.equal(ia[0], 19, 'IA starts with pstrlen=19')
  t.equal(arr2text(ia.slice(1, 20)), 'BitTorrent protocol', 'IA contains BT handshake protocol')
  t.equal(arr2hex(ia.slice(28, 48)), infoHash, 'IA contains correct infoHash')
  t.equal(arr2hex(ia.slice(48, 68)), peerId, 'IA contains correct peerId')

  t.end()
})

test('PE: method 1 plaintext (peEnabled=1) handshake and message exchange', t => {
  t.plan(8)

  const infoHash = hex()
  const peerIdA = hex()
  const peerIdB = hex()

  const { wireA, wireB } = piped(1)

  onBoth(wireA, wireB, 'crypto-handshake', () => {
    t.equal(wireA._encryptionMethod, 1, 'initiator encryption method 1')
    t.equal(wireB._encryptionMethod, 1, 'responder encryption method 1')
    t.notOk(wireA._encryptor._isEncrypted, 'initiator data not encrypted')
    t.notOk(wireB._encryptor._isEncrypted, 'responder data not encrypted')
    wireA.handshake(infoHash, peerIdA, { dht: false })
    wireB.handshake(infoHash, peerIdB, { dht: false })
  })

  let gotHandshake = 0
  function onHandshake () {
    gotHandshake++
    if (gotHandshake < 2) return
    wireA.keepAlive()
    wireB.once('keep-alive', () => t.pass('wireB received keep-alive over method 1'))
    wireB.keepAlive()
    wireA.once('keep-alive', () => t.pass('wireA received keep-alive over method 1'))
  }
  wireA.once('handshake', (gotIH, gotPI) => {
    t.equal(gotIH, infoHash, 'initiator received correct infoHash (method 1)')
    t.equal(gotPI, peerIdB, 'initiator received correct peerId (method 1)')
    onHandshake()
  })
  wireB.once('handshake', onHandshake)

  startCrypto(wireA, wireB, infoHash)
})

test('PE: _detectHandshakeOrPe: byte 0x13 + non-BT-protocol goes to PE path (responder)', t => {
  t.plan(2)

  // tcpIncoming with peEnabled=2 -> handleIncoming() -> _detectHandshakeOrPe
  const responder = new Wire('tcpIncoming', 2)
  t.equal(responder._peState, 'idle', 'responder starts idle')

  // First byte = 0x13 (19), remaining 95 bytes = random.
  // _detectHandshakeOrPe checks the full 20-byte string,
  // so 'BitTorrent protocol' must NOT match -> PE path.
  const fakeYa = concat([new Uint8Array([19]), randomBytes(95)])
  responder._write(fakeYa, () => {
    // PE path: handleStepB1 + generateStepB2 -> state = 'sentPe2'
    t.equal(responder._peState, 'sentPe2', 'responder treated data as PE, not handshake')
  })
})

test('PE: _detectHandshakeOrPe: byte 0x13 + non-BT-protocol goes to PE path (initiator)', t => {
  t.plan(3)

  const infoHash = hex()
  const initiator = new Wire('tcpOutgoing', 2)

  // Step 1: send pe1 (startEncryption throws if !_peEnabled)
  initiator.startEncryption(infoHash)
  t.equal(initiator._peState, 'sentPe1', 'initiator sent step1')
  t.equal(initiator._encryptor.skeyHex, infoHash, 'infoHash set')

  // Fake step2: first byte = 0x13 but NOT "BitTorrent protocol"
  // Must go to PE path (handleStepA2, not plaintext fallback)
  const fakeYb = concat([new Uint8Array([19]), randomBytes(95)])
  initiator._write(fakeYb, () => {
    // PE path: handleStepA2 computes S, then _advanceEncryption
    // sends step3 -> state = 'sentPe3'
    t.equal(initiator._peState, 'sentPe3', 'initiator treated data as step2, not plaintext fallback')
  })
})

test('PE: constructor peEnabled accepts 0, 1, 2', t => {
  t.plan(4)

  t.equal(new Wire('tcpOutgoing', 0)._peEnabled, 0, '0 => 0')
  t.equal(new Wire('tcpOutgoing', 1)._peEnabled, 1, '1 => 1')
  t.equal(new Wire('tcpOutgoing', 2)._peEnabled, 2, '2 => 2')
  t.equal(new Wire('tcpOutgoing')._peEnabled, 0, 'default => 0')
})

test('PE: outgoing fallback to plaintext when peer sends handshake instead of pe2', t => {
  t.plan(4)

  const infoHash = hex()
  const peerId = hex()

  fallbackTest(t, 'tcpOutgoing', 1, infoHash, peerId, wire => {
    wire.once('crypto-handshake', () => t.pass('crypto-handshake emitted on plaintext fallback'))
  })
})

test('PE: mixed levels 2->1 — init offers RC4 only, responder prefers plaintext -> method 2', t => {
  t.plan(6)

  const infoHash = hex()
  const peerIdA = hex()
  const peerIdB = hex()

  const { wireA, wireB } = piped(2, 1)

  onBoth(wireA, wireB, 'crypto-handshake', () => {
    t.equal(wireA._encryptionMethod, 2, 'initiator method 2')
    t.equal(wireB._encryptionMethod, 2, 'responder method 2')
    t.ok(wireA._encryptor._isEncrypted, 'initiator data encrypted')
    t.ok(wireB._encryptor._isEncrypted, 'responder data encrypted')
    wireA.handshake(infoHash, peerIdA, { dht: false })
    wireB.handshake(infoHash, peerIdB, { dht: false })
  })

  wireA.once('handshake', (gotIH, gotPI) => {
    t.equal(gotIH, infoHash, 'initiator correct infoHash')
    t.equal(gotPI, peerIdB, 'initiator correct peerId')
  })

  startCrypto(wireA, wireB, infoHash)
})

test('PE: mixed levels 1->2 — init offers both, respondent prefers RC4 -> method 2', t => {
  t.plan(6)

  const infoHash = hex()
  const peerIdA = hex()
  const peerIdB = hex()

  const { wireA, wireB } = piped(1, 2)

  onBoth(wireA, wireB, 'crypto-handshake', () => {
    t.equal(wireA._encryptionMethod, 2, 'initiator method 2')
    t.equal(wireB._encryptionMethod, 2, 'responder method 2')
    t.ok(wireA._encryptor._isEncrypted, 'initiator data encrypted')
    t.ok(wireB._encryptor._isEncrypted, 'responder data encrypted')
    wireA.handshake(infoHash, peerIdA, { dht: false })
    wireB.handshake(infoHash, peerIdB, { dht: false })
  })

  wireA.once('handshake', (gotIH, gotPI) => {
    t.equal(gotIH, infoHash, 'initiator correct infoHash')
    t.equal(gotPI, peerIdB, 'initiator correct peerId')
  })

  startCrypto(wireA, wireB, infoHash)
})

test('PE: mixed levels 2->0 — init tries PE, peer sends plaintext handshake -> fallback', t => {
  t.plan(4)

  const infoHash = hex()
  const peerId = hex()

  fallbackTest(t, 'tcpOutgoing', 2, infoHash, peerId, wire => {
    wire.once('crypto-handshake', () => t.pass('crypto-handshake emitted on plaintext fallback'))
  })
})

test('PE: mixed levels 0->2 — init sends BT handshake, responder detects plaintext -> fallback', t => {
  t.plan(3)

  const infoHash = hex()
  const peerId = hex()

  fallbackTest(t, 'tcpIncoming', 2, infoHash, peerId)
})

test('PE: mixed levels 1->0 — init tries PE, peer sends plaintext handshake -> fallback', t => {
  t.plan(4)

  const infoHash = hex()
  const peerId = hex()

  fallbackTest(t, 'tcpOutgoing', 1, infoHash, peerId, wire => {
    wire.once('crypto-handshake', () => t.pass('crypto-handshake emitted on plaintext fallback'))
  })
})

test('PE: mixed levels 0->1 — init sends BT handshake, responder detects plaintext -> fallback', t => {
  t.plan(3)

  const infoHash = hex()
  const peerId = hex()

  fallbackTest(t, 'tcpIncoming', 1, infoHash, peerId)
})
