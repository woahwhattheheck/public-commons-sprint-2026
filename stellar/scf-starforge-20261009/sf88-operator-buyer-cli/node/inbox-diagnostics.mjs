// MIT — Complete native failures stay beside the private command that produced them.
import { inspect } from 'node:util';
import { dirname, join } from 'node:path';
import { absolute, privateDirectory, readBytes, writeBytes, jsonBytes, digest,
  need, safeCode } from './store.mjs';

const SCHEMA = 'stellar-forge.node-inbox-diagnostic.v1';
const classes = new Set(['Error', 'SyntaxError', 'TypeError', 'RangeError',
  'ReferenceError', 'URIError', 'EvalError', 'AggregateError', 'BuyerError', 'InputError']);
const filenames = { COMMAND:'native-error.json', WORKER:'worker-error.json' };
const field = (value, key) => {
  try { return value?.[key]; } catch { return undefined; }
};
const text = value => typeof value === 'string' ? value : null;
const errorClass = problem => classes.has(field(problem, 'name')) ? field(problem, 'name') : 'Error';
function privateInspection(value) {
  try {
    return inspect(value, { depth:null, colors:false, customInspect:false, getters:false,
      maxArrayLength:null, maxStringLength:null, breakLength:120 });
  } catch { return '[Value could not be inspected]'; }
}

/** Full strings and cause/aggregate identities, including circular cause graphs. */
function privateErrorGraph(problem) {
  const seen = new Map(), pending = [], nodes = [];
  const reference = value => {
    if (value !== null && ['object','function'].includes(typeof value)) {
      if (!seen.has(value)) {
        seen.set(value, seen.size + 1);
        pending.push(value);
      }
      return { ref:seen.get(value) };
    }
    return { type:value === null ? 'null' : typeof value,
      value:typeof value === 'string' ? value : privateInspection(value) };
  };
  const root = reference(problem);
  for (let index = 0; index < pending.length; index += 1) {
    const value = pending[index], cause = field(value, 'cause'), errors = field(value, 'errors');
    nodes.push({
      id:seen.get(value), name:text(field(value, 'name')), message:text(field(value, 'message')),
      stack:text(field(value, 'stack')), code:privateInspection(field(value, 'code')),
      cause:cause === undefined ? null : reference(cause),
      errors:Array.isArray(errors) ? errors.map(reference) : null,
      inspection:privateInspection(value),
    });
  }
  return { root, nodes };
}

async function observedSource(file) {
  try {
    const bytes = await readBytes(file, 16777216);
    return { file, bytes:bytes.length, sha256:digest(bytes) };
  } catch (problem) {
    return { file, errorCode:safeCode(problem?.code, 'DIAGNOSTIC_SOURCE_UNAVAILABLE') };
  }
}

/** Only this small allowlisted reference is suitable for routine application logs. */
export function normalizeInboxDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schema !== SCHEMA || typeof value.phase !== 'string' || !Object.hasOwn(filenames, value.phase) ||
      !['SAVED','UNAVAILABLE'].includes(value.status)) return null;
  const result = { schema:SCHEMA, status:value.status, phase:value.phase,
    errorClass:classes.has(value.errorClass) ? value.errorClass : 'Error' };
  if (value.status === 'SAVED') {
    if (value.file !== filenames[value.phase] || !Number.isSafeInteger(value.bytes) ||
        value.bytes <= 0 || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))
      return null;
    Object.assign(result, { file:value.file, bytes:value.bytes, sha256:value.sha256 });
  } else result.writeErrorCode = safeCode(value.writeErrorCode, 'INBOX_DIAGNOSTIC_WRITE_FAILED');
  return Object.freeze(result);
}

/**
 * Preserve the actual failure without replacing its original public error code.
 * The source hashes describe files observed after failure, not a new execution.
 */
export async function retainInboxDiagnostic(problem, {
  phase, runtimeDirectory, inputFile, resultFile, command = null, workerFile,
}) {
  const reference = { schema:SCHEMA, phase, errorClass:errorClass(problem) };
  try {
    need(Object.hasOwn(filenames, phase), 'INBOX_DIAGNOSTIC_PHASE_INVALID');
    inputFile = absolute(inputFile);
    resultFile = absolute(resultFile);
    const directory = await privateDirectory(dirname(resultFile), { create:false });
    need(dirname(inputFile) === directory && inputFile !== resultFile,
      'INBOX_DIAGNOSTIC_DIRECTORY_MISMATCH');
    runtimeDirectory = absolute(runtimeDirectory);
    const sourceFiles = [
      absolute(workerFile), inputFile,
      join(runtimeDirectory, 'queue.mjs'), join(runtimeDirectory, 'config.mjs'),
      absolute(join(runtimeDirectory, '../sf81-buyer-operator-bridge/bridge.mjs')),
      absolute(join(runtimeDirectory, '../sf86-rpc-transfer-reconcile/networks.json')),
    ];
    const record = {
      schema:SCHEMA, phase, observedAt:new Date().toISOString(),
      command:typeof command === 'string' ? command : null,
      runtimeDirectory, inputFile, resultFile,
      error:privateErrorGraph(problem),
      sourceObservation:{ phase:'AFTER_FAILURE',
        files:await Promise.all([...new Set(sourceFiles)].map(observedSource)) },
    };
    const bytes = jsonBytes(record), file = filenames[phase];
    await writeBytes(join(directory, file), bytes, { exclusive:true });
    return normalizeInboxDiagnostic({ ...reference, status:'SAVED',
      file, bytes:bytes.length, sha256:digest(bytes) });
  } catch (writeProblem) {
    return normalizeInboxDiagnostic({ ...reference, status:'UNAVAILABLE',
      writeErrorCode:safeCode(writeProblem?.code, 'INBOX_DIAGNOSTIC_WRITE_FAILED') });
  }
}
