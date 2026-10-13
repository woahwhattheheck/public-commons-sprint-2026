// MIT. Native semantic profile and catalogue commands for the original DCAT owner.
import { resolve, dirname, basename } from 'node:path';
import { digest, fault } from '../postgres/publisher/files.mjs';

import { sourceBytes, exportRetained } from './dcat-semantic-files.mjs';
import { comparisonCliOptions, comparisonCliUsage, executeDcatSemanticComparisonCommand } from './dcat-semantic-comparison-cli.mjs';

export const semanticCliOptions = {
  ...comparisonCliOptions,
  'semantic-profile-import': ['workspace', 'input'],
  'semantic-profile': ['workspace', 'profile'],
  'semantic-run': ['workspace', 'profile', 'profile-sha256', 'catalog', 'review', 'source-sha256', 'timeout-seconds', 'memory-mib'],
  'semantic-inspect': ['workspace', 'run'],
  'semantic-findings': ['workspace', 'run', 'offset', 'limit', 'severity', 'search'],
  'semantic-review': ['workspace', 'run', 'run-sha256', 'expected-review', 'decision', 'note'],
  'semantic-export': ['workspace', 'kind', 'id', 'key', 'out'],
};
export const semanticCliUsage = [
  ...comparisonCliUsage,
  '  dcat semantic-profile-import --workspace DIR --input PROFILE.json',
  '  dcat semantic-profile --workspace DIR --profile ID',
  '  dcat semantic-run --workspace DIR --profile ID --profile-sha256 HASH --catalog ID --source-sha256 HASH',
  '  dcat semantic-run --workspace DIR --profile ID --profile-sha256 HASH --review ID --source-sha256 HASH',
  '  dcat semantic-inspect --workspace DIR --run ID',
  '  dcat semantic-findings --workspace DIR --run ID [--offset 0 --limit 100 --severity http://www.w3.org/ns/shacl#Violation --search TEXT]',
  '  dcat semantic-review --workspace DIR --run ID --run-sha256 HASH --expected-review none|HASH --decision ACCEPT|CHANGES_REQUIRED|ACKNOWLEDGE --note TEXT',
  '  dcat semantic-export --workspace DIR --kind profile|profile-file|run|review|artifact --id ID [--key KEY] --out FILE',
  'Profile source uses explicit baseIRI/contextMode and local context/shapes/ontology/audit file paths. See SEMANTIC_CATALOGS.md.',
];
function requireValue(options, name) {
  if (!options[name]) throw fault('DCAT_COMMAND_ARGUMENTS', 'Supply --' + name + '.');
  return options[name];
}
function integer(value, field) {
  const number = Number(value);
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(number))
    throw fault('DCAT_COMMAND_ARGUMENTS', 'Use a nonnegative integer for --' + field + '.');
  return number;
}
async function profileInput(path) {
  const raw = await sourceBytes(path, 1048576);
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('DCAT_SEMANTIC_PROFILE_INPUT_INVALID', 'Use a complete UTF-8 profile specification.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw fault('DCAT_SEMANTIC_PROFILE_INPUT_INVALID');
  const allowed = ['label', 'baseIRI', 'contextMode', 'context', 'shapes', 'ontologies', 'attachments',
    'coverageClasses', 'parameters', 'supersedesProfileId'];
  if (Object.keys(input).some(key => !allowed.includes(key)))
    throw fault('DCAT_SEMANTIC_PROFILE_INPUT_INVALID', 'Use the declared profile fields.');
  let total = 0, count = 0;
  async function file(item, kind) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.file !== 'string' || !item.file ||
        Object.keys(item).some(key => !['file', 'name', 'format', 'mediaType', 'bytes', 'sha256'].includes(key)))
      throw fault('DCAT_SEMANTIC_PROFILE_INPUT_INVALID', 'Select complete local profile file descriptors.');
    if (++count > 64) throw fault('DCAT_SEMANTIC_PROFILE_INPUT_INVALID', 'Select at most 64 files.');
    const selected = resolve(dirname(path), item.file), content = await sourceBytes(selected, 67108864);
    total += content.length;
    if (total > 134217728) throw fault('DCAT_SEMANTIC_PROFILE_INPUT_INVALID', 'The complete profile exceeds 128 MiB.');
    const sha256 = digest(content);
    if ((item.bytes !== undefined && item.bytes !== content.length) ||
        (item.sha256 !== undefined && item.sha256 !== sha256))
      throw fault('DCAT_SEMANTIC_PROFILE_INPUT_CHANGED', 'A selected profile file differs from its supplied identity.');
    return { name: item.name ?? basename(selected), contentBase64: content.toString('base64'),
      bytes: content.length, sha256,
      ...(['shapes', 'ontologies'].includes(kind) ? { format: item.format } : {}),
      ...(kind === 'attachments' && item.mediaType ? { mediaType: item.mediaType } : {}) };
  }
  const result = { ...input, context: await file(input.context, 'context') };
  for (const key of ['shapes', 'ontologies', 'attachments']) {
    const selected = input[key] ?? [];
    if (!Array.isArray(selected)) throw fault('DCAT_SEMANTIC_PROFILE_INPUT_INVALID');
    result[key] = [];
    for (const item of selected) result[key].push(await file(item, key));
  }
  return result;
}
export async function executeDcatSemanticCommand(project, command, options) {
  if (Object.hasOwn(comparisonCliOptions, command)) return executeDcatSemanticComparisonCommand(project, command, options);
  const required = name => requireValue(options, name);
  if (command === 'semantic-profile-import')
    return project.importDcatSemanticProfile(await profileInput(resolve(required('input'))));
  if (command === 'semantic-profile') return project.dcatSemanticProfile(required('profile'));
  if (command === 'semantic-run') {
    if (Boolean(options.catalog) === Boolean(options.review))
      throw fault('DCAT_COMMAND_ARGUMENTS', 'Select exactly one --catalog or --review candidate.');
    const limits = {};
    for (const [flag, key] of [['timeout-seconds', 'timeout_seconds'], ['memory-mib', 'memory_mib']])
      if (options[flag] !== undefined) limits[key] = integer(options[flag], flag);
    return project.startDcatSemanticRun({ profileId: required('profile'),
      expectedProfileSha256: required('profile-sha256'), expectedSourceSha256: required('source-sha256'),
      ...(options.catalog ? { catalogId: options.catalog } : { reviewId: options.review }),
      ...(Object.keys(limits).length ? { limits } : {}) });
  }
  if (command === 'semantic-inspect') return project.dcatSemanticRun(required('run'));
  if (command === 'semantic-findings') return project.dcatSemanticFindings({
    runId: required('run'), offset: integer(options.offset ?? '0', 'offset'),
    limit: integer(options.limit ?? '100', 'limit'),
    ...(options.severity ? { severity: options.severity } : {}),
    ...(options.search ? { search: options.search } : {}),
  });
  if (command === 'semantic-review') return project.reviewDcatSemanticRun({
    runId: required('run'), expectedRunSha256: required('run-sha256'),
    expectedReviewSha256: required('expected-review') === 'none' ? null : options['expected-review'],
    decision: required('decision'), note: required('note'),
  });
  if (command === 'semantic-export') {
    const selected = await project.dcatSemanticDownload({ kind: required('kind'), id: required('id'),
      ...(options.key ? { key: options.key } : {}) });
    const out = resolve(required('out')); await exportRetained(selected, out);
    return { kind: options.kind, id: options.id, ...(options.key ? { key: options.key } : {}),
      out, bytes: selected.bytes, sha256: selected.sha256 };
  }
  throw fault('DCAT_COMMAND_UNKNOWN', 'Choose an installed semantic command.');
}
