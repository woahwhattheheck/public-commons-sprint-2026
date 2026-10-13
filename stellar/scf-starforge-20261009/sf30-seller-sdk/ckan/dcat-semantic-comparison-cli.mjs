// MIT. Exact saved-pair semantic comparison through the original catalogue owner.
import { resolve } from 'node:path';
import { fault } from '../postgres/publisher/files.mjs';
import { sourceBytes, exportRetained } from './dcat-semantic-files.mjs';

export const comparisonCliOptions = {
  'semantic-compare': ['workspace', 'before', 'before-sha256', 'after', 'after-sha256',
    'predicates', 'depth', 'node-limit', 'timeout-seconds', 'memory-mib', 'retry-of'],
  'semantic-comparison': ['workspace', 'comparison'],
  'semantic-comparison-rows': ['workspace', 'comparison', 'section', 'offset', 'limit', 'search', 'change', 'snapshot'],
  'semantic-comparison-review': ['workspace', 'comparison', 'comparison-sha256', 'expected-review', 'decision', 'note'],
  'semantic-comparison-export': ['workspace', 'kind', 'id', 'key', 'out'],
};
export const comparisonCliUsage = [
  '  dcat semantic-compare --workspace DIR --before RUN --before-sha256 HASH --after RUN --after-sha256 HASH [--predicates IRIS.json --depth 2 --node-limit 100000]',
  '  dcat semantic-comparison --workspace DIR --comparison ID',
  '  dcat semantic-comparison-rows --workspace DIR --comparison ID --section changes|nodes|relationships [--offset 0 --limit 100 --search TEXT --change added|removed --snapshot before|after]',
  '  dcat semantic-comparison-review --workspace DIR --comparison ID --comparison-sha256 HASH --expected-review none|HASH --decision ACCEPT|CHANGES_REQUIRED|ACKNOWLEDGE --note TEXT',
  '  dcat semantic-comparison-export --workspace DIR --kind comparison|review|artifact --id ID [--key KEY] --out FILE',
  'Comparison pins ordered saved native snapshots and original provenance. See SEMANTIC_COMPARISONS.md.',
];
function integer(value, name) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw fault('DCAT_COMMAND_ARGUMENTS', 'Use a nonnegative integer for --' + name + '.');
  return Number(value);
}
export async function executeDcatSemanticComparisonCommand(project, command, options) {
  const required = name => {
    if (!options[name]) throw fault('DCAT_COMMAND_ARGUMENTS', 'Supply --' + name + '.');
    return options[name];
  };
  if (command === 'semantic-compare') {
    let predicates = [];
    if (options.predicates) {
      try { predicates = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await sourceBytes(resolve(options.predicates), 1048576))); }
      catch (error) { throw fault('DCAT_COMMAND_ARGUMENTS', 'Read a complete UTF-8 JSON array of predicate IRIs: ' + error.message); }
      if (!Array.isArray(predicates) || predicates.some(value => typeof value !== 'string'))
        throw fault('DCAT_COMMAND_ARGUMENTS', 'Use a JSON array of absolute predicate IRI strings.');
    }
    const limits = {};
    for (const [flag, key] of [['timeout-seconds', 'timeout_seconds'], ['memory-mib', 'memory_mib']])
      if (options[flag] !== undefined) limits[key] = integer(options[flag], flag);
    return project.startDcatSemanticComparison({
      beforeRunId: required('before'), expectedBeforeRunSha256: required('before-sha256'),
      afterRunId: required('after'), expectedAfterRunSha256: required('after-sha256'),
      parameters: { edge_predicates: predicates, depth: integer(options.depth ?? '2', 'depth'),
        node_limit: integer(options['node-limit'] ?? '100000', 'node-limit') },
      ...(Object.keys(limits).length ? { limits } : {}), ...(options['retry-of'] ? { retryOf: options['retry-of'] } : {}),
    });
  }
  if (command === 'semantic-comparison') return project.dcatSemanticComparison(required('comparison'));
  if (command === 'semantic-comparison-rows') return project.dcatSemanticComparisonRows({
    comparisonId: required('comparison'), section: required('section'),
    offset: integer(options.offset ?? '0', 'offset'), limit: integer(options.limit ?? '100', 'limit'),
    ...(options.search ? { search: options.search } : {}), ...(options.change ? { change: options.change } : {}),
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
  });
  if (command === 'semantic-comparison-review') return project.reviewDcatSemanticComparison({
    comparisonId: required('comparison'), expectedComparisonSha256: required('comparison-sha256'),
    expectedReviewSha256: required('expected-review') === 'none' ? null : options['expected-review'],
    decision: required('decision'), note: required('note'),
  });
  if (command === 'semantic-comparison-export') {
    const selected = await project.dcatSemanticComparisonDownload({
      kind: required('kind'), id: required('id'), ...(options.key ? { key: options.key } : {}),
    });
    const out = resolve(required('out')); await exportRetained(selected, out);
    return { kind: options.kind, id: options.id, ...(options.key ? { key: options.key } : {}),
      out, bytes: selected.bytes, sha256: selected.sha256 };
  }
  throw fault('DCAT_COMMAND_UNKNOWN', 'Choose an installed semantic comparison command.');
}
