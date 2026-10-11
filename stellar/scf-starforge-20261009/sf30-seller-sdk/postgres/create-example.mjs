// MIT. Create one private operator workspace; no database connection or payment.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function createExample(directory) {
  const path = resolve(directory);
  await mkdir(path, { mode: 0o700 });
  try {
    for (const [source, target] of [['example-source.json', 'source.json'], ['example-service.json', 'service.json'],
      ['example-bindings.json', 'bindings.json'], ['example-schema.sql', 'example-schema.sql']]) {
      await writeFile(resolve(path, target), await readFile(new URL(source, import.meta.url)), { mode: 0o600, flag: 'wx' });
    }
    return { directory: path, source: resolve(path, 'source.json'), service: resolve(path, 'service.json'),
      bindings: resolve(path, 'bindings.json'), launcher: fileURLToPath(new URL('serve.mjs', import.meta.url)) };
  } catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--directory') {
    process.stderr.write('Usage: node create-example.mjs --directory NEW_DIRECTORY\n'); process.exitCode = 1;
  } else createExample(process.argv[3]).then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'), () => {
    process.stderr.write('{"error":"EXAMPLE_CREATE_FAILED"}\n'); process.exitCode = 1;
  });
}
