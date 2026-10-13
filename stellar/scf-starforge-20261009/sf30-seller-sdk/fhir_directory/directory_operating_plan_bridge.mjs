// MIT. File-only adapter to the unchanged original OperatingPlan and catalog.
import { open, lstat, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as model from '../../distribution/discovery/operating-plan.mjs';
import { loadCommandCatalog } from '../../distribution/discovery/load.mjs';
import { createDirectoryOperatingPlan } from './directory_operating_plan.mjs';

const MAX_DOCUMENT = 32 * 1024 * 1024;
const MAX_BRIDGE = 128 * 1024 * 1024;
const nativeRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fail = (message, code = 'DIRECTORY_PLAN_INVALID') => {
  const error = new TypeError(message); error.code = code; throw error;
};
async function privateJSON(path, maximum) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) || st.size > maximum)
    fail('Read a complete private regular JSON file within its declared byte limit.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || (actual.mode & 0o077) || actual.size !== st.size)
      fail('The selected private JSON file changed before reading.');
    const bytes = await handle.readFile();
    if (bytes.length !== st.size || bytes.length > maximum)
      fail('The complete private JSON file changed while reading.');
    return JSON.parse(bytes.toString('utf8'));
  } finally { await handle.close(); }
}
function checkDocument(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_DOCUMENT)
    fail('The complete OperatingPlan exceeds 32 MiB.');
  return model.inspectOperatingPlan(value);
}
function withSummary(document, extra = {}) {
  return { document, summary: model.summarizeOperatingPlan(document), ...extra };
}
export async function runDirectoryOperatingBridge(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request))
    fail('Choose a complete original model request.');
  const p = request.payload ?? {};
  const getCatalog = () => loadCommandCatalog({ sourceRoot: nativeRoot,
    // Source checkouts select the same complete product. Installed catalog
    // loading still enforces the original manifest's source selection.
    selection: 'human-services-directory' });
  switch (request.action) {
    case 'catalog': return await getCatalog();
    case 'create': {
      const catalog = await getCatalog();
      return withSummary(checkDocument(createDirectoryOperatingPlan({
        catalog, input: p.input, basis: p.basis })), { catalog });
    }
    case 'step': {
      const { itemId, ...input } = p;
      const selection = itemId ? model.snapshotRegistration(await getCatalog(), itemId) : null;
      return model.createOperatingStep({ ...input, selection });
    }
    case 'inspect': return withSummary(checkDocument(p.document));
    case 'draft': return model.operatingPlanDraft(checkDocument(p.document), p.revision);
    case 'save': return withSummary(checkDocument(model.saveOperatingPlanRevision(
      checkDocument(p.document), p.draft, { savedAt: p.savedAt })));
    case 'receive': {
      const value = model.receiveOperatingPlan(checkDocument(p.incoming),
        p.existing == null ? null : checkDocument(p.existing));
      return withSummary(checkDocument(value.plan),
        { reused: value.reused, addedRevisions: value.addedRevisions });
    }
    case 'copy': return withSummary(checkDocument(model.forkOperatingPlan(
      checkDocument(p.document), { id: p.id, savedAt: p.savedAt,
        ...(p.title === undefined ? {} : { title: p.title }) })));
    case 'compare': return model.compareOperatingPlan(checkDocument(p.document),
      await getCatalog(), { revision: p.revision });
    case 'export': {
      const document = checkDocument(p.document);
      if (p.revision !== undefined) model.operatingPlanRevision(document, p.revision);
      if (p.format === 'json') return { content: JSON.stringify(document, null, 2) + '\n',
        extension: 'json', contentType: 'application/json', summary: model.summarizeOperatingPlan(document) };
      if (p.format === 'markdown') return { content: model.renderOperatingPlanMarkdown(document, { revision: p.revision }),
        extension: 'md', contentType: 'text/markdown; charset=utf-8',
        summary: model.summarizeOperatingPlan(document, { revision: p.revision }) };
      if (p.format === 'html') return { content: model.renderOperatingPlanHTML(document, { revision: p.revision }),
        extension: 'html', contentType: 'text/html; charset=utf-8',
        summary: model.summarizeOperatingPlan(document, { revision: p.revision }) };
      fail('Choose JSON, Markdown or HTML for the complete procedure.');
      break;
    }
    case 'verify-files': {
      if (!Array.isArray(p.records) || p.records.length > 100000)
        fail('Keep the complete bounded original plan record inventory.');
      const checked = [];
      for (const item of p.records) {
        const document = checkDocument(await privateJSON(item.document, MAX_DOCUMENT));
        if (document.id !== item.planId || document.revisions.length !== item.revision)
          fail('The retained plan metadata differs from its complete original history.');
        if (item.predecessorDocument) {
          const prior = checkDocument(await privateJSON(item.predecessorDocument, MAX_DOCUMENT));
          const joined = model.receiveOperatingPlan(document, prior);
          if (joined.plan.revisions.length !== document.revisions.length ||
              document.revisions.length < prior.revisions.length)
            fail('The saved plan does not extend its original predecessor history.');
        }
        if (item.preparedDocument) {
          const prepared = checkDocument(await privateJSON(item.preparedDocument, MAX_DOCUMENT));
          const joined = model.receiveOperatingPlan(document, prepared);
          if (joined.addedRevisions !== 0 ||
              JSON.stringify(document) !== JSON.stringify(prepared))
            fail('An accepted preview must retain its complete original document unchanged.');
        }
        if (item.originDocument) {
          const original = checkDocument(await privateJSON(item.originDocument, MAX_DOCUMENT));
          if (!document.origin || document.origin.id !== original.id ||
              document.origin.createdAt !== original.createdAt ||
              document.origin.revision !== original.revisions.length)
            fail('The copied procedure lost its selected original history.');
          for (let i = 0; i < original.revisions.length; i++)
            if (JSON.stringify(document.revisions[i]) !== JSON.stringify(original.revisions[i]))
              fail('A copied procedure changed an original saved revision.');
        }
        const summary = model.summarizeOperatingPlan(document);
        if (!isDeepStrictEqual(summary, item.summary))
          fail('The retained procedure summary differs from its complete original model history.');
        checked.push({ recordId: item.id, ...summary });
      }
      return { checked, count: checked.length };
    }
    default: fail('Unknown original OperatingPlan bridge action.');
  }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2) fail('Usage: node directory_operating_plan_bridge.mjs PRIVATE_REQUEST PRIVATE_RESULT');
  const [input, output] = argv.map(p => resolve(p));
  if (input === output) fail('The original request and output require separate private files.');
  let result;
  try { result = { ok: true, value: await runDirectoryOperatingBridge(await privateJSON(input, MAX_BRIDGE)) }; }
  catch (error) { result = { ok: false, error: { code: error.code ?? 'DIRECTORY_PLAN_INVALID', message: String(error.message ?? error) } }; }
  const bytes = Buffer.from(JSON.stringify(result) + '\n');
  if (bytes.length > MAX_BRIDGE) fail('The complete native model response exceeds 128 MiB.');
  const out = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await out.writeFile(bytes); await out.sync(); } finally { await out.close(); }
  if (!result.ok) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(String(error.message ?? error) + '\n'); process.exitCode = 2; });
