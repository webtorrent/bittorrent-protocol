import Wire from './Wire';
import { Extension } from './Extension';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).Extension = Extension;
module.exports.Extension = Extension;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).Wire = Wire;
module.exports = Wire;
