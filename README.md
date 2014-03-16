# bittorrent-protocol
[![Build Status](http://img.shields.io/travis/feross/bittorrent-protocol.svg)](https://travis-ci.org/feross/bittorrent-protocol)
[![NPM Version](http://img.shields.io/npm/v/bittorrent-protocol.svg)](https://npmjs.org/package/bittorrent-protocol)
[![NPM](http://img.shields.io/npm/dm/bittorrent-protocol.svg)](https://npmjs.org/package/bittorrent-protocol)
[![Gittip](http://img.shields.io/gittip/feross.svg)](https://www.gittip.com/feross/)

### Simple, robust, BitTorrent wire protocol implementation

[![browser support](https://ci.testling.com/feross/bittorrent-protocol.png)](https://ci.testling.com/feross/bittorrent-protocol)

Node.js implementation of the [BitTorrent peer wire protocol](https://wiki.theory.org/BitTorrentSpecification#Peer_wire_protocol_.28TCP.29). The protocol is the main communication layer for BitTorrent file transfer.

Also works in the browser with [browserify](http://browserify.org/)! This module is used by [WebTorrent](http://webtorrent.io).

## install

```
npm install bittorrent-protocol
```

## usage

The protocol is implemented as a **duplex stream**, so all you have to do is pipe to and from it.

duplex streams | a.pipe(b).pipe(a)
---- | ---
![duplex streams](https://raw.github.com/substack/lxjs-stream-examples/master/images/duplex_streams.png) | ![a.pipe(b).pipe(a)](https://raw.github.com/substack/lxjs-stream-examples/master/images/a_pipe_b_pipe_a.png)

(Images from the ["harnessing streams"](https://github.com/substack/lxjs-stream-examples/blob/master/slides.markdown) talk by substack.)

```js
var Protocol = require('bittorrent-protocol')
var net = require('net')

net.createServer(function (socket) {
	var wire = new Protocol()

	// pipe to and from the protocol
	socket.pipe(wire).pipe(socket)

	wire.on('handshake', function (infoHash, peerId) {
		// lets emit a handshake of our own as well
		wire.handshake(new Buffer('my info hash'), new Buffer('my peer id'))
	})

	wire.on('unchoke', function () {
		console.log('peer is no longer choking us: ' + wire.peerChoking)
	})
}).listen(6881)
```

## methods

### handshaking

Send and receive a handshake from the peer. This is the first message.

```js
// send a handshake to the peer
wire.handshake(infoHash, peerId, { dht: true })
wire.on('handshake', function (infoHash, peerId, extensions) {
	// receive a handshake
})
```

Both the `infoHash` and the `peerId` should be 20 bytes (`Buffer` or hex-encoded `string`).

### choking

Check if you or the peer is choking.

```js
wire.peerChoking // is the peer choking us?
wire.amChoking // are we choking the peer?

wire.on('choke', function () {
	// the peer is now choking us
})
wire.on('unchoke', function () {
	// peer is no longer choking us
})
```

### interested

See if you or the peer is interested.

```js
wire.peerInterested // is the peer interested in us?
wire.amInterested // are we interested in the peer?

wire.on('interested', function () {
	// peer is now interested
})
wire.on('uninterested', function () {
	// peer is no longer interested
})
```

### bitfield

Exchange piece information with the peer.

```js
// send a bitfield to the peer
wire.bitfield(buffer)
wire.on('bitfield', function (bitfield) {
	// bitfield received from the peer
})

// send a have message indicating that you have a piece
wire.have(pieceIndex)
wire.on('have', function (pieceIndex) {
	// peer has sent you a have message
})
```

You can always see which pieces the peer has

```js
wire.peerPieces.get(i) // returns true if peer has piece i
```

`wire.peerPieces` is a `BitField`, see [docs](https://www.npmjs.org/package/bitfield).

### requests

Send and respond to requests for pieces.

```js
// request a block from a peer
wire.request(pieceIndex, offset, length, function (err, block) {
	if (err) {
		// there was an error (peer has started choking us etc)
		return
	}
	// got block
})

// cancel a request to a peer
wire.cancel(pieceIndex, offset, length)

// receive a request from a peer
wire.on('request', function (pieceIndex, offset, length, callback) {
	// ... read block ...
	callback(null, block) // respond back to the peer
})

wire.requests     // list of requests we currently have pending {piece, offset, length}
wire.peerRequests // list of requests the peer currently have pending {piece, offset, length}
```

You can set a request timeout if you want to.

```js
wire.setTimeout(5000) // head request should take a most 5s to finish
```

If the timeout is triggered the request callback is called with an error and a `timeout` event is emitted.

### dht and port

You can set the extensions flag `dht` in the handshake to `true` if you participate in the torrent dht.
Afterwards you can send your dht port.

```js
// send your port to the peer
wire.port(dhtPort)
wire.on('port', function (dhtPort) {
	// peer has sent a port to us
})
```

### keep-alive

You can enable the keep-alive ping (triggered every 60s).

```js
// starts the keep alive
wire.setKeepAlive(true)
wire.on('keep-alive', function () {
	// peer sent a keep alive - just ignore it
})
```

### transfer stats

Check how many bytes you have uploaded and download

```js
wire.uploaded // number of bytes uploaded
wire.downloaded // number of bytes downloaded

wire.on('download', function (numberOfBytes) {
	...
})
wire.on('upload', function (numberOfBytes) {
	...
})
```

## license

MIT. Copyright (c) [Feross Aboukhadijeh](http://feross.org).

Includes code from [peer-wire-protocol](https://github.com/mafintosh/peer-wire-protocol) by mafintosh, which is also MIT.
