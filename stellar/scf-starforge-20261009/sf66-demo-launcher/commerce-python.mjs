// MIT. Original Python application resources owned by the existing commerce session.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import { absolute, readPrivateFile, parseJson } from '../sf103-native-buyer-signer/operator.mjs';
import { compilePythonMerchant } from '../sf30-seller-sdk/python/config.mjs';
import { createPythonSource } from '../sf30-seller-sdk/python/source.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function need(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
function compile(declaration, path) {
  try { return compilePythonMerchant(declaration, { baseDir: dirname(path) }); }
  catch { need(false, 'COMMERCE_PYTHON_CONFIG_INVALID'); }
}
async function applicationDigest(path) {
  absolute(path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= 2097152 && (info.mode & 0o022) === 0,
      'COMMERCE_PYTHON_SOURCE_INVALID');
    const bytes = await file.readFile();
    need(bytes.length <= 2097152, 'COMMERCE_PYTHON_SOURCE_TOO_LARGE');
    return hash(bytes);
  } finally { await file.close(); }
}

/** Compile the actual declaration and pin its module without importing Python. */
export async function preparePythonCommerce(configPath) {
  absolute(configPath);
  const declaration = parseJson(await readPrivateFile(configPath, 1048576));
  const compiled = compile(declaration, configPath);
  return { declaration: { ...declaration, application: compiled.options.application }, compiled,
    applicationSha256: await applicationDigest(compiled.options.application) };
}

/** Called only inside initializeCommerce's exclusively created private directory. */
export async function savePythonCommerce(prepared, directory) {
  absolute(directory);
  const path = join(directory, 'python.json');
  const bytes = Buffer.from(JSON.stringify(prepared.declaration, null, 2) + '\n');
  need(bytes.length <= 1048576, 'COMMERCE_PYTHON_CONFIG_TOO_LARGE');
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
  return { python: path, pythonSha256: hash(bytes),
    pythonApplicationSha256: prepared.applicationSha256 };
}

/** Keep the saved Python declaration, native offers and application in agreement. */
export async function readPythonCommerce(seller, directory, service) {
  need(seller.python === join(directory, 'python.json') && digest(seller.pythonSha256) &&
    digest(seller.pythonApplicationSha256), 'COMMERCE_PYTHON_SESSION_INVALID');
  const bytes = await readPrivateFile(seller.python, 1048576);
  need(hash(bytes) === seller.pythonSha256, 'COMMERCE_PYTHON_CONFIG_CHANGED');
  const compiled = compile(parseJson(bytes), seller.python);
  need(same(compiled.service, service), 'COMMERCE_PYTHON_SERVICE_CHANGED');
  need(await applicationDigest(compiled.options.application) === seller.pythonApplicationSha256,
    'COMMERCE_PYTHON_SOURCE_CHANGED');
  return { compiled, applicationSha256: seller.pythonApplicationSha256 };
}

export function describePythonCommerce(application, source = null) {
  const { compiled, applicationSha256 } = application;
  const pool = source?.stats() ?? null;
  return { kind: 'PYTHON_APPLICATION', state: pool ? pool.closed ? 'STOPPED' : 'INITIALIZED' : 'NOT_STARTED',
    application: compiled.options.application, applicationSha256,
    lifecycle: compiled.options.lifecycle, eventLoop: 'persistent',
    workerCount: compiled.options.workerCount,
    startupTimeoutMs: compiled.options.startupTimeoutMs,
    shutdownTimeoutMs: compiled.options.shutdownTimeoutMs, pool };
}

/** Acquire handlers only; the original commerce runtime owns seller and payments. */
export async function openPythonCommerce(application, { native, environment = process.env } = {}) {
  const { compiled, applicationSha256 } = application;
  const source = native ? await createPythonSource(compiled, {
    env: environment, expectedApplicationSha256: applicationSha256,
  }) : null;
  const handlers = Object.create(null);
  for (const name of Object.keys(compiled.functions)) {
    const route = source?.route(name);
    handlers[name] = route?.handler ?? (() => { need(false, 'COMMERCE_PYTHON_NOT_STARTED'); });
    handlers[name + 'Admission'] = route?.admit ?? (() => true);
  }
  return { handlers, source, status: () => describePythonCommerce(application, source),
    close: () => source?.close() ?? Promise.resolve(null) };
}
