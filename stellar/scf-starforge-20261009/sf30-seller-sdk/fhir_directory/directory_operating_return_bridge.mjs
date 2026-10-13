// MIT. File-only binding to the original complete returned OperatingPlan model.
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as returned from '../../distribution/discovery/operating-plan-return.mjs';
import { summarizeOperatingPlan } from '../../distribution/discovery/operating-plan.mjs';

const MAX_BRIDGE = 512 * 1024 * 1024;
const fail = message => { throw new TypeError(message); };
async function readPrivate(path) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) || st.size > MAX_BRIDGE)
    fail('Choose a complete private original-return request within 512 MiB.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || (before.mode & 0o077) || before.size !== st.size)
      fail('The private original-return request changed before reading.');
    const bytes = await handle.readFile();
    if (bytes.length !== st.size) fail('The complete original-return input changed.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
function full(value) {
  const review = returned.inspectOperatingPlanReturn(value);
  const comparison = returned.compareOperatingPlanReturn(review);
  return { review, comparison, summary: { ...comparison.summary,
    reviewId: review.id, planId: comparison.planId, incomingPlanId: comparison.incomingPlanId,
    relationship: comparison.relationship, commonRevision: comparison.commonRevision,
    currentRevision: comparison.currentRevision, incomingRevision: comparison.incomingRevision,
    ready: comparison.ready, issues: comparison.issues.length,
    completed: review.completion !== null,
    resultRevision: review.completion?.plan.revisions.length ?? null,
    reviewer: review.reviewer, title: review.current.revisions.at(-1).title } };
}
export function runDirectoryReturnBridge(request) {
  const p = request.payload ?? {};
  switch (request.action) {
    case 'prepare': return full(returned.createOperatingPlanReturn(p.current, p.incoming, p.options));
    case 'revise': {
      let review = returned.reviseOperatingPlanReturn(p.review, p.updates ?? {});
      for (const item of p.decisions ?? []) review = returned.decideOperatingPlanReturn(review, item.key, item.decision);
      return full(review);
    }
    case 'inspect': return full(p.review);
    case 'complete': {
      const result = returned.applyOperatingPlanReturn(p.review, { current: p.review.current, savedAt: p.savedAt });
      return { ...full(result.review), document: result.plan, documentSummary: summarizeOperatingPlan(result.plan),
        alreadyPresent: result.alreadyPresent, addedRevisions: result.addedRevisions,
        reviewedRevisions: result.reviewedRevisions };
    }
    case 'apply': {
      const result = returned.applyOperatingPlanReturn(p.review, { current: p.current });
      return { document: result.plan, documentSummary: summarizeOperatingPlan(result.plan),
        alreadyPresent: result.alreadyPresent, addedRevisions: result.addedRevisions,
        reviewedRevisions: result.reviewedRevisions };
    }
    case 'html': return { content: returned.renderOperatingPlanReturnHTML(p.review),
      filename: 'Operating_Plan_Return.html', contentType: 'text/html; charset=utf-8' };
    default: fail('Unknown original returned-plan operation.');
  }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2) fail('Usage: node directory_operating_return_bridge.mjs PRIVATE_INPUT PRIVATE_OUTPUT');
  const [input, output] = argv.map(x => resolve(x));
  if (input === output) fail('Preserve the complete original return input separately from its output.');
  let response;
  try { response = { ok: true, value: runDirectoryReturnBridge(await readPrivate(input)) }; }
  catch (error) { response = { ok: false, error: { code: error.code ?? 'DIRECTORY_RETURN_INVALID',
    message: String(error.message ?? error) } }; }
  const raw = Buffer.from(JSON.stringify(response) + '\n');
  if (raw.length > MAX_BRIDGE) fail('The complete original return response exceeds 512 MiB.');
  const out = await open(output, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await out.writeFile(raw); await out.sync(); } finally { await out.close(); }
  if (!response.ok) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(String(error.message ?? error) + '\n'); process.exitCode = 2; });
