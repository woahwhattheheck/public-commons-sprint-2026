// MIT. Metadata for the original saved 360Giving publisher and complete retained files.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const key = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,79}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };
const workspace = { workspace: alias }, request = { ...workspace, requestId: key };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: sha };
const read = { readOnly: true, idempotent: true }, change = { idempotent: true };
export function publisher360GivingTools(tool) {
  return [
    tool('merchant_360giving_workspaces', 'List configured saved publisher workspaces and their declared complete source-file handles.', {}, [], read),
    tool('merchant_360giving_status', 'Read the original publisher identity, saved edition/review/candidate/request counts and native connection state.', workspace, ['workspace'], read),
    tool('merchant_360giving_inventory', 'Page every saved dataset, edition, decision, candidate or request, or every native build/comparison for one dataset. Continue the returned snapshot.', {
      ...workspace, kind: { type: 'string', enum: ['datasets','editions','decisions','candidates','requests','native-builds','native-comparisons'] },
      dataset: key, ...page }, ['workspace','kind'], read),
    tool('merchant_360giving_review', 'Read the complete original publisher review and selected named decision. Original JSON number tokens remain exact decimal strings.', {
      ...workspace, edition: sha, decision: sha }, ['workspace','edition'], read),
    tool('merchant_360giving_upload', 'Stream one host-declared complete package, registry, capture, transport, named decision or handoff into the original content-addressed store.', {
      ...workspace, file: alias }, ['workspace','file'], change),
    tool('merchant_360giving_upload_text', 'Upload a small complete UTF-8 source or decision document without changing its original JSON number tokens. Larger inputs use declared file handles.', {
      ...workspace, text: { type: 'string', minLength: 1, maxLength: 131072 } }, ['workspace','text'], change),
    tool('merchant_360giving_intake', 'Admit one original source package with its complete registry and optional capture/transport object IDs. Retain this request ID and read its status to completion.', {
      ...request, dataset: key, label: { type: 'string', minLength: 1, maxLength: 160 },
      sourceUrl: { type: 'string', minLength: 1, maxLength: 4096 }, source: sha, registry: sha, capture: sha, transport: sha
    }, ['workspace','requestId','dataset','label','sourceUrl','source','registry'], change),
    tool('merchant_360giving_decisions', 'Admit the exact uploaded named-review document for its original source edition.', {
      ...request, edition: sha, object: sha }, ['workspace','requestId','edition','object'], change),
    tool('merchant_360giving_candidate', 'Build a publisher candidate from its original edition and exact named decision.', {
      ...request, edition: sha, decision: sha }, ['workspace','requestId','edition','decision'], change),
    tool('merchant_360giving_build', 'Admit a complete native 26-column grant dataset from the original source edition or its selected candidate.', {
      ...request, edition: sha, candidate: sha }, ['workspace','requestId','edition'], change),
    tool('merchant_360giving_query', 'Query a saved native grant build with original scalar-string parameters. Follow every body.page.nextCursor to receive all rows.', {
      ...workspace, dataset: key, build: sha, query: { type: 'object', additionalProperties: { type: 'string' } }
    }, ['workspace','dataset','build'], read),
    tool('merchant_360giving_compare', 'Admit the original keyed comparison of two complete native builds from the same dataset.', {
      ...request, dataset: key, before: sha, after: sha }, ['workspace','requestId','dataset','before','after'], change),
    tool('merchant_360giving_changes', 'Page original field changes; use changes_export for the complete NDJSON file.', {
      ...workspace, dataset: key, comparison: sha, offset: page.offset, limit: page.limit
    }, ['workspace','dataset','comparison'], read),
    tool('merchant_360giving_request', 'Read the exact original accepted request and complete native result. Repeat export with the same request ID to retain its full-file delivery.', request, ['workspace','requestId'], read),
    tool('merchant_360giving_resume', 'Explicitly resume the same saved interrupted request with its original input and publisher program.', request, ['workspace','requestId'], change),
    tool('merchant_360giving_export', 'Admit a complete original publisher handoff with source, reviews, candidate, native packages and portable source. On completion retain its exact file and manifest.', {
      ...request, edition: sha, decision: sha, candidate: sha }, ['workspace','requestId','edition'], change),
    tool('merchant_360giving_changes_export', 'Retain the complete original comparison NDJSON and source-bound manifest for resumable customer delivery.', {
      ...workspace, dataset: key, comparison: sha }, ['workspace','dataset','comparison'], change),
    tool('merchant_360giving_exports', 'Page every retained complete publisher delivery for the configured alias, including deliveries completed before a restart.', {
      ...workspace, ...page }, ['workspace'], read),
    tool('merchant_360giving_manifest', 'Inspect the exact retained delivery manifest and file identities. Complete files remain readable with the publisher stopped.', {
      ...workspace, exportId: sha }, ['workspace','exportId'], read),
    tool('merchant_360giving_file', 'Read the original complete file or manifest using verified base64 chunks. Preserve its export, manifest hash, file hash, read ID and next offset.', {
      ...workspace, exportId: sha, file: { type: 'string', enum: ['360giving-manifest.json','360giving-complete-handoff.zip','360giving-complete-changes.jsonl'] },
      expectedManifestSha256: sha, expectedSha256: sha, readId: uuid, offset: page.offset,
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES }
    }, ['workspace','exportId','file','expectedManifestSha256','expectedSha256'], read),
    tool('merchant_360giving_file_release', 'Release the original temporary read handle while retaining the complete publisher delivery.', {
      ...workspace, exportId: sha, readId: uuid }, ['workspace','exportId','readId'], change),
    tool('merchant_360giving_receive', 'Receive a complete original publisher handoff into the selected saved workspace. Choose one declared handoff file or an exact retained export from a configured workspace.', {
      ...request, file: alias, exportId: sha, fromWorkspace: alias }, ['workspace','requestId'], change)
  ];
}
