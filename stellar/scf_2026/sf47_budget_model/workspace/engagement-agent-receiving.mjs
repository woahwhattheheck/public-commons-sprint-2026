// MIT. Same-case receiving through the maintained SF47 client and MCP provider.
// The original Python course owns the workspace and inherited receiving flock.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {dirname, basename, resolve, relative, isAbsolute, join, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

export const ENGAGEMENT_AGENT_SCHEMA = 'stellar-forge.sf47-engagement-agent-receiving.v1';
export const ENGAGEMENT_AGENT_SOURCE_SCHEMA = 'stellar-forge.sf47-engagement-agent-source.v1';
export const ENGAGEMENT_AGENT_EXECUTION_SCHEMA = 'stellar-forge.sf47-engagement-agent-execution-continuation.v1';
const NATIVE = 'stellar-forge.sf47-engagement-native-receiving.v1';
const PREFIX = 'stellar/scf_2026/sf47_budget_model/workspace/';
const PROVIDER = 'stellar-forge/mcp-merchant-operator/';
const SELF = PREFIX + 'engagement-agent-receiving.mjs';
const RESULT = 'ENGAGEMENT_AGENT_RESULT.json', CLOSED = 'ENGAGEMENT_AGENT_OBSERVATION.json';
const OWN_TEMP = /^\.agent-write-[a-f0-9-]{36}$/;
const MAX_FILE = 256 * 1024 * 1024, MAX_JSON = 32 * 1024 * 1024;
const MAX_SOURCE = 512 * 1024 * 1024, MAX_FILES = 16384, CHUNK = 65536;
const HEX = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CASE = /^operation-[a-f0-9]{32}$/, REVIEW = /^review-[a-f0-9]{32}$/;
const requiredSource = [
  SELF, PREFIX + 'agent-client.mjs', PREFIX + 'agent-client.d.mts',
  PREFIX + 'agent-contracts.mjs', PREFIX + 'launch.mjs',
  PROVIDER + 'grant-workspace.mjs', PROVIDER + 'catalog/grant-workspace.mjs',
  PROVIDER + 'retained-file-reads.mjs', PROVIDER + 'retained-file-contracts.mjs',
  PROVIDER + 'host-files.mjs',
];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = (code, message) => Object.assign(new Error(message), {code});
function need(test, code, message) { if (!test) throw failure(code, message); }
function exact(value, allowed, required = allowed) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'INPUT', 'Use the complete declared original input.');
}
function canonical(value) {
  if (value === null || typeof value !== 'object') {
    need(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)),
      'JSON', 'Retain finite original JSON values.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const json = value => Buffer.from(canonical(value) + '\n');
const same = (left, right) => canonical(left) === canonical(right);
function strictJSON(bytes) {
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  let at = 0, values = 0;
  const numberToken = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const white = () => { while (at < text.length && /[ \t\r\n]/.test(text[at])) at++; };
  function string() {
    need(text[at] === '"', 'JSON', 'Expected an original JSON string.');
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') return JSON.parse(text.slice(start, at));
      need(c.charCodeAt(0) >= 32, 'JSON', 'JSON strings cannot contain raw control characters.');
      if (c === '\\') {
        const escape = text[at++];
        need(escape !== undefined && '"\\/bfnrtu'.includes(escape), 'JSON', 'Invalid JSON string escape.');
        if (escape === 'u') {
          need(/^[a-fA-F0-9]{4}$/.test(text.slice(at, at + 4)), 'JSON', 'Invalid JSON Unicode escape.');
          at += 4;
        }
      }
    }
    throw failure('JSON', 'The complete JSON string ended early.');
  }
  function value(depth) {
    white(); need(depth <= 128 && ++values <= 2000000, 'JSON_LIMIT', 'The complete JSON exceeds its structural bound.');
    const c = text[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; white(); const result = {}, names = new Set();
      if (text[at] === '}') { at++; return result; }
      for (;;) {
        white(); const key = string();
        need(!names.has(key), 'JSON_DUPLICATE', 'The original JSON repeats a key.'); names.add(key);
        white(); need(text[at++] === ':', 'JSON', 'Expected the original JSON field separator.');
        Object.defineProperty(result, key, {value:value(depth + 1), enumerable:true, writable:true, configurable:true});
        white(); const next = text[at++];
        if (next === '}') return result;
        need(next === ',', 'JSON', 'Expected the original JSON object separator.');
      }
    }
    if (c === '[') {
      at++; white(); const result = [];
      if (text[at] === ']') { at++; return result; }
      for (;;) {
        result.push(value(depth + 1)); white(); const next = text[at++];
        if (next === ']') return result;
        need(next === ',', 'JSON', 'Expected the original JSON array separator.');
      }
    }
    for (const [word, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.slice(at, at + word.length) === word) { at += word.length; return result; }
    }
    numberToken.lastIndex = at;
    const number = numberToken.exec(text);
    need(number, 'JSON', 'Expected a finite original JSON value.');
    at = numberToken.lastIndex; const result = Number(number[0]);
    need(Number.isFinite(result), 'JSON', 'The complete JSON contains a non-finite number.');
    return result;
  }
  const result = value(0); white();
  need(at === text.length, 'JSON', 'The complete JSON contains trailing data.'); return result;
}
function rel(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 1200 &&
    !/[\x00-\x1f\x7f\\]/.test(value) && !isAbsolute(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'),
  'PATH', 'Use one complete canonical relative member path.');
  return value;
}
function abs(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !/[\x00-\x1f\x7f]/.test(value), 'PATH', 'Use the exact absolute original path.');
  return value;
}
const inside = (root, path) => path !== root && path.startsWith(root + sep);
function metadata(value) {
  exact(value, ['path', 'bytes', 'sha256'], ['path', 'bytes', 'sha256']);
  abs(value.path);
  need(Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_FILE && HEX.test(value.sha256),
    'FILE_SELECTION', 'Retain the complete original file length and SHA-256.');
  return value;
}
function diagnostic(error) {
  return {code:String(error?.code ?? 'AGENT_RECEIVING_FAILED'),
    message:String(error?.message ?? error).replace(/#access=[^\s"'<>]+/g, '#access=[private]').slice(0,2048)};
}
function noteCleanup(primary, error) {
  if (!primary) return error;
  (primary.cleanup ??= []).push(diagnostic(error)); return primary;
}
function statKey(info) {
  return ['dev','ino','size','mtimeNs','ctimeNs','mode','uid'].map(key => String(info[key])).join(':');
}
async function closeOwned(owner, label, report) {
  let first = null, attempts = 0;
  for (;;) {
    try { await owner.close(); break; }
    catch (error) {
      first ??= error; attempts++;
      try { report?.({state:'DRAINING', owner:label, attempts, error:diagnostic(error)}); } catch {}
      await delay(Math.min(1000, 100 + attempts * 100));
    }
  }
  return first;
}
function control(options = {}) {
  let stopped = null, disposed = false;
  const handles = new Set();
  const abort = () => { stopped ??= options.signal?.reason instanceof Error
    ? options.signal.reason : failure('INTERRUPTED', 'The same original agent observation was interrupted.'); };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort);
  return {
    handles,
    check() { if (stopped) throw stopped; },
    stop(error) { stopped ??= error instanceof Error ? error : failure('INTERRUPTED', String(error)); },
    get stopped() { return stopped; },
    report(value) { options.onProgress?.(value); },
    async closeFile(handle, primary = null) {
      if (!handle) return primary;
      const error = await closeOwned(handle, 'original file descriptor', value => options.onProgress?.(value));
      handles.delete(handle); return error ? noteCleanup(primary, error) : primary;
    },
    async drainFiles(primary = null) {
      const outcomes = await Promise.all([...handles].map(async handle => {
        const error = await closeOwned(handle, 'original file descriptor', value => options.onProgress?.(value));
        handles.delete(handle); return error;
      }));
      for (const error of outcomes) if (error) primary = noteCleanup(primary, error);
      return primary;
    },
    dispose() { if (!disposed) { disposed = true; options.signal?.removeEventListener('abort', abort); } },
  };
}
async function openFile(ctx, filename, flags, mode = 0o600) {
  ctx.check(); const handle = await fsp.open(filename, flags, mode); ctx.handles.add(handle); return handle;
}
async function inspectFile(ctx, filename, {maximum = MAX_FILE, retain = false, privateFile = false, allowStop = false} = {}) {
  abs(filename);
  if (!allowStop) ctx.check();
  need(await fsp.realpath(filename) === filename, 'SYMLINK', 'Keep the complete selected path free of aliases.');
  const handle = await fsp.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  ctx.handles.add(handle);
  let primary = null, result;
  try {
    const before = await handle.stat({bigint:true});
    need(before.isFile() && before.size <= BigInt(maximum), 'FILE_SIZE', 'Select a bounded complete regular file.');
    if (privateFile) need(before.uid === BigInt(process.getuid()) && (before.mode & 0o077n) === 0n,
      'PRIVATE_FILE', 'Keep this original receiving file private to its owner.');
    const hash = createHash('sha256'), chunks = [], buffer = Buffer.alloc(256 * 1024);
    let offset = 0;
    for (;;) {
      if (!allowStop) ctx.check();
      const read = await handle.read(buffer, 0, buffer.length, offset);
      if (!allowStop) ctx.check();
      if (!read.bytesRead) break;
      offset += read.bytesRead; need(offset <= maximum, 'FILE_SIZE', 'The selected file grew beyond its complete bound.');
      const chunk = buffer.subarray(0, read.bytesRead); hash.update(chunk);
      if (retain) chunks.push(Buffer.from(chunk));
    }
    const after = await handle.stat({bigint:true}), current = await fsp.lstat(filename, {bigint:true});
    need(statKey(before) === statKey(after) && statKey(after) === statKey(current) &&
      current.isFile() && !current.isSymbolicLink() && BigInt(offset) === before.size &&
      await fsp.realpath(filename) === filename, 'FILE_CHANGED', 'The complete original file changed while being read.');
    if (!allowStop) ctx.check();
    result = {path:filename, bytes:offset, sha256:hash.digest('hex'), mode:Number(before.mode & 0o777n),
      ...(retain ? {data:Buffer.concat(chunks)} : {})};
  } catch (error) { primary = error; }
  primary = await ctx.closeFile(handle, primary);
  if (primary) throw primary; return result;
}
async function selectedFile(ctx, row, options = {}) {
  metadata(row);
  const actual = await inspectFile(ctx, row.path, options);
  need(actual.bytes === row.bytes && actual.sha256 === row.sha256, 'FILE_CHANGED',
    'The complete original file differs from its selected bytes or SHA-256.');
  return actual;
}
async function syncDirectory(ctx, path) {
  const handle = await fsp.open(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  ctx.handles.add(handle); let primary = null;
  try { await handle.sync(); } catch (error) { primary = error; }
  primary = await ctx.closeFile(handle, primary); if (primary) throw primary;
}
async function privateDirectory(ctx, path, root) {
  abs(path); need(path === root || inside(root, path), 'PATH', 'Keep new files inside the original observation directory.');
  if (path !== root) await privateDirectory(ctx, dirname(path), root);
  let created = false;
  try { await fsp.mkdir(path, {mode:0o700}); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await fsp.lstat(path, {bigint:true});
  need(info.isDirectory() && !info.isSymbolicLink() && info.uid === BigInt(process.getuid()) &&
    (info.mode & 0o077n) === 0n && await fsp.realpath(path) === path,
    'PRIVATE_DIRECTORY', 'Use the same owned private observation directory.');
  // Reentry finishes a directory publication interrupted after mkdir.
  await syncDirectory(ctx, path);
  if (created || path === root) await syncDirectory(ctx, dirname(path));
}
class ParentGuard {
  constructor(input) {
    this.fd = null; this.path = null;
    // The child adopts only the explicitly supplied inherited descriptor.
    need(plain(input) && Number.isInteger(input.fd) && input.fd >= 3,
      'PARENT_GUARD', 'Inherit the existing Python receiving guard descriptor.');
    this.fd = input.fd;
    try {
      need(typeof input.device === 'string' && /^\d+$/.test(input.device) &&
        typeof input.inode === 'string' && /^\d+$/.test(input.inode),
        'PARENT_GUARD', 'Keep the original inherited descriptor identity.');
      this.path = abs(input.path); this.device = input.device; this.inode = input.inode;
      this.assert();
    } catch (error) {
      const fd = this.fd; this.fd = null;
      try { fs.closeSync(fd); } catch (cleanup) { noteCleanup(error, cleanup); }
      throw error;
    }
  }
  assert() {
    need(this.fd !== null, 'PARENT_GUARD_CLOSED', 'The original inherited guard has closed.');
    const held = fs.fstatSync(this.fd, {bigint:true}), path = fs.lstatSync(this.path, {bigint:true});
    need(held.isFile() && path.isFile() && !path.isSymbolicLink() &&
      String(held.dev) === this.device && String(held.ino) === this.inode &&
      held.dev === path.dev && held.ino === path.ino && held.uid === BigInt(process.getuid()) &&
      (held.mode & 0o077n) === 0n, 'PARENT_GUARD_CHANGED', 'Keep the same original inherited receiving flock.');
  }
  close() {
    if (this.fd === null) return;
    let first;
    try { this.assert(); } catch (error) { first = error; }
    const fd = this.fd; this.fd = null;
    // Linux raw descriptor close is attempted once. Never unlock the shared flock.
    try { fs.closeSync(fd); } catch (error) { first = noteCleanup(first, error); }
    if (first) throw first;
  }
}
async function publish(ctx, guard, root, name, bytes, {replace = false, expectedSha256 = null, allowStop = false} = {}) {
  rel(name); need(Buffer.isBuffer(bytes) && bytes.length <= MAX_FILE, 'PUBLICATION', 'Retain complete bounded original bytes.');
  if (!allowStop) ctx.check(); guard.assert();
  const filename = join(root, name); await privateDirectory(ctx, dirname(filename), root);
  let present;
  try { present = await inspectFile(ctx, filename, {privateFile:true, allowStop}); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (present && !replace) {
    need(present.bytes === bytes.length && present.sha256 === sha(bytes),
      'PUBLICATION_CONFLICT', 'Keep the existing different original observation.');
    await syncDirectory(ctx, dirname(filename));
    return {path:name, bytes:present.bytes, sha256:present.sha256};
  }
  need((present?.sha256 ?? null) === expectedSha256, 'JOURNAL_CHANGED', 'Keep the original guarded observation journal.');
  const temporary = join(dirname(filename), '.agent-write-' + randomUUID());
  let handle = null, primary = null;
  try {
    handle = await fsp.open(temporary, 'wx', 0o600); ctx.handles.add(handle);
    let offset = 0;
    while (offset < bytes.length) {
      if (!allowStop) ctx.check();
      const written = await handle.write(bytes, offset, Math.min(256 * 1024, bytes.length - offset), offset);
      need(written.bytesWritten > 0, 'WRITE_INCOMPLETE', 'The original file stopped before its final bytes.');
      offset += written.bytesWritten;
    }
    await handle.sync();
    const closing = handle; handle = null;
    const closeError = await ctx.closeFile(closing);
    if (closeError) throw closeError;
    guard.assert();
    if (replace) await fsp.rename(temporary, filename);
    else {
      try { await fsp.link(temporary, filename); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await inspectFile(ctx, filename, {privateFile:true, allowStop});
        need(existing.bytes === bytes.length && existing.sha256 === sha(bytes),
          'PUBLICATION_CONFLICT', 'The same original output path contains different bytes.');
      }
      await fsp.unlink(temporary);
    }
    await syncDirectory(ctx, dirname(filename));
  } catch (error) { primary = error; }
  primary = await ctx.closeFile(handle, primary);
  try { await fsp.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') primary = noteCleanup(primary, error); }
  if (primary) throw primary;
  return {path:name, bytes:bytes.length, sha256:sha(bytes)};
}


async function executionContinuation(ctx, spec, nativeJournal, sourceRows, root, output) {
  if (spec.agentExecutionContinuation === undefined) return null;
  const file = await selectedFile(ctx, spec.agentExecutionContinuation,
    {retain:true, privateFile:true, maximum:256 * 1024});
  const document = strictJSON(file.data);
  exact(document, ['schema','operationId','reason','original','corrections']);
  need(document.schema === ENGAGEMENT_AGENT_EXECUTION_SCHEMA &&
    document.operationId === spec.operationId && typeof document.reason === 'string' &&
    document.reason.trim().length > 0 && document.reason.length <= 4000,
    'EXECUTION_CONTINUATION', 'Retain the complete explicit reason and original operation for this source continuation.');
  exact(document.original, ['sourceManifest','agentSourceManifest','nativeSelectionSha256',
    'agentSelectionSha256','native','agentJournal']);
  const prior = document.original;
  need(same(prior.sourceManifest, nativeJournal.selection.sourceManifest) &&
    same(prior.agentSourceManifest, spec.sourceManifest) && same(prior.native, spec.native) &&
    prior.nativeSelectionSha256 === sha(Buffer.from(canonical(nativeJournal.selection))) &&
    HEX.test(prior.agentSelectionSha256),
    'EXECUTION_CONTINUATION', 'Preserve the original source manifests, native selection and completed native files.');
  metadata(prior.agentJournal);
  need(prior.agentJournal.path === join(output, 'JOURNAL.json'),
    'EXECUTION_CONTINUATION', 'Bind the exact preceding agent journal from this original observation directory.');
  exact(document.corrections, ['python','node']);
  for (const [name, member] of [['python', PREFIX + 'operations_engagements_receiving.py'], ['node', SELF]]) {
    const correction = document.corrections[name]; exact(correction, ['prior','current']);
    const expected = sourceRows.get(member);
    need(expected && same(correction.prior, {path:join(root, member), bytes:expected.bytes,
      sha256:expected.sha256, mode:expected.mode}),
      'EXECUTION_CONTINUATION', 'Keep each complete original execution preimage in the unchanged source selection.');
    const current = correction.current;
    exact(current, ['path','bytes','sha256','mode']);
    metadata({path:current.path, bytes:current.bytes, sha256:current.sha256});
    need(!inside(root, current.path) && current.path !== root &&
      Number.isInteger(current.mode) && current.mode >= 0 && current.mode <= 0o777,
      'EXECUTION_CONTINUATION', 'Stage each complete correction outside the original source directory.');
    const actual = await selectedFile(ctx, {path:current.path, bytes:current.bytes, sha256:current.sha256});
    need(actual.mode === current.mode, 'EXECUTION_CONTINUATION',
      'The explicitly selected execution source mode changed.');
    if (name === 'node') need(fileURLToPath(import.meta.url) === current.path,
      'EXECUTED_SOURCE', 'Execute the exact companion selected by this explicit continuation.');
  }
  need(document.corrections.python.current.path !== document.corrections.node.current.path,
    'EXECUTION_CONTINUATION', 'Retain distinct complete Python and Node execution files.');
  return {file, record:{reference:{path:file.path, bytes:file.bytes, sha256:file.sha256}, document}};
}
async function retainExecutionContinuation(o, {adopt = false} = {}) {
  const continuation = o.executionContinuation;
  if (!continuation) {
    need(o.state.executionContinuation === undefined, 'EXECUTION_CONTINUATION',
      'Resume with the same explicit source continuation already retained by this observation.');
    return;
  }
  const prior = continuation.document.original.agentJournal;
  const prefix = 'execution-continuations/' + continuation.reference.sha256 + '/';
  const priorName = prefix + 'prior-agent-journal.json', selectionName = prefix + 'execution-continuation.json';
  let original;
  try {
    original = await selectedFile(o.ctx, {path:join(o.output, priorName), bytes:prior.bytes, sha256:prior.sha256},
      {retain:true, privateFile:true, maximum:MAX_JSON});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    need(adopt && o.state.executionContinuation === undefined && o.journalSha === prior.sha256,
      'EXECUTION_CONTINUATION', 'Retain the exact interrupted predecessor before the first execution adoption.');
    original = await selectedFile(o.ctx, prior, {retain:true, privateFile:true, maximum:MAX_JSON});
  }
  const predecessor = strictJSON(original.data);
  need(predecessor.schema === ENGAGEMENT_AGENT_SCHEMA + '.journal' &&
    predecessor.state === 'INTERRUPTED' && same(predecessor.selection, o.selection) &&
    predecessor.selectionSha256 === o.selectionSha256 &&
    predecessor.executionContinuation === undefined && plain(predecessor.steps) &&
    Object.keys(predecessor.steps).length === 0 && plain(predecessor.downloads) &&
    Object.keys(predecessor.downloads).length === 0 && Array.isArray(predecessor.attempts) &&
    predecessor.attempts.length > 0 && predecessor.attempts.every(attempt => attempt.state === 'INTERRUPTED'),
    'EXECUTION_CONTINUATION', 'This correction continues the original interrupted connection admission before any agent step or download.');
  if (o.state.executionContinuation === undefined) {
    need(adopt && o.journalSha === prior.sha256 && same(o.state, predecessor),
      'EXECUTION_CONTINUATION', 'The original interrupted agent journal changed before execution adoption.');
    await publish(o.ctx, o.guard, o.output, selectionName, o.executionContinuationFile.data);
    await publish(o.ctx, o.guard, o.output, priorName, original.data);
    o.state.executionContinuation = continuation;
    await o.save();
  } else {
    need(same(o.state.executionContinuation, continuation), 'EXECUTION_CONTINUATION',
      'Resume the exact retained source continuation without replacing its predecessor.');
    await selectedFile(o.ctx, {path:join(o.output, selectionName),
      bytes:continuation.reference.bytes, sha256:continuation.reference.sha256},
      {privateFile:true, maximum:256 * 1024});
  }
  o.executionAdoptionPending = false;
}

async function prepare(ctx, spec) {
  exact(spec, ['schema','operationId','repositoryRoot','sourceManifest','providerConfiguration',
    'workspace','native','outputDirectory','parentGuard','chunkBytes','agentExecutionContinuation'],
  ['schema','operationId','repositoryRoot','sourceManifest','providerConfiguration',
    'workspace','native','outputDirectory','parentGuard']);
  need(spec.schema === ENGAGEMENT_AGENT_SCHEMA && typeof spec.operationId === 'string' && ID.test(spec.operationId),
    'INPUT_SCHEMA', 'Select the original Contributor Engagements receiving operation.');
  need(typeof spec.workspace === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(spec.workspace),
    'WORKSPACE', 'Use the original configured workspace alias.');
  const root = abs(spec.repositoryRoot), output = abs(spec.outputDirectory);
  exact(spec.native, ['outcome','journal']);
  const outcomeFile = await selectedFile(ctx, spec.native.outcome, {retain:true, privateFile:true, maximum:MAX_JSON});
  const journalFile = await selectedFile(ctx, spec.native.journal, {retain:true, privateFile:true, maximum:MAX_JSON});
  const nativeRoot = dirname(outcomeFile.path);
  const nativeDirectory = await fsp.lstat(nativeRoot, {bigint:true});
  need(nativeDirectory.isDirectory() && !nativeDirectory.isSymbolicLink() &&
    nativeDirectory.uid === BigInt(process.getuid()) && (nativeDirectory.mode & 0o077n) === 0n &&
    await fsp.realpath(nativeRoot) === nativeRoot, 'PRIVATE_DIRECTORY',
    'Retain the original owned private native receiving directory.');
  need(dirname(journalFile.path) === nativeRoot && inside(nativeRoot, output) &&
    !inside(root, output) && !inside(output, root) && output !== root,
    'OUTPUT_SELECTION', 'Keep one separate observation directory inside the original private receiving output.');
  need(spec.parentGuard?.path === join(nativeRoot, 'engagement-native.lock') &&
    typeof spec.parentGuard.device === 'string' && /^\d+$/.test(spec.parentGuard.device) &&
    typeof spec.parentGuard.inode === 'string' && /^\d+$/.test(spec.parentGuard.inode),
    'PARENT_GUARD', 'Bind the same original Python receiving guard path and inode.');
  const chunkBytes = spec.chunkBytes ?? CHUNK;
  need(Number.isSafeInteger(chunkBytes) && chunkBytes >= 1 && chunkBytes <= CHUNK,
    'CHUNK', 'Use the original retained-file byte-page limit.');
  const outcome = strictJSON(outcomeFile.data), nativeJournal = strictJSON(journalFile.data);
  need(outcome.schema === NATIVE + '.native' && outcome.operationId === spec.operationId &&
    CASE.test(outcome.sourceCaseId) && Number.isSafeInteger(outcome.sourceCaseVersion) &&
    nativeJournal.schema === NATIVE + '.journal' && nativeJournal.state === 'NATIVE_COMPLETE' &&
    nativeJournal.selection?.operationId === spec.operationId &&
    nativeJournal.selection.mode === outcome.mode && ['ACTUAL','WALKTHROUGH'].includes(outcome.mode) &&
    nativeJournal.nativeComplete?.selectionSha256 === sha(Buffer.from(canonical(nativeJournal.selection))),
    'NATIVE_OUTCOME', 'Receive the complete closed native course with its original operation and selection.');
  need(REVIEW.test(outcome.book?.reviewId) && HEX.test(outcome.book.reviewSha256) &&
    REVIEW.test(outcome.receiving?.id) && HEX.test(outcome.receiving.sha256),
    'NATIVE_OUTCOME', 'Keep the original selected book and receiving review.');
  const manifestFile = await selectedFile(ctx, spec.sourceManifest, {retain:true, maximum:MAX_JSON});
  const manifest = strictJSON(manifestFile.data);
  need(manifest.schema === ENGAGEMENT_AGENT_SOURCE_SCHEMA && Array.isArray(manifest.files) &&
    manifest.files.length >= requiredSource.length && manifest.files.length <= MAX_FILES &&
    typeof manifest.repository === 'string' && manifest.repository.length > 0 &&
    typeof manifest.revision === 'string' && /^[a-f0-9]{40}$/.test(manifest.revision) &&
    manifest.pathBase === 'repository' && manifest.productPath === 'stellar/scf_2026/sf47_budget_model',
    'SOURCE_MANIFEST', 'Supply the complete selected repository source and its original Git provenance.');
  const nativeSourceFile = await selectedFile(ctx, nativeJournal.selection.sourceManifest,
    {retain:true, maximum:MAX_JSON});
  const nativeSource = strictJSON(nativeSourceFile.data);
  need(nativeSource.schema === 'stellar-forge.sf47-engagement-native-source.v1' &&
    nativeSource.pathBase === 'repository' && nativeSource.productPath === manifest.productPath &&
    same(nativeSource.files, manifest.files), 'SOURCE_CLOSURE',
    'The original native and agent source manifests must retain the same complete selected files.');
  need(await fsp.realpath(root) === root && nativeJournal.selection.repositoryRoot === root &&
    nativeJournal.selection.sourceDirectory === join(root, manifest.productPath),
    'SOURCE_DIRECTORY', 'Use the actual original repository and product-root native selection.');
  const sourceRows = new Map(); let sourceBytes = 0;
  for (const row of manifest.files) {
    rel(row.path);
    need(!sourceRows.has(row.path) && Number.isSafeInteger(row.bytes) && row.bytes >= 0 &&
      Number.isInteger(row.mode) && row.mode >= 0 && row.mode <= 0o777 && HEX.test(row.sha256),
      'SOURCE_MANIFEST', 'Retain distinct complete original source members and modes.');
    sourceBytes += row.bytes; need(sourceBytes <= MAX_SOURCE, 'SOURCE_SIZE', 'The complete agent source exceeds 512 MiB.');
    const actual = await selectedFile(ctx, {path:join(root, row.path), bytes:row.bytes, sha256:row.sha256});
    need(actual.mode === row.mode, 'SOURCE_MODE', 'Keep the selected original source file mode.');
    sourceRows.set(row.path, row);
  }
  need(requiredSource.every(name => sourceRows.has(name)), 'SOURCE_CLOSURE',
    'Retain the whole original client, launch, provider, catalogue and file-reader closure.');
  const execution = await executionContinuation(ctx, spec, nativeJournal, sourceRows, root, output);
  if (!execution) {
    const executing = await inspectFile(ctx, fileURLToPath(import.meta.url));
    const caller = sourceRows.get(SELF);
    need(executing.bytes === caller.bytes && executing.sha256 === caller.sha256,
      'EXECUTED_SOURCE', 'Execute the exact complete companion from its selected source edition.');
  }
  const configFile = await selectedFile(ctx, spec.providerConfiguration, {retain:true, privateFile:true, maximum:1024 * 1024});
  const configuration = strictJSON(configFile.data), declared = configuration.workspaces?.[spec.workspace];
  need(configuration.schema === 'stellar-forge.sf47-workspace-connection.v1' &&
    plain(declared) && typeof declared.directory === 'string' && declared.directory.length > 0 &&
    declared.allowStart === false, 'BORROWED_HOST_REQUIRED',
    'The selected original provider configuration must explicitly retain allowStart:false.');
  const resolvedWorkspace = resolve(dirname(configFile.path), declared.directory);
  need(resolvedWorkspace === nativeJournal.selection.host?.workspaceDirectory,
    'ORIGINAL_WORKSPACE', 'Use the same original workspace selected by the native course.');
  const artifacts = nativeJournal.artifacts;
  need(plain(artifacts) && Object.keys(artifacts).length <= MAX_FILES && plain(nativeJournal.steps),
    'NATIVE_JOURNAL', 'Retain every original native artifact and request.');
  const nativeRows = [], byPath = new Map();
  let nativeBytes = 0;
  for (const row of Object.values(artifacts)) {
    need(plain(row), 'NATIVE_ARTIFACT', 'Keep complete native artifact records.');
    rel(row.path); const path = join(nativeRoot, row.path);
    need(!inside(output, path) && path !== output, 'NATIVE_ARTIFACT', 'The frozen native input precedes this observation output.');
    const verified = await selectedFile(ctx, {path, bytes:row.bytes, sha256:row.sha256}, {privateFile:true});
    nativeBytes += verified.bytes;
    need(nativeBytes <= 1024 * 1024 * 1024, 'NATIVE_ARTIFACTS_SIZE', 'Keep the complete native receiving within its 1 GiB input bound.');
    if (byPath.has(row.path)) need(same(byPath.get(row.path), row), 'NATIVE_ARTIFACT', 'One original artifact path has conflicting bindings.');
    byPath.set(row.path, row); nativeRows.push(row);
  }
  const nativeRow = artifacts['native-receiving'];
  need(nativeRow && join(nativeRoot, nativeRow.path) === outcomeFile.path &&
    nativeRow.bytes === outcomeFile.bytes && nativeRow.sha256 === outcomeFile.sha256 &&
    same(nativeJournal.nativeComplete.artifact, nativeRow), 'NATIVE_OUTCOME', 'The frozen journal must bind these exact native outcome bytes.');
  async function nativeArtifact(row) {
    need(row && byPath.has(row.path) && same(row, byPath.get(row.path)),
      'NATIVE_ARTIFACT', 'Select one complete original journal artifact.');
    return selectedFile(ctx, {path:join(nativeRoot, row.path), bytes:row.bytes, sha256:row.sha256},
      {retain:true, privateFile:true, maximum:MAX_JSON});
  }
  const completeSteps = [];
  for (const [key, step] of Object.entries(nativeJournal.steps)) {
    if (step.state !== 'COMPLETE' || !step.request || step.kind === 'IMPORT') continue;
    const requestFile = await nativeArtifact(step.request), request = strictJSON(requestFile.data);
    if (request.path !== '/api/operations/' + outcome.sourceCaseId + '/command' ||
      !['engagement.prepare','engagement.receiving'].includes(request.body?.action)) continue;
    const responseFile = await nativeArtifact(step.response), response = strictJSON(responseFile.data);
    need(request.method === 'POST' && request.mutation === true &&
      same(request.host, nativeJournal.selection.host) &&
      sha(Buffer.from(canonical(request))) === step.requestSha256 &&
      sha(Buffer.from(canonical(response))) === step.resultSha256,
      'NATIVE_REQUEST', 'Retain the exact original accepted command and native result representation.');
    exact(request.body, ['expectedVersion','requestId','actor','note','action','data']);
    exact(request.body.data, request.body.action === 'engagement.prepare'
      ? ['document','expectedPreviewSha256']
      : ['reviewId','reviewSha256','forecastId','portfolioId','forecastSelection','portfolioSelection']);
    need(typeof request.body.actor === 'string' && typeof request.body.note === 'string' &&
      Number.isSafeInteger(request.body.expectedVersion) && request.body.expectedVersion >= 0 &&
      requestFile.data.equals(json(request)) && typeof request.body.requestId === 'string' && ID.test(request.body.requestId) &&
      response.id === outcome.sourceCaseId && response.action === request.body.action &&
      response.version === request.body.expectedVersion + 1,
      'NATIVE_REQUEST', 'Do not change any original request value, number, identity, version or note.');
    completeSteps.push({key, step, request, response, requestFile, responseFile});
  }
  function selectedCommand(action, id, digest, optional = false) {
    const rows = completeSteps.filter(row => row.request.body.action === action &&
      row.response.recordId === id && row.response.reviewSha256 === digest);
    need(rows.length === 1 || optional && rows.length === 0, 'ACCEPTED_REQUEST',
      'Select the one already-accepted command for this exact original review.');
    return rows[0] ?? null;
  }
  const prepareCommand = selectedCommand('engagement.prepare', outcome.book.reviewId, outcome.book.reviewSha256,
    outcome.mode === 'ACTUAL');
  const receivingCommand = selectedCommand('engagement.receiving', outcome.receiving.id, outcome.receiving.sha256);
  need(same(receivingCommand.request.body.data.reviewId, outcome.book.reviewId) &&
    receivingCommand.request.body.data.reviewSha256 === outcome.book.reviewSha256 &&
    receivingCommand.request.body.data.forecastId === outcome.forecast.id &&
    receivingCommand.request.body.data.portfolioId === outcome.portfolio.id &&
    receivingCommand.response.version === outcome.sourceCaseVersion,
    'ACCEPTED_SELECTION', 'Keep the original book, saved Forecast, Portfolio and final receiving request together.');
  async function originalRead(path, withFile = false) {
    const candidates = [];
    for (const [key, step] of Object.entries(nativeJournal.steps)) {
      if (step.state !== 'COMPLETE' || step.kind || !step.request || !step.response) continue;
      const requestFile = await nativeArtifact(step.request), request = strictJSON(requestFile.data);
      if (request.method === 'GET' && request.path === path && same(request.host, nativeJournal.selection.host)) {
        const file = await nativeArtifact(step.response);
        candidates.push({key, file, descriptor:step.response, value:strictJSON(file.data)});
      }
    }
    need(candidates.length > 0 && candidates.every(row => same(row.value, candidates[0].value)),
      'ORIGINAL_READ', 'Retain the complete original selected native read.');
    return withFile ? candidates[0] : candidates[0].value;
  }
  const casePath = '/api/operations/' + outcome.sourceCaseId;
  const bookRead = await originalRead(casePath + '/engagements/' + outcome.book.reviewId, true);
  const expectedBook = bookRead.value;
  need(prepareCommand || outcome.mode === 'ACTUAL' && bookRead.key === 'actual-book-reopen',
    'EXISTING_BOOK', 'Only the original ACTUAL existing-book course may omit an accepted prepare request.');
  const expectedForecast = await originalRead(casePath + '/forecasts/' + outcome.forecast.id);
  const expectedPortfolio = await originalRead(casePath + '/portfolios/' + outcome.portfolio.id);
  const expectedReceiving = await originalRead(casePath + '/reviews/' + outcome.receiving.id);
  const expectedHistory = strictJSON((await nativeArtifact(artifacts['received-history'])).data);
  need(Array.isArray(expectedHistory), 'ORIGINAL_HISTORY', 'Retain the complete originally received native event history.');
  need(expectedBook.review?.sha256 === outcome.book.reviewSha256 &&
    (!prepareCommand || same(expectedBook.document, prepareCommand.request.body.data.document) &&
      expectedBook.previewSha256 === prepareCommand.request.body.data.expectedPreviewSha256) &&
    expectedForecast.sha256 === outcome.forecast.sha256 && expectedPortfolio.sha256 === outcome.portfolio.sha256 &&
    expectedReceiving.sha256 === outcome.receiving.sha256,
    'ORIGINAL_REVIEWS', 'Retain the actual original book, full saved model outputs and receiving review.');
  const selection = {
    schema:ENGAGEMENT_AGENT_SCHEMA + '.selection', operationId:spec.operationId,
    repositoryRoot:root, repository:manifest.repository, revision:manifest.revision,
    pathBase:manifest.pathBase, productPath:manifest.productPath, sourceManifest:spec.sourceManifest,
    providerConfiguration:spec.providerConfiguration, workspace:spec.workspace,
    native:spec.native, outputDirectory:output, chunkBytes,
    parentGuard:{path:spec.parentGuard.path, device:spec.parentGuard.device, inode:spec.parentGuard.inode},
    caseId:outcome.sourceCaseId, caseVersion:outcome.sourceCaseVersion, mode:outcome.mode,
    book:outcome.book, forecast:outcome.forecast, portfolio:outcome.portfolio, receiving:outcome.receiving,
    bookAdmission:{mode:prepareCommand ? 'REPLAYED_ACCEPTED_PREPARE' : 'VERIFIED_EXISTING_BOOK',
      originalRead:bookRead.descriptor, ...(prepareCommand ? {requestId:prepareCommand.request.body.requestId} : {})},
    requests:[prepareCommand, receivingCommand].filter(Boolean).map(row => ({
      action:row.request.body.action, requestId:row.request.body.requestId,
      requestSha256:row.step.requestSha256, requestFile:row.step.request, responseFile:row.step.response,
      resultSha256:row.step.resultSha256, recordId:row.response.recordId, reviewSha256:row.response.reviewSha256,
    })),
  };
  need(!execution || execution.record.document.original.agentSelectionSha256 === sha(json(selection)),
    'EXECUTION_CONTINUATION', 'Keep the original complete agent selection and its canonical byte hash.');
  return {spec, selection, selectionSha256:sha(json(selection)), root, output, nativeRoot,
    executionContinuation:execution?.record ?? null, executionContinuationFile:execution?.file ?? null,
    manifest, manifestFile, nativeSourceFile, sourceRows, configFile, outcomeFile, journalFile, outcome, nativeJournal,
    nativeRows, prepareCommand, receivingCommand, bookReadFile:bookRead.file,
    expectedBook, expectedForecast, expectedPortfolio, expectedReceiving, expectedHistory};
}
class Observation {
  constructor(ctx, guard, prepared) {
    this.ctx = ctx; this.guard = guard; Object.assign(this, prepared);
    this.state = null; this.journalSha = null;
    this.executionAdoptionPending = Boolean(this.executionContinuation);
  }
  async initialize() {
    await privateDirectory(this.ctx, this.output, this.output);
    await prepareOwnedOutput(this);
    await publish(this.ctx, this.guard, this.output, 'SELECTION.json', json(this.selection));
    await publish(this.ctx, this.guard, this.output, 'inputs/agent-source-manifest.json', this.manifestFile.data);
    await publish(this.ctx, this.guard, this.output, 'inputs/native-source-manifest.json', this.nativeSourceFile.data);
    await publish(this.ctx, this.guard, this.output, 'inputs/provider-configuration.json', this.configFile.data);
    await publish(this.ctx, this.guard, this.output, 'inputs/native-outcome.json', this.outcomeFile.data);
    await publish(this.ctx, this.guard, this.output, 'inputs/native-journal.json', this.journalFile.data);
    await publish(this.ctx, this.guard, this.output, 'inputs/book-original-response.json', this.bookReadFile.data);
    for (const [name, command] of [['prepare', this.prepareCommand], ['receiving', this.receivingCommand]]) {
      if (!command) continue;
      await publish(this.ctx, this.guard, this.output, 'inputs/' + name + '-request.json', command.requestFile.data);
      await publish(this.ctx, this.guard, this.output, 'inputs/' + name + '-response.json', command.responseFile.data);
    }
    try {
      const original = await inspectFile(this.ctx, join(this.output, 'JOURNAL.json'), {retain:true, privateFile:true, maximum:MAX_JSON});
      this.state = strictJSON(original.data); this.journalSha = original.sha256;
      need(this.state.schema === ENGAGEMENT_AGENT_SCHEMA + '.journal' &&
        this.state.selectionSha256 === this.selectionSha256 && same(this.state.selection, this.selection),
        'OBSERVATION_SELECTION', 'Resume the same original observation selection.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = {schema:ENGAGEMENT_AGENT_SCHEMA + '.journal', selection:this.selection,
        selectionSha256:this.selectionSha256, state:'PREPARED', steps:{}, downloads:{}, attempts:[], interruptions:[]};
      await this.save();
    }
    await retainExecutionContinuation(this, {adopt:true});
  }
  async save() {
    const raw = json(this.state);
    await publish(this.ctx, this.guard, this.output, 'JOURNAL.json', raw,
      {replace:true, expectedSha256:this.journalSha, allowStop:true});
    this.journalSha = sha(raw);
  }
  async bytes(row, maximum = MAX_FILE) {
    rel(row.path);
    return selectedFile(this.ctx, {path:join(this.output, row.path), bytes:row.bytes, sha256:row.sha256},
      {retain:true, privateFile:true, maximum});
  }
  async step(name, intent, work) {
    need(ID.test(name), 'STEP', 'Use one stable original observation phase name.');
    let saved = this.state.steps[name];
    if (!saved) {
      saved = this.state.steps[name] = {state:'PREPARED', intent, intentSha256:sha(json(intent))};
      await this.save();
    }
    need(saved.intentSha256 === sha(json(intent)) && same(saved.intent, intent),
      'STEP_CHANGED', 'Keep the original accepted observation request and source selection.');
    if (saved.state === 'COMPLETE') return strictJSON((await this.bytes(saved.response, MAX_JSON)).data);
    const path = 'observations/' + name + '.json';
    try {
      const found = await inspectFile(this.ctx, join(this.output, path), {retain:true, privateFile:true, maximum:MAX_JSON});
      const result = strictJSON(found.data);
      saved.response = {path, bytes:found.bytes, sha256:found.sha256}; saved.state = 'COMPLETE';
      await this.save(); return result;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.ctx.check(); this.guard.assert();
    saved.state = 'RUNNING'; saved.attempts = (saved.attempts ?? 0) + 1; await this.save();
    const result = await work();
    // Once a native response returns, retain it even if interruption arrived in flight.
    saved.response = await publish(this.ctx, this.guard, this.output, path, json(result), {allowStop:true});
    saved.state = 'COMPLETE'; await this.save(); this.ctx.check(); return result;
  }
  async sdk(name, intent, work, expectation) {
    const result = await this.step(name, {transport:'SDK', ...intent}, async () => {
      const packetName = 'responses/' + name + '.packet';
      let packet;
      try {
        const previous = await inspectFile(this.ctx, join(this.output, packetName),
          {retain:true, privateFile:true, maximum:65 * 1024 * 1024});
        packet = decodeSDKPacket(previous.data);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!packet) {
        const response = await work();
        need(Buffer.isBuffer(response.bytes) && response.bytes.length <= 64 * 1024 * 1024 &&
          response.sha256 === sha(response.bytes) && response.status === 200 &&
          typeof response.mediaType === 'string' && plain(response.source),
          'SDK_RESPONSE', 'Retain the full original successful SDK response.');
        const information = {mediaType:response.mediaType, status:response.status,
          bytes:response.bytes.length, sha256:response.sha256, source:response.source,
          filename:response.filename ?? null};
        const header = json(information);
        need(header.length <= 65536, 'SDK_RESPONSE', 'The native response metadata exceeds its retained bound.');
        const complete = Buffer.concat([Buffer.from('SF47-SDK-RESPONSE-1\n' + header.length + '\n'),
          header, response.bytes]);
        // One atomic packet closes the response metadata/body publication gap.
        // A later file or journal failure reuses this exact original response.
        await publish(this.ctx, this.guard, this.output, packetName, complete, {allowStop:true});
        packet = {information, bytes:response.bytes};
      }
      const file = await publish(this.ctx, this.guard, this.output,
        'responses/' + name + (/application\/json\b/i.test(packet.information.mediaType) ? '.json' :
          /application\/zip\b/i.test(packet.information.mediaType) || /\.zip$/i.test(packet.information.filename ?? '') ? '.zip' : '.bin'),
        packet.bytes, {allowStop:true});
      return {file, packet:packetName, ...packet.information};
    });
    const received = await this.bytes(result.file);
    need(received.bytes === result.bytes && received.sha256 === result.sha256,
      'SDK_RESPONSE', 'Reopen the same full original SDK response bytes.');
    const value = /application\/json\b/i.test(result.mediaType) ? strictJSON(received.data) : null;
    if (expectation) expectation(value, result);
    return {value, result, bytes:received.data};
  }
}
const immutableSaved = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'current'));
function requireBook(observation, value) {
  need(value.review?.sha256 === observation.outcome.book.reviewSha256 &&
    same(value.review, observation.expectedBook.review) && same(value.document, observation.expectedBook.document) &&
    same(value.report, observation.expectedBook.report) && value.previewSha256 === observation.expectedBook.previewSha256 &&
    value.current?.programId === observation.outcome.sourceCaseId &&
    value.current.version === observation.outcome.sourceCaseVersion && value.current.sourceChanged === false,
    'BOOK_CHANGED', 'The actual original book or current source binding changed.');
}
function requireCase(observation, value) {
  need(value.program?.id === observation.outcome.sourceCaseId &&
    value.program.version === observation.outcome.sourceCaseVersion && plain(value.records) && Array.isArray(value.sources),
    'CASE_CHANGED', 'Keep the same original complete case at the accepted final version.');
}
function caseContent(value) {
  return {program:value.program, records:value.records, sources:value.sources, plan:value.plan,
    completionPlans:value.completionPlans ?? [], installationRefs:value.installationRefs ?? []};
}

function decodeSDKPacket(raw) {
  const magic = Buffer.from('SF47-SDK-RESPONSE-1\n');
  need(raw.subarray(0, magic.length).equals(magic), 'SDK_PACKET', 'Retain the complete original SDK response packet.');
  const end = raw.indexOf(10, magic.length);
  need(end > magic.length && end - magic.length <= 6, 'SDK_PACKET', 'Retain the bounded original SDK metadata length.');
  const lengthText = raw.subarray(magic.length, end).toString('ascii');
  need(/^[1-9][0-9]*$/.test(lengthText), 'SDK_PACKET', 'Retain the exact original SDK metadata framing.');
  const length = Number(lengthText);
  need(length <= 65536 && end + 1 + length <= raw.length, 'SDK_PACKET', 'The original SDK metadata ended early.');
  const information = strictJSON(raw.subarray(end + 1, end + 1 + length));
  exact(information, ['mediaType','status','bytes','sha256','source','filename']);
  const bytes = raw.subarray(end + 1 + length);
  need(information.status === 200 && typeof information.mediaType === 'string' &&
    plain(information.source) && (information.filename === null || typeof information.filename === 'string') &&
    Number.isSafeInteger(information.bytes) && information.bytes === bytes.length &&
    bytes.length <= 64 * 1024 * 1024 && HEX.test(information.sha256) && sha(bytes) === information.sha256,
    'SDK_PACKET', 'The full original SDK response metadata and body differ.');
  return {information, bytes};
}
async function prepareOwnedOutput(o) {
  const top = await fsp.readdir(o.output);
  let selected = false;
  try {
    const row = await inspectFile(o.ctx, join(o.output, 'SELECTION.json'),
      {retain:true, privateFile:true, maximum:MAX_JSON});
    need(row.data.equals(json(o.selection)), 'OBSERVATION_SELECTION', 'Keep the original observation input and owner.');
    selected = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!selected) {
    need(top.every(name => OWN_TEMP.test(name)), 'OUTPUT_OCCUPIED',
      'The chosen observation directory has no matching original selection.');
    for (const name of top) {
      const pending = await inspectFile(o.ctx, join(o.output, name),
        {retain:true, privateFile:true, maximum:json(o.selection).length});
      need(json(o.selection).subarray(0, pending.bytes).equals(pending.data),
        'OUTPUT_OCCUPIED', 'The unpublished original selection temporary has different bytes.');
      o.guard.assert(); await fsp.unlink(join(o.output, name));
    }
    await syncDirectory(o.ctx, o.output);
    return;
  }
  // A matching original selection and the inherited parent owner permit only
  // this publisher's abandoned temporary files to be retired on reentry.
  let visited = 0;
  async function visit(directory, depth = 0) {
    o.ctx.check();
    need(depth <= 64 && ++visited <= MAX_FILES * 2, 'OUTPUT_SIZE', 'Keep the original bounded output directory tree.');
    const owner = await fsp.lstat(directory, {bigint:true});
    need(owner.isDirectory() && !owner.isSymbolicLink() && owner.uid === BigInt(process.getuid()) &&
      (owner.mode & 0o077n) === 0n && await fsp.realpath(directory) === directory,
      'PRIVATE_DIRECTORY', 'Keep the original output directories private to their owner.');
    for (const name of await fsp.readdir(directory)) {
      const filename = join(directory, name), stat = await fsp.lstat(filename, {bigint:true});
      need(!stat.isSymbolicLink(), 'OUTPUT_MEMBER', 'Keep original observation members free of aliases.');
      if (stat.isDirectory()) await visit(filename, depth + 1);
      else if (OWN_TEMP.test(name)) {
        need(stat.isFile() && stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n,
          'OUTPUT_MEMBER', 'The abandoned original publication temporary changed owner.');
        o.guard.assert(); await fsp.unlink(filename); await syncDirectory(o.ctx, directory);
      }
    }
  }
  await visit(o.output);
}


class Connections {
  constructor(observation) { this.o = observation; this.client = null; this.provider = null; this.modules = null; this.binding = null; }
  async start() {
    const o = this.o; o.ctx.check();
    const [clientModule, providerModule] = await Promise.all([
      import(pathToFileURL(join(o.root, PREFIX + 'agent-client.mjs')).href),
      import(pathToFileURL(join(o.root, PROVIDER + 'grant-workspace.mjs')).href),
    ]);
    o.ctx.check();
    this.modules = {clientModule, providerModule};
    const config = await providerModule.readGrantWorkspaceConfiguration(o.configFile.path);
    const binding = config.workspaces[o.spec.workspace];
    need(binding && binding.allowStart === false && binding.directory === o.nativeJournal.selection.host.workspaceDirectory &&
      binding.selection.sourceDirectory === join(o.nativeJournal.selection.sourceDirectory, 'workspace'),
      'NATIVE_BINDING', 'Bind the original existing native workspace and exact installed product source.');
    for (const [name, digest] of Object.entries(binding.selection.sourceSha256)) {
      const path = resolve(binding.selection.sourceDirectory, name);
      need(inside(o.root, path), 'SOURCE_CLOSURE', 'The entire original native launch closure belongs to the selected repository.');
      const relativePath = relative(o.root, path).split(sep).join('/');
      need(o.sourceRows.get(relativePath)?.sha256 === digest, 'SOURCE_CLOSURE',
        'The source manifest must retain every complete file selected by the original launch.');
    }
    this.binding = binding;
    this.providerConfig = {exportsDirectory:join(o.output, 'provider'),
      grantWorkspaces:{schema:config.schema, workspaces:{[o.spec.workspace]:binding}}};
    await privateDirectory(o.ctx, this.providerConfig.exportsDirectory, o.output);
    this.client = new clientModule.GrantWorkspaceClient(binding);
    const direct = await this.client.open({expectedSelectionSha256:binding.selectionSha256});
    need(direct.connection === 'BORROWED_ORIGINAL_SERVICE', 'BORROWED_HOST_REQUIRED', 'Only borrow the original already-running host.');
    this.provider = new providerModule.MerchantGrantWorkspaces(this.providerConfig);
    const opened = await this.provider.call('merchant_grant_open',
      {workspace:o.spec.workspace, expectedSelectionSha256:binding.selectionSha256});
    need(opened.connection === 'BORROWED_ORIGINAL_SERVICE', 'BORROWED_HOST_REQUIRED', 'The MCP provider must borrow the same original host.');
    const directInspect = await this.client.inspect();
    const providerInspect = await this.provider.call('merchant_grant_inspect', {workspace:o.spec.workspace});
    need(directInspect.original?.instanceId && same(directInspect.original, providerInspect.original) &&
      directInspect.original.selectionSha256 === binding.selectionSha256,
      'HOST_IDENTITY', 'Both maintained interfaces must resolve the same original native listener.');
    this.original = directInspect.original;
    o.ctx.check();
    return {selectionSha256:binding.selectionSha256, original:this.original,
      direct:direct.connection, provider:opened.connection};
  }
  async rotate() {
    const o = this.o, previous = this.provider;
    need(previous, 'PROVIDER_OWNER', 'Retain the original provider through its complete close.');
    const error = await closeOwned(previous, 'MCP provider and original retained file reader', value => o.ctx.report(value));
    this.provider = null;
    if (error) throw error;
    o.ctx.check();
    this.provider = new this.modules.providerModule.MerchantGrantWorkspaces(this.providerConfig);
    const opened = await this.provider.call('merchant_grant_open',
      {workspace:o.spec.workspace, expectedSelectionSha256:this.binding.selectionSha256});
    const inspected = await this.provider.call('merchant_grant_inspect', {workspace:o.spec.workspace});
    need(opened.connection === 'BORROWED_ORIGINAL_SERVICE' && same(inspected.original, this.original),
      'HOST_IDENTITY', 'Reopen the same original listener, with the same retained snapshot directory.');
    return {state:opened.connection, instanceId:inspected.original.instanceId, selectionSha256:this.binding.selectionSha256};
  }
  async close(primary = null) {
    const owners = [['provider', this.provider], ['client', this.client]].filter(([, value]) => value);
    const outcomes = await Promise.all(owners.map(async ([name, value]) =>
      ({name, value, error:await closeOwned(value, name, event => this.o.ctx.report(event))})));
    for (const result of outcomes) {
      if (this[result.name] === result.value) this[result.name] = null;
      if (result.error) primary = noteCleanup(primary, result.error);
    }
    return primary;
  }
}
function snapshotSelection(observation, value) {
  need(value?.schema === 'stellar-forge.sf47-agent-snapshot.v1' &&
    value.workspace === observation.spec.workspace && /^snapshot-[a-f0-9-]{36}$/.test(value.id ?? '') &&
    value.retention?.state === 'COMPLETE' && plain(value.file) &&
    Number.isSafeInteger(value.file.bytes) && value.file.bytes >= 0 && value.file.bytes <= 64 * 1024 * 1024 &&
    HEX.test(value.file.sha256) && typeof value.file.contentType === 'string' &&
    typeof value.file.name === 'string' && value.file.name.length > 0 && value.file.name.length <= 1000 &&
    !/[\x00-\x1f\x7f]/.test(value.file.name),
    'MCP_RETENTION', 'Retain the actual complete native snapshot before receiving any byte page.');
  return {id:value.id, workspace:value.workspace, file:value.file, selection:value.selection, source:value.source};
}
async function prefixState(o, handle, path, row) {
  const before = await handle.stat({bigint:true});
  need(before.isFile() && before.uid === BigInt(process.getuid()) && (before.mode & 0o077n) === 0n &&
    before.size >= BigInt(row.offset) && before.size <= BigInt(row.snapshot.file.bytes),
    'DOWNLOAD_PREFIX', 'Retain the complete original owned byte prefix.');
  const hasher = createHash('sha256'); let at = 0;
  for (const chunk of row.chunks) {
    o.ctx.check();
    need(chunk.offset === at && Number.isInteger(chunk.bytes) && chunk.bytes > 0 &&
      chunk.bytes <= CHUNK && HEX.test(chunk.sha256) && at + chunk.bytes <= row.offset,
      'DOWNLOAD_PREFIX', 'Keep contiguous original durable byte pages.');
    const bytes = Buffer.alloc(chunk.bytes); let read = 0;
    while (read < bytes.length) {
      o.ctx.check(); const result = await handle.read(bytes, read, bytes.length - read, at + read);
      need(result.bytesRead > 0, 'DOWNLOAD_PREFIX', 'The original durable prefix ended early.'); read += result.bytesRead;
    }
    need(sha(bytes) === chunk.sha256, 'DOWNLOAD_PREFIX', 'A retained original byte page changed.');
    hasher.update(bytes); at += bytes.length;
  }
  need(at === row.offset && hasher.copy().digest('hex') === row.prefixSha256,
    'DOWNLOAD_PREFIX', 'The whole retained original prefix differs from its checkpoint.');
  const after = await handle.stat({bigint:true}), current = await fsp.lstat(path, {bigint:true});
  need(statKey(before) === statKey(after) && statKey(current) === statKey(after),
    'DOWNLOAD_PREFIX', 'The original file changed during prefix verification.');
  if (Number(after.size) !== row.offset) {
    // Only uncommitted bytes after this original durable checkpoint are discarded.
    o.guard.assert(); await handle.truncate(row.offset); await handle.sync();
  }
  return hasher;
}
async function receiveSnapshot(o, connections, name, snapshot, {interrupt = false} = {}) {
  const selected = snapshotSelection(o, snapshot), suffix = /application\/json\b/i.test(selected.file.contentType)
    ? '.json' : selected.file.name.toLowerCase().endsWith('.zip') ? '.zip' : '.bin';
  let row = o.state.downloads[name];
  if (!row) {
    row = o.state.downloads[name] = {state:'PREPARED', snapshot:selected,
      path:'downloads/' + name + suffix, partial:'downloads/' + name + '.partial',
      offset:0, prefixSha256:sha(Buffer.alloc(0)), chunks:[]};
    await o.save();
  }
  need(same(row.snapshot, selected), 'SNAPSHOT_CHANGED', 'Resume the same original snapshot, metadata and complete SHA-256.');
  const target = join(o.output, row.path), partial = join(o.output, row.partial);
  if (row.state === 'COMPLETE') {
    await selectedFile(o.ctx, {path:target, bytes:selected.file.bytes, sha256:selected.file.sha256}, {privateFile:true});
    return {path:row.path, bytes:selected.file.bytes, sha256:selected.file.sha256};
  }
  try {
    const done = await inspectFile(o.ctx, target, {privateFile:true});
    need(done.bytes === selected.file.bytes && done.sha256 === selected.file.sha256,
      'DOWNLOAD_CHANGED', 'The published complete original download changed.');
    try {
      const prior = await inspectFile(o.ctx, partial, {privateFile:true});
      need(prior.bytes === done.bytes && prior.sha256 === done.sha256, 'DOWNLOAD_CHANGED',
        'The remaining original download temporary has different bytes.');
      o.guard.assert(); await fsp.unlink(partial); await syncDirectory(o.ctx, dirname(partial));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    row.state = 'COMPLETE'; row.offset = done.bytes; row.completedSha256 = done.sha256; await o.save();
    return {path:row.path, bytes:done.bytes, sha256:done.sha256};
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await privateDirectory(o.ctx, dirname(target), o.output); o.guard.assert();
  let handle, primary = null, file;
  try {
    try { handle = await fsp.open(partial, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      need(row.offset === 0, 'DOWNLOAD_MISSING', 'The original durable byte prefix is unavailable.');
      handle = await fsp.open(partial, 'wx+', 0o600);
    }
    o.ctx.handles.add(handle);
    let hasher = await prefixState(o, handle, partial, row), readId;
    if (row.interruption?.state === 'PREFIX_DURABLE') {
      need(row.offset === row.interruption.offset && row.prefixSha256 === row.interruption.prefixSha256,
        'DOWNLOAD_PREFIX', 'Reopen the exact prefix retained before the previous provider closed.');
      row.interruption = {...row.interruption, state:'SAME_SNAPSHOT_REOPENED', reopened:{
        state:'BORROWED_ORIGINAL_SERVICE', instanceId:connections.original.instanceId,
        selectionSha256:connections.binding.selectionSha256, recovery:'original-provider-on-process-reentry'}};
      o.state.interruptions.push({file:name, ...row.interruption}); await o.save();
    }
    while (row.offset < selected.file.bytes || selected.file.bytes === 0 && row.state !== 'EMPTY_VERIFIED') {
      o.ctx.check(); o.guard.assert();
      const remaining = selected.file.bytes - row.offset;
      let limit = o.selection.chunkBytes;
      if (interrupt && !row.interruption && row.offset === 0 && remaining > 1)
        limit = Math.min(limit, Math.max(1, Math.floor(remaining / 2)));
      const args = {workspace:o.spec.workspace, snapshotId:selected.id, expectedSha256:selected.file.sha256,
        offset:row.offset, limit, ...(readId ? {readId} : {})};
      const page = await connections.provider.call('merchant_grant_file_read', args);
      need(page.file?.sha256 === selected.file.sha256 && page.file.bytes === selected.file.bytes &&
        page.file.name === selected.file.name && page.offset === row.offset && page.encoding === 'base64' &&
        Number.isInteger(page.bytesRead) && page.bytesRead === Math.min(limit, remaining) &&
        typeof page.data === 'string' && page.data.length <= Math.ceil(CHUNK / 3) * 4 &&
        typeof page.readId === 'string' && page.readId.length > 0 && page.readId.length <= 100 &&
        (!readId || page.readId === readId),
        'MCP_BYTE_PAGE', 'The native byte page differs from its exact retained snapshot.');
      const bytes = Buffer.from(page.data, 'base64');
      need(bytes.length === page.bytesRead && bytes.toString('base64') === page.data &&
        page.nextOffset === (row.offset + bytes.length < selected.file.bytes ? row.offset + bytes.length : null),
        'MCP_BYTE_PAGE', 'Keep complete canonical original byte pages and their native next offset.');
      o.ctx.check();
      const offset = row.offset; let written = 0;
      while (written < bytes.length) {
        const result = await handle.write(bytes, written, bytes.length - written, offset + written);
        need(result.bytesWritten > 0, 'DOWNLOAD_WRITE', 'The original byte page did not finish writing.');
        written += result.bytesWritten;
      }
      await handle.sync();
      hasher.update(bytes);
      if (bytes.length) row.chunks.push({offset, bytes:bytes.length, sha256:sha(bytes)});
      row.offset += bytes.length; row.prefixSha256 = hasher.copy().digest('hex');
      row.state = bytes.length ? 'RECEIVING' : 'EMPTY_VERIFIED';
      readId = page.nextOffset === null ? undefined : page.readId;
      await o.save();
      o.ctx.report({state:'RECEIVING', file:name, bytes:row.offset, total:selected.file.bytes});
      o.ctx.check();
      if (interrupt && !row.interruption && row.offset > 0 && row.offset < selected.file.bytes) {
        row.interruption = {state:'PREFIX_DURABLE', offset:row.offset, prefixSha256:row.prefixSha256,
          snapshotId:selected.id, sha256:selected.file.sha256, originalReadId:readId};
        await o.save();
        // The live RetainedFileReads session is drained by its actual original owner.
        const reopened = await connections.rotate(); readId = undefined;
        hasher = await prefixState(o, handle, partial, row);
        row.interruption = {...row.interruption, state:'SAME_SNAPSHOT_REOPENED', reopened};
        o.state.interruptions.push({file:name, ...row.interruption});
        await o.save();
      }
    }
    need(row.offset === selected.file.bytes && hasher.digest('hex') === selected.file.sha256,
      'DOWNLOAD_HASH', 'The complete original download differs from its native SHA-256.');
    await handle.sync(); const closing = handle; handle = null;
    const closeError = await o.ctx.closeFile(closing); if (closeError) throw closeError;
    const checked = await inspectFile(o.ctx, partial, {privateFile:true});
    need(checked.bytes === selected.file.bytes && checked.sha256 === selected.file.sha256,
      'DOWNLOAD_HASH', 'The closed complete original download changed.');
    o.guard.assert();
    try { await fsp.link(partial, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await selectedFile(o.ctx, {path:target, bytes:selected.file.bytes, sha256:selected.file.sha256}, {privateFile:true});
    }
    await syncDirectory(o.ctx, dirname(target)); await fsp.unlink(partial); await syncDirectory(o.ctx, dirname(target));
    row.state = 'COMPLETE'; row.completedSha256 = selected.file.sha256; await o.save();
    file = {path:row.path, bytes:selected.file.bytes, sha256:selected.file.sha256};
  } catch (error) { primary = error; }
  primary = await o.ctx.closeFile(handle, primary);
  if (primary) throw primary;
  return file;
}
async function mcp(o, connections, name, verb, fields, options = {}) {
  const tool = 'merchant_grant_' + verb, args = {workspace:o.spec.workspace, ...fields};
  const snapshot = await o.step(name, {transport:'MCP', tool, args}, async () => {
    const result = await connections.provider.call(tool, args);
    snapshotSelection(o, result); return result;
  });
  const file = await receiveSnapshot(o, connections, name, snapshot, options);
  const actual = await o.bytes(file);
  const value = /application\/json\b/i.test(snapshot.file.contentType) ? strictJSON(actual.data) : null;
  return {snapshot, file, bytes:actual.data, value};
}
async function originalTransfer(o, connections, name, originalFile) {
  const raw = originalFile.data;
  const args = {workspace:o.spec.workspace, requestId:'agent-' + sha(Buffer.from(o.spec.operationId + '\0' + name)),
    filename:name + '-original-input.json', bytes:raw.length, sha256:sha(raw), mediaType:'application/json'};
  const begin = await connections.provider.call('merchant_grant_receive_begin', args);
  need(/^input-[a-f0-9]{64}$/.test(begin.transferId ?? '') && begin.file?.bytes === raw.length &&
    begin.file.sha256 === sha(raw) && begin.chunkBytes === CHUNK && Array.isArray(begin.missingOffsets),
    'INPUT_TRANSFER', 'Reopen the exact original complete request input transfer.');
  const missing = begin.missingOffsets;
  need(new Set(missing).size === missing.length && missing.every(offset =>
    Number.isInteger(offset) && offset >= 0 && offset < raw.length && offset % CHUNK === 0),
    'INPUT_TRANSFER', 'Use the native original missing byte offsets.');
  for (const offset of missing) {
    o.ctx.check();
    const bytes = raw.subarray(offset, Math.min(raw.length, offset + CHUNK));
    const result = await connections.provider.call('merchant_grant_receive_chunk', {
      workspace:o.spec.workspace, transferId:begin.transferId, offset, data:bytes.toString('base64')});
    need(result.transferId === begin.transferId && result.offset === offset && result.bytes === bytes.length,
      'INPUT_TRANSFER', 'Retain the original whole request input bytes.');
  }
  const completed = await connections.provider.call('merchant_grant_receive_commit',
    {workspace:o.spec.workspace, transferId:begin.transferId});
  need(completed.state === 'COMPLETE' && completed.file?.bytes === raw.length &&
    completed.file.sha256 === sha(raw) && completed.missingOffsets?.length === 0,
    'INPUT_TRANSFER', 'The original provider must verify every input byte before replay.');
  await o.step('input-' + name, {request:args, transferId:begin.transferId}, async () => completed);
  return {input:{transferId:begin.transferId}, expectedInputSha256:sha(raw)};
}
function pointer(value, path) {
  for (const field of path.slice(1).split('/')) {
    const key = field.replace(/~1/g, '/').replace(/~0/g, '~');
    need(value && typeof value === 'object' && Object.hasOwn(value, key),
      'SNAPSHOT_POINTER', 'Read the original retained JSON pointer.'); value = value[key];
  }
  return value;
}
async function inspectRows(o, connections, name, source, path) {
  const expected = pointer(source.value, path);
  need(Array.isArray(expected), 'SNAPSHOT_ARRAY', 'Select the actual original array from its full verified JSON bytes.');
  const binding = {workspace:o.spec.workspace, snapshotId:source.snapshot.id,
    expectedSha256:source.snapshot.file.sha256, pointer:path};
  await o.step(name + '-snapshot', {tool:'merchant_grant_snapshot', ...binding},
    () => connections.provider.call('merchant_grant_snapshot', binding));
  let offset = 0, page = 0;
  while (offset < expected.length || page === 0) {
    o.ctx.check(); const selected = offset;
    const result = await o.step(name + '-rows-' + page, {tool:'merchant_grant_rows', ...binding, offset:selected, limit:200},
      () => connections.provider.call('merchant_grant_rows', {...binding, offset:selected, limit:200}));
    need(result.count === expected.length && result.offset === selected && Array.isArray(result.rows) &&
      same(result.rows, expected.slice(selected, selected + result.rows.length)),
      'SNAPSHOT_ROWS', 'Every paged row must match the complete original retained response.');
    if (result.largeRow) {
      need(result.rows.length === 0 && result.largeRow.index === selected && result.nextOffset === selected,
        'SNAPSHOT_ROWS', 'Keep the native oversized-row boundary.');
      // Its complete original row is already present in the hash-verified file.
      offset = selected + 1;
    } else {
      const next = selected + result.rows.length;
      need(result.nextOffset === (next < expected.length ? next : null) && (next > selected || next === expected.length),
        'SNAPSHOT_ROWS', 'The complete original native array must advance.');
      offset = next;
    }
    page++;
  }
  return {pointer:path, count:expected.length, pages:page, completeFile:source.file};
}


function commandBody(selected) {
  const {action, data, ...identity} = selected.request.body;
  return {...identity, ...data};
}
function commandIdentity(selected) {
  const {action, data, ...identity} = selected.request.body;
  return identity;
}
function requireList(o, value) {
  need(plain(value) && Array.isArray(value.engagements) && Array.isArray(value.receivings) &&
    value.engagements.some(row => row.id === o.outcome.book.reviewId && row.sha256 === o.outcome.book.reviewSha256) &&
    value.receivings.some(row => row.id === o.outcome.receiving.id && row.sha256 === o.outcome.receiving.sha256),
    'ORIGINAL_EDITIONS', 'Retain the selected book, receiving review and all earlier native editions.');
}
function requireSeed(o, value) {
  need(same(value.document, {...o.expectedBook.document, supersedes:o.outcome.book}) &&
    value.previous?.id === o.outcome.book.reviewId && value.previous.sha256 === o.outcome.book.reviewSha256 &&
    Array.isArray(value.contributors) && Array.isArray(value.packages) && Array.isArray(value.sources),
    'ORIGINAL_SEED', 'Read the native successor seed from this exact saved book without saving another edition.');
}
function requirePreview(o, kind, value) {
  if (kind === 'book') {
    need(same(value.document, o.expectedBook.document) && same(value.report, o.expectedBook.report) &&
      value.source?.programId === o.outcome.sourceCaseId &&
      value.source.version === o.outcome.sourceCaseVersion &&
      value.source.bindingSha256 === o.expectedBook.source.bindingSha256 && HEX.test(value.previewSha256),
      'ORIGINAL_PREVIEW', 'Read the complete original document and unchanged business binding at the current case version.');
  } else {
    const expected = kind === 'forecast' ? o.expectedForecast : o.expectedPortfolio;
    const selection = o.receivingCommand.request.body.data[kind + 'Selection'];
    need(same(value.inputs, expected.inputs) && same(value.selection, selection) &&
      value.source?.book?.id === o.outcome.book.reviewId &&
      value.source.book.sha256 === o.outcome.book.reviewSha256 &&
      value[kind]?.source?.programId === o.outcome.sourceCaseId &&
      value[kind].source.version === o.outcome.sourceCaseVersion &&
      HEX.test(value[kind].previewSha256),
      'ORIGINAL_MODEL_PREVIEW', 'Retain the full native preview of the original saved model inputs and selection.');
  }
}
async function readFullHistory(o, connections, transport) {
  const events = []; let after = 0, count = 0;
  for (;;) {
    need(count < 100000, 'HISTORY_LIMIT', 'The original history exceeded its complete bounded page count.');
    const fields = {caseId:o.outcome.sourceCaseId, after, limit:200};
    const received = transport === 'SDK'
      ? await o.sdk('sdk-history-' + count, {view:'case-history', args:fields},
        () => connections.client.read('case-history', fields))
      : await mcp(o, connections, 'mcp-history-' + count, 'case_history', fields);
    const value = received.value;
    need(plain(value) && value.currentVersion === o.outcome.sourceCaseVersion && Array.isArray(value.events) &&
      value.events.length <= 200, 'ORIGINAL_HISTORY', 'Read the complete original event history at the accepted version.');
    events.push(...value.events); count++;
    if (value.nextAfter === null) break;
    need(Number.isSafeInteger(value.nextAfter) && value.nextAfter > after && value.events.length > 0,
      'HISTORY_CURSOR', 'The original event cursor must advance.');
    after = value.nextAfter;
  }
  need(same(events, o.expectedHistory), 'ORIGINAL_HISTORY', 'Every original event must match the completed native receiving.');
  return {pages:count, events:events.length, sha256:sha(json(events))};
}
async function course(o, connections) {
  const caseId = o.outcome.sourceCaseId, expectedVersion = o.outcome.sourceCaseVersion;
  // Fresh reads guard every resumed course, even when its durable substeps exist.
  const current = await connections.client.read('case', {caseId});
  requireCase(o, current.value);
  const before = await o.sdk('sdk-case-before', {view:'case', args:{caseId}},
    async () => current, value => requireCase(o, value));
  need(same(caseContent(before.value), caseContent(current.value)), 'CASE_CHANGED',
    'Keep the complete originally observed case across agent reentry.');
  const list = await o.sdk('sdk-engagements', {view:'engagements', args:{caseId}},
    () => connections.client.read('engagements', {caseId}), value => requireList(o, value));
  const book = await o.sdk('sdk-book', {view:'engagement', args:{caseId, reviewId:o.outcome.book.reviewId}},
    () => connections.client.read('engagement', {caseId, reviewId:o.outcome.book.reviewId}),
    value => requireBook(o, value));
  const models = {};
  for (const [name, view, key, selected, expected] of [
    ['forecast','forecast','forecastId',o.outcome.forecast,o.expectedForecast],
    ['portfolio','portfolio','portfolioId',o.outcome.portfolio,o.expectedPortfolio],
    ['receiving','review','reviewId',o.outcome.receiving,o.expectedReceiving],
  ]) {
    const fields = {caseId, [key]:selected.id};
    models[name] = await o.sdk('sdk-' + name, {view, args:fields},
      () => connections.client.read(view, fields),
      value => need(same(immutableSaved(value), immutableSaved(expected)), 'SAVED_MODEL_CHANGED',
        'Retain every original saved model and receiving review field.'));
  }
  const seed = await o.sdk('sdk-engagement-seed', {caseId, expectedVersion, reviewId:o.outcome.book.reviewId},
    () => connections.client.engagementSeed(caseId, expectedVersion, o.outcome.book.reviewId),
    value => requireSeed(o, value));
  const preview = await o.sdk('sdk-engagement-preview',
    {caseId, expectedVersion, document:o.expectedBook.document},
    () => connections.client.engagementPreview(caseId, expectedVersion, o.expectedBook.document),
    value => requirePreview(o, 'book', value));
  const modelPreviews = {};
  for (const kind of ['forecast','portfolio']) {
    const selection = o.receivingCommand.request.body.data[kind + 'Selection'];
    modelPreviews[kind] = await o.sdk('sdk-engagement-' + kind, {caseId, expectedVersion, selection},
      () => connections.client[kind === 'forecast' ? 'engagementForecast' : 'engagementPortfolio'](
        caseId, expectedVersion, selection), value => requirePreview(o, kind, value));
  }
  const replays = [];
  for (const [name, selected, method] of [
    ['prepare',o.prepareCommand,'engagementPrepare'], ['receiving',o.receivingCommand,'engagementReceiving'],
  ]) {
    if (!selected) continue;
    const body = commandBody(selected);
    const receipt = await o.sdk('sdk-replay-' + name,
      {caseId, originalRequestSha256:selected.step.requestSha256, body},
      () => connections.client[method](caseId, body),
      value => need(same(value, selected.response), 'ORIGINAL_REPLAY',
        'The same original command must return its previously accepted complete result.'));
    replays.push({transport:'SDK', action:selected.request.body.action, requestId:body.requestId,
      originalRequestSha256:selected.step.requestSha256, originalResultSha256:selected.step.resultSha256,
      response:receipt.result.file});
  }
  const nativeRows = {};
  nativeRows.case = await mcp(o, connections, 'mcp-case', 'case', {caseId});
  requireCase(o, nativeRows.case.value);
  need(same(caseContent(nativeRows.case.value), caseContent(before.value)), 'CASE_CHANGED',
    'Both original interfaces must expose the same complete native case.');
  nativeRows.list = await mcp(o, connections, 'mcp-engagements', 'engagements', {caseId});
  requireList(o, nativeRows.list.value);
  need(same(nativeRows.list.value, list.value), 'ORIGINAL_EDITIONS', 'Keep all original engagement and receiving summaries.');
  nativeRows.book = await mcp(o, connections, 'mcp-book', 'engagement', {caseId, reviewId:o.outcome.book.reviewId});
  requireBook(o, nativeRows.book.value);
  need(same(nativeRows.book.value, book.value), 'BOOK_CHANGED', 'The full SDK and MCP original book must agree.');
  for (const [name, view, key, selected] of [
    ['forecast','forecast','forecastId',o.outcome.forecast],
    ['portfolio','portfolio','portfolioId',o.outcome.portfolio],
    ['receiving','review','reviewId',o.outcome.receiving],
  ]) {
    nativeRows[name] = await mcp(o, connections, 'mcp-' + name, view, {caseId, [key]:selected.id});
    need(same(nativeRows[name].value, models[name].value), 'SAVED_MODEL_CHANGED',
      'The complete original saved model must agree through SDK and MCP.');
  }
  const paged = [
    await inspectRows(o, connections, 'edition-list', nativeRows.list, '/engagements'),
    await inspectRows(o, connections, 'receiving-list', nativeRows.list, '/receivings'),
    await inspectRows(o, connections, 'agreement-list', nativeRows.book, '/document/agreements'),
  ];
  const transferred = {
    book:await originalTransfer(o, connections, o.prepareCommand ? 'prepare' : 'existing-book',
      o.prepareCommand ? o.prepareCommand.requestFile : o.bookReadFile),
    receiving:await originalTransfer(o, connections, 'receiving', o.receivingCommand.requestFile),
  };
  const bookPointer = o.prepareCommand ? '/body/data/document' : '/document';
  const mcpSeed = await mcp(o, connections, 'mcp-engagement-seed', 'engagement_seed',
    {caseId, expectedVersion, reviewId:o.outcome.book.reviewId});
  requireSeed(o, mcpSeed.value);
  need(same(mcpSeed.value, seed.value), 'ORIGINAL_SEED', 'Both interfaces must retain the same native source seed.');
  const mcpPreview = await mcp(o, connections, 'mcp-engagement-preview', 'engagement_preview',
    {caseId, expectedVersion, ...transferred.book, inputPointer:bookPointer});
  requirePreview(o, 'book', mcpPreview.value);
  need(same(mcpPreview.value, preview.value), 'ORIGINAL_PREVIEW', 'Both interfaces must retain the full same native preview.');
  for (const kind of ['forecast','portfolio']) {
    const received = await mcp(o, connections, 'mcp-engagement-' + kind, 'engagement_' + kind,
      {caseId, expectedVersion, ...transferred.receiving, inputPointer:'/body/data/' + kind + 'Selection'});
    requirePreview(o, kind, received.value);
    need(same(received.value, modelPreviews[kind].value), 'ORIGINAL_MODEL_PREVIEW',
      'Both interfaces must retain the complete original native model preview.');
  }
  for (const [name, selected] of [['prepare',o.prepareCommand], ['receiving',o.receivingCommand]]) {
    if (!selected) continue;
    const fields = {caseId, ...commandIdentity(selected), ...(name === 'prepare' ? transferred.book : transferred.receiving),
      inputPointer:name === 'prepare' ? '/body/data/document' : '/body/data',
      ...(name === 'prepare' ? {expectedPreviewSha256:selected.request.body.data.expectedPreviewSha256} : {})};
    const receipt = await mcp(o, connections, 'mcp-replay-' + name, 'engagement_' + name, fields);
    need(same(receipt.value, selected.response), 'ORIGINAL_REPLAY',
      'The verified original input must replay the same already-accepted native command result.');
    replays.push({transport:'MCP', action:selected.request.body.action, requestId:fields.requestId,
      originalRequestSha256:selected.step.requestSha256, originalResultSha256:selected.step.resultSha256,
      response:receipt.file, snapshotId:receipt.snapshot.id});
  }
  const exportFields = {caseId, reviewId:o.outcome.book.reviewId};
  const sdkExport = await o.sdk('sdk-complete-export', {kind:'engagement', args:exportFields},
    () => connections.client.download('engagement', exportFields));
  need(sdkExport.bytes.length > 1 && /(?:application\/zip|application\/octet-stream)\b/i.test(sdkExport.result.mediaType),
    'NATIVE_EXPORT', 'Receive the complete original native case ZIP.');
  const mcpExport = await mcp(o, connections, 'mcp-complete-export', 'export',
    {kind:'engagement', ...exportFields}, {interrupt:true});
  need(mcpExport.bytes.length > 1 && o.state.downloads['mcp-complete-export'].interruption?.state === 'SAME_SNAPSHOT_REOPENED',
    'NATIVE_EXPORT_REOPEN', 'Complete the same native export snapshot after the original file-reader owner closes and reopens.');
  const sources = [];
  for (const source of before.value.sources) {
    need(/^source-[a-f0-9]{32}$/.test(source.id ?? '') && Number.isSafeInteger(source.bytes) &&
      source.bytes >= 0 && source.bytes <= 32 * 1024 * 1024 && HEX.test(source.sha256),
      'ORIGINAL_SOURCE', 'Select each complete original native source attachment.');
    const fields = {caseId, sourceId:source.id};
    const direct = await o.sdk('sdk-' + source.id, {kind:'source', args:fields},
      () => connections.client.download('source', fields));
    const viaMcp = await mcp(o, connections, 'mcp-' + source.id, 'export', {kind:'source', ...fields});
    need(direct.bytes.length === source.bytes && sha(direct.bytes) === source.sha256 &&
      viaMcp.bytes.length === source.bytes && sha(viaMcp.bytes) === source.sha256 &&
      direct.bytes.equals(viaMcp.bytes), 'ORIGINAL_SOURCE', 'Receive every unchanged original source byte through both interfaces.');
    sources.push({id:source.id, bytes:source.bytes, sha256:source.sha256,
      SDK:direct.result.file, MCP:viaMcp.file, snapshotId:viaMcp.snapshot.id});
  }
  const history = {SDK:await readFullHistory(o, connections, 'SDK'),
    MCP:await readFullHistory(o, connections, 'MCP')};
  const final = await connections.client.read('case', {caseId});
  requireCase(o, final.value);
  need(same(caseContent(final.value), caseContent(before.value)), 'CASE_CHANGED',
    'Agent observation and original request replays must preserve the entire accepted case.');
  await o.sdk('sdk-case-after', {view:'case', args:{caseId}}, async () => final,
    value => need(same(caseContent(value), caseContent(before.value)), 'CASE_CHANGED',
      'Retain the complete original final case observation.'));
  const inspected = await connections.provider.call('merchant_grant_inspect', {workspace:o.spec.workspace});
  need(same(inspected.original, connections.original), 'HOST_IDENTITY', 'Keep the original managed listener through final receiving.');
  await o.step('final-host', {workspace:o.spec.workspace, selectionSha256:connections.binding.selectionSha256},
    async () => inspected.original);
  return {
    schema:ENGAGEMENT_AGENT_SCHEMA + '.observation', operationId:o.spec.operationId,
    selectionSha256:o.selectionSha256, originalHost:connections.original,
    native:o.outcome, requests:o.selection.requests, bookAdmission:o.selection.bookAdmission, replays, sources, history, paged,
    exports:[
      {path:join(o.output, sdkExport.result.file.path), bytes:sdkExport.result.file.bytes,
        sha256:sdkExport.result.file.sha256, transport:'SDK'},
      {path:join(o.output, mcpExport.file.path), bytes:mcpExport.file.bytes,
        sha256:mcpExport.file.sha256, transport:'MCP', snapshotId:mcpExport.snapshot.id},
    ],
    sourceManifest:o.spec.sourceManifest, nativeFiles:o.spec.native,
    interruption:o.state.downloads['mcp-complete-export'].interruption,
    originalCaseVersion:o.outcome.sourceCaseVersion,
    ...(o.executionContinuation ? {executionContinuation:o.executionContinuation} : {}),
  };
}


function journalBasis(state) {
  return {schema:state.schema, selection:state.selection, selectionSha256:state.selectionSha256,
    steps:state.steps, downloads:state.downloads, interruptions:state.interruptions,
    ...(state.executionContinuation ? {executionContinuation:state.executionContinuation} : {})};
}
async function treeInventory(ctx, root, excluded = new Set(), synchronize = false) {
  const rows = [], directories = []; let total = 0;
  async function walk(directory, prefix) {
    ctx.check();
    const info = await fsp.lstat(directory, {bigint:true});
    need(info.isDirectory() && !info.isSymbolicLink() && info.uid === BigInt(process.getuid()) &&
      (info.mode & 0o077n) === 0n && await fsp.realpath(directory) === directory,
      'PRIVATE_DIRECTORY', 'Keep every retained observation directory private and original.');
    directories.push(directory);
    need(directories.length <= MAX_FILES, 'OUTPUT_SIZE', 'The original observation has too many directories.');
    for (const name of (await fsp.readdir(directory)).sort()) {
      const member = prefix ? prefix + '/' + name : name; rel(member);
      if (excluded.has(member)) continue;
      const filename = join(directory, name), stat = await fsp.lstat(filename, {bigint:true});
      need(!stat.isSymbolicLink(), 'OUTPUT_MEMBER', 'Keep the complete original output free of symlinks.');
      if (stat.isDirectory()) { await walk(filename, member); continue; }
      need(stat.isFile() && !OWN_TEMP.test(name), 'OUTPUT_MEMBER',
        'Only complete closed regular original members belong to the observation.');
      const file = await inspectFile(ctx, filename, {privateFile:true});
      total += file.bytes;
      need(rows.length < MAX_FILES && total <= 2 * 1024 * 1024 * 1024,
        'OUTPUT_SIZE', 'The complete retained observation exceeds its explicit 2 GiB or file-count bound.');
      rows.push({path:member, bytes:file.bytes, sha256:file.sha256, mode:file.mode});
    }
  }
  await walk(root, '');
  rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (synchronize) {
    for (const directory of directories.sort((left, right) => right.split(sep).length - left.split(sep).length ||
      (left < right ? -1 : left > right ? 1 : 0))) await syncDirectory(ctx, directory);
    await syncDirectory(ctx, dirname(root));
  }
  return rows;
}
async function loadObservation(ctx, prepared) {
  const o = new Observation(ctx, null, prepared);
  const selected = await inspectFile(ctx, join(o.output, 'SELECTION.json'),
    {retain:true, privateFile:true, maximum:MAX_JSON});
  need(selected.data.equals(json(o.selection)), 'OBSERVATION_SELECTION', 'Reopen the exact original observation selection.');
  const journal = await inspectFile(ctx, join(o.output, 'JOURNAL.json'),
    {retain:true, privateFile:true, maximum:MAX_JSON});
  o.state = strictJSON(journal.data); o.journalSha = journal.sha256;
  need(o.state.schema === ENGAGEMENT_AGENT_SCHEMA + '.journal' &&
    o.state.selectionSha256 === o.selectionSha256 && same(o.state.selection, o.selection) &&
    plain(o.state.steps) && plain(o.state.downloads) && Array.isArray(o.state.attempts),
    'OBSERVATION_JOURNAL', 'Retain the complete original observation journal.');
  await retainExecutionContinuation(o);
  return o;
}
function inventoryMap(rows) {
  need(Array.isArray(rows) && rows.length > 0 && rows.length <= MAX_FILES,
    'OUTPUT_MANIFEST', 'Retain every complete original observation file.');
  const result = new Map(); let total = 0;
  for (const row of rows) {
    rel(row.path);
    need(!result.has(row.path) && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= MAX_FILE &&
      HEX.test(row.sha256) && Number.isInteger(row.mode) && row.mode >= 0 && row.mode <= 0o777 &&
      (row.mode & 0o077) === 0, 'OUTPUT_MANIFEST', 'Retain unique complete private file identities and modes.');
    total += row.bytes; need(total <= 2 * 1024 * 1024 * 1024, 'OUTPUT_MANIFEST', 'The complete output exceeds its declared bound.');
    result.set(row.path, row);
  }
  return result;
}
function boundOutputFile(o, files, value) {
  need(plain(value), 'OUTPUT_BINDING', 'Retain the original complete output descriptor.');
  const name = isAbsolute(value.path) ? relative(o.output, value.path).split(sep).join('/') : value.path;
  rel(name); const row = files.get(name);
  need(row && row.bytes === value.bytes && row.sha256 === value.sha256 &&
    (!isAbsolute(value.path) || join(o.output, name) === value.path),
    'OUTPUT_BINDING', 'Every returned original artifact must be bound to the complete file manifest.');
  return row;
}
async function validateObservation(o, value, rows) {
  const files = inventoryMap(rows);
  need(value.schema === ENGAGEMENT_AGENT_SCHEMA + '.observation' && value.operationId === o.spec.operationId &&
    value.selectionSha256 === o.selectionSha256 && same(value.native, o.outcome) &&
    same(value.requests, o.selection.requests) && same(value.bookAdmission, o.selection.bookAdmission) &&
    same(value.sourceManifest, o.spec.sourceManifest) &&
    same(value.nativeFiles, o.spec.native) && value.originalCaseVersion === o.outcome.sourceCaseVersion &&
    same(value.executionContinuation ?? null, o.executionContinuation),
    'CLOSED_OBSERVATION', 'Retain the same original complete native case, source, request and observation outcome.');
  need(Array.isArray(value.replays) && value.replays.length === o.selection.requests.length * 2 &&
    Array.isArray(value.exports) && value.exports.length === 2 && Array.isArray(value.sources),
    'CLOSED_OBSERVATION', 'Retain both original command replays and both complete native exports.');
  for (const transport of ['SDK','MCP']) {
    for (const selected of [o.prepareCommand, o.receivingCommand].filter(Boolean)) {
      const found = value.replays.filter(row => row.transport === transport &&
        row.action === selected.request.body.action && row.requestId === selected.request.body.requestId);
      need(found.length === 1 && found[0].originalRequestSha256 === selected.step.requestSha256 &&
        found[0].originalResultSha256 === selected.step.resultSha256,
        'CLOSED_REQUEST', 'Keep every original accepted request and result identity.');
      const row = boundOutputFile(o, files, found[0].response);
      const bytes = await o.bytes(row, MAX_JSON);
      need(same(strictJSON(bytes.data), selected.response), 'CLOSED_REQUEST',
        'The complete original replay response differs from the accepted native result.');
    }
    const exports = value.exports.filter(row => row.transport === transport);
    need(exports.length === 1 && exports[0].bytes > 1, 'CLOSED_EXPORT', 'Retain one full original native case ZIP per interface.');
    boundOutputFile(o, files, exports[0]);
  }
  const download = o.state.downloads['mcp-complete-export'];
  need(download?.state === 'COMPLETE' && download.interruption?.state === 'SAME_SNAPSHOT_REOPENED' &&
    same(value.interruption, download.interruption) &&
    value.interruption.snapshotId === download.snapshot.id &&
    value.interruption.sha256 === download.snapshot.file.sha256 &&
    value.interruption.offset > 0 && value.interruption.offset < download.snapshot.file.bytes,
    'CLOSED_REOPEN', 'Keep the actual durable prefix and original same-snapshot reopen.');
  need(o.state.steps['sdk-case-before']?.state === 'COMPLETE', 'CLOSED_CASE',
    'Retain the original complete case observation.');
  const beforeMeta = strictJSON((await o.bytes(o.state.steps['sdk-case-before'].response, MAX_JSON)).data);
  boundOutputFile(o, files, beforeMeta.file);
  const before = strictJSON((await o.bytes(beforeMeta.file, MAX_JSON)).data); requireCase(o, before);
  need(value.sources.length === before.sources.length &&
    new Set(value.sources.map(row => row.id)).size === value.sources.length, 'CLOSED_SOURCES',
    'Retain every complete original source exactly once.');
  for (const source of before.sources) {
    const observed = value.sources.find(row => row.id === source.id);
    need(observed && observed.bytes === source.bytes && observed.sha256 === source.sha256,
      'CLOSED_SOURCES', 'Retain the exact original source metadata.');
    for (const transport of ['SDK','MCP']) {
      const file = boundOutputFile(o, files, observed[transport]);
      need(file.bytes === source.bytes && file.sha256 === source.sha256,
        'CLOSED_SOURCES', 'Every received original source must retain all its exact bytes.');
    }
  }
  need(value.history?.SDK?.events === o.expectedHistory.length && value.history?.MCP?.events === o.expectedHistory.length &&
    value.history.SDK.sha256 === sha(json(o.expectedHistory)) &&
    value.history.MCP.sha256 === sha(json(o.expectedHistory)),
    'CLOSED_HISTORY', 'Keep the complete original event history through both maintained interfaces.');
  for (const row of value.paged ?? []) boundOutputFile(o, files, row.completeFile);
}
async function readClosedObservation(o, {synchronize = false} = {}) {
  let file;
  try {
    file = await inspectFile(o.ctx, join(o.output, CLOSED), {retain:true, privateFile:true, maximum:MAX_JSON});
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const closed = strictJSON(file.data);
  need(closed.schema === ENGAGEMENT_AGENT_SCHEMA + '.closed' && closed.state === 'DRAINED' &&
    closed.operationId === o.spec.operationId && closed.selectionSha256 === o.selectionSha256 &&
    same(closed.journalBasis, journalBasis(o.state)) &&
    same(closed.executionContinuation ?? null, o.executionContinuation), 'CLOSED_OBSERVATION',
    'Keep the original drained outcome and its complete request/download journal.');
  inventoryMap(closed.files);
  const actual = await treeInventory(o.ctx, o.output, new Set(['JOURNAL.json', CLOSED, RESULT]), synchronize);
  need(same(actual, closed.files), 'CLOSED_OBSERVATION',
    'The complete closed original observation member set, bytes or modes changed.');
  await validateObservation(o, closed.observation, closed.files);
  return {value:closed, file:{path:CLOSED, bytes:file.bytes, sha256:file.sha256}};
}
function resultValue(o, closed, files) {
  return {schema:ENGAGEMENT_AGENT_SCHEMA + '.result', state:'COMPLETED',
    operationId:o.spec.operationId, selectionSha256:o.selectionSha256,
    outputDirectory:o.output, resultFile:join(o.output, RESULT), native:o.outcome,
    source:{repository:o.manifest.repository, revision:o.manifest.revision,
      pathBase:o.manifest.pathBase, productPath:o.manifest.productPath,
      manifest:o.spec.sourceManifest, files:o.manifest.files.length},
    ...(o.executionContinuation ? {executionContinuation:o.executionContinuation} : {}),
    requests:o.selection.requests, bookAdmission:o.selection.bookAdmission, exports:closed.value.observation.exports,
    observation:closed.file, files,
    custody:{managedHost:'BORROWED_ORIGINAL_SERVICE', providerAndClient:'DRAINED',
      fileReaders:'DRAINED', parentGuard:o.selection.parentGuard,
      inheritedDescriptor:'closed-on-return-without-unlock'},
  };
}
async function completedResult(o, {required = false} = {}) {
  let found;
  try {
    found = await inspectFile(o.ctx, join(o.output, RESULT), {retain:true, privateFile:true, maximum:MAX_JSON});
  } catch (error) { if (error.code === 'ENOENT' && !required) return null; throw error; }
  const result = strictJSON(found.data);
  need(o.state.state === 'COMPLETED', 'COMPLETED_JOURNAL', 'The completed result requires its original completed journal.');
  const closed = await readClosedObservation(o);
  need(closed, 'CLOSED_OBSERVATION', 'The complete result requires the original drained observation.');
  const actual = await treeInventory(o.ctx, o.output, new Set([RESULT]));
  need(same(result, resultValue(o, closed, actual)), 'COMPLETED_RESULT',
    'The original complete result, file inventory or returned native ZIP bindings changed.');
  return result;
}
async function finishClosed(o, closed) {
  o.guard.assert();
  // This path has no import, host binding, API request, native command or new attempt.
  o.state.state = 'COMPLETED';
  await o.save();
  const files = await treeInventory(o.ctx, o.output, new Set([RESULT]), true);
  const result = resultValue(o, closed, files);
  await publish(o.ctx, o.guard, o.output, RESULT, json(result));
  await syncDirectory(o.ctx, o.output); await syncDirectory(o.ctx, dirname(o.output));
  return result;
}
export async function inspectEngagementAgentObservation(spec, options = {}) {
  const ctx = control(options); let first = null, result;
  try {
    const prepared = await prepare(ctx, spec), o = await loadObservation(ctx, prepared);
    result = await completedResult(o, {required:true});
  } catch (error) { first = error; }
  first = await ctx.drainFiles(first); ctx.dispose();
  if (first) throw first; return result;
}
export async function receiveEngagementAgent(spec, options = {}) {
  const ctx = control(options);
  let guard = null, o = null, connections = null, primary = null, result = null, attempt = null;
  try {
    guard = new ParentGuard(spec?.parentGuard);
    const prepared = await prepare(ctx, spec);
    guard.assert(); o = new Observation(ctx, guard, prepared); await o.initialize();
    const completed = await completedResult(o);
    if (completed) result = completed;
    else {
      const closed = await readClosedObservation(o, {synchronize:true});
      if (closed) result = await finishClosed(o, closed);
      else {
        ctx.check(); guard.assert();
        attempt = {id:randomUUID(), state:'RUNNING', startedAt:new Date().toISOString()};
        o.state.attempts.push(attempt); o.state.state = 'RUNNING'; await o.save();
        ctx.report({state:'STARTING', operationId:spec.operationId, caseId:o.outcome.sourceCaseId});
        connections = new Connections(o);
        const opened = await connections.start();
        attempt.opened = opened; await o.save();
        await o.step('initial-host', {workspace:o.spec.workspace, sourceManifest:o.spec.sourceManifest},
          async () => opened);
        const observation = await course(o, connections);
        // The borrowed connections own no external host. Their actual accepted
        // requests/readers nevertheless drain before any closed marker appears.
        primary = await connections.close(primary); connections = null;
        primary = await ctx.drainFiles(primary);
        o.state.state = 'DRAINED';
        attempt.state = 'DRAINED'; attempt.drainedAt = new Date().toISOString();
        if (primary) attempt.cleanup = diagnostic(primary);
        await o.save();
        const files = await treeInventory(ctx, o.output, new Set(['JOURNAL.json', CLOSED, RESULT]), true);
        await validateObservation(o, observation, files);
        const closedValue = {schema:ENGAGEMENT_AGENT_SCHEMA + '.closed', state:'DRAINED',
          operationId:o.spec.operationId, selectionSha256:o.selectionSha256,
          journalBasis:journalBasis(o.state), observation, files,
          ...(o.executionContinuation ? {executionContinuation:o.executionContinuation} : {})};
        const closedFile = await publish(ctx, guard, o.output, CLOSED, json(closedValue));
        if (primary) throw primary;
        result = await finishClosed(o, {value:closedValue, file:closedFile});
      }
    }
  } catch (error) { if (primary !== error) primary = noteCleanup(primary, error); }
  if (connections) { primary = await connections.close(primary); connections = null; }
  primary = await ctx.drainFiles(primary);
  let resultVisible = Boolean(result);
  if (primary && o && !resultVisible) {
    try { await fsp.lstat(join(o.output, RESULT)); resultVisible = true; }
    catch (error) { if (error.code !== 'ENOENT') { resultVisible = true; primary = noteCleanup(primary, error); } }
  }
  if (primary && o && !resultVisible && !o.executionAdoptionPending) {
    try {
      o.state.state = 'INTERRUPTED';
      if (attempt) { attempt.state = 'INTERRUPTED'; attempt.stoppedAt = new Date().toISOString(); attempt.error = diagnostic(primary); }
      o.state.lastError = diagnostic(primary); await o.save();
    } catch (error) { primary = noteCleanup(primary, error); }
  }
  primary = await ctx.drainFiles(primary);
  if (guard) { try { guard.close(); } catch (error) { primary = noteCleanup(primary, error); } }
  ctx.dispose();
  if (primary) throw primary;
  return result;
}
function output(stream, text) {
  return new Promise((resolve, reject) => {
    let settled = false, callback = false, emitted = null;
    const finish = () => {
      if (settled || !callback) return;
      settled = true; stream.removeListener('error', onError);
      emitted ? reject(emitted) : resolve();
    };
    const onError = error => { emitted ??= error; if (callback) setImmediate(finish); };
    stream.on('error', onError);
    try {
      stream.write(text, error => {
        emitted ??= error ?? null; callback = true;
        // Node may emit error after calling the write callback.
        setImmediate(finish);
      });
    } catch (error) { emitted ??= error; callback = true; setImmediate(finish); }
  });
}
export async function runEngagementAgentCli(argv = process.argv.slice(2)) {
  const controller = new AbortController(); let first = null, result = null, progress = Promise.resolve();
  const stopped = () => {
    if (!controller.signal.aborted) controller.abort(failure('INTERRUPTED', 'The original agent observation received a stop signal.'));
  };
  const outputFailed = error => {
    first ??= error;
    if (!controller.signal.aborted) controller.abort(error);
  };
  process.on('SIGINT', stopped); process.on('SIGTERM', stopped);
  process.stdout.on('error', outputFailed); process.stderr.on('error', outputFailed);
  try {
    need(argv.length === 3 && ['run','inspect'].includes(argv[0]) && argv[1] === '--input',
      'CLI_INPUT', 'Use run or inspect --input followed by the exact private input JSON path.');
    const ctx = control({signal:controller.signal});
    let input, inputError = null;
    try {
      const source = await inspectFile(ctx, abs(argv[2]), {retain:true, privateFile:true, maximum:2 * 1024 * 1024});
      input = strictJSON(source.data);
    } catch (error) { inputError = error; }
    inputError = await ctx.drainFiles(inputError); ctx.dispose();
    if (inputError) throw inputError;
    const options = {signal:controller.signal, onProgress(value) {
      progress = progress.then(() => output(process.stderr, canonical(value) + '\n'));
      progress.catch(outputFailed);
    }};
    result = argv[0] === 'run' ? await receiveEngagementAgent(input, options) :
      await inspectEngagementAgentObservation(input, options);
    await progress;
    if (first) throw first;
    await output(process.stdout, canonical(result) + '\n');
  } catch (error) {
    first ??= error;
    try { await progress; } catch (failure) { first ??= failure; }
    try { await output(process.stderr, canonical({schema:ENGAGEMENT_AGENT_SCHEMA + '.error', error:diagnostic(first)}) + '\n'); }
    catch (failure) { first ??= failure; }
  } finally {
    try { await progress; } catch (error) { first ??= error; }
    await new Promise(resolve => setImmediate(resolve));
    process.removeListener('SIGINT', stopped); process.removeListener('SIGTERM', stopped);
    process.stdout.removeListener('error', outputFailed); process.stderr.removeListener('error', outputFailed);
  }
  return first ? 1 : 0;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runEngagementAgentCli().then(code => { process.exitCode = code; },
    () => { process.exitCode = 1; });
}
