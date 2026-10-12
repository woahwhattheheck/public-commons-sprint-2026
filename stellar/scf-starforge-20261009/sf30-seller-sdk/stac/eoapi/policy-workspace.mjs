// MIT. Review, approved deployment editions and independent receiving on the original SF88 store.
import { randomUUID, createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { privateDirectory, readJson, readBytes, writeJson, writeBytes, jsonBytes, exists, need }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { POLICY_PACKAGE_SCHEMA, normalizeDeploymentPolicy, compileDeploymentPolicy, compareDeploymentPolicies,
  policyDigest, canonicalPolicyJSON, deploymentEnvironmentText, deploymentPolicyMarkdown }
  from './deployment-policy.mjs';

const stamp = () => new Date().toISOString();
const id = prefix => prefix + '-' + randomUUID().replaceAll('-', '').slice(0, 24);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const FILES = Object.freeze(['policy.json', 'review.json', 'approval.json', 'environment.json', 'unset-environment.json', 'auth-proxy.docker.env', 'OPERATOR.md']);
const textFile = (path, text, mime) => ({ path, mime, bytes: Buffer.byteLength(text), sha256: hash(Buffer.from(text)), text });

export function validateDeploymentPolicyPackage(value) {
  need(value && value.schema === POLICY_PACKAGE_SCHEMA && Array.isArray(value.files), 'EOAPI_POLICY_PACKAGE_INVALID');
  const { digest, ...core } = value;
  need(digest === policyDigest(core), 'EOAPI_POLICY_PACKAGE_DIGEST_MISMATCH');
  need(value.files.length === FILES.length && new Set(value.files.map(file => file.path)).size === FILES.length &&
    value.files.every(file => FILES.includes(file.path)), 'EOAPI_POLICY_PACKAGE_FILE_SET_INVALID');
  let total = 0;
  for (const file of value.files) {
    need(typeof file.text === 'string' && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 2 * 1024 ** 2 &&
      Buffer.byteLength(file.text) === file.bytes && hash(Buffer.from(file.text)) === file.sha256, 'EOAPI_POLICY_PACKAGE_FILE_MISMATCH');
    total += file.bytes;
  }
  need(total <= 8 * 1024 ** 2, 'EOAPI_POLICY_PACKAGE_SIZE_EXCEEDED');
  const file = path => value.files.find(item => item.path === path).text;
  const policy = normalizeDeploymentPolicy(JSON.parse(file('policy.json'))), compilation = compileDeploymentPolicy(policy);
  const review = JSON.parse(file('review.json')), approval = JSON.parse(file('approval.json'));
  need(value.policyDigest === compilation.digest && policyDigest(normalizeDeploymentPolicy(review.policy)) === compilation.digest && policyDigest(review.policy) === compilation.digest && review.policyDigest === compilation.digest &&
    approval.policyDigest === compilation.digest && approval.reviewId === review.id && value.approvalId === approval.id &&
    typeof approval.reviewer === 'string' && approval.reviewer.trim() && typeof approval.at === 'string', 'EOAPI_POLICY_PACKAGE_REVIEW_MISMATCH');
  need(compilation.ready && policyDigest(JSON.parse(file('environment.json'))) === policyDigest(compilation.environment) &&
    policyDigest(JSON.parse(file('unset-environment.json'))) === policyDigest(compilation.unset) &&
    file('auth-proxy.docker.env') === deploymentEnvironmentText(compilation.environment) &&
    file('OPERATOR.md') === deploymentPolicyMarkdown(compilation), 'EOAPI_POLICY_PACKAGE_CONFIGURATION_MISMATCH');
  need(policyDigest(review.compilation) === policyDigest(compilation), 'EOAPI_POLICY_PACKAGE_REVIEW_MISMATCH');
  return { policy, compilation, review, approval, bytes: total, files: value.files.length, digest };
}

export async function openDeploymentPolicyWorkspace({ directory, create = true, title = 'eoAPI deployment policy' } = {}) {
  directory = await privateDirectory(directory, { create });
  const versions = await privateDirectory(join(directory, 'versions'), { create });
  let queue = Promise.resolve();
  const pathFor = revision => join(versions, String(revision).padStart(12, '0') + '.json');
  const versionNames = async () => (await readdir(versions)).filter(name => /^\d{12}\.json$/.test(name)).sort();
  async function getState() {
    const files = await versionNames(); need(files.length, 'EOAPI_POLICY_WORKSPACE_NOT_FOUND');
    return readJson(join(versions, files.at(-1)), 64 * 1024 ** 2);
  }
  if (!(await versionNames()).length) {
    need(create, 'EOAPI_POLICY_WORKSPACE_NOT_FOUND');
    const initial = { schema: 'scf-eoapi-policy-workspace/v1', id: id('eoapi-policy-workspace'), title,
      revision: 0, createdAt: stamp(), updatedAt: stamp(), draft: null, reviews: [], approvals: [], currentApprovalId: null, imports: [] };
    try { await writeJson(pathFor(0), initial, { exclusive: true }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  async function mutate(change, expectedRevision) {
    const operation = queue.then(async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const state = await getState();
        if (expectedRevision !== undefined) need(state.revision === expectedRevision, 'EOAPI_POLICY_REVISION_CHANGED');
        const output = change(state); state.revision++; state.updatedAt = stamp();
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
    return mutate(state => {
      need(state.draft, 'EOAPI_POLICY_DRAFT_REQUIRED');
      const compilation = compileDeploymentPolicy(state.draft.policy);
      const approved = state.approvals.find(value => value.id === state.currentApprovalId);
      const previous = approved ? state.reviews.find(value => value.id === approved.reviewId)?.policy : null;
      const record = { id: id('eoapi-policy-review'), policyDigest: compilation.digest, policy: compilation.policy,
        compilation, changes: compareDeploymentPolicies(previous, compilation.policy), draftRevision: state.revision, at: stamp() };
      state.reviews.push(record); return record;
    }, expectedRevision);
  }
  async function approve({ reviewId, reviewer, expectedRevision } = {}) {
    need(typeof reviewer === 'string' && reviewer.trim().length > 0 && reviewer.length <= 300 && !/[\r\n\0]/.test(reviewer), 'EOAPI_POLICY_REVIEWER_REQUIRED');
    return mutate(state => {
      const record = state.reviews.find(value => value.id === reviewId);
      need(record && record.policyDigest === state.draft?.digest, 'EOAPI_POLICY_REVIEW_STALE');
      need(record.compilation.ready, 'EOAPI_POLICY_FINDINGS_REQUIRE_CORRECTION');
      const existing = state.approvals.find(value => value.reviewId === reviewId);
      if (existing) { state.currentApprovalId = existing.id; return existing; }
      const approval = { id: id('eoapi-policy-approval'), reviewId, policyDigest: record.policyDigest, reviewer: reviewer.trim(), at: stamp() };
      state.approvals.push(approval); state.currentApprovalId = approval.id; return approval;
    }, expectedRevision);
  }
  async function getApproval({ approvalId } = {}) {
    const state = await getState();
    const approval = state.approvals.find(value => value.id === (approvalId ?? state.currentApprovalId));
    need(approval, 'EOAPI_APPROVED_POLICY_REQUIRED');
    const review = state.reviews.find(value => value.id === approval.reviewId);
    need(review && review.policyDigest === approval.policyDigest, 'EOAPI_APPROVED_POLICY_CHANGED');
    const policy = normalizeDeploymentPolicy(review.policy), compilation = compileDeploymentPolicy(policy);
    need(compilation.ready && compilation.digest === approval.policyDigest &&
      policyDigest(review.compilation) === policyDigest(compilation), 'EOAPI_APPROVED_POLICY_CHANGED');
    return structuredClone({ approval, review, policy, compilation });
  }
  async function exportPackage({ approvalId, directory: destination } = {}) {
    const state = await getState();
    const approval = state.approvals.find(value => value.id === (approvalId ?? state.currentApprovalId));
    need(approval, 'EOAPI_APPROVED_POLICY_REQUIRED');
    const review = state.reviews.find(value => value.id === approval.reviewId), compilation = compileDeploymentPolicy(review.policy);
    need(compilation.ready && compilation.digest === approval.policyDigest, 'EOAPI_APPROVED_POLICY_CHANGED');
    const files = [
      textFile('policy.json', jsonBytes(compilation.policy).toString(), 'application/json'),
      textFile('review.json', jsonBytes(review).toString(), 'application/json'),
      textFile('approval.json', jsonBytes(approval).toString(), 'application/json'),
      textFile('environment.json', jsonBytes(compilation.environment).toString(), 'application/json'),
      textFile('unset-environment.json', jsonBytes(compilation.unset).toString(), 'application/json'),
      textFile('auth-proxy.docker.env', deploymentEnvironmentText(compilation.environment), 'text/plain'),
      textFile('OPERATOR.md', deploymentPolicyMarkdown(compilation), 'text/markdown')
    ].sort((a, b) => a.path.localeCompare(b.path));
    const core = { schema: POLICY_PACKAGE_SCHEMA, sourceWorkspaceId: state.id, policyDigest: compilation.digest,
      approvalId: approval.id, files }, bundle = { ...core, digest: policyDigest(core) };
    validateDeploymentPolicyPackage(bundle);
    if (destination !== undefined) {
      destination = resolve(destination); need(destination !== directory && !destination.startsWith(directory + '/'), 'EOAPI_PACKAGE_SEPARATE_DIRECTORY_REQUIRED');
      await privateDirectory(destination);
      for (const file of [...files, textFile('package.json', jsonBytes(bundle).toString(), 'application/json')]) {
        const target = join(destination, file.path);
        if (await exists(target)) need(hash(await readBytes(target, file.bytes)) === file.sha256, 'EOAPI_PACKAGE_DESTINATION_CONFLICT');
        else await writeBytes(target, Buffer.from(file.text), { exclusive: true });
      }
      const present = (await readdir(destination)).sort();
      need(canonicalPolicyJSON(present) === canonicalPolicyJSON([...FILES, 'package.json'].sort()), 'EOAPI_PACKAGE_DESTINATION_EXTRA_FILES');
    }
    return { package: bundle, directory: destination ?? null };
  }
  async function importPackage({ package: bundle, expectedRevision } = {}) {
    const validated = validateDeploymentPolicyPackage(bundle);
    return mutate(state => {
      const existing = state.imports.find(value => value.digest === bundle.digest); if (existing) return existing;
      const approval = structuredClone(validated.approval), review = structuredClone(validated.review);
      const priorReview = state.reviews.find(value => value.id === review.id), priorApproval = state.approvals.find(value => value.id === approval.id);
      need(!priorReview || policyDigest(priorReview) === policyDigest(review), 'EOAPI_IMPORTED_REVIEW_CONFLICT');
      need(!priorApproval || policyDigest(priorApproval) === policyDigest(approval), 'EOAPI_IMPORTED_APPROVAL_CONFLICT');
      if (!priorReview) state.reviews.push(review);
      if (!priorApproval) state.approvals.push(approval);
      state.draft = { policy: validated.policy, digest: validated.compilation.digest, updatedAt: stamp() };
      state.currentApprovalId = approval.id;
      const receipt = { id: id('eoapi-policy-import'), digest: bundle.digest, policyDigest: bundle.policyDigest,
        sourceWorkspaceId: bundle.sourceWorkspaceId, approvalId: approval.id, files: validated.files, bytes: validated.bytes, at: stamp() };
      state.imports.push(receipt); return receipt;
    }, expectedRevision);
  }
  return Object.freeze({ directory, getState, getApproval, saveDraft, review, approve, exportPackage, importPackage, close: () => queue });
}
