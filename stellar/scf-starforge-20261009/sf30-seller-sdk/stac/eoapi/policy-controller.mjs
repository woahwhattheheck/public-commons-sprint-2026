// MIT. Framework-neutral operator boundary for the original deployment policy store.
import { need, object, safeCode } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { compileDeploymentPolicy, compareDeploymentPolicies } from './deployment-policy.mjs';

const exact = (value, fields) => {
  need(object(value) && Object.keys(value).every(key => fields.includes(key)), 'EOAPI_POLICY_ACTION_FIELDS_INVALID');
  return value;
};
const selectedId = value => {
  need(typeof value === 'string' && /^eoapi-policy-(?:review|approval)-[a-f0-9]{24}$/.test(value), 'EOAPI_POLICY_SELECTION_INVALID');
  return value;
};
const expected = body => {
  need(Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0, 'EOAPI_POLICY_EXPECTED_REVISION_REQUIRED');
};
const reviewerName = value => {
  need(typeof value === 'string' && value.trim() && value.length <= 300 && !/[\r\n\0]/.test(value), 'EOAPI_POLICY_REVIEWER_REQUIRED');
  return value.trim();
};
const reviewRow = (review, state) => ({
  id: review.id, policyDigest: review.policyDigest, at: review.at,
  title: review.policy.title, draftRevision: review.draftRevision,
  ready: review.compilation.ready, findings: review.compilation.review.findings.length,
  changes: review.changes.changes.length, currentDraft: review.policyDigest === state.draft?.digest,
  approvalId: state.approvals.find(value => value.reviewId === review.id)?.id ?? null
});
function summary(state, reviewer) {
  const approval = state.approvals.find(value => value.id === state.currentApprovalId) ?? null;
  const latestReview = state.reviews.at(-1);
  return {
    schema: state.schema, id: state.id, title: state.title, revision: state.revision,
    createdAt: state.createdAt, updatedAt: state.updatedAt, draft: state.draft,
    currentApprovalId: state.currentApprovalId, currentApproval: approval,
    latestReview: latestReview ? reviewRow(latestReview, state) : null,
    counts: { reviews: state.reviews.length, approvals: state.approvals.length, imports: state.imports.length },
    reviewer: reviewer ?? null, reviewerFromHost: reviewer !== undefined
  };
}
function history(state, query) {
  need([...query.keys()].every(key => ['kind', 'before', 'limit'].includes(key)) &&
    [...new Set(query.keys())].every(key => query.getAll(key).length === 1), 'EOAPI_POLICY_HISTORY_QUERY_INVALID');
  const kind = query.get('kind') ?? 'reviews';
  need(['reviews', 'approvals', 'imports'].includes(kind), 'EOAPI_POLICY_HISTORY_KIND_INVALID');
  const number = (value, fallback) => value === null ? fallback : /^\d{1,12}$/.test(value) ? Number(value) : NaN;
  const rows = state[kind], before = number(query.get('before'), rows.length), limit = number(query.get('limit'), 30);
  need(Number.isSafeInteger(before) && before >= 0 && before <= rows.length &&
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'EOAPI_POLICY_HISTORY_QUERY_INVALID');
  const start = Math.max(0, before - limit);
  return {
    kind, workspaceId: state.id, revision: state.revision, total: rows.length,
    rows: rows.slice(start, before).reverse().map(value => kind === 'reviews' ? reviewRow(value, state) : value),
    nextBefore: start > 0 ? start : null
  };
}

