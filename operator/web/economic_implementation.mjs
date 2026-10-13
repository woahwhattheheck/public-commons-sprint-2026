/** Review one retained whole economic scenario for the native implementation planner. */
const clone = value => JSON.parse(JSON.stringify(value));
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const required = (value, message) => { if (!value) throw Error(message); };
const metricLabels = {nitrogen_export:'Nitrogen',phosphorus_export:'Phosphorus',sediment_export:'Sediment'};

export function economicImplementationOptions(edition, workspaceKey) {
  required(isRecord(edition) && edition.schema === 'upstate.economic-edition/v1',
    'Choose a completed economic edition from this workspace.');
  required(edition.workspace_key === workspaceKey && !!workspaceKey,
    'Reopen the economic edition in its original workspace.');
  required(hex(edition.id) && hex(edition.report_id), 'The completed edition needs its original saved identity.');
  const input = edition.input, report = edition.report;
  required(isRecord(input) && isRecord(report), 'The saved edition needs its full original report and inputs.');
  required(hex(input.report_id) && hex(input.report_sha256) && typeof input.zone_id === 'string' && input.zone_id,
    'The saved edition needs its original native report, source hash and reporting zone.');
  required(edition.producer_report_id === input.report_id && edition.zone_id === input.zone_id &&
    report.id === edition.report_id, 'The saved edition and original report do not match.');
  required(report.physical_source?.source?.sha256 === input.report_sha256 &&
    report.physical_source?.zone?.id === input.zone_id,
    'The selected edition needs its exact native source and zone.');
  required(isRecord(input.selection) && Array.isArray(report.alternatives),
    'The saved edition needs its retained whole-scenario alternatives.');
  const costs = input.selection.costs || [];
  required(Array.isArray(costs), 'The original cost selection is incomplete.');
  const costByRun = new Map();
  for (const cost of costs) {
    required(isRecord(cost) && typeof cost.run_id === 'string' && !costByRun.has(cost.run_id),
      'The saved edition repeats or omits an original cost scenario.');
    costByRun.set(cost.run_id, cost);
  }
  const seen = new Set();
  const alternatives = report.alternatives.map(row => {
    required(isRecord(row) && typeof row.run_id === 'string' && row.run_id &&
      !seen.has(row.run_id) && row.run_id !== report.baseline?.run_id,
      'Choose a distinct original alternative from the completed edition.');
    seen.add(row.run_id);
    const originalCost = costByRun.get(row.run_id) || null;
    required(Boolean(row.cost) === Boolean(originalCost),
      'The selected alternative and its retained cost input do not match.');
    if (originalCost) required(row.cost.currency === String(originalCost.currency).trim().toUpperCase() &&
      row.cost.capital === originalCost.capital &&
      row.cost.annual_operating === originalCost.annual_operating &&
      row.cost.horizon_years === originalCost.horizon_years &&
      row.cost.discount_rate === originalCost.discount_rate,
      'Reopen the complete edition with its original cost input.');
    return {
      run_id: row.run_id, scenario_id: row.scenario_id || null,
      label: row.label || row.run_id, eligible: row.decision?.eligible === true,
      decision: clone(row.decision || {}),
      outputs: Object.entries(row.outputs || {}).map(([metric, output]) => ({
        metric, label: metricLabels[metric] || metric.replaceAll('_',' '),
        units: report.scope?.units?.[metric] || '', ...clone(output)
      })),
      cost: row.cost ? clone(row.cost) : null,
      original_cost: originalCost ? clone(originalCost) : null
    };
  });
  required(alternatives.length, 'This completed edition has no whole scenario to plan.');
  return {
    edition_id: edition.id, workspace_key: workspaceKey,
    edition_title: edition.title || report.title,
    report_id: input.report_id, report_sha256: input.report_sha256,
    economic_report_id: report.id, zone_id: input.zone_id,
    zone_title: edition.zone_title || report.physical_source.zone.title || input.zone_id,
    baseline_run_id: report.baseline?.run_id || report.scope?.baseline_run_id,
    alternatives
  };
}

export function economicImplementationSelection(options, runId) {
  required(isRecord(options) && typeof runId === 'string' && !!runId,
    'Choose the one whole scenario to take into implementation planning.');
  const choices = (options.alternatives || []).filter(row => row.run_id === runId);
  required(choices.length === 1, 'Choose one original alternative from this completed edition.');
  return {
    workspace_key: options.workspace_key, edition_id: options.edition_id, run_id: runId,
    report_id: options.report_id, report_sha256: options.report_sha256, zone_id: options.zone_id
  };
}
