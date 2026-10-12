#!/usr/bin/env node
/** Capture and project through the installed original provider implementations. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha = raw => createHash('sha256').update(raw).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
async function put(path, raw) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const stream = await open(path, 'wx', 0o600);
  try { await stream.writeFile(raw); await stream.sync(); } finally { await stream.close(); }
}
async function originalFile(path, expected) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.mode & 0o077 || info.nlink !== 1 || info.size !== expected.bytes)
      fail('STUDY_ORIGINAL_FILE_CHANGED');
    const raw = await handle.readFile();
    if (sha(raw) !== expected.sha256) fail('STUDY_ORIGINAL_FILE_CHANGED');
    return raw;
  } finally { await handle.close(); }
}
async function inventory(root, directory = root, prefix = '') {
  const values = [];
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix + item.name, path = join(directory, item.name);
    if (item.isDirectory()) values.push(...await inventory(root, path, relative + '/'));
    else if (item.isFile()) {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash('sha256');
      let count = 0;
      try {
        for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
          count += chunk.length; hash.update(chunk);
        }
      } finally { await file.close(); }
      values.push({ path: relative, bytes: count, sha256: hash.digest('hex') });
    } else fail('STUDY_SOURCE_MEMBER_INVALID');
  }
  return values;
}

export async function retainStudySource({ provider, sourceFile, out }) {
  sourceFile = resolve(sourceFile); out = resolve(out);
  if (await realpath(dirname(out)) !== dirname(out)) fail('STUDY_OUTPUT_PARENT_CANONICAL_REQUIRED');
  await mkdir(out, { mode: 0o700 });
  const copied = join(out, 'capture');
  await mkdir(copied, { mode: 0o700 });
  let retained, reader, opener, configuration, captureId, manifestPath, projectionNames, extra = {};
  if (provider === 'acs') {
    const module = await import('../census-acs/source.mjs');
    reader = module.readCensusSource; opener = module.openCensusSourceFile;
    retained = await reader(sourceFile); manifestPath = module.MANIFEST_PATH;
    captureId = retained.captureHash; projectionNames = ['observations'];
    for (const item of retained.manifest.files) await put(join(copied, item.path), await retained.read(item.path));
    await put(join(copied, manifestPath), retained.manifestBytes);
    configuration = { schema: module.SOURCE_SCHEMA, capture: 'capture/' + manifestPath, captureSha256: captureId };
    extra = { release_label: 'ACS ' + retained.manifest.year + ' 5-year', period: retained.manifest.period };
  } else if (provider === 'bls') {
    const module = await import('../bls-labor/source.mjs');
    reader = module.readBlsSource; opener = module.openBlsSourceFile;
    retained = await reader(sourceFile); manifestPath = '_bls/capture-manifest.json';
    captureId = retained.captureHash; projectionNames = ['laus', 'qcew'];
    for (const item of retained.manifest.files) {
      await mkdir(dirname(join(copied, item.path)), { recursive: true, mode: 0o700 });
      await retained.copy(item.path, join(copied, item.path));
    }
    await put(join(copied, manifestPath), retained.manifestBytes);
    configuration = { schema: 'stellar-forge.bls-labor-source.v1', capture: 'capture/' + manifestPath, captureSha256: captureId };
    extra = { release_label: 'BLS LAUS / QCEW ' + captureId.slice(0, 12), selection: retained.manifest.selection };
  } else if (provider === 'hud') {
    const release = await import('../hud-income-limits/release.mjs');
    const driver = await import('../hud-income-limits/driver.mjs');
    reader = release.readHudSource; opener = driver.openHudSourceFile;
    retained = await reader(sourceFile); manifestPath = 'release.json';
    captureId = retained.manifest.releaseId; projectionNames = ['limits'];
    for (const item of Object.values(retained.manifest.files)) {
      await put(join(copied, item.name), await originalFile(join(retained.directory, item.name), item));
      await put(join(copied, item.capture.name), await originalFile(join(retained.directory, item.capture.name), item.capture));
    }
    await put(join(copied, manifestPath), retained.raw);
    await put(join(copied, 'localities.jsonl'), retained.index);
    configuration = { ...retained.config, release: 'capture/release.json' };
    extra = { release_label: 'HUD FY' + retained.manifest.fiscalYear,
      fiscal_year: retained.manifest.fiscalYear, effective_date: retained.manifest.effectiveDate,
      hud_workbook: retained.manifest.files.workbook.name,
      workbook_url: retained.manifest.files.workbook.url,
      workbook_retrieved_at: retained.manifest.files.workbook.capture.retrievedAt };
  } else fail('STUDY_PROVIDER_INVALID');

  await put(join(out, 'intake-source.json'), retained.original);
  await put(join(out, 'source.json'), bytes(configuration));
  await mkdir(join(out, 'projections'), { mode: 0o700 });
  const connection = await opener(join(out, 'source.json')), projections = [];
  try {
    for (const query of projectionNames) {
      const path = 'projections/' + query + '.jsonl';
      const file = await open(join(out, path), 'wx', 0o600), hash = createHash('sha256');
      let count = 0, size = 0, extraction;
      try {
        extraction = await connection.source.exportDataset(query, {}, {
          maxRows: 1000000, maxBytes: 268435456, maxRowBytes: 4194304, timeoutMs: 3600000,
          onRow: async row => {
            const raw = Buffer.from(JSON.stringify(row) + '\n');
            await file.writeFile(raw); hash.update(raw); size += raw.length; count++;
          },
        });
        await file.sync();
      } finally { await file.close(); }
      if (extraction.rowCount !== count) fail('STUDY_NATIVE_ROW_COUNT_CHANGED');
      projections.push({ query, path, rows: count, bytes: size, sha256: hash.digest('hex'), native: extraction });
    }
  } finally { await connection.source.close(); }
  // Reopen the portable declaration through its original provider before returning.
  await reader(join(out, 'source.json'), { includeRows: false });
  const descriptor = {
    schema: 'stellar-forge.study-retained-source.v1', provider, capture_id: captureId,
    source_sha256: sha(retained.original), manifest_path: 'capture/' + manifestPath,
    source_file: 'source.json', ...extra, projections, files: await inventory(out),
  };
  await put(join(out, 'descriptor.json'), bytes(descriptor));
  return descriptor;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [provider, sourceFile, out, ...extra] = process.argv.slice(2);
  if (!provider || !sourceFile || !out || extra.length) fail('STUDY_BRIDGE_ARGUMENTS');
  try { process.stdout.write(JSON.stringify(await retainStudySource({ provider, sourceFile, out })) + '\n'); }
  catch (error) { process.stderr.write(JSON.stringify({ ok: false, code: error.code ?? 'STUDY_PROVIDER_FAILED', message: error.message }) + '\n'); process.exitCode = 1; }
}
