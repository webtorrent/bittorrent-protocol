import Wire from './index';

export type ExtendedHandshake = { [key: string]: any; };
export type HandshakeExtensions = { [name: string]: boolean; }

interface IExtension {
  wire: Wire;
  name: string;

  onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;
  onExtendedHandshake: (handshake: ExtendedHandshake) => void;
  onMessage: (buf: Buffer) => void;
}

export abstract class Extension implements IExtension {
  public  wire: Wire;
  public abstract name: string;
  
  constructor(wire: Wire) {
    this.wire = wire;
  }

  public abstract onHandshake: (infoHash: string, peerId: string, extensions: HandshakeExtensions) => void;

  public abstract onExtendedHandshake: (handshake: ExtendedHandshake) => void;

  public abstract onMessage: (buf: Buffer) => void;
}
