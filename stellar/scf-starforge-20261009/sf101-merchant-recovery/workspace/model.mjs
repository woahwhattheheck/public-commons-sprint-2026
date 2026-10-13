// MIT. Operator navigation over the original SF101 recovery and transfer engines.
import { constants } from 'node:fs';
import { lstat, realpath, mkdir, readdir, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runRemote } from '../remote.mjs';
import { openS3Store } from '../remote-s3.mjs';
import { inspectLocalCapture, readCapturedBundle, runLocalCapture, runLocalVerification,
  inspectLocalPublisherRestore, runLocalPublisherPreparation, RETIRED_CAPTURE_PREFIX } from './local.mjs';
import { acquireDeliveryLease } from '../../sf98-merchant-delivery/delivery-lock.mjs';
import { inspectLocalFleetRestore, runLocalFleetPreparation } from './fleet.mjs';
import { compileObjectSessions, createObjectRecoveryAdapter } from './object-sessions.mjs';
import { createRecoverySupport } from './recovery-support.mjs';
import {compileObjectBundleArchives,createObjectBundleAdapter,objectBundleCommand,comparisonBundlePair} from './object-bundles.mjs';

import {createObjectComparisonAdapter} from './object-comparisons.mjs';

export const HOST_SCHEMA = 'stellar-forge.recovery-workspace.v1';
const STATE_SCHEMA = 'stellar-forge.recovery-workspace-state.v1';
const REQUEST_SCHEMA = 'stellar-forge.recovery-workspace-request.v1';
const BUNDLE_SCHEMA = 'stellar-forge.merchant-recovery.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const HEX = /^[a-f0-9]{64}$/;
const PASS_ENV = /^[A-Z][A-Z0-9_]{4,63}$/;
const MAX_JSON = 2 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024 * 1024;
const stamp = () => new Date().toISOString();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const objectCommand = command => ['object-snapshot','object-verify','object-restore'].includes(command);
const comparisonCommand=command=>command==='object-compare';
const localCommand = command => comparisonCommand(command) || objectCommand(command) || objectBundleCommand(command) || ['snapshot', 'local-verify', 'publisher-prepare', 'fleet-prepare'].includes(command);
const inside = (parent, child) => parent === child || child.startsWith(parent + sep);

