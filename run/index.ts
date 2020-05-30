import Wire from '../';
import { Extension, ExtendedHandshake, HandshakeExtensions } from '../Extension';
import bencode from 'bencode';

const incomingWire = new Wire('incomingWire');
const outgoingWire = new Wire('outgoingWire');

class NewExtension extends Extension {
  public name = 'new_extension';
  public requirePeer = false;

  public onHandshake = (infoHash: string, peerId: string, extensions: HandshakeExtensions) => {
    console.log(this.wire.wireName, 'NewExtension incoming', infoHash, peerId, extensions);
  };

  public onExtendedHandshake = (handshake: ExtendedHandshake) => {
    console.log(this.wire.wireName, 'NewExtension Extended Handshake incoming', handshake);
  };

  public onMessage = (buf: Buffer) => {
    console.log(this.wire.wireName, 'NewExtension incoming', bencode.decode(buf));
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class NewExtension2 extends Extension {
  public name = 'new_extension2';
  public requirePeer = true;

  public onHandshake = (infoHash: string, peerId: string, extensions: HandshakeExtensions) => {
    console.log(this.wire.wireName, 'NewExtension2 incoming', infoHash, peerId, extensions);
  };

  public onExtendedHandshake = (handshake: ExtendedHandshake) => {
    console.log(this.wire.wireName, 'NewExtension2 Extended Handshake incoming', handshake);
  };

  public onMessage = (buf: Buffer) => {
    console.log(this.wire.wireName, 'NewExtension2 incoming', bencode.decode(buf));
  };
}

outgoingWire.pipe(incomingWire).pipe(outgoingWire);

incomingWire.use(NewExtension);
outgoingWire.use(NewExtension);
outgoingWire.use(NewExtension2);
// incomingWire.use(NewExtension2);

incomingWire.on('handshake', (...data: unknown[]) => {
  console.log('{incomingWire} Incoming handshake from ', data);
  incomingWire.handshake('4444444444444444444430313233343536373839', '4444444444444444444430313233343536373839');
});

outgoingWire.on('handshake', (...data: unknown[]) => {
  console.log('{outgoingWire} Incoming handshake', data);
});

outgoingWire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930');
