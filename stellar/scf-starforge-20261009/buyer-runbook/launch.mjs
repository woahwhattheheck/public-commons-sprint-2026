// MIT. Read-only binding for the original buyer workspace and its managed launcher.
import {constants} from 'node:fs';
import {lstat,open,readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {readPlan,runbookPlanDigest} from './runbook.mjs';

export const RUNBOOK_WORKSPACE_LAUNCH_SCHEMA = 'stellar-forge.buyer-runbook-workspace-launch.v1';
const WORKSPACE = 'stellar-forge.buyer-runbook-workspace.v1';
const REQUEST = 'stellar-forge.buyer-request-intake.v1';
const PAID_FILE = 'stellar-forge.buyer-paid-file-intake.v1';
const ENV = /^[A-Z][A-Z0-9_]{1,64}$/;
const hash = raw => createHash('sha256').update(raw).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (value,code) => { if (!value) throw Object.assign(new Error(code),{code,status:409}); };
const sourceRoot = fileURLToPath(new URL('../',import.meta.url));
export const RUNBOOK_WORKSPACE_SOURCE_FILES = Object.freeze([
  'buyer-runbook/launch.mjs',
  'buyer-runbook/workspace.mjs',
  'buyer-runbook/workspace-model.mjs',
  'buyer-runbook/cli.mjs',
  'buyer-runbook/runbook.mjs',
  'buyer-runbook/handoff-intake.mjs',
  'buyer-runbook/operator-preset.mjs',
  'buyer-runbook/paid-file-intake.mjs',
  'buyer-runbook/workspace-ui/app.mjs',
  'buyer-runbook/workspace-ui/index.html',
  'buyer-runbook/workspace-ui/style.css',
  'sf81-buyer-operator-bridge/bridge.mjs',
  'sf81-buyer-operator-bridge/browser-approval.mjs',
  'sf81-buyer-operator-bridge/browser-ui/approval-panel.mjs',
  'sf81-buyer-operator-bridge/browser-ui/approval.css',
]);

export function normalizeRunbookApprovalMode(value = 'TERMINAL') {
  check(typeof value === 'string' && ['BROWSER','TERMINAL'].includes(value.toUpperCase()),
    'WORKSPACE_APPROVAL_MODE_INVALID');
  return value.toUpperCase();
}
function canonical(value) {
  check(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'),
    'ABSOLUTE_WORKSPACE_PATH_REQUIRED');
  return resolve(value);
}
async function directorySelection(value,{allowMissing = false,missingRoot = null} = {}) {
  const path = canonical(value);
  try {
    const stat = await lstat(path);
    check(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path,
      'CANONICAL_WORKSPACE_DIRECTORY_REQUIRED');
    check(process.platform === 'win32' || (stat.mode & 0o077) === 0,
      'PRIVATE_WORKSPACE_DIRECTORY_REQUIRED');
  } catch (error) {
    if (error.code !== 'ENOENT' || !allowMissing) throw error;
    const parent = dirname(path);
    if (parent !== missingRoot) {
      check(await realpath(parent) === parent,'CANONICAL_WORKSPACE_PARENT_REQUIRED');
    }
  }
  return path;
}
async function optionalDirectory(path) {
  try { await directorySelection(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function optionalRecord(path,inputFiles,limit = 8 * 1024 * 1024) {
  let file;
  try { file = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.size <= limit,'WORKSPACE_LAUNCH_INPUT_INVALID');
    check(process.platform === 'win32' || (stat.mode & 0o077) === 0,
      'WORKSPACE_LAUNCH_INPUT_NOT_PRIVATE');
    const raw = await file.readFile();
    check(raw.length <= limit,'WORKSPACE_LAUNCH_INPUT_TOO_LARGE');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)); }
    catch { throw Object.assign(new Error('WORKSPACE_LAUNCH_INPUT_INVALID'),{code:'WORKSPACE_LAUNCH_INPUT_INVALID'}); }
    check(object(value),'WORKSPACE_LAUNCH_INPUT_INVALID');
    inputFiles.push({path,bytes:raw.length,sha256:hash(raw)});
    return value;
  } finally { await file.close(); }
}
function claimNames(value) {
  check(Array.isArray(value) && value.length >= 1 && value.length <= 32 &&
    value.every(name => typeof name === 'string' && ENV.test(name)) &&
    new Set(value).size === value.length,'PAID_FILE_CLAIM_ENVS_INVALID');
  return [...value];
}

