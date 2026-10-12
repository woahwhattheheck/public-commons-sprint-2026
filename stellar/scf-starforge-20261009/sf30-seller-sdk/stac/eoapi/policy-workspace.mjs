// MIT. Review, approved deployment editions and independent receiving on the original SF88 store.
import { randomUUID, createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { privateDirectory, readJson, readBytes, writeJson, writeBytes, jsonBytes, exists, need }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { POLICY_PACKAGE_SCHEMA, normalizeDeploymentPolicy, compileDeploymentPolicy, compareDeploymentPolicies,
  policyDigest, canonicalPolicyJSON, deploymentEnvironmentText, deploymentPolicyMarkdown,
  retainedDeploymentCompilation, deploymentRuntimeSource, deploymentPolicyMarkdownEditions }
  from './deployment-policy.mjs';
import { PUBLIC_PROXY_FILENAME } from './public-proxy-runtime.mjs';

import { ORIGINAL_PUBLIC_PROXY_SHA256 } from './public-proxy-original-runtime.mjs';

const stamp = () => new Date().toISOString();
const id = prefix => prefix + '-' + randomUUID().replaceAll('-', '').slice(0, 24);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const FILES = Object.freeze(['policy.json', 'review.json', 'approval.json', 'environment.json', 'unset-environment.json', 'auth-proxy.docker.env', 'OPERATOR.md']);
const textFile = (path, text, mime) => ({ path, mime, bytes: Buffer.byteLength(text), sha256: hash(Buffer.from(text)), text });

function validatePackage(value, { frozen = false } = {}) {
  need(value && value.schema === POLICY_PACKAGE_SCHEMA && Array.isArray(value.files), 'EOAPI_POLICY_PACKAGE_INVALID');
  need(typeof value.sourceWorkspaceId === 'string' && /^eoapi-policy-workspace-[a-f0-9]{24}$/.test(value.sourceWorkspaceId), 'EOAPI_POLICY_PACKAGE_SOURCE_INVALID');
  const { digest, ...core } = value;
  need(digest === policyDigest(core), 'EOAPI_POLICY_PACKAGE_DIGEST_MISMATCH');
  const allowed = [...FILES, PUBLIC_PROXY_FILENAME];
  need([FILES.length, allowed.length].includes(value.files.length) && new Set(value.files.map(file => file.path)).size === value.files.length &&
    FILES.every(path => value.files.some(file => file.path === path)) && value.files.every(file => allowed.includes(file.path)), 'EOAPI_POLICY_PACKAGE_FILE_SET_INVALID');
  let total = 0;
  for (const file of value.files) {
    need(typeof file.text === 'string' && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 2 * 1024 ** 2 &&
      Buffer.byteLength(file.text) === file.bytes && hash(Buffer.from(file.text)) === file.sha256, 'EOAPI_POLICY_PACKAGE_FILE_MISMATCH');
    total += file.bytes;
  }
  need(total <= 8 * 1024 ** 2, 'EOAPI_POLICY_PACKAGE_SIZE_EXCEEDED');
  const file = path => value.files.find(item => item.path === path).text;
  const policy = normalizeDeploymentPolicy(JSON.parse(file('policy.json')));
  const review = JSON.parse(file('review.json')), approval = JSON.parse(file('approval.json'));
  const compilation = frozen ? structuredClone(review.compilation) : retainedDeploymentCompilation(review.compilation);
  const expectedFiles = policy.identity.mode === 'public' ? [...FILES, PUBLIC_PROXY_FILENAME] : FILES;
  need(value.files.length === expectedFiles.length && value.files.every(file => expectedFiles.includes(file.path)), 'EOAPI_POLICY_PACKAGE_FILE_SET_INVALID');
  const digestOfPolicy = policyDigest(policy);
  need(compilation && compilation.schema === 'scf-eoapi-policy-compilation/v1' && compilation.ready === true &&
    compilation.digest === digestOfPolicy && compilation.id === 'eoapi-policy-' + digestOfPolicy.slice(0, 24) &&
    policyDigest(compilation.policy) === digestOfPolicy && value.policyDigest === digestOfPolicy &&
    policyDigest(normalizeDeploymentPolicy(review.policy)) === digestOfPolicy && policyDigest(review.policy) === digestOfPolicy &&
    review.policyDigest === digestOfPolicy && approval.policyDigest === digestOfPolicy &&
    /^eoapi-policy-review-[a-f0-9]{24}$/.test(review.id) && /^eoapi-policy-approval-[a-f0-9]{24}$/.test(approval.id) &&
    approval.reviewId === review.id && value.approvalId === approval.id &&
    typeof approval.reviewer === 'string' && approval.reviewer.trim() && approval.reviewer.length <= 300 && !/[\r\n\0]/.test(approval.reviewer) &&
    typeof approval.at === 'string' && Number.isFinite(Date.parse(approval.at)), 'EOAPI_POLICY_PACKAGE_REVIEW_MISMATCH');
  if (policy.identity.mode === 'public') {
    const runtime = compilation.review.runtime;
    need(runtime && runtime.filename === PUBLIC_PROXY_FILENAME && hash(Buffer.from(file(PUBLIC_PROXY_FILENAME))) === runtime.sourceSha256,
      'EOAPI_POLICY_PACKAGE_RUNTIME_MISMATCH');
    if (!frozen) need(file(PUBLIC_PROXY_FILENAME) === deploymentRuntimeSource(compilation), 'EOAPI_POLICY_PACKAGE_RUNTIME_MISMATCH');
  }
  need(policyDigest(JSON.parse(file('environment.json'))) === policyDigest(compilation.environment) &&
    policyDigest(JSON.parse(file('unset-environment.json'))) === policyDigest(compilation.unset) &&
    file('auth-proxy.docker.env') === deploymentEnvironmentText(compilation.environment), 'EOAPI_POLICY_PACKAGE_CONFIGURATION_MISMATCH');
  if (!frozen) need(deploymentPolicyMarkdownEditions(compilation).includes(file('OPERATOR.md')), 'EOAPI_POLICY_PACKAGE_CONFIGURATION_MISMATCH');
  return { policy: structuredClone(review.policy), compilation, review, approval, bytes: total, files: value.files.length, digest };
}
export function validateDeploymentPolicyPackage(value) { return validatePackage(value); }

function packageInput(bundle, packageText) {
  if (packageText !== undefined) {
    need(typeof packageText === 'string' && Buffer.byteLength(packageText) <= 24 * 1024 ** 2, 'EOAPI_POLICY_PACKAGE_SIZE_EXCEEDED');
    const parsed = JSON.parse(packageText);
    if (bundle !== undefined) need(policyDigest(parsed) === policyDigest(bundle), 'EOAPI_POLICY_PACKAGE_TEXT_MISMATCH');
    else bundle = parsed;
  }
  return { bundle, packageText: packageText ?? jsonBytes(bundle).toString() };
}
function materialFiles(compilation, { legacyPublicInstructions = false } = {}) {
  return [
    textFile('policy.json', jsonBytes(compilation.policy).toString(), 'application/json'),
    textFile('environment.json', jsonBytes(compilation.environment).toString(), 'application/json'),
    textFile('unset-environment.json', jsonBytes(compilation.unset).toString(), 'application/json'),
    textFile('auth-proxy.docker.env', deploymentEnvironmentText(compilation.environment), 'text/plain'),
    textFile('OPERATOR.md', deploymentPolicyMarkdown(compilation, { legacyPublicInstructions }), 'text/markdown'),
    ...(compilation.policy.identity.mode === 'public' ? [textFile(PUBLIC_PROXY_FILENAME, deploymentRuntimeSource(compilation), 'text/x-python')] : [])
  ];
}
function assemblePackage({ sourceWorkspaceId, approval, review, material }) {
  const files = [...material,
    textFile('review.json', jsonBytes(review).toString(), 'application/json'),
    textFile('approval.json', jsonBytes(approval).toString(), 'application/json')
  ].sort((a, b) => a.path.localeCompare(b.path));
  const core = { schema: POLICY_PACKAGE_SCHEMA, sourceWorkspaceId, policyDigest: approval.policyDigest, approvalId: approval.id, files };
  return { ...core, digest: policyDigest(core) };
}

export async function openDeploymentPolicyWorkspace({ directory, create = true, title = 'eoAPI deployment policy' } = {}) {
  directory = await privateDirectory(directory, { create });
  const versions = await privateDirectory(join(directory, 'versions'), { create });
  let queue = Promise.resolve();
  const pathFor = revision => join(versions, String(revision).padStart(12, '0') + '.json');
  const versionNames = async () => (await readdir(versions)).filter(name => /^\d{12}\.json$/.test(name)).sort();

  // Complete file bytes live once in content-addressed immutable files. The CAS
  // state binds their hashes to reviews/approvals without copying them into every
  // later workspace revision. A prepared orphan never creates an approval.
  async function writeFrozen(value, text = jsonBytes(value).toString()) {
    need(policyDigest(JSON.parse(text)) === policyDigest(value), 'EOAPI_FROZEN_VALUE_MISMATCH');
    const bytes = Buffer.from(text), sha256 = hash(bytes);
    need(bytes.length <= 24 * 1024 ** 2, 'EOAPI_POLICY_PACKAGE_SIZE_EXCEEDED');
    const root = await privateDirectory(join(directory, 'frozen'));
    const path = join(root, sha256 + '.json');
    try { await writeBytes(path, bytes, { exclusive: true }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need(hash(await readBytes(path, bytes.length)) === sha256, 'EOAPI_FROZEN_FILE_CHANGED');
    }
    return { sha256, bytes: bytes.length };
  }
  async function readFrozen(reference) {
    need(reference && /^[a-f0-9]{64}$/.test(reference.sha256) &&
      Number.isSafeInteger(reference.bytes) && reference.bytes > 0 && reference.bytes <= 24 * 1024 ** 2, 'EOAPI_FROZEN_REFERENCE_INVALID');
    const bytes = await readBytes(join(directory, 'frozen', reference.sha256 + '.json'), reference.bytes);
    need(bytes.length === reference.bytes && hash(bytes) === reference.sha256, 'EOAPI_FROZEN_FILE_CHANGED');
    const text = bytes.toString(); return { value: JSON.parse(text), text };
  }
  function bindRecords(state, validated) {
    const approval = state.approvals.find(value => value.id === validated.approval.id);
    const review = state.reviews.find(value => value.id === validated.review.id);
    need(approval && review && policyDigest(approval) === policyDigest(validated.approval) &&
      policyDigest(review) === policyDigest(validated.review), 'EOAPI_APPROVED_POLICY_CHANGED');
  }
  async function frozenPackage(state, approvalId) {
    const reference = (state.approvedPackages ?? []).find(value => value.approvalId === approvalId);
    if (!reference) return null;
    const saved = await readFrozen(reference), bundle = saved.value;
    need(bundle.approvalId === approvalId && bundle.digest === reference.digest &&
      bundle.sourceWorkspaceId === reference.sourceWorkspaceId, 'EOAPI_FROZEN_PACKAGE_BINDING_CHANGED');
    const validated = validatePackage(bundle, { frozen: true }); bindRecords(state, validated);
    return { package: bundle, packageText: saved.text, validated };
  }
  async function reviewMaterial(state, record) {
    const reference = (state.reviewEditions ?? []).find(value => value.reviewId === record.id);
    if (reference) {
      const saved = (await readFrozen(reference)).value;
      need(saved.reviewId === record.id && saved.compilationDigest === policyDigest(record.compilation) &&
        Array.isArray(saved.files), 'EOAPI_FROZEN_REVIEW_BINDING_CHANGED');
      return { files: saved.files, frozen: true };
    }
    const compilation = retainedDeploymentCompilation(record.compilation);
    const originalPublic = compilation.policy.identity.mode === 'public' &&
      compilation.review.runtime.sourceSha256 === ORIGINAL_PUBLIC_PROXY_SHA256;
    // The intermediate current-factory/legacy-CORS releases had two operator
    // templates. An original complete package disambiguates that edition.
    need(compilation.policy.identity.mode !== 'public' || originalPublic || 'CORS' in compilation.environment,
      'EOAPI_APPROVED_PACKAGE_BYTES_REQUIRED');
    return { files: materialFiles(compilation, { legacyPublicInstructions: originalPublic }), frozen: false };
  }
  async function selectedApproval(state, approvalId) {
    const approval = state.approvals.find(value => value.id === (approvalId ?? state.currentApprovalId));
    need(approval, 'EOAPI_APPROVED_POLICY_REQUIRED');
    const review = state.reviews.find(value => value.id === approval.reviewId);
    need(review && review.policyDigest === approval.policyDigest, 'EOAPI_APPROVED_POLICY_CHANGED');
    const saved = await frozenPackage(state, approval.id);
    if (saved) return { approval, review, policy: saved.validated.policy, compilation: saved.validated.compilation, saved };
    const policy = normalizeDeploymentPolicy(review.policy), compilation = retainedDeploymentCompilation(review.compilation);
    need(compilation.ready && compilation.digest === approval.policyDigest && policyDigest(policy) === approval.policyDigest &&
      policyDigest(review.policy) === approval.policyDigest, 'EOAPI_APPROVED_POLICY_CHANGED');
    return { approval, review, policy: structuredClone(review.policy), compilation, saved: null };
  }

  async function getState() {
    const files = await versionNames(); need(files.length, 'EOAPI_POLICY_WORKSPACE_NOT_FOUND');
    return readJson(join(versions, files.at(-1)), 64 * 1024 ** 2);
  }
  if (!(await versionNames()).length) {
    need(create, 'EOAPI_POLICY_WORKSPACE_NOT_FOUND');
    const initial = { schema: 'scf-eoapi-policy-workspace/v1', id: id('eoapi-policy-workspace'), title,
      revision: 0, createdAt: stamp(), updatedAt: stamp(), draft: null, reviews: [], approvals: [], currentApprovalId: null, imports: [], reviewEditions: [], approvedPackages: [] };
    try { await writeJson(pathFor(0), initial, { exclusive: true }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  async function mutate(change, expectedRevision, replay) {
    const operation = queue.then(async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const state = await getState();
        if (replay) { const existing = await replay(state); if (existing !== undefined) return structuredClone(existing); }
        if (expectedRevision !== undefined) need(state.revision === expectedRevision, 'EOAPI_POLICY_REVISION_CHANGED');
        const output = await change(state); state.revision++; state.updatedAt = stamp();
        try { await writeJson(pathFor(state.revision), state, { exclusive: true }); return structuredClone(output); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      need(false, 'EOAPI_POLICY_CONCURRENT_WRITER');
    });
    queue = operation.catch(() => {}); return operation;
  }
  async function saveDraft({ policy, expectedRevision } = {}) {
    const normalized = normalizeDeploymentPolicy(policy), digest = policyDigest(normalized);
    return mutate(state => {
      state.draft = { policy: normalized, digest, updatedAt: stamp() };
      return { ...state.draft, revision: state.revision + 1 };
    }, expectedRevision);
  }
  async function review({ expectedRevision } = {}) {
    return mutate(async state => {
      need(state.draft, 'EOAPI_POLICY_DRAFT_REQUIRED');
      const compilation = compileDeploymentPolicy(state.draft.policy);
      const approved = state.approvals.find(value => value.id === state.currentApprovalId);
      const previous = approved ? state.reviews.find(value => value.id === approved.reviewId)?.policy : null;
      const record = { id: id('eoapi-policy-review'), policyDigest: compilation.digest, policy: compilation.policy,
        compilation, changes: compareDeploymentPolicies(previous, compilation.policy), draftRevision: state.revision, at: stamp() };
      const frozen = await writeFrozen({ reviewId: record.id, compilationDigest: policyDigest(compilation), files: materialFiles(compilation) });
      (state.reviewEditions ??= []).push({ reviewId: record.id, ...frozen });
      state.reviews.push(record); return record;
    }, expectedRevision);
  }
  async function approve({ reviewId, reviewer, expectedRevision } = {}) {
    need(typeof reviewer === 'string' && reviewer.trim().length > 0 && reviewer.length <= 300 && !/[\r\n\0]/.test(reviewer), 'EOAPI_POLICY_REVIEWER_REQUIRED');
    return mutate(async state => {
      const record = state.reviews.find(value => value.id === reviewId);
      need(record && record.policyDigest === state.draft?.digest, 'EOAPI_POLICY_REVIEW_STALE');
      need(record.compilation.ready, 'EOAPI_POLICY_FINDINGS_REQUIRE_CORRECTION');
      const existing = state.approvals.find(value => value.reviewId === reviewId);
      if (existing) { state.currentApprovalId = existing.id; return existing; }
      const approval = { id: id('eoapi-policy-approval'), reviewId, policyDigest: record.policyDigest, reviewer: reviewer.trim(), at: stamp() };
      const material = await reviewMaterial(state, record);
      const bundle = assemblePackage({ sourceWorkspaceId: state.id, approval, review: record, material: material.files });
      validatePackage(bundle, { frozen: material.frozen });
      const frozen = await writeFrozen(bundle);
      (state.approvedPackages ??= []).push({ approvalId: approval.id, digest: bundle.digest, sourceWorkspaceId: state.id, ...frozen });
      state.approvals.push(approval); state.currentApprovalId = approval.id; return approval;
    }, expectedRevision);
  }
  async function getApproval({ approvalId } = {}) {
    const { approval, review, policy, compilation } = await selectedApproval(await getState(), approvalId);
    return structuredClone({ approval, review, policy, compilation });
  }
  async function exportPackage({ approvalId, directory: destination } = {}) {
    const state = await getState(), selected = await selectedApproval(state, approvalId);
    let bundle, packageText;
    if (selected.saved) { bundle = selected.saved.package; packageText = selected.saved.packageText; }
    else {
      const material = await reviewMaterial(state, selected.review);
      const received = state.imports.find(value => value.approvalId === selected.approval.id);
      bundle = assemblePackage({ sourceWorkspaceId: received?.sourceWorkspaceId ?? state.id,
        approval: selected.approval, review: selected.review, material: material.files });
      validatePackage(bundle, { frozen: material.frozen });
      need(!received || received.digest === bundle.digest, 'EOAPI_APPROVED_PACKAGE_BYTES_REQUIRED');
      packageText = jsonBytes(bundle).toString();
    }
    const files = bundle.files;
    if (destination !== undefined) {
      destination = resolve(destination); need(destination !== directory && !destination.startsWith(directory + '/'), 'EOAPI_PACKAGE_SEPARATE_DIRECTORY_REQUIRED');
      await privateDirectory(destination);
      for (const file of [...files, textFile('package.json', packageText, 'application/json')]) {
        const target = join(destination, file.path);
        if (await exists(target)) need(hash(await readBytes(target, file.bytes)) === file.sha256, 'EOAPI_PACKAGE_DESTINATION_CONFLICT');
        else await writeBytes(target, Buffer.from(file.text), { exclusive: true });
      }
      const present = (await readdir(destination)).sort();
      need(canonicalPolicyJSON(present) === canonicalPolicyJSON([...files.map(file => file.path), 'package.json'].sort()), 'EOAPI_PACKAGE_DESTINATION_EXTRA_FILES');
    }
    return structuredClone({ package: bundle, packageText, directory: destination ?? null });
  }
  async function inspectPackage({ package: input, packageText } = {}) {
    const { bundle } = packageInput(input, packageText), state = await getState();
    const saved = bundle?.approvalId ? await frozenPackage(state, bundle.approvalId) : null;
    if (saved) need(policyDigest(bundle) === policyDigest(saved.package), 'EOAPI_IMPORTED_PACKAGE_CONFLICT');
    return validatePackage(bundle, { frozen: Boolean(saved) });
  }
  async function importPackage({ package: input, packageText, expectedRevision } = {}) {
    const parsed = packageInput(input, packageText), bundle = parsed.bundle;
    const validated = await inspectPackage({ package: bundle });
    function checkExisting(state) {
      const priorReview = state.reviews.find(value => value.id === validated.review.id);
      const priorApproval = state.approvals.find(value => value.id === validated.approval.id);
      need(!priorReview || policyDigest(priorReview) === policyDigest(validated.review), 'EOAPI_IMPORTED_REVIEW_CONFLICT');
      need(!priorApproval || policyDigest(priorApproval) === policyDigest(validated.approval), 'EOAPI_IMPORTED_APPROVAL_CONFLICT');
      const reference = (state.approvedPackages ?? []).find(value => value.approvalId === validated.approval.id);
      const previous = state.imports.find(value => value.approvalId === validated.approval.id);
      need(!reference || reference.digest === bundle.digest && reference.sourceWorkspaceId === bundle.sourceWorkspaceId, 'EOAPI_IMPORTED_PACKAGE_CONFLICT');
      need(!previous || previous.digest === bundle.digest && previous.sourceWorkspaceId === bundle.sourceWorkspaceId, 'EOAPI_IMPORTED_PACKAGE_CONFLICT');
      if (priorApproval && !reference && !previous) need(bundle.sourceWorkspaceId === state.id, 'EOAPI_IMPORTED_PACKAGE_SOURCE_CONFLICT');
      return { priorReview, priorApproval };
    }
    const replay = async state => {
      checkExisting(state);
      const existing = state.imports.find(value => value.digest === bundle.digest);
      if (!existing) return undefined;
      need(existing.approvalId === bundle.approvalId && existing.sourceWorkspaceId === bundle.sourceWorkspaceId &&
        existing.policyDigest === bundle.policyDigest && existing.files === validated.files && existing.bytes === validated.bytes, 'EOAPI_IMPORTED_PACKAGE_CONFLICT');
      const saved = await frozenPackage(state, bundle.approvalId);
      if (!saved) return undefined;
      need(policyDigest(saved.package) === policyDigest(bundle), 'EOAPI_IMPORTED_PACKAGE_CONFLICT');
      return existing;
    };
    return mutate(async state => {
      const { priorReview, priorApproval } = checkExisting(state);
      const frozen = await writeFrozen(bundle, parsed.packageText);
      if (!priorReview) state.reviews.push(structuredClone(validated.review));
      if (!priorApproval) state.approvals.push(structuredClone(validated.approval));
      if (!(state.approvedPackages ?? []).some(value => value.approvalId === bundle.approvalId)) {
        (state.approvedPackages ??= []).push({ approvalId: bundle.approvalId, digest: bundle.digest,
          sourceWorkspaceId: bundle.sourceWorkspaceId, ...frozen });
      }
      const existingReceipt = state.imports.find(value => value.digest === bundle.digest);
      if (existingReceipt) return existingReceipt;
      state.draft = { policy: validated.policy, digest: validated.compilation.digest, updatedAt: stamp() };
      state.currentApprovalId = bundle.approvalId;
      const receipt = { id: id('eoapi-policy-import'), digest: bundle.digest, policyDigest: bundle.policyDigest,
        sourceWorkspaceId: bundle.sourceWorkspaceId, approvalId: bundle.approvalId, files: validated.files, bytes: validated.bytes, at: stamp() };
      state.imports.push(receipt); return receipt;
    }, expectedRevision, replay);
  }

  return Object.freeze({ directory, getState, getApproval, inspectPackage, saveDraft, review, approve, exportPackage, importPackage, close: () => queue });
}
