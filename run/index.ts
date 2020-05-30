import Wire from '../';
import { Extension, ExtendedHandshake, HandshakeExtensions } from '../Extension';
import bencode from 'bencode';

const incomingWire = new Wire();
const outgoingWire = new Wire();

class NewExtension extends Extension {
  public name = 'new_extension';

  public onHandshake = (infoHash: string, peerId: string, extensions: HandshakeExtensions) => {
    console.log('New Handshake incoming', infoHash, peerId, extensions);
  };

  public onExtendedHandshake = (handshake: ExtendedHandshake) => {
    console.log('New Extended Handshake incoming', handshake);
  };

  public onMessage = (buf: Buffer) => {
    console.log('new Message incoming', bencode.decode(buf));
  };
}

outgoingWire.pipe(incomingWire).pipe(outgoingWire);

incomingWire.use(NewExtension);
outgoingWire.use(NewExtension);

incomingWire.on('handshake', (...data: unknown[]) => {
  console.log('Incoming handshake', data);
});

outgoingWire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930');