/** No directories, imports, presets, keys, attempts or listeners are created here. */
export async function inspectRunbookWorkspaceSelection({directory,configsDirectory,operatorSettings,
  paidFileClaimEnvs,runs = [],approvalMode} = {}) {
  const inputFiles = [];
  directory = await directorySelection(directory,{allowMissing:true});
  const meta = await optionalRecord(join(directory,'workspace.json'),inputFiles);
  if (meta) check(meta.schema === WORKSPACE && meta.directory === directory,
    'WORKSPACE_IDENTITY_MISMATCH');
  const suppliedConfigs = configsDirectory === undefined ? undefined : canonical(configsDirectory);
  const actualConfigs = suppliedConfigs ?? meta?.configsDirectory ?? join(directory,'configs');
  configsDirectory = await directorySelection(actualConfigs,{
    allowMissing:!meta && suppliedConfigs === undefined,missingRoot:directory});
  if (meta) check(meta.configsDirectory === configsDirectory,'WORKSPACE_CONFIG_DIRECTORY_MISMATCH');
  const suppliedSettings = operatorSettings === undefined ? null : canonical(operatorSettings);
  const handoffs = join(directory,'handoffs');
  await optionalDirectory(handoffs);
  await optionalDirectory(join(directory,'imports'));
  const request = await optionalRecord(join(handoffs,'intake.json'),inputFiles);
  if (request) check(request.schema === REQUEST && request.directory === handoffs &&
    request.configsDirectory === configsDirectory &&
    (request.operatorSettings === null || typeof request.operatorSettings === 'string'),
    'REQUEST_INTAKE_IDENTITY_CHANGED');
  const declared = await optionalRecord(join(handoffs,'operator-settings.json'),inputFiles);
  if (declared) check(typeof declared.path === 'string' && canonical(declared.path) === declared.path,
    'REQUEST_OPERATOR_PRESET_PATH_CHANGED');
  if (request?.operatorSettings !== undefined && request.operatorSettings !== null)
    check(canonical(request.operatorSettings) === request.operatorSettings,
      'REQUEST_OPERATOR_PRESET_PATH_CHANGED');
  // An old null declaration may attach its first host-selected preset at Start.
  const effectiveOperatorSettings = request?.operatorSettings ?? declared?.path ?? suppliedSettings;
  check(suppliedSettings === null || suppliedSettings === effectiveOperatorSettings,
    'REQUEST_OPERATOR_PRESET_PATH_CHANGED');
  if (declared && request?.operatorSettings === null && suppliedSettings !== null)
    check(declared.path === suppliedSettings,'REQUEST_OPERATOR_PRESET_PATH_CHANGED');
  const paidDirectory = join(handoffs,'paid-files');
  await optionalDirectory(paidDirectory);
  const paid = await optionalRecord(join(paidDirectory,'intake.json'),inputFiles);
  if (paid) check(paid.schema === PAID_FILE && paid.directory === paidDirectory &&
    paid.configsDirectory === configsDirectory,'PAID_FILE_WORKSPACE_CHANGED');
  const suppliedClaims = paidFileClaimEnvs === undefined ? null : claimNames(paidFileClaimEnvs);
  const effectivePaidFileClaimEnvs = paid ? claimNames(paid.claimEnvs) :
    suppliedClaims ?? ['SF101_CLAIM_TOKEN'];
  check(suppliedClaims === null || isDeepStrictEqual(suppliedClaims,effectivePaidFileClaimEnvs),
    'PAID_FILE_CLAIM_ENVS_CHANGED');
  check(Array.isArray(runs) && runs.length <= 64,'WORKSPACE_INITIAL_RUNS_INVALID');
  const initialRuns = [],initialRunIdentities = [];
  for (const supplied of runs) {
    const path = await directorySelection(supplied);
    check(!initialRuns.includes(path),'WORKSPACE_INITIAL_RUNS_INVALID');
    const rawPlan = await optionalRecord(join(path,'plan.json'),inputFiles);
    check(rawPlan,'INVALID_SAVED_RUNBOOK');
    const plan = await readPlan(path);
    check(isDeepStrictEqual(rawPlan,plan),'WORKSPACE_INITIAL_RUN_CHANGED');
    const id = 'import-' + hash(path).slice(0,32);
    const pointer = await optionalRecord(join(directory,'imports',id+'.json'),inputFiles);
    if (pointer) check(pointer.path === path && pointer.planId === plan.id,'IMPORTED_RUN_MISMATCH');
    initialRuns.push(path);
    initialRunIdentities.push({path,planId:plan.id,planSha256:runbookPlanDigest(plan)});
  }
  const selection = {directory,configsDirectory,operatorSettings:suppliedSettings,
    paidFileClaimEnvs:suppliedClaims,initialRuns,approvalMode:normalizeRunbookApprovalMode(approvalMode),
    effectiveOperatorSettings,effectivePaidFileClaimEnvs,initialRunIdentities};
  const sourceFiles = [];
  for (const path of RUNBOOK_WORKSPACE_SOURCE_FILES) {
    const raw = await readFile(join(sourceRoot,path));
    sourceFiles.push({path,bytes:raw.length,sha256:hash(raw)});
  }
  // New workspace metadata is published by the original constructor. Its presence
  // and timestamps do not change the reviewed semantic selection after Reopen.
  const selectionSha256 = hash(JSON.stringify({selection,sourceFiles}));
  return {selection,selectionSha256,inputFiles,sourceFiles};
}

export function matchRunbookWorkspaceLaunch(value,binding) {
  check(object(value) && value.schema === RUNBOOK_WORKSPACE_LAUNCH_SCHEMA &&
    value.mode === 'BUYER_RUNBOOK_WORKSPACE' && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.instanceId === 'string' && /^[a-f0-9-]{36}$/.test(value.instanceId) &&
    value.selectionSha256 === binding.selectionSha256 &&
    isDeepStrictEqual(value.selection,binding.selection) &&
    isDeepStrictEqual(value.sourceFiles,binding.sourceFiles) &&
    value.directory === binding.selection.directory &&
    value.approvalMode === binding.selection.approvalMode &&
    typeof value.terminalAvailable === 'boolean' && typeof value.approvalAvailable === 'boolean',
  'WORKSPACE_LAUNCH_SELECTION_CHANGED');
  let url;
  try { url = new URL(value.url); } catch { check(false,'WORKSPACE_LAUNCH_URL_INVALID'); }
  check(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname) &&
    /^[1-9][0-9]{0,4}$/.test(url.port) && Number(url.port) <= 65535 &&
    url.username === '' && url.password === '' && url.pathname === '/' &&
    url.search === '' && url.hash === '','WORKSPACE_LAUNCH_URL_INVALID');
  return value;
}
