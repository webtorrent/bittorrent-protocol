const Protocol = require('../')
const test = require('tape')

test('Timeout and destroy when peer does not respond', t => {
  t.plan(4)

  let timeouts = 0

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)
  wire.setTimeout(1000)
  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))

  wire.on('unchoke', () => {
    wire.request(0, 0, 0, err => {
      t.ok(err)
    })

    wire.request(0, 0, 0, err => {
      t.ok(err)
    })

    wire.request(0, 0, 0, err => {
      t.ok(err)
    })
  })

  wire.on('timeout', () => {
    t.equal(++timeouts, 1)
    wire.end()
  })

  wire.unchoke()
})
