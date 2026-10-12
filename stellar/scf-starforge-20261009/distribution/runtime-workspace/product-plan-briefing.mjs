// MIT. Readable product delivery from the existing saved plan and original catalog.
import { readFileSync } from 'node:fs';
import { productSourceSummary } from '../product-catalog/catalog.mjs';

export const PRODUCT_PLAN_BRIEFING_SCHEMA = 'stellar-forge.product-plan-briefing.v1';
export const PRODUCT_PLAN_BRIEFING_FORMATS = Object.freeze(['json', 'markdown', 'html']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const entries = value => Object.entries(plain(value) ? value : {}).sort(([a], [b]) => a.localeCompare(b, 'en'));
const text = value => value === undefined || value === null ? '' : String(value);
const need = (condition, message) => { if (!condition) throw new TypeError(message); };
const sourceDescriptor = value => value ? { path: value.path, gitBlob: value.gitBlob, bytes: value.bytes, sha256: value.sha256 } : null;
const packageState = value => value ? {
  phase: value.phase, stage: value.stage, reviewId: value.reviewId, requestId: value.requestId,
  sourceCommit: value.sourceCommit, archiveId: value.archiveId,
  archive: value.archive ? { file: value.archive.file, bytes: value.archive.bytes, sha256: value.archive.sha256 } : null,
  errorCode: value.error?.code ?? null,
} : null;

/** Project only the declared delivery fields from a locally opened, validated plan. */
export function productPlanBriefing(view, { generatedAt = new Date().toISOString() } = {}) {
  need(plain(view) && view.plan?.schema === 'stellar-forge.runtime-product-plan.v1',
    'Open a saved product plan before preparing its briefing.');
  const plan = view.plan, selected = list(view.origins).find(origin => origin.originId === view.bindingId && origin.local);
  need(selected && selected.workspaceId === view.workspaceId &&
    selected.review.reviewId === view.review?.reviewId && selected.review.requestId === view.buildRequest?.requestId &&
    selected.review.sourceCommit === plan.intent.sourceCommit && view.product?.sourceCommit === plan.intent.sourceCommit,
  'Use the saved plan’s original local source review.');
  need(typeof generatedAt === 'string' && !Number.isNaN(Date.parse(generatedAt)), 'Choose a valid briefing timestamp.');
  const product = productSourceSummary(view.product), inspection = view.product.runtimeRequirements ?? {};
  const declared = new Map(list(plan.catalogProduct.capabilityDeclarations).map(value => [value.id, value]));
  const available = new Set(list(plan.catalogProduct.requirements));
  const capabilities = list(plan.intent.requirements).map(id => {
    need(available.has(id), 'The selected product must cover every requested capability.');
    const record = declared.get(id), at = id.indexOf(':');
    return { id, kind: record?.kind ?? id.slice(0, at), name: record?.name ?? id.slice(at + 1),
      provision: record?.provision ?? 'registration',
      sources: list(record?.sources).map(source => ({ id: source.id, path: source.path, kind: source.kind })) };
  });
  const groups = [...new Set(['native', ...list(inspection.featureNames),
    ...Object.keys(inspection.featurePeers ?? {}), ...Object.keys(inspection.runtimePackageManifests ?? {}),
    ...Object.keys(inspection.dependencyLocks ?? {})])].sort((a, b) => a.localeCompare(b, 'en'));
  const dependencies = groups.flatMap(name => {
    const lock = inspection.dependencyLocks?.[name] ?? {};
    const peers = name === 'native' ? inspection.nativePeers ?? {} :
      inspection.resolvedManifestPeers?.[name] ?? inspection.featurePeers?.[name] ?? {};
    const declarations = entries(lock.declared ?? Object.fromEntries(entries(peers).map(([key, value]) => [key, value.version])))
      .map(([packageName, requested]) => ({ name: packageName, requested,
        probe: peers[packageName]?.probe ?? null, native: peers[packageName]?.native ?? null }));
    const errors = list(inspection.errors).filter(error => error.feature === name)
      .map(error => ({ code: error.code, path: error.path }));
    if (lock.error?.code) errors.push({ code: lock.error.code, path: lock.path ?? lock.source?.path ?? '' });
    if (!declarations.length && !inspection.runtimePackageManifests?.[name] && !errors.length) return [];
    const instances = list(lock.instances).map(value => ({ name: value.name, version: value.version,
      location: value.location, direct: value.direct === true, optional: value.optional === true,
      ...(value.linkTarget ? { linkTarget: value.linkTarget } : {}),
      ...(value.integrity ? { integrity: value.integrity } : {}),
      ...(Array.isArray(value.os) ? { os: [...value.os] } : {}),
      ...(Array.isArray(value.cpu) ? { cpu: [...value.cpu] } : {}) }));
    const edge = value => ({ from: value.from, name: value.name, requested: value.requested, kind: value.kind,
      ...(value.location ? { location: value.location } : {}), ...(value.reason ? { reason: value.reason } : {}) });
    return [{ name, status: lock.status ?? (errors.length ? 'unavailable' : 'declared'),
      manifestPath: inspection.runtimePackageManifests?.[name] ?? null,
      manifest: sourceDescriptor(inspection.manifests?.[name]), lock: sourceDescriptor(lock.source),
      lockfileVersion: lock.lockfileVersion ?? null, reason: lock.reason ?? null,
      declarations, instances, unresolved: list(lock.unresolved).map(edge),
      optionalOmissions: list(lock.optionalOmissions).map(edge), errors,
      counts: { declared: declarations.length, instances: instances.length,
        directInstances: instances.filter(value => value.direct).length,
        transitiveInstances: instances.filter(value => !value.direct).length } }];
  });
  const observations = list(view.observations).map(value => ({ originId: value.originId, observedAt: value.observedAt,
    build: packageState(value.build) }));
  const origins = list(view.origins).map(origin => ({ originId: origin.originId, local: origin.local === true,
    selected: origin.originId === view.bindingId, recordedAt: origin.createdAt,
    reviewId: origin.review.reviewId, requestId: origin.review.requestId,
    build: origin.local ? packageState(origin.currentBuild) : null }));
  return {
    schema: PRODUCT_PLAN_BRIEFING_SCHEMA, generatedAt,
    plan: { planId: plan.planId, label: plan.intent.label, purpose: plan.intent.purpose,
      createdAt: plan.createdAt, contentSha256: plan.contentSha256, sourceSha256: plan.sourceSha256 },
    product: { selection: plan.intent.selection, title: product.title, description: product.description,
      sourceCommit: product.sourceCommit, packageName: product.packageName, packageVersion: product.packageVersion,
      readme: product.readme, counts: { ...product.counts },
      commands: product.commands.map(value => ({ name: value.name, entry: value.entry })),
      exports: product.exports.map(value => ({ name: value.name, entry: value.entry })),
      applications: [...product.applications], merchantProviders: [...product.merchantProviders],
      components: [...product.components],
      contributions: product.contributions.map(value => ({ id: value.id, path: value.path })),
      sourceInputs: product.sourceInputs.map(sourceDescriptor) },
    capabilities, dependencies,
    review: { reviewId: view.review.reviewId, requestId: view.review.requestId,
      selectionSha256: view.review.selectionSha256, reviewedAt: view.review.reviewedAt,
      bindingId: view.bindingId, inspectedAt: selected.createdAt },
    build: packageState(selected.currentBuild), origins, observations,
  };
}
const md = value => text(value).replace(/[\\\x60*_[\]<>]/g, '\\$&').replace(/\|/g, '\\|').replace(/\r?\n/g, ' / ');
const html = value => text(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const display = value => plain(value) || Array.isArray(value) ? JSON.stringify(value) : text(value);
const pairs = values => values.map(([label, value]) => [label, display(value)]);
const status = value => ({ REVIEWED: 'Source reviewed', QUEUED: 'Build queued', RUNNING: 'Build running',
  SUCCEEDED: 'Build completed', FAILED: 'Build needs continuation' })[value] ?? text(value || 'Source reviewed');
const lockStatus = value => ({ resolved: 'Committed production lock resolved', declared: 'Declared package requirements',
  incomplete: 'Committed lock has unresolved edges', unsupported: 'Committed lock format needs review',
  mismatched: 'Manifest and committed lock differ', unavailable: 'Source inspection needs continuation' })[value] ?? text(value);
function documentSections(value) {
  need(value?.schema === PRODUCT_PLAN_BRIEFING_SCHEMA, 'Choose a product plan briefing.');
  const plan = value.plan, product = value.product, build = value.build;
  const sections = [
    { title: 'Purpose', paragraphs: [plan.purpose || product.description || product.title] },
    { title: 'Product and source', tables: [{ headers: ['Field', 'Value'], rows: pairs([
      ['Product', product.title], ['Recipe', product.selection],
      ['Package', product.packageName + ' ' + product.packageVersion], ['Source commit', product.sourceCommit],
      ['Plan', plan.planId], ['Saved', plan.createdAt], ['Source inspection', value.review.inspectedAt],
      ['Commands', product.counts.commands], ['Applications', product.counts.applications],
      ['Merchant providers', product.counts.merchantProviders], ['Package exports', product.counts.exports],
      ['Runtime feature groups', product.counts.features],
    ]) }] },
    { title: 'Required capabilities',
      paragraphs: [value.capabilities.length ?
        'The selected product covers all ' + value.capabilities.length + ' saved capability requirements.' :
        'The plan selects the complete product recipe. Its declared commands and applications are listed below.'],
      tables: value.capabilities.length ? [{ headers: ['Capability', 'Source declarations'], rows: value.capabilities.map(item =>
        [item.id, item.sources.map(source => source.id + ' — ' + source.path).join('; ') || 'Selected product declaration']) }] : [] },
    { title: 'Build and package', paragraphs: [status(build?.phase)],
      tables: [{ headers: ['Field', 'Value'], rows: pairs([
        ['Original review', value.review.reviewId], ['Original build request', value.review.requestId],
        ['Reviewed', value.review.reviewedAt], ['Source selection SHA-256', value.review.selectionSha256],
        ...(build?.stage ? [['Build stage', build.stage]] : []),
        ...(build?.archive ? [['Package file', build.archive.file], ['Package bytes', build.archive.bytes],
          ['Package SHA-256', build.archive.sha256]] : []),
        ...(build?.errorCode ? [['Continuation code', build.errorCode]] : []),
      ]) }] },
  ];
  const appendices = [];
  for (const group of value.dependencies) {
    const paragraphs = [lockStatus(group.status)];
    if (group.reason) paragraphs.push(group.reason);
    const tables = [];
    if (group.manifestPath) tables.push({ headers: ['Source', 'Committed path', 'SHA-256'], rows: [
      ['Manifest', group.manifestPath, group.manifest?.sha256 ?? ''],
      ...(group.lock ? [['Lock v' + group.lockfileVersion, group.lock.path, group.lock.sha256]] : []),
    ] });
    if (group.declarations.length) tables.push({ title: 'Declared requirements',
      headers: ['Package', 'Requested version', 'Committed direct versions', 'Probe'], rows: group.declarations.map(item =>
        [item.name, item.requested, [...new Set(group.instances.filter(instance => instance.direct &&
          (instance.name === item.name || instance.location === 'node_modules/' + item.name)).map(instance => instance.version))].join(', '), item.probe]) });
    if (group.instances.length) appendices.push({ title: 'Committed package instances: ' + group.name,
      appendix: true, paragraphs: [group.counts.directInstances + ' direct and ' + group.counts.transitiveInstances + ' transitive instances.'], tables: [{
      headers: ['Package', 'Version', 'Dependency role', 'Package location', 'Platform declarations'],
      rows: group.instances.map(item => [item.name, item.version,
        (item.direct ? 'Direct' : 'Transitive') + (item.optional ? ', optional' : ''), item.location,
        [...(item.os ?? []).map(os => 'os:' + os), ...(item.cpu ?? []).map(cpu => 'cpu:' + cpu)].join(', ')]) }] });
    if (group.unresolved.length) tables.push({ title: 'Unresolved committed edges',
      headers: ['From', 'Package', 'Requested version', 'Kind', 'Reason'],
      rows: group.unresolved.map(item => [item.from, item.name, item.requested, item.kind, item.reason ?? 'Package record absent']) });
    if (group.optionalOmissions.length) tables.push({ title: 'Optional edges omitted from the committed lock',
      headers: ['From', 'Package', 'Requested version', 'Kind'],
      rows: group.optionalOmissions.map(item => [item.from, item.name, item.requested, item.kind]) });
    if (group.errors.length) tables.push({ title: 'Source inspection continuation',
      headers: ['Code', 'Committed source'], rows: group.errors.map(item => [item.code, item.path]) });
    sections.push({ title: 'Runtime dependencies: ' + group.name, paragraphs, tables });
  }
  if (product.commands.length) appendices.push({ title: 'Product commands (' + product.commands.length + ')', appendix: true, tables: [
    { headers: ['Command', 'Source entry'], rows: product.commands.map(item => [item.name, item.entry]) },
  ] });
  if (product.applications.length || product.merchantProviders.length) appendices.push({ title: 'Applications and providers', appendix: true, tables: [
    { headers: ['Kind', 'Name'], rows: [...product.applications.map(name => ['Application', name]),
      ...product.merchantProviders.map(name => ['Merchant provider', name])] },
  ] });
  if (product.exports.length) appendices.push({ title: 'Package exports (' + product.exports.length + ')', appendix: true, tables: [
    { headers: ['Export', 'Source entry'], rows: product.exports.map(item => [item.name, display(item.entry)]) },
  ] });
  if (value.origins.length) appendices.push({ title: 'Plan and build history (' + value.origins.length + ' origins)', appendix: true, paragraphs: [
    'The complete transfer document retains these source reviews and the original build observations.',
  ], tables: [
    { headers: ['Origin', 'Relationship', 'Recorded', 'Original request', 'Current build'],
      rows: value.origins.map(origin => [origin.originId,
        origin.selected ? 'Opened local review' : origin.local ? 'Local review' : 'Received origin',
        origin.recordedAt, origin.requestId, origin.build ? status(origin.build.phase) : '']) },
    ...(value.observations.length ? [{ headers: ['Origin', 'Observed', 'Original request', 'Build state', 'Package SHA-256'],
      rows: value.observations.map(item => [item.originId, item.observedAt, item.build?.requestId,
        status(item.build?.phase), item.build?.archive?.sha256 ?? '']) }] : []),
  ] });
  appendices.push({ title: 'Source declarations', appendix: true, tables: [
    { headers: ['Source', 'Committed path'], rows: product.contributions.map(item => [item.id, item.path]) },
    { headers: ['Committed input', 'Git object', 'Bytes', 'SHA-256'], rows: product.sourceInputs.map(item =>
      [item.path, item.gitBlob, item.bytes, item.sha256]) },
  ], paragraphs: [
    'Plan content SHA-256: ' + plan.contentSha256,
    'Product source SHA-256: ' + plan.sourceSha256,
  ] });
  return [...sections, ...appendices];
}
export function formatProductPlanBriefingMarkdown(value) {
  const lines = ['# ' + md(value.plan?.label), '', 'Product briefing · ' + md(value.generatedAt), ''];
  for (const section of documentSections(value)) {
    lines.push('## ' + (section.appendix ? 'Appendix: ' : '') + md(section.title), '');
    for (const paragraph of section.paragraphs ?? []) lines.push(md(paragraph), '');
    for (const table of section.tables ?? []) {
      if (!table.rows.length) continue;
      if (table.title) lines.push('### ' + md(table.title), '');
      lines.push('| ' + table.headers.map(md).join(' | ') + ' |',
        '| ' + table.headers.map(() => '---').join(' | ') + ' |',
        ...table.rows.map(row => '| ' + row.map(md).join(' | ') + ' |'), '');
    }
  }
  return lines.join('\n');
}
export function formatProductPlanBriefingHTML(value) {
  const sections = documentSections(value);
  const parts = sections.map(section => (section.appendix ? '<details><summary>' + html(section.title) + '</summary>' : '') +
    '<section>' + (section.appendix ? '' : '<h2>' + html(section.title) + '</h2>') +
    (section.paragraphs ?? []).map(paragraph => '<p>' + html(paragraph) + '</p>').join('') +
    (section.tables ?? []).filter(table => table.rows.length).map(table =>
      (table.title ? '<h3>' + html(table.title) + '</h3>' : '') +
      '<div class="table"><table><thead><tr>' + table.headers.map(header => '<th scope="col">' + html(header) + '</th>').join('') +
      '</tr></thead><tbody>' + table.rows.map(row => '<tr>' + row.map(cell => '<td>' + html(cell) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>').join('') + '</section>' + (section.appendix ? '</details>' : '')).join('');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>' + html(value.plan.label) + ' — Product briefing</title>' +
    '<style>' + readFileSync(new URL('./public/product-plan-briefing.css', import.meta.url), 'utf8') +
    '</style></head><body><main class="product-briefing"><header><p class="eyebrow">Stellar Forge · Product briefing</p><h1>' + html(value.plan.label) +
    '</h1><p class="meta">Prepared ' + html(value.generatedAt) + ' · Plan ' + html(value.plan.planId) +
    '</p></header>' + parts + '</main></body></html>\n';
}
export function exportProductPlanBriefing(view, { format = 'markdown', generatedAt } = {}) {
  need(PRODUCT_PLAN_BRIEFING_FORMATS.includes(format), 'Choose json, markdown or html for the product briefing.');
  const briefing = productPlanBriefing(view, { ...(generatedAt === undefined ? {} : { generatedAt }) });
  const content = format === 'json' ? JSON.stringify(briefing, null, 2) + '\n' :
    format === 'html' ? formatProductPlanBriefingHTML(briefing) : formatProductPlanBriefingMarkdown(briefing);
  return { schema: PRODUCT_PLAN_BRIEFING_SCHEMA, planId: briefing.plan.planId, bindingId: briefing.review.bindingId,
    sourceCommit: briefing.product.sourceCommit, generatedAt: briefing.generatedAt, format,
    filename: 'product-plan-' + briefing.plan.planId + '-briefing.' + (format === 'markdown' ? 'md' : format),
    mimeType: format === 'html' ? 'text/html; charset=utf-8' :
      format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
    content };
}
