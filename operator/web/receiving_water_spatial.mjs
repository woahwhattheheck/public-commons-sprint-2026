/** Select retained receiving-water layers in the original spatial workbench. */

const groups = new Set(['receiving-water-plan', 'receiving-water-analysis']);
const priorities = new Set(['current_priority', 'increased_export_priority', 'avoided_export_priority']);

export function isReceivingWaterTarget(target) {
  return groups.has(target?.kind);
}

export function receivingWaterTargetMatches(row, target) {
  if (!isReceivingWaterTarget(target) || row.group !== target.kind || row.owner_id !== target.id) return false;
  if (target.kind === 'receiving-water-plan') {
    return row.kind === 'vector' && (!target.subject || row.subject_id === target.subject);
  }
  if (row.kind === 'vector') return true;
  if (target.statistic === 'areas') return false;
  if (target.subject && row.subject_id !== target.subject) return false;
  if (target.subject_kind && row.subject_kind !== target.subject_kind) return false;
  if (target.statistic && row.statistic !== target.statistic) return false;
  if (target.quantity && row.quantity !== target.quantity) return false;
  const run = target.run || row.baseline_run_id;
  return !run || row.run_id === run;
}

export function receivingWaterView(rows, target, selectionFor) {
  if (!isReceivingWaterTarget(target) || typeof selectionFor !== 'function') {
    throw Error('Choose a receiving-water plan or saved analysis.');
  }
  if (target.kind === 'receiving-water-analysis' && target.subject && !target.subject_kind) {
    throw Error('Choose the individual water or combined family area in the saved analysis.');
  }
  const selectedRows = rows.filter(row => receivingWaterTargetMatches(row, target));
  const vectors = selectedRows.filter(row => row.kind === 'vector');
  const rasters = selectedRows.filter(row => row.kind === 'raster');
  if (!selectedRows.length) throw Error('Open the retained receiving-water record and refresh its spatial sources.');
  if (target.kind === 'receiving-water-plan' && !target.subject) {
    throw Error('Choose a receiving water in the source plan to review its original and contributing boundaries.');
  }
  if (target.kind === 'receiving-water-analysis' && target.statistic !== 'areas' && !rasters.length) {
    throw Error('This receiving area has no saved raster for the selected run and quantity. Open its recorded coverage and completed outputs.');
  }
  const contribution = vectors.find(row => row.geometry_role === 'contribution' || /contribution/.test(row.role));
  const reference = contribution || vectors[0] || rasters[0];
  const raster = rasters.find(row => row.statistic === (target.statistic || 'current_priority')) || rasters[0] || null;
  const select = row => {
    const value = selectionFor(row.id);
    if (!value) throw Error('The selected receiving-water layer is absent from the current spatial catalog.');
    const selection = {...value};
    if (row.kind === 'vector') {
      if (row.native_layer) selection.layer = row.native_layer;
      if (target.kind === 'receiving-water-analysis' && target.subject) {
        selection.where = {subject_id: target.subject, kind: target.subject_kind};
      }
    }
    return selection;
  };
  const title = raster?.title || reference.title || raster?.subject_title || reference.subject_title;
  const interpretation = raster?.relationship_precision || reference.relationship_precision || '';
  return {
    reference: select(reference),
    primary: raster ? select(raster) : null,
    comparison: null,
    mode: 'single',
    view: null,
    scale: raster && priorities.has(raster.statistic) ? {mode:'fixed', minimum:0, maximum:1} : {mode:'auto'},
    overlays: vectors.map(row => ({
      selection: select(row),
      label: row.title,
      visible: true,
      style: row === contribution ? 'solid' : 'dash',
      width: row === contribution ? 1.8 : 1.2,
      opacity: 1
    })),
    markers: [],
    point: null,
    frame: null,
    title: title || 'Receiving-water review',
    notes: interpretation,
    previous_review_id: null,
    pendingSave: null
  };
}

/** Invalidate the native catalog when a receiving operation finishes. */
export function receivingWaterStateSignature(state) {
  const data = state?.data || {};
  const water = data.receiving_waters || data;
  return ['receiving_water_plans', 'receiving_water_analyses'].map(name =>
    (water[name] || []).map(row => [row.id, row.state]));
}
