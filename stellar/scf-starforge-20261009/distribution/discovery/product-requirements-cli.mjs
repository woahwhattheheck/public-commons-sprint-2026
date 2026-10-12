// MIT. Capability plans and direct native build-review request files.
import { resolve } from 'node:path';
import { exportRequirementPlan, productReviewRequest } from './product-requirements.mjs';
import { loadProductRequirements } from './product-requirements-source.mjs';
import { saveExport } from './write-json.mjs';

export const REQUIREMENT_ACTIONS = Object.freeze(['requirements', 'review-request']);
const HELP = [
  'Stellar Forge capability requirements', '',
  '  starforge discover requirements --repository /absolute/git-repository',
  '      --require KIND:NAME [--require KIND:NAME ...]',
  '      [--match all|any] [--sort source|coverage|runtime-groups|commands] [--json] [--out NEW_FILE]',
  '  starforge discover review-request PRODUCT_ID --repository /absolute/git-repository',
  '      [--require KIND:NAME ...] [--python python3] [--out NEW_FILE] [--workspace /absolute/runtime-workspace]', '',
  'Source options: --ref COMMIT_OR_REF and --online. The original Git reader uses local objects by default.',
  'Requirement kinds: command, application, merchant, export, feature, source.',
  'Omit --require to list the exact capabilities available in this committed source.',
  'Requirements output includes every matching original product. Output files are created exclusively.',
  'A review-request file goes directly to runtime-workspace source-build-review.',
  'The original product-catalog command and Build a product screen provide product search and comparison.', '',
].join('\n');

export function parseRequirementArguments(args) {
  args = [...args];
  const action = args.shift();
  if (!REQUIREMENT_ACTIONS.includes(action)) throw new TypeError('Unknown requirement action: ' + action);
  if (args.some(value => value === '--help' || value === '-h')) return { action: 'help' };
  const allowed = new Set(['--repository', '--ref', '--online', '--out', '--require',
    ...(action === 'requirements' ? ['--match', '--sort', '--json'] : ['--python', '--workspace'])]);
  const options = { requirements: [], offline: true }, words = [], seen = new Set();
  let literal = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!literal && flag === '--') { literal = true; continue; }
    if (literal || !flag.startsWith('--')) { words.push(flag); continue; }
    if (!allowed.has(flag) || seen.has(flag) && flag !== '--require') throw new TypeError('Unknown or repeated option: ' + flag);
    seen.add(flag);
    if (flag === '--online') { options.offline = false; continue; }
    if (flag === '--json') { options.json = true; continue; }
    if (args[index + 1] === undefined || args[index + 1].startsWith('--')) throw new TypeError('Missing value for ' + flag);
    const value = args[++index];
    if (flag === '--require') options.requirements.push(value);
    else options[flag.slice(2)] = value;
  }
  if (action === 'review-request' ? words.length !== 1 : words.length > 0)
    throw new TypeError(action === 'review-request' ? 'Choose one original product ID.' : 'Choose capabilities with --require.');
  if (!options.repository) throw new TypeError('Choose the existing Git source with --repository.');
  if (options.workspace && (!options.workspace.startsWith('/') || /[\u0000-\u001f\u007f]/.test(options.workspace)))
    throw new TypeError('Select the absolute original runtime workspace path.');
  return { action, options, id: words[0] };
}
export async function mainRequirements(args) {
  const { action, options = {}, id } = parseRequirementArguments(args);
  if (action === 'help') { console.log(HELP); return; }
  const catalog = await loadProductRequirements(options);
  const result = action === 'review-request' ? productReviewRequest(catalog, id, options) :
    options.requirements.length ? exportRequirementPlan(catalog, options) :
      { sourceCommit: catalog.sourceCommit, repository: catalog.repository, capabilities: catalog.capabilities };
  if (options.out) {
    await saveExport(options.out, result);
    const filename = resolve(options.out);
    console.log(JSON.stringify({ file: filename, sourceCommit: catalog.sourceCommit,
      ...(action === 'review-request' && options.workspace ? {
        nextArgv: ['starforge', 'runtime-workspace', 'source-build-review',
          '--workspace', options.workspace, '--request', filename],
      } : {}) }));
  } else if (action === 'requirements' && !options.json && result.products) {
    const lines = [result.total + ' matching products · ' + catalog.sourceCommit, ''];
    for (const product of result.products) lines.push(product.id + ' — ' + product.title,
      '  ' + product.description,
      '  Covers ' + product.requirementMatch.covered.length + '/' + result.requirements.length +
        (product.requirementMatch.missing.length ? '; missing: ' + product.requirementMatch.missing.join(', ') : ''),
      '  ' + product.capabilityCounts.commands + ' commands · ' + product.capabilityCounts.runtimeGroups + ' optional runtime groups', '');
    for (const product of result.unread) lines.push(product.title + ': ' + product.error.message);
    console.log(lines.join('\n'));
  } else console.log(JSON.stringify(result, null, 2));
  return result;
}
