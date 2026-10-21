import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.');
const out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'public'), out, { recursive: true });
// Keep the original /public paths available to the editor preview iframe.
await cp(resolve(root, 'public'), resolve(out, 'public'), { recursive: true });
await cp(resolve(root, 'private-editor'), resolve(out, 'editor'), { recursive: true });
await cp(resolve(root, 'private-editor/admin.html'), resolve(out, 'editor/index.html'));
console.log('Built static site and editor into dist/.');
