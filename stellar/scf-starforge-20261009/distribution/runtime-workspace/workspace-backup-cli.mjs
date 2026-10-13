// MIT. Original whole-workspace backup and receiving commands.
import { constants, createWriteStream } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail, need, privateDirectory } from './storage.mjs';

const common = ['--workspace', '--storage'];
export const workspaceBackupCommands = {
  'workspace-backups': [...common],
  'workspace-backup-review': [...common, '--request-id', '--label'],
  'workspace-backup-create': [...common, '--request-id', '--review-id', '--review-sha256'],
  'workspace-backup-inspect': [...common, '--archive', '--upload-id', '--sha256'],
  'workspace-backup-upload': [...common, '--request-id', '--archive', '--sha256'],
  'workspace-backup-restore': [...common, '--request-id', '--archive-id', '--manifest-sha256', '--directory', '--mode'],
  'workspace-backup-continue': [...common, '--operation-id'],
  'workspace-backup-download': [...common, '--archive-id', '--output'],
  'workspace-backup-bindings': [...common, '--receiving-id', '--host-bindings'],
  'workspace-backup-open': [...common, '--receiving-id', '--review-id', '--review-sha256'],
};
export const workspaceBackupHelp = [
  '  runtime-workspace workspace-backups --workspace DIRECTORY [--storage PRIVATE_BACKUP_DIRECTORY]',
  '  runtime-workspace workspace-backup-review --workspace DIRECTORY --request-id UUID --label NAME [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-create --workspace DIRECTORY --request-id UUID --review-id ID --review-sha256 SHA [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-inspect --workspace CONTROL_DIRECTORY --archive ARCHIVE --sha256 SHA [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-upload --workspace CONTROL_DIRECTORY --request-id UUID --archive ARCHIVE --sha256 SHA [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-inspect --workspace CONTROL_DIRECTORY --upload-id UUID --sha256 SHA [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-restore --workspace CONTROL_DIRECTORY --request-id UUID --archive-id ID --manifest-sha256 SHA --directory DIRECTORY [--mode new-host] [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-continue --workspace DIRECTORY --operation-id UUID [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-download --workspace DIRECTORY --archive-id ID --output NEW_ARCHIVE [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-bindings --workspace CONTROL_DIRECTORY --receiving-id ID [--host-bindings EXACT_JSON_FILE] [--storage DIRECTORY]',
  '  runtime-workspace workspace-backup-open --workspace CONTROL_DIRECTORY --receiving-id ID --review-id ID --review-sha256 SHA [--storage DIRECTORY]',
].join('\n');

