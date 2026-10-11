// MIT. Compose the original merchant handler, admission and native seller launchers.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCubePaidHandler } from '../adapter.mjs';
import { compileCubeCatalog, renderCubeQuery } from '../cube-template.mjs';
import { openCubePackage } from './package.mjs';
import { writeNew, json } from './files.mjs';

export function createCubeReportHandlers(config, options = {}) {
  const snapshot = structuredClone(config), catalog = compileCubeCatalog(snapshot);
  const cubeReport = createCubePaidHandler(snapshot, options);
  const cubeAdmission = context => {
    try { renderCubeQuery(catalog, context); return true; }
    catch { return { status: 400, body: { error: 'REPORT_INPUT_INVALID' } }; }
  };
  return { cubeReport, cubeAdmission };
}

/** Original serve.mjs owns facilitator setup, listeners, native payment and drain. */
export async function launchCubePackage({ directory, args = [] }) {
  const saved = await openCubePackage(directory);
  const sellerArgs = [], operationsArgs = [], seen = new Set();
  let operations = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new TypeError(`Duplicate launch option: ${flag}`);
    seen.add(flag);
    if (flag === '--operations') { operations = true; continue; }
    if (flag === '--allow-local-facilitator') { sellerArgs.push(flag); continue; }
    const isOperations = ['--operations-port', '--history-dir', '--history-days'].includes(flag);
    if (!isOperations && !['--port', '--facilitator', '--max-in-flight', '--drain-grace-ms'].includes(flag) ||
        !args[index + 1] || args[index + 1].startsWith('--')) throw new TypeError(`Unsupported or missing launch option: ${flag}`);
    (isOperations ? operationsArgs : sellerArgs).push(flag, args[++index]);
    if (isOperations) operations = true;
  }
  const temporary = await mkdtemp(join(tmpdir(), 'sf102-cube-launch-'));
  try {
    // Pass verified snapshots to the original CLI. The generated module has no credential value.
    await writeNew(join(temporary, 'seller-service.json'), json(saved.compiled.seller));
    const binding = JSON.stringify({ config: saved.compiled.adapter, allowLoopback: saved.compiled.allowLoopback });
    const module = `import { createCubeReportHandlers } from ${JSON.stringify(import.meta.url)};\n` +
      `const saved = JSON.parse(${JSON.stringify(binding)});\n` +
      `export const { cubeReport, cubeAdmission } = createCubeReportHandlers(saved.config, { allowLoopback: saved.allowLoopback });\n`;
    await writeNew(join(temporary, 'merchant-handlers.mjs'), Buffer.from(module));
    const base = ['--config', join(temporary, 'seller-service.json'), '--handlers', join(temporary, 'merchant-handlers.mjs'), ...sellerArgs];
    const native = operations ? await import('../../sf30-seller-sdk/operations/launch.mjs') : await import('../../sf30-seller-sdk/serve.mjs');
    return await native.main(operations ? [...operationsArgs, '--', ...base] : base);
  } finally {
    // Both original launchers snapshot config and import handlers before returning.
    await rm(temporary, { recursive: true, force: true });
  }
}
