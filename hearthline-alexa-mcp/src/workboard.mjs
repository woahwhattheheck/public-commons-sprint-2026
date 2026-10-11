import { randomUUID } from 'node:crypto';

const STATUSES = new Set(['todo', 'doing', 'done']);
const INVENTORY_KEY = /^[a-z0-9_-]{1,64}$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const timestamp = runtime => new Date(runtime.clock()).toISOString();
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);

function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid ' + name);
  return value.trim();
}
function count(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error('Invalid ' + name + ': use a whole count from 0 to 10000');
  return value;
}
function revision(expected, actual, subject) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('A current ' + subject + ' revision is required');
  if (expected !== actual) throw new Error(subject + ' changed since it was opened. Refresh and review the saved values before saving again.');
}
function dueDate(value) {
  const date = text(value, 'due date', 10);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) throw new Error('Use a real due date in YYYY-MM-DD format');
  return date;
}
function onlyKeys(value, allowed, name) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid ' + name + ' fields');
}
function missionIn(state, missionId) {
  text(missionId, 'mission ID', 200, true);
  const mission = Object.hasOwn(state.missions, missionId) && state.missions[missionId];
  if (!mission) throw new Error('Mission not found');
  return mission;
}
function inventoryView(state) {
  return { items: clone(state.inventory), revision: state.inventoryRevision ?? 0, updatedAt: state.inventoryUpdatedAt ?? null };
}

// The original seed tool and the operator use the same count/version update.
// Stock counts are observations; they do not place an order or rewrite a plan.
export function setInventory(state, items, at) {
  if (!record(items) || Object.keys(items).length > 128) throw new Error('Inventory must contain at most 128 named counts');
  let changed = false;
  for (const [name, quantity] of Object.entries(items)) {
    if (!INVENTORY_KEY.test(name) || FORBIDDEN_KEYS.has(name)) throw new Error('Invalid inventory item: ' + name);
    count(quantity, name);
  }
  const additions = Object.keys(items).filter(name => !Object.hasOwn(state.inventory, name));
  if (additions.length && Object.keys(state.inventory).length + additions.length > 128) throw new Error('A household inventory supports 128 item names. Update an existing count instead of adding another name.');
  // Older stores may already exceed this limit. Their existing counts remain
  // editable; this check prevents further growth without dropping saved stock.
  for (const [name, quantity] of Object.entries(items)) {
    if (!Object.hasOwn(state.inventory, name) || state.inventory[name] !== quantity) changed = true;
    state.inventory[name] = quantity;
  }
  if (changed) {
    state.inventoryRevision = (state.inventoryRevision ?? 0) + 1;
    state.inventoryUpdatedAt = at;
  }
  return inventoryView(state);
}

function initialBoard(mission) {
  const tasks = [];
  const review = mission.actions.find(action => action.kind === 'inventory_review');
  for (const gap of review?.result?.missing ?? []) {
    tasks.push({ id: 'supply_' + gap.item, kind: 'supply', title: 'Restock ' + gap.item.replaceAll('_', ' '), item: gap.item, target: gap.minimum, sourceActionId: review.id });
  }
  const reminder = mission.actions.find(action => action.kind === 'household_reminder');
  if (reminder) tasks.push({ id: 'household_check_in', kind: 'household', title: 'Review the plan with the household', sourceActionId: reminder.id });
  return {
    version: 1, missionId: mission.id, revision: 1, createdAt: mission.createdAt, updatedAt: mission.createdAt,
    tasks: tasks.map(task => ({ ...task, status: 'todo', assignee: '', dueDate: '', notes: '', revision: 1, createdAt: mission.createdAt, updatedAt: mission.createdAt, completedAt: null })),
  };
}
function boardIn(state, missionId, persist = false) {
  const mission = missionIn(state, missionId);
  const saved = state.workboards?.[missionId];
  const board = saved ?? initialBoard(mission);
  if (persist && !saved) {
    state.workboards ??= {};
    state.workboards[missionId] = board;
  }
  return board;
}
function boardView(state, missionId) {
  const board = clone(boardIn(state, missionId));
  for (const task of board.tasks) {
    if (task.kind !== 'supply') continue;
    task.onHand = Number(state.inventory[task.item] ?? 0);
    task.shortfall = Math.max(0, task.target - task.onHand);
  }
  return {
    ...board, inventory: inventoryView(state),
    summary: {
      total: board.tasks.length,
      done: board.tasks.filter(task => task.status === 'done').length,
      doing: board.tasks.filter(task => task.status === 'doing').length,
      unassigned: board.tasks.filter(task => task.status !== 'done' && !task.assignee).length,
      supplyGaps: board.tasks.filter(task => task.kind === 'supply' && task.shortfall > 0).length,
    },
  };
}

