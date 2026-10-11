// MIT. Explicit report migration over the original Cube metadata and plan compiler.
import { compileCubeMetadata, plain, text, keys } from '../onboarding/metadata.mjs';
import { compileCubeMerchantPlan } from '../onboarding/plan.mjs';

const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function descriptors(raw) {
  const compiled = compileCubeMetadata(raw), all = new Map();
  for (const cube of raw.cubes) for (const kind of ['measures', 'dimensions', 'segments']) {
    for (const member of cube[kind] ?? []) {
      const publicMember = compiled.members.get(member.name);
      const visible = cube.public !== false && cube.isVisible !== false && member.public !== false && member.isVisible !== false;
      const value = { name: member.name, cube: cube.name, cubeType: cube.type === 'view' ? 'view' : 'cube', kind,
        public: visible, type: member.type ?? null, title: member.title ?? member.name,
        granularities: visible && publicMember?.type === 'time' ? [...publicMember.granularities].sort() : [] };
      // Hidden aliases can repeat in real metadata. Keep every claim rather than choosing one.
      all.set(member.name, [...(all.get(member.name) ?? []), value]);
    }
  }
  return { compiled, all };
}

/** Missing in /meta is unavailable, not proof that a member was deleted rather than hidden. */
export function compareCubeMetadata(before, after) {
  const left = descriptors(before), right = descriptors(after), changes = [];
  for (const name of new Set([...left.all.keys(), ...right.all.keys()])) {
    const was = left.all.get(name) ?? [], now = right.all.get(name) ?? [];
    if (same(was, now)) continue;
    const fields = !was.length || !now.length ? ['availability'] :
      ['cube', 'cubeType', 'kind', 'public', 'type', 'granularities', 'title']
        .filter(field => !same(was.map(row => row[field]), now.map(row => row[field])));
    changes.push({ name, change: !was.length ? 'ADDED' : !now.length ? 'UNAVAILABLE' : 'CHANGED', fields, before: was, after: now });
  }
  changes.sort((a, b) => a.name.localeCompare(b.name));
  return { changes, counts: { added: changes.filter(row => row.change === 'ADDED').length,
    unavailable: changes.filter(row => row.change === 'UNAVAILABLE').length,
    changed: changes.filter(row => row.change === 'CHANGED').length },
    source: { beforeMembers: left.compiled.members.size, afterMembers: right.compiled.members.size } };
}

function reference(value, catalog) {
  if (catalog.members.has(value)) return { member: value, granularity: null };
  const dot = typeof value === 'string' ? value.lastIndexOf('.') : -1;
  if (dot > 0 && catalog.members.get(value.slice(0, dot))?.type === 'time')
    return { member: value.slice(0, dot), granularity: value.slice(dot + 1) };
  return { member: value, granularity: null };
}

/** Visit only native query member slots. Literal values and public input contracts stay exact. */
function mapQuery(query, catalog, memberMap, granularityMap, used, grains) {
  const output = clone(query);
  function replace(value) {
    const ref = reference(value, catalog); used.add(ref.member);
    if (ref.granularity) grains.add(ref.member + '.' + ref.granularity);
    const mapped = Object.hasOwn(memberMap, ref.member) ? memberMap[ref.member] : ref.member;
    const grainKey = ref.member + '.' + ref.granularity;
    return ref.granularity ? mapped + '.' + (Object.hasOwn(granularityMap, grainKey) ? granularityMap[grainKey] : ref.granularity) : mapped;
  }
  for (const key of ['measures', 'dimensions', 'segments']) if (Array.isArray(output[key])) output[key] = output[key].map(replace);
  function filter(node) {
    if (Array.isArray(node.and)) node.and.forEach(filter);
    if (Array.isArray(node.or)) node.or.forEach(filter);
    if (Object.hasOwn(node, 'member')) node.member = replace(node.member);
  }
  (output.filters ?? []).forEach(filter);
  for (const row of output.timeDimensions ?? []) {
    const original = row.dimension;
    row.dimension = replace(original);
    if (typeof row.granularity === 'string') {
      const key = original + '.' + row.granularity; grains.add(key);
      row.granularity = Object.hasOwn(granularityMap, key) ? granularityMap[key] : row.granularity;
    }
  }
  if (Array.isArray(output.order)) output.order = output.order.map(([name, direction]) => [replace(name), direction]);
  else if (plain(output.order)) {
    const entries = Object.entries(output.order).map(([name, direction]) => [replace(name), direction]);
    if (new Set(entries.map(([name]) => name)).size !== entries.length) throw new TypeError('Remapping would collapse distinct ordering members');
    output.order = Object.fromEntries(entries);
  }
  return output;
}

