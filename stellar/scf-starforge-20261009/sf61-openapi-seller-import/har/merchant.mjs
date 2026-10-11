// MIT. Join reviewed capture source to the ONE original SF61 merchant compiler/store.
import { openWorkspace, readRevision, readRegular } from './store.mjs';
import { buildDocument } from './model.mjs';
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
/** All plans, payments, backend transport and package files stay in the native implementation. */
export async function saveHarMerchant({ workspace: directory, revision, planFile, parent, name }) {
  const workspace = await openWorkspace(directory), saved = await readRevision(workspace, revision);
  const document = buildDocument(workspace.inventory, saved.review);
  document['x-starforge-har'].reviewSha256 = revision;
  const plan = json(await readRegular(planFile, 4 * 1024 * 1024));
  const reviewed = new Map();
  for (const [path, item] of Object.entries(document.paths)) for (const [method, op] of Object.entries(item)) reviewed.set(method.toUpperCase() + ' ' + path, op);
  if (!Array.isArray(plan.operations) || plan.operations.length !== reviewed.size) throw new Error('Merchant plan must select exactly the reviewed HAR operations');
  const seen = new Set();
  for (const row of plan.operations) {
    const key = String(row.method).toUpperCase() + ' ' + row.path, operation = reviewed.get(key);
    if (!operation || seen.has(key)) throw new Error('Merchant plan has a missing, additional or duplicated reviewed route');
    seen.add(key);
    const mapped = new Map(Object.entries(row.headerEnv || {}).map(([k, v]) => [k.toLowerCase(), v]));
    for (const binding of operation['x-har-observation'].backendBindings) {
      if (binding.in !== 'header' || mapped.get(binding.name.toLowerCase()) !== binding.reference)
        throw new Error(`${key}: preserve the reviewed ${binding.in}:${binding.name} -> ${binding.reference} backend reference in headerEnv`);
    }
  }
  const { savePackage } = await import('../workspace/model.mjs');
  return savePackage({ specText: JSON.stringify(document, null, 2) + '\n', plan, parent, name });
}
