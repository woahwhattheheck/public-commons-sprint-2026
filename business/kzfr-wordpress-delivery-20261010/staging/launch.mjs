import { runCLI } from '@wp-playground/cli';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const blueprint = JSON.parse(await readFile(resolve(here, 'blueprint.json'), 'utf8'));
const checkEditor = process.argv.includes('--check-editor');
if (checkEditor) blueprint.login = false;
const server = await runCLI({
  command: 'server', wp: '6.8.3', php: '8.3', workers: 2,
  port: Number(process.env.KZFR_STAGE_PORT || 9413), login: !checkEditor,
  blueprint,
  mount: [
    { hostPath: resolve(root, 'plugin/kzfr-editorial-bridge'), vfsPath: '/wordpress/wp-content/plugins/kzfr-editorial-bridge' },
    { hostPath: resolve(root, 'theme/kzfr-community-radio'), vfsPath: '/wordpress/wp-content/themes/kzfr-community-radio' },
  ],
});
let disposed = false;
async function close() { if (!disposed) { disposed = true; await server[Symbol.asyncDispose](); } }
process.once('SIGINT', () => close());
process.once('SIGTERM', () => close());
try {
  const seed = await server.playground.run({ code: await readFile(resolve(here, 'seed.php'), 'utf8') });
  if (seed.exitCode !== 0) throw new Error(seed.errors || seed.text);
  console.log('Disposable station ready:', seed.text);
  console.log('Open', server.serverUrl, 'and /wp-admin/ to edit the fictional demo records.');
  if (checkEditor) {
    const result = await server.playground.run({ code: await readFile(resolve(here, 'verify-editor.php'), 'utf8') });
    if (result.exitCode !== 0) throw new Error(result.errors || result.text);
    const report = JSON.parse(result.text);
    report.pages = [];
    const output = resolve(here, 'output');
    await mkdir(output, { recursive: true });
    for (const [name, url, marker] of [
      ['home', '/', 'PEOPLE POWERED RADIO'],
      ['programs', '/programs/?program_q=Evening', 'Demo: Evening Jazz'],
      ['events', '/events/', 'Demo: Open Studio'],
      ['underwriters', '/underwriters/', 'Demo: Community Books'],
    ]) {
      const response = await server.playground.request({ url });
      const html = response.text;
      if (response.httpStatusCode !== 200 || !html.includes(marker) || /Fatal error|Parse error/.test(html)) {
        throw new Error(`${name}: WordPress rendering failed (${response.httpStatusCode})`);
      }
      if (name === 'events' && html.includes('Demo: Past Gathering')) throw new Error('Expired event entered upcoming calendar');
      await writeFile(resolve(output, `${name}.html`), html);
      report.pages.push({ name, status: response.httpStatusCode, bytes: Buffer.byteLength(html) });
    }
    report.runtime = JSON.parse(seed.text);
    await writeFile(resolve(output, 'editor-runtime.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    await close();
  }
} catch (error) {
  await close();
  throw error;
}
