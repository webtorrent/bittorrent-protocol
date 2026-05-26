import test from 'tape'
import Wire from '../index.js'
import { arr2hex, randomBytes } from 'uint8-util'

function setupWires (pe) {
  const infoHash = arr2hex(randomBytes(20))
  const wireA = new Wire('tcpOutgoing', pe)
  const wireB = new Wire('tcpIncoming', pe)
  wireA.pipe(wireB).pipe(wireA)

  if (!pe) return { wireA, wireB }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('handshake timeout')), 5000)
    wireB.once('crypto-infohash', () => wireB.setInfoHash(infoHash))
    let done = 0
    const onDone = () => { done++; if (done === 2) { clearTimeout(timeout); resolve({ wireA, wireB }) } }
    wireA.once('crypto-handshake', onDone)
    wireB.once('crypto-handshake', onDone)
    wireA.startEncryption(infoHash)
  })
}

// fresh payload per iteration — wire is zero-copy so reusing a single
// buffer gives unrealistically fast plain numbers
function benchPieces (wireA, wireB, sizes, iterations) {
  const results = []
  for (const size of sizes) {
    for (let i = 0; i < iterations; i++) wireB.read()
    const start = process.hrtime.bigint()
    for (let i = 0; i < iterations; i++) {
      wireA.piece(0, 0, randomBytes(size))
      wireB.read()
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    results.push({ size, ms, mbps: size * iterations / ms * 8 / 1000 })
  }
  return results
}

test('piece messages', async t => {
  const sizes = [1024, 16384, 65536, 262144]
  const iterations = 500

  const [enc, plain] = await Promise.all([
    setupWires(2),
    setupWires(0)
  ])
  const encR = benchPieces(enc.wireA, enc.wireB, sizes, iterations)
  const plainR = benchPieces(plain.wireA, plain.wireB, sizes, iterations)
  enc.wireA.destroy(); enc.wireB.destroy()
  plain.wireA.destroy(); plain.wireB.destroy()

  t.plan(sizes.length)
  for (let i = 0; i < sizes.length; i++) {
    const pct = ((encR[i].ms / plainR[i].ms) - 1) * 100
    t.ok(encR[i].ms > 0,
      `${sizes[i]} B: plain ${plainR[i].mbps.toFixed(0)} Mbps, ` +
      `enc ${encR[i].mbps.toFixed(0)} Mbps ` +
      `(+${pct.toFixed(0)}%)`)
  }
})

test('small control messages', async t => {
  const [enc, plain] = await Promise.all([
    setupWires(2),
    setupWires(0)
  ])

  const run = (wireA, wireB, count) => {
    for (let i = 0; i < count; i++) wireB.read()
    const start = process.hrtime.bigint()
    for (let i = 0; i < count; i++) {
      wireA.keepAlive()
      wireB.read()
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    return { ms, msgps: count / ms * 1000 }
  }

  const encR = run(enc.wireA, enc.wireB, 50000)
  const plainR = run(plain.wireA, plain.wireB, 50000)
  enc.wireA.destroy(); enc.wireB.destroy()
  plain.wireA.destroy(); plain.wireB.destroy()

  t.plan(1)
  const pct = ((encR.ms / plainR.ms) - 1) * 100
  t.ok(encR.ms > 0,
    `keepAlive: plain ${plainR.msgps.toFixed(0)} msg/s, ` +
    `enc ${encR.msgps.toFixed(0)} msg/s ` +
    `(+${pct.toFixed(2)}%)`)
})
