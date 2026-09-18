/**
 * Bundles the action.
 *
 * The entrypoint is dependency-free CommonJS, so bundling is a copy — but it
 * is a copy with a check: the file must parse, or CI ships a broken action.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, 'src/index.js');
const target = resolve(here, 'dist/index.js');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);

// Fail loudly if the bundle is not loadable JavaScript.
new Function(readFileSync(target, 'utf8'));
console.log(`bundled action -> ${target}`);
