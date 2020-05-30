import Wire from './index';

export type ExtendedHandshakeMessageParams = { [key: string]: any };

/**
 * http://www.bittorrent.org/beps/bep_0010.html
 */
export type ExtendedHandshake = {
  m?: { [name: string]: number };
} & ExtendedHandshakeMessageParams;

export type HandshakeExtensions = { [name: string]: boolean };

interface IExtension {
  wire: Wire;
  name: string;
  requirePeer: boolean;

  onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;
  onExtendedHandshake: (handshake: ExtendedHandshake) => void;
  onMessage: (buf: Buffer) => void;
}

export abstract class Extension implements IExtension {
  public wire: Wire;
  public abstract name: string;
  public abstract requirePeer: boolean;

  constructor(wire: Wire) {
    this.wire = wire;
  }

  public abstract onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;

  public abstract onExtendedHandshake: (handshake: ExtendedHandshake) => void;

  public abstract onMessage: (buf: Buffer) => void;
}
