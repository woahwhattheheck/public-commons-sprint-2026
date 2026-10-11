// MIT. Read one Git snapshot in batches; the repository remains the source cache.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_SOURCE = 32 * 1024 * 1024;
const round = value => Math.round(value * 100) / 100;

export function openGitSource({ repository, ref = 'HEAD', offline = false, onProgress = () => {} }) {
  if (typeof ref !== 'string' || !ref || typeof offline !== 'boolean' || typeof onProgress !== 'function')
    throw new TypeError('Expected a Git ref, an offline boolean and a progress callback');
  const repo = resolve(repository), started = performance.now(), cache = new Map();
  const counts = { gitCommands: 0, gitMilliseconds: 0, metadataBatches: 0, contentBatches: 0,
    fetchBatches: 0, requestedObjects: 0, cachedObjects: 0, fetchedObjects: 0, uniqueBytes: 0 };
  let commit, remotes;
  const progress = (phase, details = {}) => onProgress({ phase, ...(commit ? { sourceCommit: commit } : {}),
    elapsedMilliseconds: round(performance.now() - started), ...details });
  function git(args, { input, maxBuffer = MAX_SOURCE + 1024 * 1024, optional = false } = {}) {
    const begin = performance.now();
    counts.gitCommands++;
    try {
      return execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', ...args], {
        cwd: repo, input, maxBuffer, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (error) {
      if (optional && error.status === 1) return Buffer.alloc(0);
      // A configured remote can contain credentials. Do not copy command output
      // or URLs into the release receipt or operator progress stream.
      const failure = new Error(`Git source operation failed (exit ${error.status ?? 'unknown'}). ` +
        'Use Git with --no-lazy-fetch support and check access to the configured repository.');
      failure.code = 'GIT_SOURCE_FAILED';
      throw failure;
    } finally { counts.gitMilliseconds += performance.now() - begin; }
  }
  progress('resolve');
  commit = git(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).toString().trim();
  if (!OID.test(commit)) throw new TypeError('Git did not resolve one immutable commit');
  const tree = git(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8')
    .split('\0').filter(Boolean).map(line => {
      const tab = line.indexOf('\t'), fields = line.slice(0, tab).split(' ');
      if (tab < 0 || fields.length !== 3 || !OID.test(fields[2])) throw new TypeError('Invalid Git tree entry');
      return { mode: fields[0], type: fields[1], blob: fields[2], path: line.slice(tab + 1) };
    });
  progress('resolved', { treeFiles: tree.length });

  function inspect(blobs) {
    if (!blobs.length) return new Map();
    counts.metadataBatches++;
    const lines = git(['cat-file', '--batch-check'], { input: blobs.join('\n') + '\n',
      maxBuffer: Math.max(1024 * 1024, blobs.length * 128) }).toString('utf8').trimEnd().split('\n');
    if (lines.length !== blobs.length) throw new TypeError('Incomplete Git object metadata batch');
    const result = new Map();
    for (let i = 0; i < blobs.length; i++) {
      const fields = lines[i].split(' ');
      if (fields[0] !== blobs[i]) throw new TypeError('Git object metadata order changed');
      if (fields.length === 2 && fields[1] === 'missing') { result.set(blobs[i], null); continue; }
      const size = Number(fields[2]);
      if (fields.length !== 3 || fields[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0)
        throw new TypeError('Expected regular Git blob metadata');
      if (size > MAX_FILE) throw new RangeError('Distribution source file size exceeded');
      result.set(blobs[i], size);
    }
    return result;
  }
  function promisorRemotes() {
    if (remotes) return remotes;
    const configuration = git(['config', '--null', '--get-regexp',
      '^(extensions[.]partialclone|remote[.].*[.](promisor|partialclonefilter))$'], { optional: true }).toString();
    const found = new Set(); let last;
    for (const entry of configuration.split('\0').filter(Boolean)) {
      const at = entry.indexOf('\n'), key = entry.slice(0, at), value = entry.slice(at + 1);
      if (key.toLowerCase() === 'extensions.partialclone') { last = value; continue; }
      const match = /^remote\.(.+)\.(promisor|partialclonefilter)$/i.exec(key);
      if (match && (match[2].toLowerCase() === 'partialclonefilter' || /^(true|yes|on|1)$/i.test(value)))
        found.add(match[1]);
    }
    if (last) { found.delete(last); found.add(last); }
    remotes = [...found];
    return remotes;
  }
  function acquire(blobs, metadata) {
    let missing = blobs.filter(blob => metadata.get(blob) === null);
    if (!missing.length) return metadata;
    if (!offline) {
      for (const remote of promisorRemotes()) {
        progress('fetching', { objects: missing.length, remote });
        counts.fetchBatches++;
        // Exact blob IDs come only from the selected immutable tree. Keep the
        // checkout, branch refs and FETCH_HEAD intact. Git's configured object
        // database (including existing alternates) owns all acquired objects.
        try {
          git(['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--no-tags', '--no-write-fetch-head', '--no-auto-maintenance',
            '--recurse-submodules=no', '--filter=blob:none', '--stdin', '--', remote],
          { input: missing.join('\n') + '\n' });
        } catch (error) {
          progress('fetch-incomplete', { objects: missing.length, remote, code: error.code });
        }
        const observed = inspect(missing);
        for (const [blob, size] of observed) metadata.set(blob, size);
        const remaining = missing.filter(blob => metadata.get(blob) === null);
        counts.fetchedObjects += missing.length - remaining.length;
        missing = remaining;
        if (!missing.length) break;
      }
    }
    if (missing.length) {
      progress('source-needed', { objects: missing.length, offline });
      const error = new Error(`${missing.length} selected Git source objects are unavailable. ` +
        (offline ? 'Acquire them in the same repository, then repeat the offline build.' :
          'Check its configured promisor remote, then repeat the same commit with a new output directory.'));
      error.code = 'MISSING_SOURCE_OBJECTS'; error.missingObjects = missing; error.sourceCommit = commit;
      throw error;
    }
    return metadata;
  }
  function readFiles(items) {
    for (const item of items)
      if (!item || !['100644', '100755'].includes(item.mode) || item.type !== 'blob' || !OID.test(item.blob))
        throw new TypeError('Only regular source files may be packaged: ' + (item?.path ?? 'missing entry'));
    const blobs = [...new Set(items.map(item => item.blob))].filter(blob => !cache.has(blob));
    if (blobs.length) {
      counts.requestedObjects += blobs.length;
      progress('inspect', { files: items.length, objects: blobs.length });
      const metadata = inspect(blobs);
      counts.cachedObjects += blobs.filter(blob => metadata.get(blob) !== null).length;
      acquire(blobs, metadata);
      const size = blobs.reduce((sum, blob) => sum + metadata.get(blob), 0);
      if (counts.uniqueBytes + size > MAX_SOURCE) throw new RangeError('Distribution source size exceeded');
      counts.contentBatches++;
      const data = git(['cat-file', '--batch'], { input: blobs.join('\n') + '\n',
        maxBuffer: size + blobs.length * 128 + 1024 });
      let offset = 0;
      for (const blob of blobs) {
        const end = data.indexOf(10, offset), length = metadata.get(blob);
        if (end < offset || data.toString('ascii', offset, end) !== `${blob} blob ${length}`)
          throw new TypeError('Git content batch header does not match selected source');
        const start = end + 1, stop = start + length;
        if (stop >= data.length || data[stop] !== 10) throw new TypeError('Incomplete Git source content');
        const bytes = data.subarray(start, stop);
        const actual = createHash(blob.length === 64 ? 'sha256' : 'sha1')
          .update(`blob ${length}\0`).update(bytes).digest('hex');
        if (actual !== blob) throw new TypeError('Git source content identity changed');
        cache.set(blob, bytes); offset = stop + 1;
      }
      if (offset !== data.length) throw new TypeError('Unexpected trailing Git source content');
      counts.uniqueBytes += size;
      progress('loaded', { files: items.length, objects: blobs.length, bytes: size });
    }
    return new Map(items.map(item => [item.path, cache.get(item.blob)]));
  }
  return { commit, tree, readFiles, progress,
    metrics: () => ({ ...counts, gitMilliseconds: round(counts.gitMilliseconds),
      elapsedMilliseconds: round(performance.now() - started), offline }) };
}