export function createDeploymentPolicyController({ workspace, reviewerFor } = {}) {
  need(workspace && ['getState', 'getApproval', 'saveDraft', 'review', 'approve', 'exportPackage', 'importPackage']
    .every(name => typeof workspace[name] === 'function'), 'EOAPI_POLICY_WORKSPACE_REQUIRED');
  need(reviewerFor === undefined || typeof reviewerFor === 'function', 'EOAPI_POLICY_REVIEWER_RESOLVER_INVALID');
  const hostReviewer = async request => reviewerFor ? reviewerName(await reviewerFor({ context: request.context, signal: request.signal })) : undefined;
  return Object.freeze({
    // The enclosing host retains authentication, authorization, same-origin/CSRF
    // checks and its body-size limit. It strips /api/eoapi/policy before dispatch.
    // context is supplied by that host, never copied from the HTTP body.
    async dispatch(request = {}) {
      const { method, path, body = {}, signal } = request;
      try {
        need(!signal?.aborted, 'EOAPI_POLICY_REQUEST_ABORTED');
        need(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') &&
          path.length <= 1200 && !/[\0\r\n#\\]/.test(path), 'EOAPI_POLICY_ROUTE_INVALID');
        const parsed = new URL(path, 'http://policy.local'), route = parsed.pathname;
        need(route === '/history' || !parsed.search, 'EOAPI_POLICY_ROUTE_INVALID');
        let result;
        if (method === 'GET' && route === '/state') {
          result = summary(await workspace.getState(), await hostReviewer(request));
        } else if (method === 'GET' && route === '/history') {
          result = history(await workspace.getState(), parsed.searchParams);
        } else if (method === 'GET' && route.startsWith('/reviews/')) {
          const id = selectedId(route.slice('/reviews/'.length)), state = await workspace.getState();
          const review = state.reviews.find(value => value.id === id);
          need(review, 'EOAPI_POLICY_REVIEW_NOT_FOUND');
          result = { review, currentRevision: state.revision, currentDraft: state.draft?.digest === review.policyDigest,
            approval: state.approvals.find(value => value.reviewId === id) ?? null };
        } else if (method === 'GET' && route.startsWith('/approvals/')) {
          result = await workspace.getApproval({ approvalId: selectedId(route.slice('/approvals/'.length)) });
        } else if (method === 'POST') {
          need(object(body) && Buffer.byteLength(JSON.stringify(body)) <= 20 * 1024 ** 2, 'EOAPI_POLICY_REQUEST_SIZE_EXCEEDED');
          if (route === '/preview') {
            exact(body, ['policy', 'againstApprovalId']);
            const compilation = compileDeploymentPolicy(body.policy), state = await workspace.getState();
            const approvalId = body.againstApprovalId ?? state.currentApprovalId;
            const original = approvalId ? await workspace.getApproval({ approvalId: selectedId(approvalId) }) : null;
            result = { compilation, changes: compareDeploymentPolicies(original?.policy ?? null, compilation.policy),
              againstApprovalId: original?.approval.id ?? null, currentRevision: state.revision };
          } else if (route === '/draft') {
            exact(body, ['policy', 'expectedRevision']); expected(body);
            result = await workspace.saveDraft(body);
          } else if (route === '/review') {
            exact(body, ['expectedRevision']); expected(body);
            result = await workspace.review(body);
          } else if (route === '/approve') {
            exact(body, ['reviewId', 'reviewer', 'expectedRevision']); expected(body); selectedId(body.reviewId);
            const reviewer = reviewerFor ? await hostReviewer(request) : reviewerName(body.reviewer);
            need(!signal?.aborted, 'EOAPI_POLICY_REQUEST_ABORTED');
            result = await workspace.approve({ reviewId: body.reviewId, reviewer, expectedRevision: body.expectedRevision });
          } else if (route === '/export') {
            exact(body, ['approvalId']);
            if (body.approvalId !== undefined) selectedId(body.approvalId);
            result = await workspace.exportPackage(body);
          } else if (route === '/inspect') {
            exact(body, ['package']);
            const { validateDeploymentPolicyPackage } = await import('./policy-workspace.mjs');
            const validated = typeof workspace.inspectPackage === 'function'
              ? await workspace.inspectPackage(body) : validateDeploymentPolicyPackage(body.package);
            result = { digest: validated.digest, policyDigest: validated.compilation.digest,
              sourceWorkspaceId: body.package.sourceWorkspaceId, approval: validated.approval,
              policy: validated.policy, compilation: validated.compilation,
              files: body.package.files.map(({ path, mime, bytes, sha256 }) => ({ path, mime, bytes, sha256 })), bytes: validated.bytes };
          } else if (route === '/receive') {
            exact(body, ['package', 'packageText', 'expectedRevision']); expected(body);
            result = await workspace.importPackage(body);
          } else return { status: 404, body: { error: 'EOAPI_POLICY_ROUTE_NOT_FOUND' } };
        } else return { status: 404, body: { error: 'EOAPI_POLICY_ROUTE_NOT_FOUND' } };
        return { status: 200, body: structuredClone(result) };
      } catch (error) {
        const code = safeCode(error?.code, 'EOAPI_POLICY_ACTION_FAILED');
        const status = /ABORTED/.test(code) ? 499 : /NOT_FOUND/.test(code) ? 404 :
          /CHANGED|STALE|CONFLICT|CONCURRENT/.test(code) ? 409 : /SIZE_EXCEEDED/.test(code) ? 413 : 400;
        const field = typeof error?.path === 'string' && error.path.length <= 1000 ? error.path : undefined;
        return { status, body: { error: code, ...(field ? { field } : {}) } };
      }
    }
  });
}
