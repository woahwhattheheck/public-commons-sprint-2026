// MIT. Exact-path bindings for the original SF99 merchant container.
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { validateOAuthHostDirectories } from '../sf30-seller-sdk/oauth-connections/deployment.mjs';

const inside = (root, file) => file === root || file.startsWith(root + '/');
const overlaps = (left, right) => inside(left, right) || inside(right, left);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, message) => { if (!value) throw new Error(message); };

function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && value !== '/' &&
    resolve(value) === value && !/[\\\x00-\x1f\x7f]/.test(value),
  label + ' must be an absolute normalized path below the filesystem root');
  return value;
}

async function existing(value, label, kind, allowMissing = false) {
  const path = absolute(value, label);
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new Error(label + ' is missing: ' + path);
    throw error;
  }
  need(!info.isSymbolicLink() && (info.isFile() || info.isDirectory()),
    label + ' must be a regular file or real directory: ' + path);
  need(await realpath(path) === path, label + ' must use its canonical path without symlink parents: ' + path);
  need(!kind || (kind === 'directory' ? info.isDirectory() : info.isFile()),
    label + ' must be a ' + kind + ': ' + path);
  return { path, directory: info.isDirectory(), info };
}

function bind(source, readOnly) {
  return { type: 'bind', source, target: source, read_only: readOnly,
    bind: { create_host_path: false } };
}

/**
 * Prepare raw Compose long-bind descriptors after the bundle directory exists.
 * This reads metadata only; it creates no paths and changes no ownership/modes.
 * Dollar signs remain literal here. The Compose serializer owns its escaping.
 */