export async function readInventory(runtime) {
  await runtime.store.load();
  return inventoryView(runtime.store.snapshot());
}
export async function readWorkboard(runtime, { missionId }) {
  await runtime.getMission(missionId);
  return boardView(runtime.store.snapshot(), missionId);
}
export async function addWorkTask(runtime, args) {
  onlyKeys(args, ['missionId', 'taskId', 'title', 'assignee', 'dueDate', 'notes'], 'new task');
  const title = text(args.title, 'task title', 160, true);
  const assignee = text(args.assignee ?? '', 'assignee', 80);
  const notes = text(args.notes ?? '', 'notes', 2000);
  const due = dueDate(args.dueDate ?? '');
  const taskId = args.taskId ?? 'task_' + randomUUID();
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(taskId)) throw new Error('Invalid new task ID');
  const creation = { title, assignee, dueDate: due, notes };
  await runtime.getMission(args.missionId);
  return runtime.store.mutate(state => {
    const board = boardIn(state, args.missionId, true);
    const existing = board.tasks.find(task => task.id === taskId);
    if (existing) {
      if (JSON.stringify(existing.creation) !== JSON.stringify(creation)) throw new Error('Task ID is already used by another task');
      return { taskId, workboard: boardView(state, args.missionId) };
    }
    if (board.tasks.length >= 256) throw new Error('This mission already has 256 tasks');
    const at = timestamp(runtime);
    const task = { id: taskId, kind: 'custom', ...creation, creation, status: 'todo', revision: 1, createdAt: at, updatedAt: at, completedAt: null };
    board.tasks.push(task); board.revision++; board.updatedAt = at;
    return { taskId: task.id, workboard: boardView(state, args.missionId) };
  });
}
export async function updateWorkTask(runtime, args) {
  onlyKeys(args, ['missionId', 'taskId', 'expectedRevision', 'changes', 'quantityOnHand', 'expectedInventoryRevision'], 'task update');
  text(args.taskId, 'task ID', 200, true);
  onlyKeys(args.changes, ['title', 'assignee', 'dueDate', 'notes', 'status'], 'task changes');
  if (!Object.keys(args.changes).length && args.quantityOnHand === undefined) throw new Error('Provide task changes or a stock count');
  const changes = {};
  for (const [key, value] of Object.entries(args.changes)) {
    if (key === 'title') changes.title = text(value, 'task title', 160, true);
    if (key === 'assignee') changes.assignee = text(value, 'assignee', 80);
    if (key === 'notes') changes.notes = text(value, 'notes', 2000);
    if (key === 'dueDate') changes.dueDate = dueDate(value);
    if (key === 'status') {
      if (!STATUSES.has(value)) throw new Error('Task status must be todo, doing or done');
      changes.status = value;
    }
  }
  if (args.quantityOnHand !== undefined) count(args.quantityOnHand, 'stock count');
  await runtime.getMission(args.missionId);
  return runtime.store.mutate(state => {
    const board = boardIn(state, args.missionId, true);
    const task = board.tasks.find(item => item.id === args.taskId);
    if (!task) throw new Error('Task not found');
    revision(args.expectedRevision, task.revision, 'Task');
    const at = timestamp(runtime);
    if (args.quantityOnHand !== undefined) {
      if (task.kind !== 'supply') throw new Error('Only a supply task can update a stock count');
      revision(args.expectedInventoryRevision, state.inventoryRevision ?? 0, 'Inventory');
      setInventory(state, { [task.item]: args.quantityOnHand }, at);
    } else if (args.expectedInventoryRevision !== undefined) throw new Error('Provide the stock count with its revision');
    const previousStatus = task.status;
    if (changes.status === 'done' && previousStatus !== 'done' && task.kind === 'supply' && (state.inventory[task.item] ?? 0) < task.target) throw new Error('Record at least ' + task.target + ' on hand before completing this restock task');
    Object.assign(task, changes);
    if (task.status === 'done' && previousStatus !== 'done') task.completedAt = at;
    if (task.status !== 'done') task.completedAt = null;
    task.revision++; task.updatedAt = at; board.revision++; board.updatedAt = at;
    return { taskId: task.id, workboard: boardView(state, args.missionId) };
  });
}
export async function updateInventory(runtime, args) {
  onlyKeys(args, ['items', 'expectedRevision'], 'inventory update');
  if (!record(args.items) || !Object.keys(args.items).length) throw new Error('Provide at least one stock count');
  return runtime.store.mutate(state => {
    revision(args.expectedRevision, state.inventoryRevision ?? 0, 'Inventory');
    return setInventory(state, args.items, timestamp(runtime));
  });
}
