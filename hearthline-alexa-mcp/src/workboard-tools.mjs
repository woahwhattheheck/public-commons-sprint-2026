const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = maxLength => ({ type: 'string', maxLength });
const missionId = { type: 'string', minLength: 1, maxLength: 200 };
const revision = { type: 'integer', minimum: 0 };
const count = { type: 'integer', minimum: 0, maximum: 10000 };
const taskFields = { title: { type: 'string', minLength: 1, maxLength: 160 }, assignee: string(80), dueDate: string(10), notes: string(2000) };
const read = { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true };
const write = { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false };

export const WORKBOARD_TOOLS = [
  { name: 'hearthline_get_inventory', title: 'Read household stock', description: 'Read current counts on hand and the revision used to save an updated count.', inputSchema: object({}), annotations: read },
  { name: 'hearthline_get_workboard', title: 'Read household workboard', description: 'Read task assignments, notes, due dates, completion and current supply gaps for an existing mission.', inputSchema: object({ missionId }, ['missionId']), annotations: read },
  { name: 'hearthline_add_task', title: 'Add a household task', description: 'Add real household work to an existing mission. Assignee and due date are optional; dueDate uses YYYY-MM-DD or an empty string. Reuse an optional taskId with the same creation fields to recover a response without adding another task.', inputSchema: object({ missionId, taskId: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }, ...taskFields }, ['missionId', 'title']), annotations: write },
  { name: 'hearthline_update_task', title: 'Update household task', description: 'Assign, edit, complete or reopen a task at its current revision. A supply task can atomically record quantityOnHand with expectedInventoryRevision. Completion does not approve or execute any shopping or reminder action.', inputSchema: object({ missionId, taskId: missionId, expectedRevision: revision, changes: object({ ...taskFields, status: { type: 'string', enum: ['todo', 'doing', 'done'] } }), quantityOnHand: count, expectedInventoryRevision: revision }, ['missionId', 'taskId', 'expectedRevision', 'changes']), annotations: write },
  { name: 'hearthline_update_inventory', title: 'Record stock on hand', description: 'Save observed absolute household counts using the revision returned by get_inventory. Existing plans and approved action content remain saved as originally prepared.', inputSchema: object({ items: { type: 'object', minProperties: 1, maxProperties: 128, additionalProperties: count }, expectedRevision: revision }, ['items', 'expectedRevision']), annotations: write },
];
const names = new Set(WORKBOARD_TOOLS.map(tool => tool.name));
export function isWorkboardTool(name) { return names.has(name); }
export async function callWorkboardTool(runtime, name, args) {
  let result;
  switch (name) {
    case 'hearthline_get_inventory':
      if (Object.keys(args).length) throw new Error('get_inventory takes no arguments');
      result = { inventory: await runtime.getInventory() }; break;
    case 'hearthline_get_workboard':
      if (Object.keys(args).some(key => key !== 'missionId')) throw new Error('Invalid workboard arguments');
      result = { workboard: await runtime.getWorkboard(args) }; break;
    case 'hearthline_add_task': result = await runtime.addTask(args); break;
    case 'hearthline_update_task': result = await runtime.updateTask(args); break;
    case 'hearthline_update_inventory': result = { inventory: await runtime.updateInventory(args) }; break;
    default: throw new Error('Unknown workboard tool');
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
}
