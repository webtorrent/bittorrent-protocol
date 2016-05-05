var Protocol = require('../')
var test = require('tape')

test('Extension.prototype.name', function (t) {
  t.plan(2)

  var wire = new Protocol()

  function NoNameExtension () {}
  t.throws(function () {
    wire.use(NoNameExtension)
  }, 'throws when Extension.prototype.name is undefined')

  function NamedExtension () {}
  NamedExtension.prototype.name = 'named_extension'
  t.doesNotThrow(function () {
    wire.use(NamedExtension)
  }, 'does not throw when Extension.prototype.name is defined')
})

test('Extension.onHandshake', function (t) {
  t.plan(4)

  function TestExtension () {}
  TestExtension.prototype.name = 'test_extension'
  TestExtension.prototype.onHandshake = function (infoHash, peerId, extensions) {
    t.equal(new Buffer(infoHash, 'hex').length, 20)
    t.equal(new Buffer(infoHash, 'hex').toString(), '01234567890123456789')
    t.equal(new Buffer(peerId, 'hex').length, 20)
    t.equal(new Buffer(peerId, 'hex').toString(), '12345678901234567890')
  }

  var wire = new Protocol()
  wire.on('error', t.fail)
  wire.pipe(wire)

  wire.use(TestExtension)

  wire.handshake(new Buffer('01234567890123456789'), new Buffer('12345678901234567890'))
})

test('Extension.onExtendedHandshake', function (t) {
  t.plan(3)

  function TestExtension (wire) {
    wire.extendedHandshake = {
      hello: 'world!'
    }
  }
  TestExtension.prototype.name = 'test_extension'
  TestExtension.prototype.onExtendedHandshake = function (handshake) {
    t.ok(handshake.m.test_extension, 'peer extended handshake includes extension name')
    t.equal(handshake.hello.toString(), 'world!', 'peer extended handshake includes extension-defined parameters')
  }

  var wire = new Protocol()  // incoming
  wire.pipe(wire)
  wire.on('error', t.fail)

  wire.once('handshake', function (infoHash, peerId, extensions) {
    t.equal(extensions.extended, true)
  })

  wire.use(TestExtension)

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')
})

test('Extension.onMessage', function (t) {
  t.plan(1)

  function TestExtension (wire) {
    this.wire = wire
  }
  TestExtension.prototype.name = 'test_extension'
  TestExtension.prototype.onMessage = function (message) {
    t.equal(message.toString(), 'hello world!', 'receives message sent with wire.extended()')
  }

  var wire = new Protocol()  // outgoing
  wire.pipe(wire)
  wire.on('error', t.fail)

  wire.use(TestExtension)

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')

  wire.once('extended', function () {
    wire.extended('test_extension', new Buffer('hello world!'))
  })
})
