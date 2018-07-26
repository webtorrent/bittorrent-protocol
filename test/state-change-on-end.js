const Protocol = require('../')
const test = require('tape')

test('State changes correctly on wire \'end\'', t => {
  t.plan(11)

  const wire = new Protocol()
  wire.on('error', err => { t.fail(err) })
  wire.pipe(wire)

  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'))

  t.ok(wire.amChoking)
  t.ok(wire.peerChoking)

  wire.on('unchoke', () => {
    t.ok(!wire.amChoking)
    t.ok(!wire.peerChoking)
    wire.interested()
  })

  wire.on('interested', () => {
    t.ok(wire.peerInterested)
    destroy()
  })

  function destroy () {
    wire.on('choke', () => {
      t.pass('wire got choke event')
    })
    wire.on('uninterested', () => {
      t.pass('wire got uninterested event')
    })

    wire.on('end', () => {
      t.ok(wire.peerChoking)
      t.ok(!wire.peerInterested)
    })

    wire.on('finish', () => {
      t.ok(wire.peerChoking)
      t.ok(!wire.peerInterested)
    })

    wire.destroy()
  }

  wire.unchoke()
})
