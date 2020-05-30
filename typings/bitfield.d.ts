declare module 'bitfield' {
  export default class BitField {
    public grow: number;
    public buffer: Buffer;

    constructor(data?: number, opts?: { grow: number });

    public get(i: number): true;
    public set(i: number, b?: boolean): void;
  }
}
