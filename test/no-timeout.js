var Protocol = require('../')
var test = require('tape')

test('No timeout when peer is good', function (t) {
  t.plan(6)

  var wire = new Protocol()
  wire.pipe(wire)
  wire.setTimeout(1000)
  wire.handshake(new Buffer('01234567890123456789'), new Buffer('12345678901234567890'))

  wire.on('unchoke', function () {
    var requests = 0

    wire.request(0, 0, 11, function (err) {
      t.error(err)
      t.ok(++requests === 1)
    })

    wire.request(0, 0, 11, function (err) {
      t.error(err)
      t.ok(++requests === 2)
    })

    wire.request(0, 0, 11, function (err) {
      t.error(err)
      t.ok(++requests === 3)
    })
  })

  wire.on('request', function (i, offset, length, callback) {
    callback(null, new Buffer('hello world'))
  })

  // there should never be a timeout
  wire.on('timeout', function () {
    t.fail('Timed out')
  })

  wire.unchoke()
})
