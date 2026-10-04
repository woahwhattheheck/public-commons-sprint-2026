import { APP_URI } from './app-resource.mjs';

const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const text = (value) => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });
const operationIdSchema = { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' };

export function listTools() {
  const ui = { ui: { resourceUri: APP_URI } };
  return [
    { name: 'hearthline_seed_inventory', title: 'Seed household inventory', description: 'Set demo household inventory counts used by preparedness missions. Local state only.', inputSchema: objectSchema({ items: { type: 'object', additionalProperties: { type: 'integer', minimum: 0, maximum: 10000 } } }, ['items']), annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: false } },
    { name: 'hearthline_prepare_storm', title: 'Prepare storm-readiness mission', description: 'Fetch active US National Weather Service alerts, compare local supplies, and prepare a stateful mission. External commits remain gated for explicit approval.', inputSchema: objectSchema({ title: { type: 'string', maxLength: 120 }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, household: objectSchema({ people: { type: 'integer', minimum: 1, maximum: 30 }, pets: { type: 'integer', minimum: 0, maximum: 30 }, notes: { type: 'string', maxLength: 500 } }) }, ['latitude', 'longitude']), _meta: ui, annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false } },
    { name: 'hearthline_get_mission', title: 'Read mission', description: 'Read a mission including approval state, operation binding, and the plan hash required for approval.', inputSchema: objectSchema({ missionId: { type: 'string', minLength: 1 } }, ['missionId']), _meta: ui, annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true } },
    { name: 'hearthline_list_missions', title: 'List missions', description: 'List durable missions from prior sessions.', inputSchema: objectSchema({}), annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true } },
    { name: 'hearthline_get_operation', title: 'Read authority operation', description: 'Read the durable approval/execution authority record for one operation ID, including conservative authority ceilings and tamper-evident receipt linkage.', inputSchema: objectSchema({ operationId: operationIdSchema }, ['operationId']), _meta: ui, annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true } },
    { name: 'hearthline_approve_action', title: 'Approve a mission action', description: 'Bind one explicit operation ID to the exact current action payload and plan hash. Approval records authority ceilings and does not execute the action.', inputSchema: objectSchema({ missionId: { type: 'string' }, actionId: { type: 'string' }, planHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, operationId: operationIdSchema }, ['missionId', 'actionId', 'planHash']), _meta: ui, annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: false } },
    { name: 'hearthline_execute_approved', title: 'Execute approved action', description: 'Execute only the exact payload bound to a durable approved operation ID. Exact retries return the original receipt; changed/rebound operations fail closed. Shopping never purchases; reminders stay in the local demo outbox.', inputSchema: objectSchema({ missionId: { type: 'string' }, actionId: { type: 'string' }, operationId: operationIdSchema, idempotencyKey: operationIdSchema }, ['missionId', 'actionId']), _meta: ui, annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false, readOnlyHint: false } },
  ];
}

export async function callTool(orchestrator, name, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be an object');
  validateToolArgs(name, args);
  switch (name) {
    case 'hearthline_seed_inventory': { const result = await orchestrator.seedInventory(args.items); return { content: [text(result)], structuredContent: result }; }
    case 'hearthline_prepare_storm': { const mission = await orchestrator.prepareStormMission(args); return { content: [text({ missionId: mission.id, status: mission.status, alerts: mission.alertsSummary, pendingApprovals: mission.actions.filter(a => a.status === 'awaiting_approval').length })], structuredContent: { mission } }; }
    case 'hearthline_get_mission': { const mission = await orchestrator.getMission(args.missionId); return { content: [text(mission)], structuredContent: { mission } }; }
    case 'hearthline_list_missions': { const missions = await orchestrator.listMissions(); return { content: [text({ count: missions.length, missions: missions.map(({ id, title, status, createdAt }) => ({ id, title, status, createdAt })) })], structuredContent: { missions } }; }
    case 'hearthline_get_operation': { const operation = await orchestrator.getOperation(args.operationId); return { content: [text(operation)], structuredContent: { operation } }; }
    case 'hearthline_approve_action': { const result = await orchestrator.approveAction(args); return { content: [text({ actionId: result.action.id, operationId: result.approval.operationId, approvalDigest: result.approval.approvalDigest, status: result.action.status, replayed: result.replayed, alreadyComplete: result.alreadyComplete, authorityCeiling: result.approval.authorityCeiling })], structuredContent: { mission: result.mission, action: result.action, approval: result.approval, replayed: result.replayed } }; }
    case 'hearthline_execute_approved': { const result = await orchestrator.executeApproved(args); return { content: [text({ operationId: result.approval.operationId, approvalDigest: result.approval.approvalDigest, receipt: result.receipt, replayed: result.replayed })], structuredContent: { mission: result.mission, approval: result.approval, receipt: result.receipt, replayed: result.replayed } }; }
    default: throw new Error(`unknown tool: ${name}`);
  }
}

function validateToolArgs(name, args) {
  const own = (key) => Object.prototype.hasOwnProperty.call(args, key);
  const string = (key, { min = 0, max = Infinity, pattern } = {}) => { if (!own(key) || typeof args[key] !== 'string' || args[key].length < min || args[key].length > max || (pattern && !pattern.test(args[key]))) throw new Error(`invalid ${key}`); };
  const operationId = () => string('operationId', { min: 8, max: 128, pattern: /^[A-Za-z0-9._:-]+$/ });
  const number = (key, min, max) => { if (!own(key) || !Number.isFinite(args[key]) || args[key] < min || args[key] > max) throw new Error(`invalid ${key}`); };
  switch (name) {
    case 'hearthline_seed_inventory': if (!own('items') || !args.items || typeof args.items !== 'object' || Array.isArray(args.items)) throw new Error('invalid items'); break;
    case 'hearthline_prepare_storm': number('latitude', -90, 90); number('longitude', -180, 180); if (own('title') && (typeof args.title !== 'string' || args.title.length > 120)) throw new Error('invalid title'); if (own('household') && (!args.household || typeof args.household !== 'object' || Array.isArray(args.household))) throw new Error('invalid household'); break;
    case 'hearthline_get_mission': string('missionId', { min: 1, max: 200 }); break;
    case 'hearthline_list_missions': break;
    case 'hearthline_get_operation': operationId(); break;
    case 'hearthline_approve_action': string('missionId', { min: 1, max: 200 }); string('actionId', { min: 1, max: 200 }); string('planHash', { min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }); if (own('operationId')) operationId(); break;
    case 'hearthline_execute_approved': string('missionId', { min: 1, max: 200 }); string('actionId', { min: 1, max: 200 }); if (!own('operationId') && !own('idempotencyKey')) throw new Error('invalid operationId'); if (own('operationId')) operationId(); if (own('idempotencyKey')) string('idempotencyKey', { min: 8, max: 128, pattern: /^[A-Za-z0-9._:-]+$/ }); break;
    default: throw new Error(`unknown tool: ${name}`);
  }
}
