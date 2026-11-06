// Loads the extension's plain scripts into a sandbox so pure logic can be unit-tested.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension/src');

export function loadJC(files = ['shared/config.js', 'shared/profile-schema.js', 'shared/field-rules.js']) {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  return sandbox.JC;
}
