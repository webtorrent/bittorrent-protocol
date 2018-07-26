const Protocol = require('../')
const test = require('tape')

test('Handshake', t => {
  t.plan(4)

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)

  wire.on('handshake', (infoHash, peerId) => {
    t.equal(Buffer.from(infoHash, 'hex').length, 20)
    t.equal(Buffer.from(infoHash, 'hex').toString(), '01234567890123456789')
    t.equal(Buffer.from(peerId, 'hex').length, 20)
    t.equal(Buffer.from(peerId, 'hex').toString(), '12345678901234567890')
  })

  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))
})

test('Handshake (with string args)', t => {
  t.plan(4)

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)

  wire.on('handshake', (infoHash, peerId) => {
    t.equal(Buffer.from(infoHash, 'hex').length, 20)
    t.equal(Buffer.from(infoHash, 'hex').toString(), '01234567890123456789')
    t.equal(Buffer.from(peerId, 'hex').length, 20)
    t.equal(Buffer.from(peerId, 'hex').toString(), '12345678901234567890')
  })

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')
})

test('Asynchronous handshake + extended handshake', t => {
  const eventLog = []

  const wire1 = new Protocol() // outgoing
  const wire2 = new Protocol() // incoming
  wire1.pipe(wire2).pipe(wire1)
  wire1.on('error', err => { t.fail(err) })
  wire2.on('error', err => { t.fail(err) })

  wire1.on('handshake', (infoHash, peerId, extensions) => {
    eventLog.push('w1 hs')
    t.equal(Buffer.from(infoHash, 'hex').toString(), '01234567890123456789')
    t.equal(Buffer.from(peerId, 'hex').toString(), '12345678901234567890')
    t.equal(extensions.extended, true)
  })
  wire1.on('extended', (ext, obj) => {
    if (ext === 'handshake') {
      eventLog.push('w1 ex')
      t.ok(obj)

      // Last step: ensure handshakes came before extension protocol
      t.deepEqual(eventLog, ['w2 hs', 'w1 hs', 'w2 ex', 'w1 ex'])
      t.end()
    }
  })

  wire2.on('handshake', (infoHash, peerId, extensions) => {
    eventLog.push('w2 hs')
    t.equal(Buffer.from(infoHash, 'hex').toString(), '01234567890123456789')
    t.equal(Buffer.from(peerId, 'hex').toString(), '12345678901234567890')
    t.equal(extensions.extended, true)

    // Respond asynchronously
    process.nextTick(() => {
      wire2.handshake(infoHash, peerId)
    })
  })
  wire2.on('extended', (ext, obj) => {
    if (ext === 'handshake') {
      eventLog.push('w2 ex')
      t.ok(obj)
    }
  })

  wire1.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')
})

test('Unchoke', t => {
  t.plan(4)

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)
  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))

  t.ok(wire.amChoking)
  t.ok(wire.peerChoking)

  wire.on('unchoke', () => {
    t.ok(!wire.peerChoking)
  })

  wire.unchoke()
  t.ok(!wire.amChoking)
})

test('Interested', t => {
  t.plan(4)

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)
  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))

  t.ok(!wire.amInterested)
  t.ok(!wire.peerInterested)

  wire.on('interested', () => {
    t.ok(wire.peerInterested)
  })

  wire.interested()
  t.ok(wire.amInterested)
})

test('Request a piece', t => {
  t.plan(12)

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)
  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))

  t.equal(wire.requests.length, 0)
  t.equal(wire.peerRequests.length, 0)

  wire.on('request', (i, offset, length, callback) => {
    t.equal(wire.requests.length, 1)
    t.equal(wire.peerRequests.length, 1)
    t.equal(i, 0)
    t.equal(offset, 1)
    t.equal(length, 11)
    callback(null, Buffer.from('hello world'))
  })

  wire.once('unchoke', () => {
    t.equal(wire.requests.length, 0)
    wire.request(0, 1, 11, (err, buffer) => {
      t.equal(wire.requests.length, 0)
      t.ok(!err)
      t.equal(buffer.toString(), 'hello world')
    })
    t.equal(wire.requests.length, 1)
  })

  wire.unchoke()
})

test('No duplicate `have` events for same piece', t => {
  t.plan(6)

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')

  let haveEvents = 0
  wire.on('have', () => {
    haveEvents += 1
  })
  t.equal(haveEvents, 0)
  t.equal(!!wire.peerPieces.get(0), false)
  wire.have(0)
  process.nextTick(() => {
    t.equal(haveEvents, 1, 'emitted event for new piece')
    t.equal(!!wire.peerPieces.get(0), true)
    wire.have(0)
    process.nextTick(() => {
      t.equal(haveEvents, 1, 'not emitted event for preexisting piece')
      t.equal(!!wire.peerPieces.get(0), true)
    })
  })
})
