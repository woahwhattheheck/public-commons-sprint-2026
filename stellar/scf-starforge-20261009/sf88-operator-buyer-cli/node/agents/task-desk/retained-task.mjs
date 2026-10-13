// MIT. Open a retained native task at its original location.
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { openInboxTask, openInboxTaskPacket } from '../inbox-task.mjs';
import { absolute, digest, exists, privateDirectory, readJson } from '../../store.mjs';

const RECEIVING = 'stellar-forge.inbox-task-receiving-intent.v1';
function requireSelection(value, code, message) {
  if (!value) throw Object.assign(new Error(message), { code, status: 409 });
}
function inside(parent, candidate) {
  const value = relative(parent, candidate);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep));
}
async function originalDirectory(directory, { absent = false } = {}) {
  directory = absolute(directory);
  if (absent && !await exists(directory)) {
    const parent = await privateDirectory(dirname(directory), { create: false });
    requireSelection(await realpath(parent) === parent, 'DESK_RETAINED_DIRECTORY_CHANGED',
      'Use the original absolute directory, with its original parent.');
    return directory;
  }
  await privateDirectory(directory, { create: false });
  requireSelection(await realpath(directory) === directory, 'DESK_RETAINED_DIRECTORY_CHANGED',
    'Use the original absolute task and result directories.');
  return directory;
}
function receivingPath(taskDirectory, outputDirectory) {
  return join(taskDirectory, 'receivings', digest(Buffer.from(outputDirectory)) + '.json');
}
async function originalReceiving(taskDirectory, outputDirectory, taskSha256) {
  await originalDirectory(join(taskDirectory, 'receivings'));
  const record = await readJson(receivingPath(taskDirectory, outputDirectory));
  requireSelection(record.schema === RECEIVING && record.taskSha256 === taskSha256 &&
    record.outputDirectory === outputDirectory && typeof record.createdAt === 'string',
  'DESK_RETAINED_RECEIVING_CHANGED',
  'The selected result directory differs from this task\'s original receiving.');
  return record;
}

/**
 * Selection reads the original records and complete packets. It never starts
 * execution or receiving, copies a task, or creates a replacement destination.
 */
export async function selectRetainedTask({ inbox, taskDirectory, outputDirectory } = {}) {
  if (taskDirectory === undefined && outputDirectory === undefined) return null;
  requireSelection(typeof taskDirectory === 'string' && taskDirectory &&
    typeof outputDirectory === 'string' && outputDirectory,
  'DESK_RETAINED_PAIR_REQUIRED',
  'Select both the existing task revision and its original receiving or delivered packet.');
  taskDirectory = await originalDirectory(taskDirectory);
  outputDirectory = absolute(outputDirectory);
  const inboxDirectory = absolute(inbox?.directory);
  requireSelection(!inside(taskDirectory, outputDirectory) && !inside(inboxDirectory, outputDirectory) &&
    !inside(outputDirectory, taskDirectory) && !inside(outputDirectory, inboxDirectory),
  'DESK_RETAINED_OUTPUT_DIRECTORY',
  'Keep the selected results outside the original task and Inbox directories.');
  const task = await openInboxTask({ inbox, directory: taskDirectory });
  const marker = receivingPath(taskDirectory, outputDirectory);
  let mode;
  if (await exists(marker)) {
    await originalReceiving(taskDirectory, outputDirectory, task.taskSha256);
    await originalDirectory(outputDirectory, { absent: true });
    mode = 'original-receiving';
  } else {
    requireSelection(await exists(join(outputDirectory, 'manifest.json')),
      'DESK_RETAINED_RECEIVING_REQUIRED',
      'Select the task\'s recorded receiving destination or a complete delivered packet.');
    await originalDirectory(outputDirectory);
    await openInboxTaskPacket({ directory: outputDirectory, expectedTaskSha256: task.taskSha256 });
    mode = 'delivered-packet';
  }
  return Object.freeze({
    taskDirectory, outputDirectory, taskSha256: task.taskSha256, record: task.record,
    retained: true, mode, receiveAllowed: mode === 'original-receiving',
    receivingRecordPath: mode === 'original-receiving' ? marker : null,
  });
}

/** Re-read the original destination binding before an explicit native receive. */
export async function requireRetainedReceiving(selection, task) {
  requireSelection(selection?.receiveAllowed === true && selection.mode === 'original-receiving',
    'DESK_DELIVERED_PACKET_READ_ONLY',
    'This complete packet is at its delivery location. Refresh or download the packet; use its original receiving destination to resume receiving.');
  requireSelection(task.directory === selection.taskDirectory && task.taskSha256 === selection.taskSha256,
    'DESK_RETAINED_TASK_CHANGED', 'The retained task differs from the selected original revision.');
  await originalDirectory(selection.taskDirectory);
  await originalReceiving(selection.taskDirectory, selection.outputDirectory, selection.taskSha256);
  await originalDirectory(selection.outputDirectory, { absent: true });
  return selection.outputDirectory;
}

export function retainedTaskLocations(selection) {
  return {
    taskDirectory: selection.taskDirectory, outputDirectory: selection.outputDirectory,
    retained: true, mode: selection.mode, receiveAllowed: selection.receiveAllowed,
  };
}

/** Apply the same saved-task identity and storage checks during review and launch. */
export async function validateRetainedTaskStorage({ selection, inbox, tasksDirectory, outputsDirectory } = {}) {
  if (!selection) return null;
  tasksDirectory = absolute(tasksDirectory); outputsDirectory = absolute(outputsDirectory);
  requireSelection(!inside(tasksDirectory, selection.outputDirectory) &&
    !inside(selection.outputDirectory, tasksDirectory) &&
    !inside(selection.taskDirectory, outputsDirectory) &&
    !inside(outputsDirectory, selection.taskDirectory),
  'DESK_RETAINED_DIRECTORY_OVERLAP',
  'Keep desk storage separate from the selected original result and task directories.');
  const caller = selection.record.manifest.task;
  const id = digest(Buffer.from(JSON.stringify([caller.system, caller.id, caller.revision])));
  const managed = join(tasksDirectory, id);
  if (managed !== selection.taskDirectory && await exists(managed)) {
    const duplicate = await openInboxTask({ inbox, directory: managed });
    requireSelection(JSON.stringify(duplicate.record) === JSON.stringify(selection.record),
      'DESK_RETAINED_TASK_COLLISION',
      'A different saved task already uses this caller revision in the desk.');
  }
  return id;
}
