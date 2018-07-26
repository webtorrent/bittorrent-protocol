const Protocol = require('../')
const test = require('tape')

test('Timeout when peer does not respond', t => {
  t.plan(9)

  let timeouts = 0

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)
  wire.setTimeout(1000)
  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))

  wire.on('unchoke', () => {
    let requests = 0

    wire.request(0, 0, 0, err => {
      t.ok(err)
      t.ok(++requests === 1)
    })

    wire.request(0, 0, 0, err => {
      t.ok(err)
      t.ok(++requests === 2)
    })

    wire.request(0, 0, 0, err => {
      t.ok(err)
      t.ok(++requests === 3)
    })
  })

  wire.on('timeout', () => {
    t.ok(++timeouts <= 3) // should get called 3 times
  })

  wire.unchoke()
})
