var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;
var bncode = require('bncode');


inherits(MetadataExtension, process.EventEmitter);
function MetadataExtension(wire) {
    if (!(this instanceof MetadataExtension)) return new MetadataExtension();

    this.send = function(info, trailer) {
        var buf = bncode.encode(info);
        if (Buffer.isBuffer(trailer))
            buf = Buffer.concat(buf, trailer);
        wire.extended('ut_metadata', buf);
    };

    wire.on('extended-handshake', function(info) {
        var n = 1;
        for(var k in info.m) {
            if (info.m[k] >= n) {
                n = info.m[k] + 1;
            }
        }
        info.m.ut_metadata = n;
    });
    wire.on('extended', function(ext, buf) {
        var info;
        if (ext === 'handshake' &&
            buf.m.ut_metadata
           ) {
            this.metadataSize = buf.metadata_size;
            if (typeof this.metadataSize === 'number')  {
                this.emit('enabled', this.metadataSize);
            }
        } else if (ext === 'ut_metadata') {
            var decoder = new bncode.decoder();
            for(var i = 0; i < buf.length; i++) {
                decoder.decode(buf.slice(i, i + 1));
                try {
                    info = decoder.result()[0];
                    break;
                } catch (e) {
                    if (e.message !== "not in consistent state. More bytes coming?")
                        throw e;
                }
            }

            var trailer = (i < buf.length) &&
                buf.slice(i + 1);
            this._onMessage(info, trailer);
        }
    }.bind(this));
}
module.exports = MetadataExtension;

MetadataExtension.prototype.chunkSize = 16384;

MetadataExtension.prototype._onMessage = function(info, trailer) {
    switch(info.msg_type) {
    case 0:
        this.emit('request', info);
        break;
    case 1:
        this.emit('data', info, trailer);
        break;
    case 2:
        this.emit('reject', info);
        break;
    }
};

MetadataExtension.prototype.request = function(piece) {
    this.send({
        msg_type: 0,
        piece: piece
    });
};

MetadataExtension.prototype.data = function(piece, buf, totalSize) {
    var msg = {
        msg_type: 1,
        piece: piece
    };
    if (typeof totalSize === 'number') {
        msg.total_size = totalSize;
    }
    this.send(msg, buf);
};

MetadataExtension.prototype.reject = function(piece) {
    this.send({
        msg_type: 2,
        piece: piece
    });
};
