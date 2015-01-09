var Protocol = require('../')
var test = require('tape')

test('Handshake', function (t) {
  t.plan(4)

  var wire = new Protocol()
  wire.pipe(wire)

  wire.on('handshake', function (infoHash, peerId) {
    t.equal(infoHash.length, 20)
    t.equal(infoHash.toString(), '01234567890123456789')
    t.equal(peerId.length, 20)
    t.equal(peerId.toString(), '12345678901234567890')
  })

  wire.handshake(new Buffer('01234567890123456789'), new Buffer('12345678901234567890'))
})

test('Handshake (with string args)', function (t) {
  t.plan(4)

  var wire = new Protocol()
  wire.pipe(wire)

  wire.on('handshake', function (infoHash, peerId) {
    t.equal(infoHash.length, 20)
    t.equal(infoHash.toString(), '01234567890123456789')
    t.equal(peerId.length, 20)
    t.equal(peerId.toString(), '12345678901234567890')
  })

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')
})

test('Unchoke', function (t) {
  t.plan(4)

  var wire = new Protocol()
  wire.pipe(wire)
  wire.handshake(new Buffer('01234567890123456789'), new Buffer('12345678901234567890'))

  t.ok(wire.amChoking)
  t.ok(wire.peerChoking)

  wire.on('unchoke', function () {
    t.ok(!wire.peerChoking)
  })

  wire.unchoke()
  t.ok(!wire.amChoking)
})

test('Interested', function (t) {
  t.plan(4)

  var wire = new Protocol()
  wire.pipe(wire)
  wire.handshake(new Buffer('01234567890123456789'), new Buffer('12345678901234567890'))

  t.ok(!wire.amInterested)
  t.ok(!wire.peerInterested)

  wire.on('interested', function () {
    t.ok(wire.peerInterested)
  })

  wire.interested()
  t.ok(wire.amInterested)
})

test('Request a piece', function (t) {
  t.plan(12)

  var wire = new Protocol()
  wire.pipe(wire)
  wire.handshake(new Buffer('01234567890123456789'), new Buffer('12345678901234567890'))

  t.equal(wire.requests.length, 0)
  t.equal(wire.peerRequests.length, 0)

  wire.on('request', function (i, offset, length, callback) {
    t.equal(wire.requests.length, 1)
    t.equal(wire.peerRequests.length, 1)
    t.equal(i, 0)
    t.equal(offset, 1)
    t.equal(length, 11)
    callback(null, new Buffer('hello world'))
  })

  wire.once('unchoke', function () {
    t.equal(wire.requests.length, 0)
    wire.request(0, 1, 11, function (err, buffer) {
      t.equal(wire.requests.length, 0)
      t.ok(!err)
      t.equal(buffer.toString(), 'hello world')
    })
    t.equal(wire.requests.length, 1)
  })

  wire.unchoke()
})

test('No duplicate `have` events for same piece', function (t) {
  t.plan(6)

  var wire = new Protocol()
  wire.pipe(wire)

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')

  var haveEvents = 0
  wire.on('have', function () {
    haveEvents += 1
  })
  t.equal(haveEvents, 0)
  t.equal(!!wire.peerPieces.get(0), false)
  wire.have(0)
  process.nextTick(function () {
    t.equal(haveEvents, 1, 'emitted event for new piece')
    t.equal(!!wire.peerPieces.get(0), true)
    wire.have(0)
    process.nextTick(function () {
      t.equal(haveEvents, 1, 'not emitted event for preexisting piece')
      t.equal(!!wire.peerPieces.get(0), true)
    })
  })
})
