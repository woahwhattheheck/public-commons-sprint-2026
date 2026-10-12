// MIT. Read-only launch binding for the installed private Ruby runtime desk.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

export const RUBY_CUSTOMER_STARTUP_SCHEMA = 'stellar-forge.ruby-customer-workspace-startup.v1';
const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ['source.mjs','model.mjs','browser.mjs','panel.mjs','cli.mjs','index.html','launch.mjs','server.mjs','customer.css','README.md', 'runtime-browser.mjs','runtime-style.css','../workspace/uploads.mjs','../model.mjs','../files.mjs'];
const fault = (code, message) => Object.assign(new Error(message), { code, status: 409 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value);
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const version = stat => [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');
async function regular(path, maximum, privateOnly = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat({ bigint: true });
    if (!first.isFile() || first.size > BigInt(maximum) || privateOnly &&
      (first.uid !== BigInt(process.getuid()) || (first.mode & 0o077n) !== 0n))
      throw fault('RUBY_DESK_LAUNCH_FILE', 'The selected launch file is not a complete original regular file.');
    const bytes = await handle.readFile(), last = await handle.stat({ bigint: true });
    if (BigInt(bytes.length) !== first.size || version(first) !== version(last))
      throw fault('RUBY_DESK_LAUNCH_CHANGED', 'The installed runtime source changed during launch.');
    return { bytes, stat: last, descriptor: { bytes: bytes.length, sha256: digest(bytes) } };
  } finally { await handle.close(); }
}
async function originalDirectory(path, privateOnly = false) {
  if (typeof path !== 'string' || !path.startsWith('/') || resolve(path) !== path)
    throw fault('RUBY_DESK_LAUNCH_DIRECTORY', 'Use the absolute selected runtime directory.');
  const stat = await lstat(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path ||
      privateOnly && (stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) !== 0n))
    throw fault('RUBY_DESK_LAUNCH_DIRECTORY', 'Use the original private runtime directory.');
  return stat;
}
export async function inspectRubyCustomerLaunch({ directory, sourceDirectory = HERE } = {}) {
  const before = await originalDirectory(directory, true);
  await originalDirectory(sourceDirectory);
  const marker = await regular(join(directory, 'ruby-runtime.json'), 65536, true);
  const selected = JSON.parse(marker.bytes.toString('utf8'));
  if (selected.schema !== 'stellar-forge.ruby-runtime.v1' || selected.directory !== directory ||
      selected.id !== digest(directory).slice(0,24))
    throw fault('RUBY_DESK_LAUNCH_SELECTION', 'Open the original initialized Ruby runtime directory.');
  const files = [];
  for (const name of FILES) files.push({ name, ...(await regular(join(sourceDirectory,name), 4*1024*1024)).descriptor });
  const after = await originalDirectory(directory, true);
  if (encode(identity(before)) !== encode(identity(after)))
    throw fault('RUBY_DESK_LAUNCH_CHANGED', 'The selected runtime directory changed during launch.');
  const workspace = { directory, directoryIdentity: identity(after), settingsSha256: marker.descriptor.sha256 };
  return { schema: 'stellar-forge.ruby-customer-workspace-launch.v1', workspace,
    workspaceIdentity: digest(encode(workspace)), sourceDirectory, files, sourceSha256: digest(encode(files)) };
}
export async function rubyCustomerWorkspaceStartup({ launch, workspace, service } = {}) {
  if (!launch || !workspace || !service || service.workspace !== workspace ||
      service.directory !== launch.workspace.directory)
    throw fault('RUBY_DESK_LAUNCH_SELECTION', 'Start the selected original runtime handle.');
  const current = await inspectRubyCustomerLaunch({ directory: service.directory, sourceDirectory: launch.sourceDirectory });
  if (current.workspaceIdentity !== launch.workspaceIdentity || current.sourceSha256 !== launch.sourceSha256)
    throw fault('RUBY_DESK_LAUNCH_CHANGED', 'The selected runtime or installed browser source changed during launch.');
  return { schema: RUBY_CUSTOMER_STARTUP_SCHEMA, status: 'RUBY_CUSTOMER_WORKSPACE_READY',
    instanceId: randomUUID(), pid: process.pid, directory: service.directory, url: service.url,
    workspaceIdentity: current.workspaceIdentity, settingsSha256: current.workspace.settingsSha256,
    sourceDirectory: current.sourceDirectory, sourceSha256: current.sourceSha256, sourceFiles: current.files };
}
