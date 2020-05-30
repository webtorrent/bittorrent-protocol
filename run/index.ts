import Wire from '../';

const incomingWire = new Wire();
const outgoingWire = new Wire();

outgoingWire.pipe(incomingWire).pipe(outgoingWire);

incomingWire.on('handshake', (...data: any[]) => {
  console.log('Incoming handshake', data);
});

outgoingWire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930');