export async function prepareMounts(host, container, bundle) {
  need(object(host) && object(container), 'Original host and container options are required');
  const sourceMode = container.sourceMode ?? 'bind';
  need(['bind', 'image'].includes(sourceMode), 'sourceMode must be bind or image');
  need(Number.isSafeInteger(container.uid) && container.uid >= 0,
    'Select the existing numeric container service UID');
  need(Array.isArray(host.inputFiles), 'Original host inputFiles are required');
  const extras = container.readOnlyRoots ?? [];
  need(Array.isArray(extras), 'readOnlyRoots must be an array of existing absolute files or directories');

  // Even image mode retains the original source path. Do not let a different
  // binding shadow the code location whose entrypoints the host preflight pins.
  const [source, state, output] = await Promise.all([
    existing(host.sourceRoot, 'sourceRoot', 'directory'),
    existing(host.stateRoot, 'stateRoot', 'directory'),
    existing(bundle, 'container bundle', 'directory'),
  ]);
  for (const [left, right] of [[source, state], [source, output], [state, output]])
    need(!overlaps(left.path, right.path),
      'Keep sourceRoot, stateRoot and the container bundle separate; overlapping paths: ' + left.path + ' and ' + right.path);

  // The original receiver, outbox and retained release stores need a private
  // service-owned writable root. Its existing GID can differ: owner access is
  // determined by the matching UID. Provisioning remains the operator's step.
  need(state.info.uid === container.uid,
    'stateRoot must already belong to the selected container UID ' + container.uid + ': ' + state.path);
  need((state.info.mode & 0o077) === 0 && (state.info.mode & 0o700) === 0o700,
    'stateRoot must retain private 0700 owner read/write/traverse access: ' + state.path);

  // A service-owned parent does not grant access to another owner's existing
  // private store below it. Check the actual original writer directories; leave
  // new outbox/receiver paths for their original initialization commands.
  const writers = [
    [host.outbox, 'Original delivery outbox', true],
    [host.receiverState, 'Original receiver state', true],
    [host.release?.store, 'Original retained release store', false],
    [host.discovery?.directory, 'Original discovery setup', false],
  ].filter(([path]) => path !== null && path !== undefined);
  await Promise.all(writers.map(async ([path, label, allowMissing]) => {
    absolute(path, label);
    need(path !== state.path && inside(state.path, path),
      label + ' must remain beneath the original writable stateRoot: ' + path);
    const writer = await existing(path, label, 'directory', allowMissing);
    if (!writer) {
      // An absent leaf must not turn a pre-existing parent symlink into state
      // on /tmp or another mounted root when the original initializer runs.
      let parent = state.path;
      for (const segment of path.slice(state.path.length + 1).split('/').slice(0, -1)) {
        parent += '/' + segment;
        if (!await existing(parent, label + ' parent', 'directory', true)) break;
      }
      return;
    }
    need(writer.info.uid === container.uid,
      label + ' must belong to the selected container UID ' + container.uid + ': ' + path);
    need((writer.info.mode & 0o077) === 0 && (writer.info.mode & 0o700) === 0o700,
      label + ' must retain private 0700 owner read/write/traverse access: ' + path);
  }));

  const oauth = await Promise.all(validateOAuthHostDirectories(host, { bundle }).map(entry =>
    existing(entry.directory, 'Private OAuth store ' + entry.directoryEnv, 'directory')));
  for (const store of oauth) need(store.info.uid === container.uid && (store.info.mode & 0o777) === 0o700,
    'Each private OAuth store must retain 0700 access and belong to the selected container UID');
  const roots = await Promise.all(extras.map(value => existing(value, 'readOnlyRoots entry')));
  for (const root of roots) {
    need(!oauth.some(store => overlaps(root.path, store.path)),
      'A readOnlyRoots entry cannot cover or subdivide a private writable OAuth store');
    need(!overlaps(root.path, state.path),
      'A readOnlyRoots entry cannot cover or subdivide the writable merchant state: ' + root.path);
    need(!(root.path !== source.path && inside(root.path, source.path)),
      'A broad readOnlyRoots ancestor would replace the selected source mount: ' + root.path);
    need(!(root.path !== output.path && inside(root.path, output.path)),
      'A broad readOnlyRoots ancestor would replace the container bundle mount: ' + root.path);
    need(sourceMode !== 'image' || !overlaps(root.path, source.path),
      'readOnlyRoots must stay outside the image-owned sourceRoot: ' + root.path);
  }

  const inputs = [host.planFile, ...host.inputFiles.map(item => {
    need(object(item) && typeof item.path === 'string', 'Invalid original host inputFiles entry');
    return item.path;
  }), ...(host.environmentFile ? [host.environmentFile] : [])];
  const files = await Promise.all([...new Set(inputs)].map(value => existing(value, 'Original host input', 'file')));
  const selected = [
    ...(sourceMode === 'bind' ? [{ ...source, readOnly: true, role: 'source' }] : []),
    { ...state, readOnly: false, role: 'state' },
    ...oauth.map(store => ({ ...store, readOnly: false, role: 'oauth' })),
    { ...output, readOnly: true, role: 'bundle' },
    ...roots.map(root => ({ ...root, readOnly: true, role: 'extra' })),
    ...files.map(file => ({ ...file, readOnly: true, role: 'input' })),
  ];
  // Parent-first selection removes incidental nested mounts. In particular,
  // retained-release inputs already inside stateRoot stay with the original
  // writable state mount; a nested read-only state.json would change its writer
  // semantics. Explicit extra roots overlapping state were rejected above.
  selected.sort((left, right) => left.path.length - right.path.length ||
    (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const retained = [];
  for (const item of selected) {
    const covering = retained.find(parent => parent.path === item.path ||
      parent.directory && inside(parent.path, item.path));
    if (covering) {
      need(!(covering.readOnly && !item.readOnly),
        'A read-only binding would shadow writable merchant state: ' + item.path);
      need(covering.readOnly || !item.readOnly || item.role === 'input',
        'Conflicting container bindings at ' + item.path);
      continue;
    }
    retained.push(item);
  }
  return retained.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map(item => bind(item.path, item.readOnly));
}

/** Recheck source existence/type/identity and the exact saved binding contract. */
export async function checkMounts(host, container, bundle, mounts) {
  const expected = await prepareMounts(host, container, bundle);
  need(Array.isArray(mounts) && mounts.length === expected.length,
    'Container mounts differ from the original host and selected readOnlyRoots');
  const fields = ['bind', 'read_only', 'source', 'target', 'type'];
  for (let index = 0; index < expected.length; index++) {
    const actual = mounts[index], wanted = expected[index];
    need(object(actual) && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(fields) &&
      actual.type === 'bind' && actual.source === wanted.source && actual.target === wanted.target &&
      actual.read_only === wanted.read_only && object(actual.bind) &&
      Object.keys(actual.bind).length === 1 && actual.bind.create_host_path === false,
    'Container binding changed at index ' + index + ': ' + wanted.source);
  }
  return expected;
}
