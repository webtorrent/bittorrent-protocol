import Wire from '../';
import test from 'tape';
import { Extension, HandshakeExtensions, ExtendedHandshake } from '../src/Extension';

test('Extension.prototype.name', (t) => {
  t.plan(2);

  const wire = new Wire();

  class NoNameExtension extends Extension {
    public name: string;
    public requirePeer = false;
    public onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;
    public onExtendedHandshake: (handshake: ExtendedHandshake) => void;
    public onMessage: (buf: Buffer) => void;
  }

  t.throws(() => {
    wire.use(NoNameExtension);
  }, 'throws when Extension.name is undefined');

  class NamedExtension extends Extension {
    public name = 'named_extension';
    public requirePeer = false;

    public onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;
    public onExtendedHandshake: (handshake: ExtendedHandshake) => void;
    public onMessage: (buf: Buffer) => void;
  }

  t.doesNotThrow(() => {
    wire.use(NamedExtension);
  }, 'does not throw when Extension.prototype.name is defined');
});

test('Extension.onHandshake', (t) => {
  t.plan(4);

  class TestExtension extends Extension {
    public name = 'test_extension';
    public requirePeer = false;

    public onHandshake = (infoHash: string, peerId: string): void => {
      t.equal(Buffer.from(infoHash, 'hex').length, 20);
      t.equal(Buffer.from(infoHash, 'hex').toString(), '01234567890123456789');
      t.equal(Buffer.from(peerId, 'hex').length, 20);
      t.equal(Buffer.from(peerId, 'hex').toString(), '12345678901234567890');
    };

    public onExtendedHandshake: (handshake: ExtendedHandshake) => void;
    public onMessage: (buf: Buffer) => void;
  }

  const wire = new Wire();

  wire.on('error', (err) => {
    t.fail(err);
  });
  wire.pipe(wire);

  wire.use(TestExtension);

  wire.handshake(Buffer.from('01234567890123456789'), Buffer.from('12345678901234567890'), undefined);
});

test('Extension.onExtendedHandshake', (t) => {
  t.plan(4);

  class TestExtension extends Extension {
    public name = 'test_extension';
    public requirePeer = undefined;

    constructor(wire: Wire) {
      super(wire);

      wire.extendedHandshake = {
        hello: 'world!'
      };
    }

    public onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;

    public onExtendedHandshake = (handshake: ExtendedHandshake): void => {
      t.ok(handshake.m, 'm field should be populated in Extended handshake');
      t.ok(handshake.m?.test_extension, 'peer extended handshake includes extension name');
      t.equal(handshake.hello.toString(), 'world!', 'peer extended handshake includes extension-defined parameters');
    };

    public onMessage: (buf: Buffer) => void;
  }

  const wire = new Wire(); // incoming
  wire.on('error', (err) => {
    t.fail(err);
  });
  wire.pipe(wire);

  wire.once('handshake', (infoHash, peerId, extensions) => {
    console.log(extensions);
    t.equal(extensions.extended, true);
  });

  wire.use(TestExtension);

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930', undefined);
});

test('Wire destroyed on Extension with requirePeer true', (t) => {
  t.plan(2);

  class TestExtension extends Extension {
    public name = 'test_extension';
    public requirePeer = true;

    public onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;

    public onExtendedHandshake: (handshake: ExtendedHandshake) => void;

    public onMessage: (buf: Buffer) => void;
  }

  const incomingWire = new Wire('incomingWire');
  const outgoingWire = new Wire('outgoingWire');

  outgoingWire.pipe(incomingWire).pipe(outgoingWire);

  incomingWire.use(TestExtension);

  incomingWire.on('handshake', (...data: unknown[]) => {
    incomingWire.handshake('4444444444444444444430313233343536373839', '4444444444444444444430313233343536373839');
  });

  incomingWire.on('destroy-required-extension', (reason: string) => {
    t.true(incomingWire.destroy);
    t.equals(reason, `Connected peer did not have the same extension: test_extension`);
  });

  outgoingWire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930');
});

test('Extension.onMessage', (t) => {
  t.plan(1);

  class TestExtension extends Extension {
    public name = 'test_extension';
    public requirePeer = false;

    public onMessage = (message: Buffer): void => {
      t.equal(message.toString(), 'hello world!', 'receives message sent with wire.extended()');
    };

    public onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;
    public onExtendedHandshake: (handshake: ExtendedHandshake) => void;
  }

  const wire = new Wire(); // outgoing
  wire.on('error', (err) => {
    t.fail(err);
  });
  wire.pipe(wire);

  wire.use(TestExtension);

  wire.handshake('3031323334353637383930313233343536373839', '3132333435363738393031323334353637383930', undefined);

  wire.once('extended', () => {
    wire.extended('test_extension', Buffer.from('hello world!'));
  });
});