async function hostBindingsFile(path) {
  const file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    need(before.isFile() && before.size > 0 && before.size <= 512 * 1024, 'WORKSPACE_BACKUP_HOST_BINDINGS_FILE');
    const bytes = await file.readFile(), after = await file.stat();
    need(before.size === bytes.length && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs, 'WORKSPACE_BACKUP_HOST_BINDINGS_CHANGED');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
function required(options, name) {
  const value = options[name];
  need(typeof value === 'string' && value.length, 'WORKSPACE_BACKUP_ARGUMENT_REQUIRED', 'Supply ' + name + '.');
  return value;
}
function storage(options) {
  return options['--storage'] ? { storageDirectory: resolve(options['--storage']) } : {};
}
async function saveDownload(model, input, output) {
  const destination = resolve(output), parent = await privateDirectory(dirname(destination));
  need(parent === dirname(destination), 'WORKSPACE_BACKUP_OUTPUT_PARENT_INVALID');
  const temporary = join(parent, '.' + basename(destination) + '.download-' + randomUUID());
  const value = await model.workspaceBackupDownload(input);
  let bytes = 0, hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length; hash.update(chunk); callback(null, chunk);
  } });
  try {
    await pipeline(value.stream, meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    need(bytes === value.bytes && hash.digest('hex') === value.sha256,
      'WORKSPACE_BACKUP_DOWNLOAD_CHANGED', 'The complete downloaded archive differs from its retained identity.');
    const handle = await open(temporary, constants.O_RDWR | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
    await link(temporary, destination);
    await unlink(temporary);
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
    return { output: destination, archiveId: input.archiveId, bytes, sha256: value.sha256 };
  } finally {
    value.stream.destroy();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function upload(model, options, base) {
  const requestId = required(options, '--request-id'), sha256 = required(options, '--sha256');
  const path = resolve(required(options, '--archive'));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    need(before.isFile() && before.size > 0 && Number.isSafeInteger(before.size),
      'WORKSPACE_BACKUP_ARCHIVE_INVALID');
    const saved = await model.workspaceBackupState(base);
    const previous = saved.uploads.find(item => item.uploadId === requestId || item.requestId === requestId);
    if (previous) need(previous.sha256 === sha256 && previous.bytes === before.size,
      'WORKSPACE_BACKUP_UPLOAD_REQUEST_CHANGED', 'Continue the original archive with this request ID.');
    if (previous?.complete) return previous;
    const offset = previous?.receivedBytes ?? 0;
    need(Number.isSafeInteger(offset) && offset >= 0 && offset <= before.size,
      'WORKSPACE_BACKUP_UPLOAD_OFFSET_INVALID');
    const stream = file.createReadStream({ autoClose: false, start: offset });
    try {
      const result = await model.workspaceBackupUpload({ ...base, requestId, sha256,
        bytes: before.size, offset, body: stream });
      const after = await file.stat();
      need(after.size === before.size && after.mtimeMs === before.mtimeMs &&
        after.ino === before.ino && after.dev === before.dev,
      'WORKSPACE_BACKUP_ARCHIVE_CHANGED', 'The selected archive changed during upload.');
      return result;
    } finally { stream.destroy(); }
  } finally { await file.close(); }
}
export async function runWorkspaceBackupCommand(model, command, options) {
  need(Object.hasOwn(workspaceBackupCommands, command), 'WORKSPACE_BACKUP_COMMAND_INVALID');
  const base = storage(options);
  if (command === 'workspace-backups') return model.workspaceBackupState(base);
  if (command === 'workspace-backup-review') return model.workspaceBackupReview({
    ...base, requestId: required(options, '--request-id'), label: required(options, '--label'),
  });
  if (command === 'workspace-backup-create') return model.workspaceBackupCreate({
    ...base, requestId: required(options, '--request-id'), reviewId: required(options, '--review-id'),
    reviewSha256: required(options, '--review-sha256'),
  });
  if (command === 'workspace-backup-inspect') {
    need(Boolean(options['--archive']) !== Boolean(options['--upload-id']),
      'WORKSPACE_BACKUP_ARCHIVE_SELECTION_REQUIRED', 'Choose --archive or --upload-id.');
    return model.workspaceBackupInspect({ ...base, sha256: required(options, '--sha256'),
      ...(options['--archive'] ? { archivePath: resolve(options['--archive']) } : { uploadId: options['--upload-id'] }),
    });
  }
  if (command === 'workspace-backup-upload') return upload(model, options, base);
  if (command === 'workspace-backup-restore') return model.workspaceBackupRestore({
    ...base, requestId: required(options, '--request-id'), archiveId: required(options, '--archive-id'),
    manifestSha256: required(options, '--manifest-sha256'), directory: resolve(required(options, '--directory')),
    ...(options['--mode'] ? { mode: options['--mode'] } : {}),
  });
  if (command === 'workspace-backup-continue') return model.workspaceBackupContinue({
    ...base, operationId: required(options, '--operation-id'),
  });
  if (command === 'workspace-backup-download') return saveDownload(model, {
    ...base, archiveId: required(options, '--archive-id'),
  }, required(options, '--output'));
  if (command === 'workspace-backup-bindings') return model.workspaceBackupBindings({
    ...base, receivingId: required(options, '--receiving-id'),
    ...(options['--host-bindings'] ? { hostBindings: await hostBindingsFile(options['--host-bindings']) } : {}),
  });
  if (command === 'workspace-backup-open') return model.workspaceBackupOpen({
    ...base, receivingId: required(options, '--receiving-id'), reviewId: required(options, '--review-id'),
    reviewSha256: required(options, '--review-sha256'),
  });
  fail('WORKSPACE_BACKUP_COMMAND_INVALID');
}