function need(ok, code, message = code, status = 400) {
  if (!ok) { const error = new Error(message); error.code = code; error.status = status; throw error; }
}
function exact(value, fields, label) {
  need(object(value), 'WORKSPACE_INPUT_INVALID', label + ' must be an object');
  need(Object.keys(value).every(key => fields.includes(key)), 'WORKSPACE_INPUT_INVALID', 'Unknown ' + label + ' field');
  return value;
}
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value,
    'WORKSPACE_PATH_INVALID', label + ' must be a normalized absolute path');
  return value;
}
function identifier(value, label) {
  need(typeof value === 'string' && ID.test(value), 'WORKSPACE_ID_INVALID', 'Invalid ' + label);
  return value;
}
function label(value, fallback) {
  const text = value ?? fallback;
  need(typeof text === 'string' && text.trim().length > 0 && text.length <= 160 &&
    !/[\u0000-\u001f]/.test(text), 'WORKSPACE_LABEL_INVALID');
  return text;
}
function segment(value) {
  need(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 255 &&
    value !== '.' && value !== '..' && !/[\/\\\u0000-\u001f]/.test(value), 'WORKSPACE_BUNDLE_INVALID');
  return value;
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function privateDirectory(path, create = false) {
  absolute(path, 'Directory');
  if (create && !await exists(path)) await mkdir(path, { mode: 0o700 });
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) &&
    await realpath(path) === path, 'WORKSPACE_PRIVATE_DIRECTORY_REQUIRED', 'A private real directory is required: ' + path);
  return path;
}
async function privateBytes(path, maximum = MAX_JSON) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    need(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.size <= maximum,
      'WORKSPACE_PRIVATE_FILE_REQUIRED', 'A private regular file within its size limit is required: ' + path);
    const value = await fd.readFile();
    need(value.length === stat.size && value.length <= maximum, 'WORKSPACE_FILE_CHANGED');
    return value;
  } finally { await fd.close(); }
}
async function privateJSON(path, maximum) {
  try { return JSON.parse((await privateBytes(path, maximum)).toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) { error.code = 'WORKSPACE_JSON_INVALID'; error.status = 400; } throw error; }
}
async function syncDirectory(path) {
  const fd = await open(path, constants.O_RDONLY);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function atomicJSON(path, value) {
  await privateDirectory(dirname(path));
  if (await exists(path)) await privateBytes(path);
  const temporary = join(dirname(path), '.recovery-workspace-' + randomUUID());
  const fd = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const data = JSON.stringify(value, null, 2) + '\n';
    need(Buffer.byteLength(data) <= MAX_JSON, 'WORKSPACE_RECORD_TOO_LARGE');
    await fd.writeFile(data); await fd.sync();
  } finally { await fd.close(); }
  try { await rename(temporary, path); await syncDirectory(dirname(path)); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
function compileHost(value) {
  exact(value, ['schema', 'title', 'profiles'], 'host configuration');
  need(value.schema === HOST_SCHEMA && Array.isArray(value.profiles) &&
    value.profiles.length > 0 && value.profiles.length <= 32, 'WORKSPACE_HOST_CONFIG_INVALID');
  const seen = new Set();
  const profiles = value.profiles.map(input => {
    exact(input, ['id', 'label', 'storeConfig', 'operations', 'passEnv', 'bundleRoots', 'downloadRoot', 'restoreRoot', 'capturePlans', 'publisherRestores', 'fleetRestores', 'fleetTargets', 'objectSessions', 'objectBundleArchives', 'casesDirectory', 'caseSourceDirectory'], 'profile');
    const id = identifier(input.id, 'profile ID');
    need(!seen.has(id), 'WORKSPACE_DUPLICATE_PROFILE'); seen.add(id);
    need(PASS_ENV.test(input.passEnv ?? ''), 'WORKSPACE_PASSPHRASE_NAME_INVALID');
    need(Array.isArray(input.bundleRoots) && input.bundleRoots.length > 0 &&
      input.bundleRoots.length <= 32, 'WORKSPACE_BUNDLE_ROOTS_REQUIRED');
    const roots = new Set();
    const bundleRoots = input.bundleRoots.map(root => {
      exact(root, ['id', 'label', 'directory'], 'bundle root');
      const rootId = identifier(root.id, 'bundle-root ID');
      need(!roots.has(rootId), 'WORKSPACE_DUPLICATE_BUNDLE_ROOT'); roots.add(rootId);
      return { id: rootId, label: label(root.label, rootId), directory: absolute(root.directory, 'Bundle root') };
    });
    const captureIds = new Set();
    need(input.capturePlans === undefined || Array.isArray(input.capturePlans), 'WORKSPACE_CAPTURE_PLANS_INVALID');
    const capturePlans = (input.capturePlans ?? []).map(plan => {
      exact(plan, ['id', 'label', 'planFile', 'bundleRootId'], 'capture plan');
      const planId = identifier(plan.id, 'capture-plan ID');
      need(!captureIds.has(planId), 'WORKSPACE_DUPLICATE_CAPTURE_PLAN'); captureIds.add(planId);
      need(roots.has(plan.bundleRootId), 'WORKSPACE_CAPTURE_ROOT_NOT_FOUND',
        'A capture plan must select one declared bundle root');
      return { id: planId, label: label(plan.label, planId),
        planFile: absolute(plan.planFile, 'Original snapshot plan'), bundleRootId: plan.bundleRootId };
    });
    need(capturePlans.length <= 32, 'WORKSPACE_CAPTURE_PLANS_INVALID');
    const downloadRoot = absolute(input.downloadRoot, 'Download root');
    const restoreRoot = absolute(input.restoreRoot, 'Restore root');
    const restoreIds = new Set();
    need(input.publisherRestores === undefined || Array.isArray(input.publisherRestores),
      'WORKSPACE_PUBLISHER_RESTORES_INVALID');
    const publisherRestores = (input.publisherRestores ?? []).map(restored => {
      exact(restored, ['id', 'label', 'bundleDirectory', 'restoreDirectory'], 'restored publisher');
      const restoredId = identifier(restored.id, 'restored-publisher ID');
      need(!restoreIds.has(restoredId), 'WORKSPACE_DUPLICATE_PUBLISHER_RESTORE'); restoreIds.add(restoredId);
      const bundleDirectory = absolute(restored.bundleDirectory, 'Original encrypted publisher bundle');
      const restoreDirectory = absolute(restored.restoreDirectory, 'Original restored publisher');
      need(bundleRoots.some(root => bundleDirectory !== root.directory && inside(root.directory, bundleDirectory)) ||
        bundleDirectory !== downloadRoot && inside(downloadRoot, bundleDirectory),
        'WORKSPACE_PUBLISHER_BUNDLE_OUTSIDE_HOST_ROOTS');
      need(restoreDirectory !== restoreRoot && inside(restoreRoot, restoreDirectory),
        'WORKSPACE_PUBLISHER_RESTORE_OUTSIDE_HOST_ROOTS');
      need(!inside(bundleDirectory, restoreDirectory) && !inside(restoreDirectory, bundleDirectory),
        'WORKSPACE_PUBLISHER_RESTORE_OVERLAP');
      return { id: restoredId, label: label(restored.label, restoredId), bundleDirectory, restoreDirectory };
    });
    need(publisherRestores.length <= 32, 'WORKSPACE_PUBLISHER_RESTORES_INVALID');
    const fleetRestoreIds = new Set();
    need(input.fleetRestores === undefined || Array.isArray(input.fleetRestores),
      'WORKSPACE_FLEET_RESTORES_INVALID');
    const fleetRestores = (input.fleetRestores ?? []).map(restored => {
      exact(restored, ['id', 'label', 'bundleDirectory', 'restoreDirectory'], 'restored fleet');
      const restoredId = identifier(restored.id, 'restored-fleet ID');
      need(!fleetRestoreIds.has(restoredId), 'WORKSPACE_DUPLICATE_FLEET_RESTORE'); fleetRestoreIds.add(restoredId);
      const bundleDirectory = absolute(restored.bundleDirectory, 'Original encrypted fleet bundle');
      const restoreDirectory = absolute(restored.restoreDirectory, 'Original restored fleet');
      need(bundleRoots.some(root => bundleDirectory !== root.directory && inside(root.directory, bundleDirectory)) ||
        bundleDirectory !== downloadRoot && inside(downloadRoot, bundleDirectory),
        'WORKSPACE_FLEET_BUNDLE_OUTSIDE_HOST_ROOTS');
      need(restoreDirectory !== restoreRoot && inside(restoreRoot, restoreDirectory),
        'WORKSPACE_FLEET_RESTORE_OUTSIDE_HOST_ROOTS');
      need(!inside(bundleDirectory, restoreDirectory) && !inside(restoreDirectory, bundleDirectory),
        'WORKSPACE_FLEET_RESTORE_OVERLAP');
      return { id: restoredId, label: label(restored.label, restoredId), bundleDirectory, restoreDirectory };
    });
    need(fleetRestores.length <= 32, 'WORKSPACE_FLEET_RESTORES_INVALID');
    const fleetTargetIds = new Set();
    need(input.fleetTargets === undefined || Array.isArray(input.fleetTargets), 'WORKSPACE_FLEET_TARGETS_INVALID');
    const fleetTargets = (input.fleetTargets ?? []).map(target => {
      exact(target, ['id', 'label', 'targetFile', 'operationDirectory'], 'receiving fleet target');
      const targetId = identifier(target.id, 'fleet-target ID');
      need(!fleetTargetIds.has(targetId), 'WORKSPACE_DUPLICATE_FLEET_TARGET'); fleetTargetIds.add(targetId);
      return { id: targetId, label: label(target.label, targetId),
        targetFile: absolute(target.targetFile, 'Original private fleet target declaration'),
        operationDirectory: absolute(target.operationDirectory, 'Original fleet receiving operation') };
    });
    need(fleetTargets.length <= 32, 'WORKSPACE_FLEET_TARGETS_INVALID');
    const objectSessions = compileObjectSessions(input.objectSessions ?? [], {bundleRoots,downloadRoot,
      controls:[absolute(input.operations, 'Original operations directory')]});
    const objectBundleArchives=compileObjectBundleArchives(input.objectBundleArchives,{downloadRoot,objectSessions,
      controls:[absolute(input.operations,'Original operations directory'),...['casesDirectory','caseSourceDirectory'].filter(key=>input[key]).map(key=>absolute(input[key],key))]});
    return { id, label: label(input.label, id),
      storeConfig: input.storeConfig == null ? null : absolute(input.storeConfig, 'S3 configuration'),
      operations: absolute(input.operations, 'Original operations directory'), passEnv: input.passEnv, bundleRoots,
      capturePlans, publisherRestores, fleetRestores, fleetTargets, objectSessions, objectBundleArchives, downloadRoot, restoreRoot,
      ...(input.casesDirectory===undefined?{}:{casesDirectory:absolute(input.casesDirectory,'Support cases')}),
      ...(input.caseSourceDirectory===undefined?{}:{caseSourceDirectory:absolute(input.caseSourceDirectory,'Original case source delivery')}) };
  });
  return { schema: HOST_SCHEMA, title: label(value.title, 'Merchant recovery'), profiles };
}
function publicError(error) {
  const result = { code: String(error.code ?? 'RECOVERY_WORKSPACE_FAILED').slice(0, 100),
    message: String(error.message ?? 'Recovery operation failed').slice(0, 500) };
  for (const key of ['status', 'providerCode', 'originalCode', 'requestId', 'putRequestId', 'retryAfter', 'retryable', 'mayHaveCommitted', 'reconciliationCode', 'reconciliationStatus'])
    if (['string', 'number', 'boolean'].includes(typeof error[key])) result[key] = error[key];
  return result;
}
function cursorPage(names, cursor, limit) {
  need(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'WORKSPACE_PAGE_LIMIT_INVALID');
  if (cursor !== undefined && cursor !== null && cursor !== '') identifier(cursor, 'page cursor');
  const selected = names.sort().filter(name => !cursor || name > cursor);
  return { names: selected.slice(0, limit), nextCursor: selected.length > limit ? selected[limit - 1] : null };
}

// Read the exact host selection without opening a workspace, provider or lease.
// Launchers retain only these path bindings and the original file digests.
export async function readRecoveryConfiguration(configFile) {
  absolute(configFile, 'Host configuration');
  const bytes = await privateBytes(configFile);
  return { configFile, sha256: hash(bytes), host: compileHost(JSON.parse(bytes.toString('utf8'))) };
}

// Native attachment identity: read the existing state without acquiring its writer.
export async function readRecoveryWorkspaceIdentity({ configFile, directory } = {}) {
  await privateDirectory(directory);
  const { sha256 } = await readRecoveryConfiguration(configFile);
  const state = await privateJSON(join(directory, 'workspace.json'));
  need(state.schema === STATE_SCHEMA && state.configFile === configFile &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(state.id ?? ''),
    'WORKSPACE_IDENTITY_CHANGED', 'Select this existing workspace and its original host configuration');
  return { schema: 'stellar-forge.recovery-workspace-identity.v1', workspaceId: state.id,
    directory, configFile, configurationSha256: sha256 };
}

export async function openRecoveryWorkspace({ configFile, directory, readOnly = false } = {}) {
  absolute(directory, 'Workspace');
  const { sha256: configHash, host } = await readRecoveryConfiguration(configFile);
  await privateDirectory(directory, !readOnly);
  const requestRoot = join(directory, 'requests');
  if (!readOnly) await privateDirectory(requestRoot, true);
  else if (await exists(requestRoot)) await privateDirectory(requestRoot);
  for (const profile of host.profiles) {
    need(!inside(directory, profile.operations) && !inside(profile.operations, directory),
      'WORKSPACE_OPERATION_DIRECTORY_OVERLAP');
    for (const root of [...profile.bundleRoots.map(item => item.directory), profile.downloadRoot, profile.restoreRoot]) {
      need(!inside(directory, root) && !inside(root, directory), 'WORKSPACE_SOURCE_DIRECTORY_OVERLAP');
      await privateDirectory(root);
    }
    for(const archive of profile.objectBundleArchives)
      for(const control of [directory,...host.profiles.map(row=>row.operations)])
        need(!inside(control,archive.path)&&!inside(archive.path,control),'WORKSPACE_BUNDLE_ARCHIVE_OVERLAP');
    for (const declaration of profile.objectSessions)
      for (const path of [declaration.stateRoot,declaration.bundle])
        for (const control of [directory,...host.profiles.map(row=>row.operations)])
          need(!inside(path,control)&&!inside(control,path),'WORKSPACE_OBJECT_CONTROL_OVERLAP');
    for(const path of [profile.casesDirectory,profile.caseSourceDirectory].filter(Boolean)) {
      need(!inside(directory,path)&&!inside(path,directory),'WORKSPACE_SUPPORT_CONTROL_OVERLAP');
      for(const other of [profile.operations,...profile.objectSessions.flatMap(row=>[row.stateRoot,row.bundle])])
        need(!inside(other,path)&&!inside(path,other),'WORKSPACE_SUPPORT_SOURCE_OVERLAP');
      await privateDirectory(path);
    }
    need(!profile.caseSourceDirectory||profile.casesDirectory,'WORKSPACE_SUPPORT_CASES_REQUIRED');
    if(profile.casesDirectory&&profile.caseSourceDirectory)need(!inside(profile.casesDirectory,profile.caseSourceDirectory)&&
      !inside(profile.caseSourceDirectory,profile.casesDirectory),'WORKSPACE_SUPPORT_SOURCE_OVERLAP');
    if (profile.storeConfig !== null) await privateBytes(profile.storeConfig);
    // Original plan files are read for fresh capture review. Retained operations can reopen after source removal.
    if (await exists(profile.operations)) await privateDirectory(profile.operations);
  }
  let lease;
  if (!readOnly) lease = await acquireDeliveryLease(directory, { purpose: 'drain' });
  let workspaceState, active = null, closed = false, closing = false;
  let mutations = Promise.resolve();
  const transition = action => {
    const next = mutations.then(action, action);
    mutations = next.catch(() => {});
    return next;
  };
  try {
    const statePath = join(directory, 'workspace.json');
    if (await exists(statePath)) {
      workspaceState = await privateJSON(statePath);
      need(workspaceState.schema === STATE_SCHEMA && workspaceState.configFile === configFile,
        'WORKSPACE_IDENTITY_CHANGED', 'Reopen this workspace with its original host configuration path');
    } else {
      need(!readOnly, 'WORKSPACE_NOT_CREATED', 'Start the workspace once before reading its saved state', 404);
      workspaceState = { schema: STATE_SCHEMA, id: randomUUID(), configFile, createdAt: stamp() };
      await atomicJSON(statePath, workspaceState);
    }
  } catch (error) { await lease?.release(); throw error; }

  const objectAdapter = createObjectRecoveryAdapter({directory,environment:process.env,
    isClosing:()=>closing||closed,readOnly});
  const comparisonAdapter=createObjectComparisonAdapter({directory,environment:process.env,
    isClosing:()=>closing||closed,readOnly});
  async function originalRequestBytes(profileId,id){
    selectedProfile(profileId);identifier(id,'operation ID');
    const raw=await privateBytes(requestPath(profileId,id)),saved=JSON.parse(raw.toString('utf8'));
    need(saved.schema===REQUEST_SCHEMA&&saved.review?.profileId===profileId&&saved.review?.operationId===id,
      'WORKSPACE_REQUEST_IDENTITY_INVALID');return raw;
  }
  async function originalEvidenceBytes(sha256){
    const found=await objectAdapter.evidence(sha256),raw=Buffer.from(JSON.stringify(found.evidence)+'\n');
    need(raw.length===found.bytes&&hash(raw)===sha256,'WORKSPACE_OBJECT_EVIDENCE_CHANGED');return raw;
  }
  async function originalComparisonArtifactBytes(ref){
    const artifact=await comparisonAdapter.artifact(ref.sha256);
    need(artifact.bytes===ref.bytes&&artifact.mediaType===ref.mediaType,'WORKSPACE_COMPARISON_ARTIFACT_CHANGED');
    const raw=Buffer.from(artifact.text,'utf8');
    need(raw.length===ref.bytes&&hash(raw)===ref.sha256,'WORKSPACE_COMPARISON_ARTIFACT_CHANGED');return raw;
  }
  const bundleAdapter=createObjectBundleAdapter({directory,workspaceId:workspaceState.id,
    readRequestBytes:originalRequestBytes,readEvidenceBytes:originalEvidenceBytes,readComparisonArtifactBytes:originalComparisonArtifactBytes});
  const support = createRecoverySupport({directory,workspaceId:workspaceState.id,profiles:host.profiles,currentHost,
    readRequestBytes:originalRequestBytes,readEvidenceBytes:originalEvidenceBytes,
    readComparisonArtifactBytes:originalComparisonArtifactBytes,
    isActive:(profileId,id)=>active?.key===requestPath(profileId,id),isClosing:()=>closing||closed,readOnly});
  async function bundlePairSelected(profileId,beforeId,afterId){
    await currentHost();selectedProfile(profileId);identifier(beforeId,'before original export');identifier(afterId,'after original export');
    const entries={};
    for(const [side,id]of Object.entries({before:beforeId,after:afterId})){
      const request=await readRequest(profileId,id);
      need(request?.review.command==='object-bundle-export'&&request.result?.status==='COMPLETE','WORKSPACE_BUNDLE_EXPORT_REQUIRED');
      entries[side]={archive:await bundleAdapter.artifact(profileId,id),
        transport:{...request.result,workspaceOperationId:id}};
    }
    return {entries,pair:comparisonBundlePair(entries.before,entries.after)};
  }
  const objectReviews = join(directory,'object-reviews');
  function declaredObject(profile,id) {
    identifier(id,'Object-session declaration');
    const declaration=profile.objectSessions.find(row=>row.id===id);
    need(declaration,'WORKSPACE_OBJECT_SESSION_NOT_DECLARED','Select an original host-declared Object session',404);
    return declaration;
  }
  async function objectSession(profileId,id) {
    need(!readOnly&&!closing,'WORKSPACE_READ_ONLY');
    need(!active,'WORKSPACE_EXECUTION_ACTIVE','Read the saved result while an original execution is active',409);
    await currentHost();
    return objectAdapter.inspect(declaredObject(selectedProfile(profileId),id));
  }
  async function objectEvidence(sha256) {
    need(!closed,'WORKSPACE_CLOSED');await currentHost();return objectAdapter.evidence(sha256);
  }
  async function preparedObject(input,expectedReviewHash) {
    await currentHost();
    const reviewed=await privateJSON(join(objectReviews,expectedReviewHash+'.json'));
    need((objectCommand(reviewed.command)||objectBundleCommand(reviewed.command)||comparisonCommand(reviewed.command))&&reviewed.reviewHash===expectedReviewHash&&
      JSON.stringify(reviewed.intent)===JSON.stringify(input)&&
      finishReview(reviewed,reviewed.intent).reviewHash===expectedReviewHash,
      'WORKSPACE_OBJECT_PREPARED_REVIEW_CHANGED','Select the exact original saved Object review',409);
    localPathBindings(selectedProfile(reviewed.profileId),reviewed);
    return reviewed;
  }
  async function objectSelection(profile,input) {
    exact(input,['profileId','action','id','objectSessionId','expectedRecordSha256','quiesced'],'Object selection');
    const declaration=declaredObject(profile,input.objectSessionId);
    const saved=await readRequest(profile.id,input.id);
    if(saved){
      need(objectCommand(saved.review.command)&&JSON.stringify(saved.review.intent)===JSON.stringify(input),
        'WORKSPACE_REQUEST_SELECTION_CHANGED','Keep this original Object request with its complete saved selection',409);
      localPathBindings(profile,saved.review);return clone(saved.review);
    }
    need(!readOnly&&!closing,'WORKSPACE_READ_ONLY');
    need(!active,'WORKSPACE_EXECUTION_ACTIVE','Finish the current original execution before preparing another review',409);
    const native=await objectAdapter.review(declaration,{action:input.action,
      expectedRecordSha256:input.expectedRecordSha256,quiesced:input.quiesced,passEnv:profile.passEnv});
    const reviewed=finishReview({profileId:profile.id,command:input.action,operationId:input.id,
      store:null,snapshotId:native.expectedRecordSha256??null,source:declaration.directory,
      destination:input.action==='object-snapshot'?declaration.bundle:input.action==='object-restore'?declaration.stateRoot:null,
      objectDeclaration:clone(declaration),objectRecovery:native,
      options:{command:input.action,id:input.id,passEnv:profile.passEnv,objectSessionId:declaration.id,objectRecovery:native}},input);
    localPathBindings(profile,reviewed);await privateDirectory(objectReviews,true);
    const file=join(objectReviews,reviewed.reviewHash+'.json');
    if(await exists(file))need(JSON.stringify(await privateJSON(file))===JSON.stringify(reviewed),
      'WORKSPACE_OBJECT_PREPARED_REVIEW_CHANGED');
    else await atomicJSON(file,reviewed);
    return reviewed;
  }

  async function comparisonSelection(profile,input){
    exact(input,['profileId','action','id','beforeObjectSessionId','afterObjectSessionId',
      'beforeExpectedRecordSha256','afterExpectedRecordSha256'],'Object comparison');
    const saved=await readRequest(profile.id,input.id);
    if(saved){
      need(comparisonCommand(saved.review.command)&&JSON.stringify(saved.review.intent)===JSON.stringify(input),
        'WORKSPACE_REQUEST_SELECTION_CHANGED');
      localPathBindings(profile,saved.review);return clone(saved.review);
    }
    need(!readOnly&&!closing,'WORKSPACE_READ_ONLY');need(!active,'WORKSPACE_EXECUTION_ACTIVE');
    const selected=await comparisonAdapter.review(profile,input);
    const reviewed=finishReview({profileId:profile.id,command:'object-compare',operationId:input.id,
      store:null,snapshotId:null,source:selected.before.bundle,destination:null,
      objectComparison:selected,options:{command:'object-compare',id:input.id,passEnv:profile.passEnv,
        objectComparison:selected}},input);
    localPathBindings(profile,reviewed);await privateDirectory(objectReviews,true);
    const file=join(objectReviews,reviewed.reviewHash+'.json');
    if(await exists(file))need(JSON.stringify(await privateJSON(file))===JSON.stringify(reviewed),
      'WORKSPACE_OBJECT_PREPARED_REVIEW_CHANGED');
    else await atomicJSON(file,reviewed);return reviewed;
  }

  async function bundleSelection(profile,input){
    const saved=await readRequest(profile.id,input.id);
    if(saved){
      need(objectBundleCommand(saved.review.command)&&JSON.stringify(saved.review.intent)===JSON.stringify(input),
        'WORKSPACE_REQUEST_SELECTION_CHANGED');
      localPathBindings(profile,saved.review);return clone(saved.review);
    }
    need(!readOnly&&!closing,'WORKSPACE_READ_ONLY');
    need(!active,'WORKSPACE_EXECUTION_ACTIVE');
    const selected=await bundleAdapter.review(profile,input);
    const reviewed=finishReview({profileId:profile.id,command:input.action,operationId:input.id,
      store:null,snapshotId:selected.recordSha256,
      source:input.action==='object-bundle-export'?selected.objectDeclaration.bundle:selected.archiveDeclaration.path,
      destination:input.action==='object-bundle-export'?null:selected.objectDeclaration.bundle,
      objectBundle:selected,options:{command:input.action,id:input.id,passEnv:profile.passEnv,objectBundle:selected}},input);
    localPathBindings(profile,reviewed);await privateDirectory(objectReviews,true);
    const file=join(objectReviews,reviewed.reviewHash+'.json');
    if(await exists(file))need(JSON.stringify(await privateJSON(file))===JSON.stringify(reviewed),
      'WORKSPACE_BUNDLE_PREPARED_REVIEW_CHANGED');
    else await atomicJSON(file,reviewed);return reviewed;
  }
  async function bundleInspection(profileId,archiveId){
    need(!readOnly&&!closing,'WORKSPACE_READ_ONLY');need(!active,'WORKSPACE_EXECUTION_ACTIVE');
    await currentHost();return bundleAdapter.inspection(selectedProfile(profileId),archiveId);
  }

  function selectedProfile(id) {
    need(!closed, 'WORKSPACE_CLOSED', 'The recovery workspace is closed', 409);
    const profile = host.profiles.find(item => item.id === id);
    need(profile, 'WORKSPACE_PROFILE_NOT_FOUND', 'Unknown host recovery profile', 404);
    return profile;
  }
  async function currentHost() {
    need(hash(await privateBytes(configFile)) === configHash, 'WORKSPACE_HOST_CONFIG_CHANGED',
      'Restart the workspace to load the changed host configuration', 409);
  }
  function requireRemoteStore(profile) {
    need(profile.storeConfig !== null, 'WORKSPACE_REMOTE_STORE_NOT_CONFIGURED',
      'This host profile is configured for local recovery. Select a profile with a remote store for transfers.', 409);
  }
  async function storeHint(profile) {
    if (profile.storeConfig === null) return null;
    const cfg = await privateJSON(profile.storeConfig);
    need(cfg.schema === 'stellar-forge.merchant-recovery-s3.v1', 'WORKSPACE_S3_CONFIG_INVALID');
    return { region: cfg.region, bucket: cfg.bucket, prefix: cfg.prefix ?? '',
      endpoint: cfg.endpoint ?? null, proxyEnvironment: cfg.proxyEnvironment === true };
  }
  async function bundleAt(profile, bundleId) {
    need(typeof bundleId === 'string', 'WORKSPACE_BUNDLE_REQUIRED');
    const slash = bundleId.indexOf('/');
    need(slash > 0, 'WORKSPACE_BUNDLE_INVALID');
    const root = profile.bundleRoots.find(item => item.id === bundleId.slice(0, slash));
    need(root, 'WORKSPACE_BUNDLE_ROOT_NOT_FOUND', 'Unknown host bundle root', 404);
    const name = segment(bundleId.slice(slash + 1));
    const path = join(root.directory, name);
    await privateDirectory(root.directory); await privateDirectory(path);
    const raw = await privateBytes(join(path, 'manifest.json'), MAX_MANIFEST);
    const manifest = JSON.parse(raw.toString('utf8'));
    need(object(manifest) && manifest.schema === BUNDLE_SCHEMA && Number.isSafeInteger(manifest.fileCount) &&
      manifest.fileCount >= 0 && Number.isSafeInteger(manifest.totalPlainBytes) &&
      manifest.totalPlainBytes >= 0 && Array.isArray(manifest.roots), 'WORKSPACE_ORIGINAL_BUNDLE_REQUIRED');
    return { bundleId, name, rootId: root.id, rootLabel: root.label, directory: path,
      snapshotId: hash(raw), createdAt: manifest.createdAt, files: manifest.fileCount,
      plainBytes: manifest.totalPlainBytes, roots: manifest.roots.map(item => item.name),
      verification: 'AUTHENTICATED_BY_ORIGINAL_ENGINE_WHEN_USED' };
  }
  async function localBundles(profileId) {
    const profile = selectedProfile(profileId); const bundles = [], errors = [];
    for (const root of profile.bundleRoots) {
      const entries = await readdir(root.directory, { withFileTypes: true });
      need(entries.length <= 10000, 'WORKSPACE_BUNDLE_ROOT_TOO_LARGE', 'Select a more specific host bundle root');
      for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith(RETIRED_CAPTURE_PREFIX)).sort((a, b) => a.name.localeCompare(b.name))) {
        const bundleId = root.id + '/' + entry.name;
        if (!await exists(join(root.directory, entry.name, 'manifest.json'))) continue;
        try { bundles.push(await bundleAt(profile, bundleId)); }
        catch (error) { errors.push({ bundleId, ...publicError(error) }); }
      }
    }
    return { bundles, errors };
  }
  async function operation(profileId, id) {
    const profile = selectedProfile(profileId); identifier(id, 'operation ID');
    return runRemote({ command: 'status', operations: profile.operations, id });
  }
  async function operations(profileId, { cursor, limit = 50 } = {}) {
    const profile = selectedProfile(profileId);
    if (!await exists(profile.operations)) return { operations: [], errors: [], nextCursor: null };
    await privateDirectory(profile.operations);
    const entries = await readdir(profile.operations, { withFileTypes: true });
    const page = cursorPage(entries.filter(item => item.isDirectory() && ID.test(item.name)).map(item => item.name), cursor, limit);
    const rows = [], errors = [];
    for (const id of page.names) {
      try { rows.push(await operation(profileId, id)); }
      catch (error) { errors.push({ operationId: id, ...publicError(error) }); }
    }
    return { operations: rows, errors, nextCursor: page.nextCursor };
  }
  async function inventory(profileId, { cursor, limit = 20 } = {}) {
    const profile = selectedProfile(profileId); await currentHost(); requireRemoteStore(profile);
    const store = await openS3Store(profile.storeConfig);
    try { return { ...(await runRemote({ command: 'list', limit, ...(cursor ? { cursor } : {}) }, { store })), observedAt: stamp() }; }
    finally { store.close(); }
  }
  function allowedBundle(profile, path) {
    return profile.bundleRoots.some(root => path !== root.directory && inside(root.directory, path)) ||
      path !== profile.downloadRoot && inside(profile.downloadRoot, path);
  }
  async function publisherRestoreSource(profile, restoreId) {
    identifier(restoreId, 'completed restore operation ID');
    const original = await operation(profile.id, restoreId);
    need(original.command === 'restore' && original.status === 'COMPLETE' &&
      HEX.test(original.snapshotId ?? ''), 'WORKSPACE_PUBLISHER_COMPLETE_RESTORE_REQUIRED',
      'Select a completed original cold restore of the typed dataset publisher');
    absolute(original.bundle, 'Original encrypted bundle');
    absolute(original.destination, 'Completed cold restore');
    need(allowedBundle(profile, original.bundle) && original.destination !== profile.restoreRoot &&
      inside(profile.restoreRoot, original.destination), 'WORKSPACE_PUBLISHER_RESTORE_OUTSIDE_HOST_ROOTS');
    need(!inside(original.bundle, original.destination) && !inside(original.destination, original.bundle),
      'WORKSPACE_PUBLISHER_RESTORE_OVERLAP');
    for (const path of [original.bundle, original.destination]) {
      for (const control of [directory, ...host.profiles.map(item => item.operations)])
        need(!inside(control, path) && !inside(path, control), 'WORKSPACE_OPERATION_PATH_OVERLAP');
      await privateDirectory(path);
    }
    need(hash(await privateBytes(join(original.bundle, 'manifest.json'), MAX_MANIFEST)) === original.snapshotId,
      'WORKSPACE_ORIGINAL_SNAPSHOT_CHANGED');
    return original;
  }
  function declaredPublisherRestore(profile, restoredId) {
    identifier(restoredId, 'host-declared restored-publisher ID');
    const selected = profile.publisherRestores.find(item => item.id === restoredId);
    need(selected, 'WORKSPACE_PUBLISHER_RESTORE_NOT_DECLARED',
      'Select an original restored publisher declared by this host profile', 404);
    return selected;
  }
  async function declaredPublisherSource(profile, restoredId) {
    const selected = declaredPublisherRestore(profile, restoredId);
    for (const path of [selected.bundleDirectory, selected.restoreDirectory]) {
      for (const control of [directory, ...host.profiles.map(item => item.operations)])
        need(!inside(control, path) && !inside(path, control), 'WORKSPACE_OPERATION_PATH_OVERLAP');
      await privateDirectory(path);
    }
    const raw = await privateBytes(join(selected.bundleDirectory, 'manifest.json'), MAX_MANIFEST);
    const manifest = JSON.parse(raw.toString('utf8'));
    need(object(manifest) && manifest.schema === BUNDLE_SCHEMA &&
      Number.isSafeInteger(manifest.fileCount) && manifest.fileCount >= 0 &&
      Number.isSafeInteger(manifest.totalPlainBytes) && manifest.totalPlainBytes >= 0,
      'WORKSPACE_ORIGINAL_BUNDLE_REQUIRED');
    return { publisherRestore: clone(selected), bundle: selected.bundleDirectory,
      destination: selected.restoreDirectory, snapshotId: hash(raw),
      files: manifest.fileCount, plainBytes: manifest.totalPlainBytes };
  }
  async function publisherRestoreBinding(profile, review) {
    const options = review.options;
    const original = options.sourcePublisherRestoreId !== undefined ?
      await declaredPublisherSource(profile, options.sourcePublisherRestoreId) :
      await publisherRestoreSource(profile, options.sourceRestoreId);
    need(original.snapshotId === options.snapshotId && original.bundle === options.bundle &&
      original.destination === options.out, 'WORKSPACE_PUBLISHER_RESTORE_SELECTION_CHANGED');
    if (original.publisherRestore) need(JSON.stringify(original.publisherRestore) === JSON.stringify(review.publisherRestore),
      'WORKSPACE_PUBLISHER_RESTORE_SELECTION_CHANGED');
    return original;
  }
  async function fleetRestoreSource(profile, restoreId) {
    identifier(restoreId, 'completed restore operation ID');
    const original = await operation(profile.id, restoreId);
    need(original.command === 'restore' && original.status === 'COMPLETE' &&
      HEX.test(original.snapshotId ?? ''), 'WORKSPACE_FLEET_COMPLETE_RESTORE_REQUIRED',
      'Select a completed original cold restore of the typed dataset fleet');
    absolute(original.bundle, 'Original encrypted bundle');
    absolute(original.destination, 'Completed cold restore');
    need(allowedBundle(profile, original.bundle) && original.destination !== profile.restoreRoot &&
      inside(profile.restoreRoot, original.destination), 'WORKSPACE_FLEET_RESTORE_OUTSIDE_HOST_ROOTS');
    need(!inside(original.bundle, original.destination) && !inside(original.destination, original.bundle),
      'WORKSPACE_FLEET_RESTORE_OVERLAP');
    for (const path of [original.bundle, original.destination]) {
      for (const control of [directory, ...host.profiles.map(item => item.operations)])
        need(!inside(control, path) && !inside(path, control), 'WORKSPACE_OPERATION_PATH_OVERLAP');
      await privateDirectory(path);
    }
    need(hash(await privateBytes(join(original.bundle, 'manifest.json'), MAX_MANIFEST)) === original.snapshotId,
      'WORKSPACE_ORIGINAL_SNAPSHOT_CHANGED');
    return original;
  }
  function declaredFleetRestore(profile, restoredId) {
    identifier(restoredId, 'host-declared restored-fleet ID');
    const selected = profile.fleetRestores.find(item => item.id === restoredId);
    need(selected, 'WORKSPACE_FLEET_RESTORE_NOT_DECLARED',
      'Select an original restored fleet declared by this host profile', 404);
    return selected;
  }
  async function declaredFleetSource(profile, restoredId) {
    const selected = declaredFleetRestore(profile, restoredId);
    for (const path of [selected.bundleDirectory, selected.restoreDirectory]) {
      for (const control of [directory, ...host.profiles.map(item => item.operations)])
        need(!inside(control, path) && !inside(path, control), 'WORKSPACE_OPERATION_PATH_OVERLAP');
      await privateDirectory(path);
    }
    const raw = await privateBytes(join(selected.bundleDirectory, 'manifest.json'), MAX_MANIFEST);
    const manifest = JSON.parse(raw.toString('utf8'));
    need(object(manifest) && manifest.schema === BUNDLE_SCHEMA &&
      Number.isSafeInteger(manifest.fileCount) && manifest.fileCount >= 0 &&
      Number.isSafeInteger(manifest.totalPlainBytes) && manifest.totalPlainBytes >= 0,
      'WORKSPACE_ORIGINAL_BUNDLE_REQUIRED');
    return { fleetRestore: clone(selected), bundle: selected.bundleDirectory,
      destination: selected.restoreDirectory, snapshotId: hash(raw),
      files: manifest.fileCount, plainBytes: manifest.totalPlainBytes };
  }
  function declaredFleetTarget(profile, targetId) {
    identifier(targetId, 'host-declared fleet-target ID');
    const target = profile.fleetTargets.find(item => item.id === targetId);
    need(target, 'WORKSPACE_FLEET_TARGET_NOT_DECLARED',
      'Select the original fleet target declaration and operation directory from this host profile', 404);
    return target;
  }
  async function fleetRestoreBinding(profile, review) {
    const options = review.options;
    const original = options.sourceFleetRestoreId !== undefined ?
      await declaredFleetSource(profile, options.sourceFleetRestoreId) : await fleetRestoreSource(profile, options.sourceRestoreId);
    const target = declaredFleetTarget(profile, options.fleetTargetId);
    need(original.snapshotId === options.snapshotId && original.bundle === options.bundle &&
      original.destination === options.out && target.targetFile === options.targetFile &&
      target.operationDirectory === options.operationDirectory &&
      JSON.stringify(target) === JSON.stringify(review.fleetTarget), 'WORKSPACE_FLEET_RESTORE_SELECTION_CHANGED');
    if (original.fleetRestore) need(JSON.stringify(original.fleetRestore) === JSON.stringify(review.fleetRestore),
      'WORKSPACE_FLEET_RESTORE_SELECTION_CHANGED');
    return original;
  }
  function captureIdentity(profileId, id) {
    return hash(STATE_SCHEMA + '\n' + workspaceState.id + '\n' + directory + '\n' + profileId + '\n' + id);
  }
  function localPathBindings(profile, review) {
    const options = review.options;
    need(options.id === review.operationId && options.passEnv === profile.passEnv &&
      options.command === review.command, 'WORKSPACE_PROFILE_SELECTION_CHANGED');
    if(comparisonCommand(review.command)){
      need(JSON.stringify(options.objectComparison)===JSON.stringify(review.objectComparison),
        'WORKSPACE_COMPARISON_REVIEW_CHANGED');
      comparisonAdapter.binding(profile,review.objectComparison);return;
    }
    if(objectBundleCommand(review.command)){
      need(JSON.stringify(options.objectBundle)===JSON.stringify(review.objectBundle),'WORKSPACE_BUNDLE_REVIEW_CHANGED');
      bundleAdapter.binding(profile,review.objectBundle);return;
    }
    if (objectCommand(review.command)) {
      const declaration=declaredObject(profile,options.objectSessionId);
      need(JSON.stringify(declaration)===JSON.stringify(review.objectDeclaration)&&
        JSON.stringify(options.objectRecovery)===JSON.stringify(review.objectRecovery)&&
        review.objectRecovery.command===review.command&&review.objectRecovery.objectSessionId===declaration.id,
        'WORKSPACE_OBJECT_DECLARATION_CHANGED','Restore the exact original Object declaration before continuation',409);
      return;
    } else if (review.command === 'snapshot') {
      const plan = profile.capturePlans.find(item => item.id === review.capturePlan?.id);
      const root = profile.bundleRoots.find(item => item.id === plan?.bundleRootId);
      need(plan && root && JSON.stringify(plan) === JSON.stringify(review.capturePlan) &&
        options.plan === plan.planFile && dirname(options.out) === root.directory &&
        options.captureId === captureIdentity(profile.id, review.operationId) &&
        HEX.test(options.expectedPlanSha256 ?? ''), 'WORKSPACE_CAPTURE_SELECTION_CHANGED');
    } else if (review.command === 'fleet-prepare') {
      need((options.sourceRestoreId !== undefined) !== (options.sourceFleetRestoreId !== undefined),
        'WORKSPACE_FLEET_RESTORE_SELECTION_INVALID');
      if (options.sourceFleetRestoreId !== undefined) {
        const selected = declaredFleetRestore(profile, options.sourceFleetRestoreId);
        need(review.sourceType === 'host-fleet-restore' &&
          JSON.stringify(selected) === JSON.stringify(review.fleetRestore) &&
          selected.bundleDirectory === options.bundle && selected.restoreDirectory === options.out,
          'WORKSPACE_FLEET_RESTORE_SELECTION_CHANGED');
      } else {
        identifier(options.sourceRestoreId, 'completed restore operation ID');
        need(review.sourceType === 'remote-restore' && review.fleetRestore === undefined,
          'WORKSPACE_FLEET_RESTORE_SELECTION_CHANGED');
      }
      const target = declaredFleetTarget(profile, options.fleetTargetId), native = review.restoredFleet?.review;
      need(JSON.stringify(target) === JSON.stringify(review.fleetTarget) &&
        target.targetFile === options.targetFile && target.operationDirectory === options.operationDirectory &&
        allowedBundle(profile, options.bundle) && options.out !== profile.restoreRoot && inside(profile.restoreRoot, options.out) &&
        HEX.test(options.snapshotId ?? '') && options.snapshotId === review.snapshotId &&
        HEX.test(options.expectedReviewSha256 ?? '') && HEX.test(options.fleetOperationId ?? '') &&
        options.expectedReviewSha256 === review.restoredFleet?.reviewSha256 &&
        options.fleetOperationId === review.restoredFleet?.operationId && options.quiesced === true &&
        native?.snapshotId === options.snapshotId && native.bundleDirectory === options.bundle &&
        native.restoreDirectory === options.out && native.targetFile === options.targetFile &&
        native.operationDirectory === options.operationDirectory, 'WORKSPACE_FLEET_RESTORE_SELECTION_CHANGED');
      for (const path of [options.operationDirectory, native.deploymentBundle, ...native.roots.map(root => root.destination)]) {
        absolute(path, 'Original fleet receiving path');
        for (const control of [directory, ...host.profiles.map(item => item.operations)])
          need(!inside(control, path) && !inside(path, control), 'WORKSPACE_OPERATION_PATH_OVERLAP');
      }
    } else if (review.command === 'publisher-prepare') {
      need((options.sourceRestoreId !== undefined) !== (options.sourcePublisherRestoreId !== undefined),
        'WORKSPACE_PUBLISHER_RESTORE_SELECTION_INVALID');
      if (options.sourcePublisherRestoreId !== undefined) {
        const selected = declaredPublisherRestore(profile, options.sourcePublisherRestoreId);
        need(review.sourceType === 'host-publisher-restore' &&
          JSON.stringify(selected) === JSON.stringify(review.publisherRestore) &&
          selected.bundleDirectory === options.bundle && selected.restoreDirectory === options.out,
          'WORKSPACE_PUBLISHER_RESTORE_SELECTION_CHANGED');
      } else {
        identifier(options.sourceRestoreId, 'completed restore operation ID');
        need(review.publisherRestore === undefined, 'WORKSPACE_PUBLISHER_RESTORE_SELECTION_CHANGED');
      }
      need(allowedBundle(profile, options.bundle) && options.out !== profile.restoreRoot &&
        inside(profile.restoreRoot, options.out) &&
        HEX.test(options.snapshotId ?? '') && options.snapshotId === review.snapshotId &&
        HEX.test(options.expectedReviewSha256 ?? '') && HEX.test(options.publisherOperationId ?? '') &&
        options.expectedReviewSha256 === review.restoredPublisher?.reviewSha256 &&
        options.publisherOperationId === review.restoredPublisher?.operationId &&
        options.bundle === review.restoredPublisher?.bundleDirectory &&
        options.out === review.restoredPublisher?.restoreDirectory,
        'WORKSPACE_PUBLISHER_RESTORE_SELECTION_CHANGED');
    } else {
      need(review.command === 'local-verify' && allowedBundle(profile, options.bundle) &&
        HEX.test(options.snapshotId ?? '') && options.snapshotId === review.snapshotId,
        'WORKSPACE_LOCAL_VERIFICATION_SELECTION_CHANGED');
    }
    for (const path of [options.bundle, options.out].filter(Boolean))
      for (const control of [directory, ...host.profiles.map(item => item.operations)])
        need(!inside(control, path) && !inside(path, control), 'WORKSPACE_OPERATION_PATH_OVERLAP');
  }
  function finishReview(review, input) {
    const selected = { profileId: review.profileId, command: review.command, operationId: review.operationId,
      store: review.store, snapshotId: review.snapshotId, options: review.options };
    return { ...review, reviewHash: hash(JSON.stringify(selected)), intent: clone(input) };
  }
  async function localSelection(profile, input) {
    const saved = await readRequest(profile.id, input.id);
    if (!saved) need(!await exists(join(profile.operations, input.id, 'operation.json')),
      'WORKSPACE_OPERATION_ID_USED', 'Select a new local operation ID; this ID already belongs to an original transfer');
    let review;
    if(comparisonCommand(input.action))return comparisonSelection(profile,input);
    if(objectCommand(input.action))return objectSelection(profile,input);
    if(objectBundleCommand(input.action))return bundleSelection(profile,input);
    if (input.action === 'snapshot') {
      need(input.bundleId === undefined && input.snapshotId === undefined && input.restoreId === undefined &&
        input.publisherRestoreId === undefined && input.quiesced === true,
        'WORKSPACE_CAPTURE_QUIESCENCE_REQUIRED',
        'Confirm that every declared source producer is quiesced before reviewing its capture');
      const capturePlan = profile.capturePlans.find(item => item.id === input.capturePlanId);
      need(capturePlan, 'WORKSPACE_CAPTURE_PLAN_NOT_FOUND', 'Select a host-declared original snapshot plan', 404);
      const root = profile.bundleRoots.find(item => item.id === capturePlan.bundleRootId);
      const name = input.destinationName === undefined || input.destinationName === '' ? input.id :
        identifier(input.destinationName, 'bundle destination name');
      need(!name.startsWith(RETIRED_CAPTURE_PREFIX), 'WORKSPACE_CAPTURE_DESTINATION_INVALID');
      await privateDirectory(root.directory);
      await privateBytes(capturePlan.planFile, 256 * 1024);
      const out = join(root.directory, name), captureId = captureIdentity(profile.id, input.id);
      if (await exists(out)) need(saved?.review.command === 'snapshot' &&
        saved.review.options.out === out && saved.review.options.plan === capturePlan.planFile &&
        saved.review.options.captureId === captureId, 'WORKSPACE_CAPTURE_DESTINATION_EXISTS',
        'Select a new bundle destination; retain this existing directory with its original capture', 409);
      const plan = await inspectLocalCapture({ plan: capturePlan.planFile, out,
        forbiddenRoots: [directory, ...host.profiles.map(item => item.operations)] });
      review = { profileId: profile.id, command: 'snapshot', operationId: input.id,
        store: null, snapshotId: null, source: capturePlan.planFile, destination: out,
        originalStatus: saved?.result?.status ?? null, files: plan.files, plainBytes: plan.bytes,
        capturePlan: clone(capturePlan), plan,
        options: { command: 'snapshot', id: input.id, plan: capturePlan.planFile, out,
          passEnv: profile.passEnv, captureId, expectedPlanSha256: plan.planSha256,
          captureKind: plan.captureKind } };
    } else if (input.action === 'fleet-prepare') {
      need(input.capturePlanId === undefined && input.publisherRestoreId === undefined &&
        input.snapshotId === undefined && input.destinationName === undefined && input.bundleId === undefined,
        'WORKSPACE_FLEET_RESTORE_SELECTION_INVALID');
      need(input.quiesced === true, 'WORKSPACE_FLEET_QUIESCENCE_REQUIRED',
        'Keep the receiving fleet and original selected writers stopped through their native preparation');
      need((input.restoreId !== undefined) !== (input.fleetRestoreId !== undefined),
        'WORKSPACE_FLEET_RESTORE_SELECTION_INVALID',
        'Select either the original completed remote restore or one host-declared restored fleet');
      const original = input.fleetRestoreId !== undefined ?
        await declaredFleetSource(profile, input.fleetRestoreId) : await fleetRestoreSource(profile, input.restoreId);
      const fleetTarget = declaredFleetTarget(profile, input.fleetTargetId);
      const selected = { command: 'fleet-prepare', id: input.id,
        ...(input.fleetRestoreId !== undefined ? { sourceFleetRestoreId: input.fleetRestoreId } : { sourceRestoreId: input.restoreId }),
        fleetTargetId: input.fleetTargetId, bundle: original.bundle, out: original.destination,
        passEnv: profile.passEnv, snapshotId: original.snapshotId, quiesced: true,
        targetFile: fleetTarget.targetFile, operationDirectory: fleetTarget.operationDirectory };
      const restoredFleet = await inspectLocalFleetRestore(selected);
      review = { profileId: profile.id, command: 'fleet-prepare', operationId: input.id,
        ...(original.fleetRestore ? { sourceType: 'host-fleet-restore', fleetRestore: original.fleetRestore } : { sourceType: 'remote-restore' }),
        fleetTarget: clone(fleetTarget), store: null, snapshotId: original.snapshotId,
        source: original.bundle, destination: original.destination,
        originalStatus: restoredFleet.status === 'FLEET_RECEIVING_COMPLETE' ? 'COMPLETE' : restoredFleet.status,
        files: original.files ?? null, plainBytes: original.plainBytes ?? null, restoredFleet,
        options: { ...selected, expectedReviewSha256: restoredFleet.reviewSha256, fleetOperationId: restoredFleet.operationId } };
    } else if (input.action === 'publisher-prepare') {
      need(input.capturePlanId === undefined && input.quiesced === undefined &&
        input.snapshotId === undefined && input.destinationName === undefined && input.bundleId === undefined,
        'WORKSPACE_PUBLISHER_RESTORE_SELECTION_INVALID');
      need((input.restoreId !== undefined) !== (input.publisherRestoreId !== undefined),
        'WORKSPACE_PUBLISHER_RESTORE_SELECTION_INVALID',
        'Select either a completed remote restore or one host-declared restored publisher');
      const original = input.publisherRestoreId !== undefined ?
        await declaredPublisherSource(profile, input.publisherRestoreId) :
        await publisherRestoreSource(profile, input.restoreId);
      const selected = { command: 'publisher-prepare', id: input.id,
        ...(input.publisherRestoreId !== undefined ? { sourcePublisherRestoreId: input.publisherRestoreId } :
          { sourceRestoreId: input.restoreId }),
        bundle: original.bundle, out: original.destination, passEnv: profile.passEnv,
        snapshotId: original.snapshotId };
      const restoredPublisher = await inspectLocalPublisherRestore(selected);
      review = { profileId: profile.id, command: 'publisher-prepare', operationId: input.id,
        ...(original.publisherRestore ? { sourceType: 'host-publisher-restore', publisherRestore: original.publisherRestore } :
          { sourceType: 'remote-restore' }),
        store: null, snapshotId: original.snapshotId, source: original.bundle, destination: original.destination,
        originalStatus: restoredPublisher.status === 'RESTORED_PUBLISHER_PREPARED' ? 'COMPLETE' : restoredPublisher.status,
        files: original.files ?? null, plainBytes: original.plainBytes ?? null, restoredPublisher,
        options: { ...selected, expectedReviewSha256: restoredPublisher.reviewSha256,
          publisherOperationId: restoredPublisher.operationId } };
    } else {
      need(input.capturePlanId === undefined && input.quiesced === undefined && input.restoreId === undefined &&
        input.publisherRestoreId === undefined && input.snapshotId === undefined && input.destinationName === undefined,
        'WORKSPACE_LOCAL_VERIFICATION_SELECTION_INVALID');
      const bundle = await bundleAt(profile, input.bundleId);
      review = { profileId: profile.id, command: 'local-verify', operationId: input.id,
        store: null, snapshotId: bundle.snapshotId, source: bundle.directory, destination: null,
        originalStatus: saved?.result?.status ?? null, files: bundle.files, plainBytes: bundle.plainBytes,
        options: { command: 'local-verify', id: input.id, bundle: bundle.directory,
          passEnv: profile.passEnv, snapshotId: bundle.snapshotId } };
    }
    localPathBindings(profile, review);
    return finishReview(review, input);
  }
  async function selection(input) {
    exact(input, ['profileId', 'action', 'id', 'bundleId', 'snapshotId', 'destinationName',
      'capturePlanId', 'quiesced', 'restoreId', 'publisherRestoreId', 'fleetRestoreId', 'fleetTargetId',
      'objectSessionId','expectedRecordSha256','archiveId','sourceRequestId','sourceReviewHash','sourceAttempt','sourceSide',
      'beforeObjectSessionId','afterObjectSessionId','beforeExpectedRecordSha256','afterExpectedRecordSha256'], 'recovery selection');
    if(!comparisonCommand(input.action))need(['beforeObjectSessionId','afterObjectSessionId','beforeExpectedRecordSha256','afterExpectedRecordSha256'].every(key=>input[key]===undefined),'WORKSPACE_COMPARISON_SELECTION_NOT_APPLICABLE');
    if(!objectBundleCommand(input.action))need(['archiveId','sourceRequestId','sourceReviewHash','sourceAttempt','sourceSide'].every(key=>input[key]===undefined),
      'WORKSPACE_BUNDLE_SELECTION_NOT_APPLICABLE');
    if(!objectCommand(input.action)&&!objectBundleCommand(input.action))need(input.objectSessionId===undefined&&input.expectedRecordSha256===undefined,
      'WORKSPACE_OBJECT_SELECTION_NOT_APPLICABLE');
    if (input.action !== 'fleet-prepare') need(input.fleetRestoreId === undefined && input.fleetTargetId === undefined,
      'WORKSPACE_FLEET_SELECTION_NOT_APPLICABLE', 'Fleet selectors belong to the fleet preparation action');
    const profile = selectedProfile(input.profileId);
    identifier(input.id, 'original operation ID');
    need(comparisonCommand(input.action)||objectCommand(input.action)||objectBundleCommand(input.action)||['snapshot', 'verify', 'publisher-prepare', 'fleet-prepare', 'push', 'pull', 'restore', 'resume'].includes(input.action),
      'WORKSPACE_ACTION_INVALID');
    await currentHost();
    if (comparisonCommand(input.action)||objectCommand(input.action)||objectBundleCommand(input.action)||['snapshot', 'verify', 'publisher-prepare', 'fleet-prepare'].includes(input.action)) return localSelection(profile, input);
    requireRemoteStore(profile);
    need(input.capturePlanId === undefined && input.quiesced === undefined && input.restoreId === undefined &&
      input.publisherRestoreId === undefined,
      'WORKSPACE_TRANSFER_SELECTION_INVALID');
    let options = { command: input.action, config: profile.storeConfig, operations: profile.operations,
      id: input.id, passEnv: profile.passEnv };
    let local = null, original = null;
    if (input.action === 'resume') {
      need(input.bundleId === undefined && input.snapshotId === undefined && input.destinationName === undefined,
        'WORKSPACE_RESUME_SELECTION_CHANGED', 'An original operation resumes its retained selection');
      original = await operation(profile.id, input.id);
      options.command = original.command;
      if (original.command === 'push') options.bundle = original.bundle;
      else {
        options.snapshot = original.snapshotId;
        options.out = original.command === 'restore' ? original.destination : original.bundle;
        if (original.command === 'restore') options.bundleOut = original.bundle;
      }
    } else if (input.action === 'push') {
      need(input.snapshotId === undefined && input.destinationName === undefined, 'WORKSPACE_PUSH_SELECTION_INVALID');
      local = await bundleAt(profile, input.bundleId); options.bundle = local.directory;
    } else {
      need(HEX.test(input.snapshotId ?? ''), 'WORKSPACE_SNAPSHOT_ID_REQUIRED', 'Select an exact remote snapshot');
      options.snapshot = input.snapshotId;
      const name = input.destinationName === undefined || input.destinationName === '' ? input.id :
        identifier(input.destinationName, 'destination name');
      if (input.action === 'pull') {
        need(input.bundleId === undefined, 'WORKSPACE_PULL_SELECTION_INVALID');
        options.out = join(profile.downloadRoot, name);
      } else {
        options.out = join(profile.restoreRoot, name);
        if (input.bundleId !== undefined && input.bundleId !== '') {
          local = await bundleAt(profile, input.bundleId);
          need(local.snapshotId === input.snapshotId, 'WORKSPACE_BUNDLE_SNAPSHOT_MISMATCH');
          options.bundleOut = local.directory;
        } else options.bundleOut = join(profile.downloadRoot, 'restore-' + input.id);
      }
    }
    need(['push', 'pull', 'restore'].includes(options.command), 'WORKSPACE_ORIGINAL_COMMAND_INVALID');
    if (options.bundle) need(allowedBundle(profile, options.bundle), 'WORKSPACE_BUNDLE_OUTSIDE_HOST_ROOTS');
    if (options.bundleOut) need(allowedBundle(profile, options.bundleOut), 'WORKSPACE_BUNDLE_OUTSIDE_HOST_ROOTS');
    if (options.out) {
      const root = options.command === 'restore' ? profile.restoreRoot : profile.downloadRoot;
      need(options.out !== root && inside(root, options.out), 'WORKSPACE_DESTINATION_OUTSIDE_HOST_ROOT');
    }
    for (const path of [options.bundle, options.bundleOut, options.out].filter(Boolean))
      need(!inside(profile.operations, path) && !inside(path, profile.operations) &&
        !inside(directory, path) && !inside(path, directory), 'WORKSPACE_OPERATION_PATH_OVERLAP');
    if (options.bundleOut) need(!inside(options.bundleOut, options.out) && !inside(options.out, options.bundleOut),
      'WORKSPACE_RESTORE_PATH_OVERLAP');
    const store = await openS3Store(profile.storeConfig);
    let identity;
    try { identity = clone(store.identity); } finally { store.close(); }
    if (original) need(JSON.stringify(original.store) === JSON.stringify(identity), 'WORKSPACE_ORIGINAL_STORE_CHANGED',
      'Select the original store for this retained operation', 409);
    const snapshotId = local?.snapshotId ?? options.snapshot ?? (original?.status === 'COMPLETE' ? original.snapshotId : null) ?? (options.bundle ?
      hash(await privateBytes(join(options.bundle, 'manifest.json'), MAX_MANIFEST)) : original?.snapshotId ?? null);
    if (original?.snapshotId) need(original.snapshotId === snapshotId, 'WORKSPACE_ORIGINAL_SNAPSHOT_CHANGED');
    const review = { profileId: profile.id, command: options.command, operationId: options.id,
      store: identity, snapshotId, source: options.bundle ?? options.bundleOut ?? null,
      destination: options.out ?? null, originalStatus: original?.status ?? null,
      files: local?.files ?? original?.files ?? null, plainBytes: local?.plainBytes ?? original?.plainBytes ?? null,
      options };
    return finishReview(review, input);
  }
  const requestPath = (profileId, id) => join(requestRoot, hash(profileId + '\n' + id) + '.json');
  async function readRequest(profileId, id) {
    const path = requestPath(profileId, id);
    if (!await exists(path)) return null;
    const request = await privateJSON(path);
    need(request.schema === REQUEST_SCHEMA && request.review.profileId === profileId &&
      request.review.operationId === id, 'WORKSPACE_REQUEST_IDENTITY_INVALID');
    return request;
  }
  async function requestView(request) {
    let original = null, error = null;
    if (localCommand(request.review.command)) original = request.result ?? null;
    else {
      try { original = await operation(request.review.profileId, request.review.operationId); }
      catch (caught) { if (caught.code !== 'ENOENT') error = publicError(caught); }
    }
    const running = active?.key === requestPath(request.review.profileId, request.review.operationId);
    const local = request.local ? clone(request.local) : null;
    for (const key of ['paidJobsPlan', 'datasetPublisherPlan', 'merchantFleetPlan']) if (local?.[key]) {
      const { schema, planSha256, bytes } = local[key];
      local[key] = { schema, planSha256, bytes };
    }
    return { profileId: request.review.profileId, operationId: request.review.operationId,
      review: clone(request.review), createdAt: request.createdAt, updatedAt: request.updatedAt,
      phase: original?.status === 'COMPLETE' ? 'COMPLETE' : running ? 'RUNNING' :
        request.phase === 'RUNNING' ? 'INTERRUPTED' : request.phase,
      running, cancelRequested: running && active.cancelRequested, attempts: request.attempts,
      operation: original, ...(local ? { local } : {}),
      error: error ?? request.error ?? null };
  }
  async function request(profileId, id) {
    selectedProfile(profileId); identifier(id, 'operation ID');
    const retained = await readRequest(profileId, id);
    need(retained, 'WORKSPACE_REQUEST_NOT_FOUND', 'No workspace request exists for this profile and operation ID', 404);
    return requestView(retained);
  }
  async function requests({ cursor, limit = 50 } = {}) {
    if (!await exists(requestRoot)) return { requests: [], nextCursor: null };
    const entries = (await readdir(requestRoot)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const page = cursorPage(entries, cursor, limit);
    const rows = [];
    for (const name of page.names) rows.push(await requestView(await privateJSON(join(requestRoot, name))));
    return { requests: rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), nextCursor: page.nextCursor };
  }
  async function execute(request, job) {
    let store;
    try {
      const local = localCommand(request.review.command);
      let retained = local ? request.result ?? null : null;
      if (!local) {
        try { retained = await operation(request.review.profileId, request.review.operationId); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (retained?.status === 'COMPLETE') {
        request.phase = 'COMPLETE'; request.result = retained; request.updatedAt = stamp(); delete request.error;
        await atomicJSON(job.key, request); return;
      }
      request.phase = 'RUNNING'; request.attempts++; request.updatedAt = stamp(); delete request.error;
      await atomicJSON(job.key, request);
      await currentHost();
      const profile = selectedProfile(request.review.profileId);
      let result;
      if (local) {
        localPathBindings(profile, request.review);
        if (request.review.command === 'publisher-prepare') await publisherRestoreBinding(profile, request.review);
        if (request.review.command === 'fleet-prepare') await fleetRestoreBinding(profile, request.review);
        request.local ??= {};
        const localOptions = { options: request.review.options, state: request.local,
          save: async () => { request.updatedAt = stamp(); await atomicJSON(job.key, request); },
          cancelled: () => job.cancelRequested };
        result = comparisonCommand(request.review.command)?await comparisonAdapter.run({
          profile,id:request.review.operationId,review:request.review.objectComparison,state:request.local,
          save:async local=>{request.local=local;await localOptions.save();},signal:job.controller.signal,cancelled:localOptions.cancelled}):objectBundleCommand(request.review.command)?await bundleAdapter.run({profile,id:request.review.operationId,
          review:request.review.objectBundle,state:request.local,save:localOptions.save,signal:job.controller.signal,
          cancelled:localOptions.cancelled}):objectCommand(request.review.command) ? await objectAdapter.run({
          declaration:declaredObject(profile,request.review.options.objectSessionId),review:request.review.objectRecovery,
          state:request.local,save:localOptions.save,cancelled:localOptions.cancelled,signal:job.controller.signal,passEnv:profile.passEnv}) :
          request.review.command === 'snapshot' ?
          await runLocalCapture({ ...localOptions, allowCapture: job.allowCapture === true }) :
          request.review.command === 'publisher-prepare' ? await runLocalPublisherPreparation(localOptions) :
          request.review.command === 'fleet-prepare' ? await runLocalFleetPreparation(localOptions) :
          await runLocalVerification(localOptions);
      } else {
        if (request.review.command === 'push') need(
          hash(await privateBytes(join(request.review.options.bundle, 'manifest.json'), MAX_MANIFEST)) === request.review.snapshotId,
          'WORKSPACE_ORIGINAL_SNAPSHOT_CHANGED', 'The local bundle changed after this operation was reviewed', 409);
        store = await openS3Store(profile.storeConfig); job.store = store;
        need(JSON.stringify(store.identity) === JSON.stringify(request.review.store), 'WORKSPACE_REVIEW_STORE_CHANGED',
          'The selected store changed after review', 409);
        if (job.cancelRequested) { store.close(); need(false, 'WORKSPACE_CANCELLED', 'Recovery execution was cancelled'); }
        result = await runRemote(request.review.options, { store });
      }
      request.phase = result.status === 'COMPLETE' ? 'COMPLETE' : 'INTERRUPTED';
      request.result = result; request.updatedAt = stamp(); delete request.error;
      await atomicJSON(job.key, request);
    } catch (error) {
      if(comparisonCommand(request.review.command)&&error.objectComparisonResult)
        request.result=clone(error.objectComparisonResult);
      if(objectCommand(request.review.command)&&error.objectRecoveryResult)
        request.result=clone(error.objectRecoveryResult);
      request.phase = job.cancelRequested ? 'INTERRUPTED' : 'FAILED';
      request.error = publicError(error); request.updatedAt = stamp();
      await atomicJSON(job.key, request).catch(() => {});
    } finally {
      store?.close();
      if (active === job) active = null;
    }
  }
  async function start({ selection: input, expectedReviewHash } = {}) {
    need(!readOnly && !closing, 'WORKSPACE_READ_ONLY', 'This workspace is closing or was opened for reading', 409);
    need(HEX.test(expectedReviewHash ?? ''), 'WORKSPACE_REVIEW_REQUIRED', 'Review the exact selection before starting');
    const reviewed = (objectCommand(input?.action)||objectBundleCommand(input?.action)||comparisonCommand(input?.action)) ? await preparedObject(input,expectedReviewHash) : await selection(input);
    need(!closing, 'WORKSPACE_CLOSING', 'The workspace is closing', 409);
    need(reviewed.reviewHash === expectedReviewHash, 'WORKSPACE_REVIEW_CHANGED',
      'The selection changed. Review it again before starting.', 409);
    const key = requestPath(reviewed.profileId, reviewed.operationId);
    let request = await readRequest(reviewed.profileId, reviewed.operationId);
    const retainedRequest = Boolean(request);
    if (active) need(active.key === key, 'WORKSPACE_EXECUTION_ACTIVE', 'Finish or cancel the active recovery execution first', 409);
    if (request) {
      need(request.review.snapshotId === reviewed.snapshotId &&
        JSON.stringify(request.review.options) === JSON.stringify(reviewed.options) &&
        JSON.stringify(request.review.store) === JSON.stringify(reviewed.store),
        'WORKSPACE_REQUEST_SELECTION_CHANGED', 'Keep the original operation ID with its original selection', 409);
    } else {
      request = { schema: REQUEST_SCHEMA, review: reviewed, phase: 'PREPARED', attempts: 0,
        createdAt: stamp(), updatedAt: stamp() };
      await atomicJSON(key, request);
    }
    if ((objectCommand(reviewed.command)||objectBundleCommand(reviewed.command)||comparisonCommand(reviewed.command))&&retainedRequest) return requestView(request);
    if (active) {
      need(active.key === key, 'WORKSPACE_EXECUTION_ACTIVE', 'Finish or cancel the active recovery execution first', 409);
      return requestView(request);
    }
    const job = { key, profileId: reviewed.profileId, operationId: reviewed.operationId,
      store: null, controller:new AbortController(), cancelRequested: false, allowCapture: reviewed.command === 'snapshot', promise: null };
    active = job; job.promise = execute(request, job);
    return requestView(request);
  }
  async function resume(profileId, id, continuation = {}) {
    need(!readOnly && !closing, 'WORKSPACE_READ_ONLY'); selectedProfile(profileId); identifier(id, 'operation ID');
    const request = await readRequest(profileId, id);
    need(request, 'WORKSPACE_REQUEST_NOT_FOUND', 'Review this original operation before adopting it into the workspace', 404);
    if(objectCommand(request.review.command)||objectBundleCommand(request.review.command)||comparisonCommand(request.review.command)) {
      exact(continuation,['expectedReviewHash','afterAttempt','quiesced'],'Object continuation');
      need(continuation.expectedReviewHash===request.review.reviewHash&&Number.isSafeInteger(continuation.afterAttempt)&&
        continuation.afterAttempt>=0&&continuation.afterAttempt<=request.attempts,
        'WORKSPACE_OBJECT_CONTINUATION_SELECTION_CHANGED','Read and explicitly select this original saved attempt',409);
      if(continuation.afterAttempt<request.attempts||request.result?.status==='COMPLETE')return requestView(request);
      if(request.review.command==='object-snapshot')need(continuation.quiesced===true,
        'WORKSPACE_OBJECT_QUIESCENCE_REQUIRED','Confirm current original writer shutdown before continuing this backup',409);
      else need(continuation.quiesced===undefined,'WORKSPACE_OBJECT_QUIESCENCE_NOT_APPLICABLE');
    } else need(Object.keys(continuation).length===0,'WORKSPACE_OBJECT_CONTINUATION_NOT_APPLICABLE');
    if (active) {
      need(active.key === requestPath(profileId, id), 'WORKSPACE_EXECUTION_ACTIVE',
        'Finish or cancel the active recovery execution first', 409);
      return requestView(request);
    }
    await currentHost();
    const profile = selectedProfile(profileId);
    if (localCommand(request.review.command)) {
      localPathBindings(profile, request.review);
      if (request.result?.status === 'COMPLETE') return requestView(request);
      if (request.review.command === 'publisher-prepare') await publisherRestoreBinding(profile, request.review);
      if (request.review.command === 'fleet-prepare') await fleetRestoreBinding(profile, request.review);
      if (request.review.command === 'snapshot') need(!request.local?.pendingRetirement &&
        await readCapturedBundle(request.review.options), 'WORKSPACE_CAPTURE_REVIEW_REQUIRED',
        'Review the same capture and confirm that its original source producers are quiesced', 409);
    } else {
      for (const path of [request.review.options.bundle, request.review.options.bundleOut].filter(Boolean))
        need(allowedBundle(profile, path), 'WORKSPACE_BUNDLE_OUTSIDE_HOST_ROOTS');
      const root = request.review.command === 'restore' ? profile.restoreRoot : profile.downloadRoot;
      if (request.review.options.out) need(request.review.options.out !== root &&
        inside(root, request.review.options.out), 'WORKSPACE_DESTINATION_OUTSIDE_HOST_ROOT');
      need(request.review.options.operations === profile.operations && request.review.options.config === profile.storeConfig &&
        request.review.options.passEnv === profile.passEnv, 'WORKSPACE_PROFILE_SELECTION_CHANGED');
    }
    const job = { key: requestPath(profileId, id), profileId, operationId: id,
      store: null, controller:new AbortController(), cancelRequested: false, allowCapture: false, promise: null };
    active = job; job.promise = execute(request, job);
    return requestView(request);
  }
  async function cancel(profileId, id) {
    selectedProfile(profileId); identifier(id, 'operation ID');
    need(!readOnly, 'WORKSPACE_READ_ONLY');
    const request = await readRequest(profileId, id);
    need(request, 'WORKSPACE_REQUEST_NOT_FOUND', 'Unknown workspace recovery request', 404);
    if (active?.key === requestPath(profileId, id)) {
      active.cancelRequested = true; active.controller.abort(); active.store?.close();
    }
    return requestView(request);
  }
  async function state() {
    const profiles = [];
    for (const profile of host.profiles) profiles.push({ id: profile.id, label: profile.label,
      store: await storeHint(profile), remoteConfigured: profile.storeConfig !== null, operations: profile.operations,
      bundleRoots: clone(profile.bundleRoots), capturePlans: clone(profile.capturePlans),
      publisherRestores: clone(profile.publisherRestores), fleetRestores: clone(profile.fleetRestores),
      fleetTargets: clone(profile.fleetTargets), objectSessions:clone(profile.objectSessions),
      objectBundleArchives:clone(profile.objectBundleArchives),
      supportConfigured:!!profile.casesDirectory,caseSourceConfigured:!!profile.caseSourceDirectory,
      downloadRoot: profile.downloadRoot, restoreRoot: profile.restoreRoot,
      passEnv: profile.passEnv, passphraseAvailable: typeof process.env[profile.passEnv] === 'string' && process.env[profile.passEnv].length > 0 });
    const page = await requests();
    if (active && !page.requests.some(row => row.profileId === active.profileId && row.operationId === active.operationId)) {
      const request = await readRequest(active.profileId, active.operationId);
      if (request) page.requests.unshift(await requestView(request));
    }
    return { schema: STATE_SCHEMA, id: workspaceState.id, title: host.title, createdAt: workspaceState.createdAt,
      directory, readOnly, profiles, active: active ? { profileId: active.profileId,
        operationId: active.operationId, cancelRequested: active.cancelRequested } : null,
      requests: page.requests, nextRequestsCursor: page.nextCursor };
  }
  async function close({ cancelActive = false } = {}) {
    if (closed) return;
    closing = true;
    let supportError;
    const supportClosed=support.close().catch(error=>{supportError=error;});
    await mutations;
    await supportClosed;
    if (cancelActive && active) { active.cancelRequested = true; active.controller.abort(); active.store?.close(); }
    await active?.promise;
    try { await Promise.all([objectAdapter.close(),comparisonAdapter.close()]); if(supportError)throw supportError; } finally { closed = true; await lease?.release(); }
  }
  async function identity() {
    need(!closed, 'WORKSPACE_CLOSED', 'The recovery workspace is closed', 409);
    await currentHost();
    return { schema: 'stellar-forge.recovery-workspace-identity.v1', workspaceId: workspaceState.id,
      directory, configFile, configurationSha256: configHash };
  }
  return { state, identity, localBundles, operations, operation, inventory, requests, request, objectSession, objectEvidence, review:input=>transition(()=>selection(input)),
    comparisonArtifact:async(profileId,id,kind,expectedSha256)=>{
      await currentHost();selectedProfile(profileId);identifier(id,'comparison request');
      need(['result','html','markdown'].includes(kind)&&HEX.test(expectedSha256??''),'WORKSPACE_COMPARISON_ARTIFACT_INVALID');
      const saved=await readRequest(profileId,id);
      need(saved&&comparisonCommand(saved.review.command),'WORKSPACE_COMPARISON_REQUEST_INVALID');
      const identity=saved.result?.artifacts?.[kind]??saved.local?.objectComparisonLastResult?.artifacts?.[kind];
      need(identity?.sha256===expectedSha256,'WORKSPACE_COMPARISON_ARTIFACT_CHANGED');
      const artifact=await comparisonAdapter.artifact(expectedSha256);
      need(artifact.bytes===identity.bytes&&artifact.mediaType===identity.mediaType,'WORKSPACE_COMPARISON_ARTIFACT_CHANGED');
      return artifact;
    },
    bundleInspection:(profileId,archiveId)=>transition(()=>bundleInspection(profileId,archiveId)),
    bundleReport:async(profileId,id,kind)=>{await currentHost();selectedProfile(profileId);const request=await readRequest(profileId,id);need(request&&objectBundleCommand(request.review.command),'WORKSPACE_BUNDLE_REQUEST_INVALID');
      return bundleAdapter.report(profileId,id,kind,request.result);},
    bundleArtifact:async(profileId,id)=>{await currentHost();selectedProfile(profileId);return bundleAdapter.artifact(profileId,id);},
    bundleAttach:input=>transition(async()=>{
      exact(input,['profileId','id','transferId','expectedReviewSha256','expectedRevision','actor'],'encrypted bundle attachment');
      need(!readOnly&&!closing,'WORKSPACE_READ_ONLY');need(!active,'WORKSPACE_EXECUTION_ACTIVE');
      await currentHost();selectedProfile(input.profileId);identifier(input.id,'original bundle export request');
      const request=await readRequest(input.profileId,input.id);
      need(request?.review.command==='object-bundle-export'&&request.result?.status==='COMPLETE',
        'WORKSPACE_BUNDLE_EXPORT_REQUIRED');
      const archive=await bundleAdapter.artifact(input.profileId,input.id),{id,...selected}=input;
      return support.attachArchive({...selected,archive,transport:{...request.result,workspaceOperationId:id}});
    }),
    bundlePair:async(profileId,beforeId,afterId)=>(await bundlePairSelected(profileId,beforeId,afterId)).pair,
    bundlePairAttach:input=>transition(async()=>{
      exact(input,['profileId','beforeId','afterId','transferId','expectedReviewSha256','expectedRevision','actor','expectedPairSha256'],'comparison bundle attachment');
      need(!readOnly&&!closing,'WORKSPACE_READ_ONLY');need(!active,'WORKSPACE_EXECUTION_ACTIVE');
      const {entries,pair}=await bundlePairSelected(input.profileId,input.beforeId,input.afterId);
      need(pair.pairSha256===input.expectedPairSha256,'WORKSPACE_BUNDLE_COMPARISON_PAIR_CHANGED');
      const {beforeId,afterId,...selected}=input;return support.attachComparison({...selected,...entries});
    }),
    bundleAttachment:input=>transition(()=>support.attachment(input)),
    bundleCaseExport:input=>transition(()=>support.exportAttached(input)),
    supportCases:(profileId,query)=>transition(()=>support.cases(profileId,query)),
    supportTransfers:profileId=>transition(()=>support.list(profileId)),
    supportTransfer:(profileId,id)=>transition(()=>support.read(profileId,id)),
    supportReview:input=>transition(()=>support.prepare(input)),
    supportSave:input=>transition(()=>support.save(input)),
    supportHandoff:(profileId,id)=>transition(()=>support.handoff(profileId,id)),
    supportExport:input=>transition(()=>support.export(input)),
    supportPackage:(profileId,id)=>transition(()=>support.inspectPackage(profileId,id)),
    start: input => transition(() => start(input)),
    resume: (profileId, id, continuation) => transition(() => resume(profileId, id, continuation)),
    cancel: (profileId, id) => transition(() => cancel(profileId, id)), close };
}
