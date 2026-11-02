// Runs after `vite build`: scrambles the bundled JavaScript so the demo is hard
// to read or reuse. The app works exactly the same.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';

const dir = path.resolve('dist/assets');
const files = readdirSync(dir).filter(f => f.endsWith('.js'));

if (!process.env.DEMO_ALLOWED_HOSTS) {
  console.warn('\n  ! DEMO_ALLOWED_HOSTS is not set: this build will run on any website.\n' +
    '    Set it in Vercel (Settings → Environment Variables) to your demo address, e.g. fastener-erp-demo.vercel.app\n');
}

for (const file of files) {
  const full = path.join(dir, file);
  const code = readFileSync(full, 'utf8');
  const out = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    target: 'browser',
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.6,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: true,
    sourceMap: false,
  }).getObfuscatedCode();
  writeFileSync(full, out);
  console.log(`  protected ${file}  ${(code.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB`);
}
