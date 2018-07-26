const Protocol = require('../')
const test = require('tape')

test('No timeout when peer is good', t => {
  t.plan(3)

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)
  wire.setTimeout(1000)
  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))

  wire.on('unchoke', () => {
    wire.request(0, 0, 11, err => {
      t.error(err)
    })

    wire.request(0, 0, 11, err => {
      t.error(err)
    })

    wire.request(0, 0, 11, err => {
      t.error(err)
    })
  })

  wire.on('request', (i, offset, length, callback) => {
    callback(null, Buffer.from('hello world'))
  })

  // there should never be a timeout
  wire.on('timeout', () => {
    t.fail('Timed out')
  })

  wire.unchoke()
})
