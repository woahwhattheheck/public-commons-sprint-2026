#!/usr/bin/env node
// MIT. Native source acquisition commands; no credentials are accepted as literals.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { captureArcGis } from './arcgis.mjs';
import { inspectEbsWadl, downloadEbsWadl, captureEbsInterface, reopenEbsCapture } from './oracle-ebs.mjs';
import { prepareGlInterface, reopenGlPreparation } from './oracle-gl.mjs';
import { reopenCapture, recoverCaptureLock, readJson, sourceJson, fault } from './common.mjs';

const [command, ...argv] = process.argv.slice(2), args = {};
for (let i = 0; i < argv.length; i++) {
  if (!['--config', '--source-jsonl', '--directory'].includes(argv[i]) || !argv[i + 1]) throw fault('CLI_ARGUMENT', 'Use --config FILE, --directory DIR or --source-jsonl FILE');
  args[argv[i].slice(2)] = path.resolve(argv[++i]);
}
const controller = new AbortController();
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort(new Error(name)));
const progress = value => process.stderr.write(JSON.stringify(value) + '\n');
async function* sourceRows(file) {
  const input = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try { for await (const line of input) { controller.signal.throwIfAborted(); if (line.trim()) yield sourceJson(line); } }
  finally { input.close(); }
}
try {
  const config = args.config ? await readJson(args.config) : {};
  if (args.directory) config.directory = args.directory;
  const options = { ...config, signal: controller.signal, onProgress: progress };
  let result;
  if (command === 'arcgis') result = await captureArcGis(options);
  else if (command === 'ebs-inspect') result = await inspectEbsWadl(options);
  else if (command === 'ebs-download-wadl') result = await downloadEbsWadl(options);
  else if (command === 'ebs-capture') result = await captureEbsInterface(options);
  else if (command === 'gl-prepare') {
    if (!args['source-jsonl']) throw fault('SOURCE_JSONL_REQUIRED', 'Select the approved source JSONL with --source-jsonl');
    const sourceFile = args['source-jsonl'], hash = createHash('sha256');
    for await (const chunk of createReadStream(sourceFile)) { controller.signal.throwIfAborted(); hash.update(chunk); }
    result = await prepareGlInterface({ ...options, source: { ...config.source, file: sourceFile, sha256: hash.digest('hex') }, sourceRows: sourceRows(sourceFile) });
  } else if (command === 'reopen') {
    if (!config.directory) throw fault('DIRECTORY_REQUIRED', 'Select --directory');
    let gl = false;
    try { await fs.access(path.join(config.directory, 'preparation.json')); gl = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (gl) result = await reopenGlPreparation(config.directory);
    else {
      const current = await readJson(path.join(config.directory, 'capture.json'));
      result = current.schema === 'tjl.oracle-ebs-capture.v1' ? await reopenEbsCapture(config.directory) : await reopenCapture(config.directory);
    }
  } else if (command === 'recover-lock') result = await recoverCaptureLock(config.directory);
  else throw fault('CLI_COMMAND', 'Commands: arcgis, ebs-inspect, ebs-download-wadl, ebs-capture, gl-prepare, reopen, recover-lock');
  const output = result.resources ? result : { schema: result.schema, status: result.status, directory: config.directory,
    records: result.projection?.records ?? result.records, pages: result.pages?.length, projection: result.projection,
    errors: result.review?.errors, warnings: result.review?.warnings, recovered: result.recovered };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: { code: error.code || error.name, message: error.message, details: error.details || {} } }) + '\n');
  process.exitCode = controller.signal.aborted ? 130 : 1;
}
