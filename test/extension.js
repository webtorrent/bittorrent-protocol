const Protocol = require('../')
const test = require('tape')

test('Extension.prototype.name', t => {
  t.plan(2)

  const wire = new Protocol()

  function NoNameExtension () {}
  t.throws(() => {
    wire.use(NoNameExtension)
  }, 'throws when Extension.prototype.name is undefined')

  function NamedExtension () {}
  NamedExtension.prototype.name = 'named_extension'
  t.doesNotThrow(() => {
    wire.use(NamedExtension)
  }, 'does not throw when Extension.prototype.name is defined')
})

test('Extension.onHandshake', t => {
  t.plan(4)

  function TestExtension () {}
  TestExtension.prototype.name = 'test_extension'
  TestExtension.prototype.onHandshake = (infoHash, peerId, extensions) => {
    t.equal(Buffer.from(infoHash, 'hex').length, 20)
    t.equal(Buffer.from(infoHash, 'hex').toString(), '01234567890123456789')
    t.equal(Buffer.from(peerId, 'hex').length, 20)
    t.equal(Buffer.from(peerId, 'hex').toString(), '12345678901234567890')
  }

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)

  wire.use(TestExtension)

  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))
})

test('Extension.onExtendedHandshake', t => {
  t.plan(3)

  function TestExtension (wire) {
    wire.extendedHandshake = {
      hello: 'world!'
    }
  }
  TestExtension.prototype.name = 'test_extension'
  TestExtension.prototype.onExtendedHandshake = handshake => {
    t.ok(handshake.m.test_extension, 'peer extended handshake includes extension name')
    t.equal(handshake.hello.toString(), 'world!', 'peer extended handshake includes extension-defined parameters')
  }

  const wire = new Protocol() // incoming
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)

  wire.once('handshake', (infoHash, peerId, extensions) => {
    t.equal(extensions.extended, true)
  })

  wire.use(TestExtension)

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')
})

test('Extension.onMessage', t => {
  t.plan(1)

  class TestExtension {
    constructor (wire) {
      this.wire = wire
    }

    onMessage (message) {
      t.equal(message.toString(), 'hello world!', 'receives message sent with wire.extended()')
    }
  }

  TestExtension.prototype.name = 'test_extension'

  const wire = new Protocol() // outgoing
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)

  wire.use(TestExtension)

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930')

  wire.once('extended', () => {
    wire.extended('test_extension', Buffer.from('hello world!'))
  })
})
