// Bundles the official Anthropic TypeScript SDK into one browser ES module for the
// extension (which has no build step):  extension/vendor/anthropic-sdk/anthropic-sdk.mjs
//   node scripts/vendor-anthropic-sdk.mjs [version]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.argv[2] || '1.3.0';
const ESBUILD = '0.25.12';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'extension/vendor/anthropic-sdk');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'jc-sdk-'));
try {
  writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'tmp', private: true, type: 'module' }));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', `@anthropic-ai/sdk@${VERSION}`, `esbuild@${ESBUILD}`], { cwd: tmp, stdio: 'inherit' });
  writeFileSync(path.join(tmp, 'entry.mjs'), "export { default } from '@anthropic-ai/sdk';\nexport * from '@anthropic-ai/sdk';\n");
  mkdirSync(out, { recursive: true });
  execFileSync(path.join(tmp, 'node_modules/.bin/esbuild'), ['entry.mjs', '--bundle', '--format=esm', '--platform=browser', '--minify', `--outfile=${path.join(out, 'anthropic-sdk.mjs')}`, '--legal-comments=eof'], { cwd: tmp, stdio: 'inherit' });
  copyFileSync(path.join(tmp, 'node_modules/@anthropic-ai/sdk/LICENSE'), path.join(out, 'LICENSE'));
  const pkg = JSON.parse(readFileSync(path.join(tmp, 'node_modules/@anthropic-ai/sdk/package.json'), 'utf8'));
  writeFileSync(path.join(out, 'README.txt'), `@anthropic-ai/sdk ${pkg.version} (${pkg.license}) https://github.com/anthropics/anthropic-sdk-typescript\nBundled with esbuild ${ESBUILD} by scripts/vendor-anthropic-sdk.mjs. Used only by the options page when the user\nturns on "Read my resume with Claude" with their own API key.\n`);
  console.log(`vendored @anthropic-ai/sdk ${pkg.version} -> ${path.relative(root, out)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