export function inspectCubeRefresh(before, after, plan) {
  const old = compileCubeMerchantPlan(before, plan), catalog = compileCubeMetadata(before), diff = compareCubeMetadata(before, after);
  const changed = new Map(diff.changes.map(row => [row.name, row]));
  const reports = old.reports.map(report => {
    const used = new Set(), grains = new Set();
    mapQuery(plan.reports[report.id].query, catalog, {}, {}, used, grains);
    let compatible = true, error = null;
    try { compileCubeMerchantPlan(after, { ...plan, reports: { [report.id]: plan.reports[report.id] } }); }
    catch (problem) { compatible = false; error = problem.message; }
    return { id: report.id, description: report.description, path: report.path,
      members: [...used], fixedGranularities: [...grains], changes: [...used].filter(name => changed.has(name)).map(name => changed.get(name)),
      compatible, error, inputs: clone(plan.reports[report.id].inputs ?? {}), paymentOptions: clone(report.paymentOptions) };
  });
  return { ...diff, reports };
}

/** All reports receive an explicit decision; the original compiler decides admissibility. */
export function prepareCubeRefresh(before, after, plan, decisions) {
  const impact = inspectCubeRefresh(before, after, plan), catalog = compileCubeMetadata(before), target = compileCubeMetadata(after);
  keys(decisions, Object.keys(plan.reports), 'Report decisions');
  if (Object.keys(decisions).length !== Object.keys(plan.reports).length) throw new TypeError('Review every existing report');
  const next = clone(plan), reviewed = [], errors = [];
  for (const report of impact.reports) {
    const decision = decisions[report.id];
    keys(decision, ['action', 'reason', 'members', 'granularities'], `Decision ${report.id}`);
    if (!['keep', 'remap', 'retire'].includes(decision.action)) throw new TypeError(`Choose keep, remap or retire for ${report.id}`);
    text(decision.reason, `Reason for ${report.id}`, 4000);
    const memberMap = decision.members ?? {}, grainMap = decision.granularities ?? {};
    keys(memberMap, report.members, `Member replacements for ${report.id}`);
    keys(grainMap, report.fixedGranularities, `Fixed granularity replacements for ${report.id}`);
    if (decision.action !== 'remap' && (Object.keys(memberMap).length || Object.keys(grainMap).length))
      throw new TypeError(`Only a remap decision may replace members in ${report.id}`);
    for (const [name, replacement] of Object.entries(memberMap)) {
      text(replacement, `Replacement for ${name}`, 512);
      if (!target.members.has(replacement)) throw new TypeError(`Replacement ${replacement} is not public in the candidate metadata`);
    }
    for (const [name, replacement] of Object.entries(grainMap)) text(replacement, `Granularity for ${name}`, 80);
    if (decision.action === 'retire') delete next.reports[report.id];
    else if (decision.action === 'remap') next.reports[report.id].query =
      mapQuery(next.reports[report.id].query, catalog, memberMap, grainMap, new Set(), new Set());
    reviewed.push({ id: report.id, ...clone(decision), path: report.path, changes: report.changes,
      previousQuery: clone(plan.reports[report.id].query), query: next.reports[report.id]?.query ?? null });
  }
  let compiled;
  try { compiled = compileCubeMerchantPlan(after, next); }
  catch (problem) { errors.push(problem.message); }
  return { status: errors.length ? 'NEEDS_CHANGES' : 'READY', plan: next, decisions: clone(decisions), reviewed, errors,
    changeCounts: impact.counts, reportCount: Object.keys(next.reports).length,
    reports: compiled ? clone(compiled.reports) : [],
    retained: { serviceName: plan.serviceName, publicOrigin: plan.publicOrigin,
      reportIds: Object.keys(next.reports), exactPaymentAndInputs: true } };
}
