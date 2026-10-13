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

/** Open two retained plan editions in one native spatial review. */
export function receivingWaterPlanMapRequest(target) {
  const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
  if(target?.kind!=='receiving-water-plan-comparison'||
     !hash(target.reference_id)||!hash(target.id)||
     !hash(target.reference_sha256)||!hash(target.candidate_sha256)||
     typeof target.subject!=='string'||!target.subject)
    throw Error('Choose an exact receiving-water row from the saved plan comparison.');
  return {reference_plan_id:target.reference_id,candidate_plan_id:target.id,
    subject_id:target.subject,reference_record_sha256:target.reference_sha256,
    candidate_record_sha256:target.candidate_sha256};
}

export function receivingWaterPlanMapView(catalog,target,value) {
  const request=receivingWaterPlanMapRequest(target),clone=row=>JSON.parse(JSON.stringify(row));
  const equalSelection=(a,b)=>a?.layer_id===b?.layer_id&&a?.layer===b?.layer&&
    !Object.keys(a?.where||{}).length&&!Object.keys(b?.where||{}).length;
  if(value?.schema!=='upstate.receiving-water-plan-map/v1'||
     value.project_id!==catalog?.project?.id||value.subject_id!==request.subject_id||
     value.reference?.id!==request.reference_plan_id||
     value.candidate?.id!==request.candidate_plan_id||
     value.reference?.record_sha256!==request.reference_record_sha256||
     value.candidate?.record_sha256!==request.candidate_record_sha256||
     typeof value.reference.present!=='boolean'||typeof value.candidate.present!=='boolean'||
     (!value.reference.present&&!value.candidate.present))
    throw Error('The geographic comparison differs from the original saved plan pair. Reopen the comparison.');
  const view=value.view;
  if(typeof view?.crs!=='string'||!view.crs||!Array.isArray(view.bounds)||
     view.bounds.length!==4||!view.bounds.every(Number.isFinite)||
     view.bounds[0]>=view.bounds[2]||view.bounds[1]>=view.bounds[3])
    throw Error('The retained plan boundaries do not have a complete common map extent.');
  if(typeof value.title!=='string'||!value.title.trim()||typeof value.notes!=='string'||
     !Array.isArray(value.overlays)||!value.overlays.length||value.overlays.length>4||
     !Array.isArray(value.bindings)||value.bindings.length!==value.overlays.length||
     value.overlays.length>(catalog.limits?.overlays??24))
    throw Error('Read the complete original receiving-water boundary comparison.');
  const owners=new Map([value.reference,value.candidate].filter(row=>row.present).map(row=>[row.id,row]));
  const roles=new Map([...owners.keys()].map(id=>[id,new Set()]));
  const selections=[];
  for(let index=0;index<value.overlays.length;index++){
    const overlay=value.overlays[index],choice=overlay.selection;
    const binding=value.bindings.find(row=>equalSelection(row.selection,choice));
    const layer=catalog.layers.find(row=>row.id===choice?.layer_id);
    if(!binding||!layer||layer.kind!=='vector'||binding.kind!=='vector'||
       layer.group!=='receiving-water-plan'||!owners.has(binding.plan_id)||
       layer.owner_id!==binding.plan_id||layer.receiving_water_plan_id!==binding.plan_id||
       layer.subject_id!==request.subject_id||binding.subject_id!==request.subject_id||
       !['receptor','contribution'].includes(binding.geometry_role)||
       layer.geometry_role!==binding.geometry_role||
       layer.sha256!==binding.sha256||layer.bytes!==binding.bytes||
       !Number.isSafeInteger(binding.bytes)||binding.bytes<=0||
       typeof choice.layer!=='string'||choice.layer!==layer.native_layer||
       Object.keys(choice).some(key=>!['layer_id','layer','where'].includes(key))||
       Object.keys(choice.where||{}).length)
      throw Error('Restore this comparison’s exact original plan geometry before opening the map.');
    if(typeof overlay.label!=='string'||!overlay.label||
       !['solid','dash','dot'].includes(overlay.style)||
       typeof overlay.visible!=='boolean'||!Number.isFinite(overlay.width)||
       overlay.width<0.2||overlay.width>8||!Number.isFinite(overlay.opacity)||
       overlay.opacity<0||overlay.opacity>1)
      throw Error('The boundary comparison contains an invalid original overlay style.');
    roles.get(binding.plan_id).add(binding.geometry_role);
    selections.push({binding,selection:choice});
  }
  for(const found of roles.values())if(!found.has('receptor')||!found.has('contribution'))
    throw Error('Retain both the original feature and its prepared contribution boundary for each displayed edition.');
  const reference=selections.find(row=>row.binding.plan_id===request.reference_plan_id&&row.binding.geometry_role==='contribution')||
    selections.find(row=>row.binding.geometry_role==='contribution')||selections[0];
  return {reference:clone(reference.selection),primary:null,comparison:null,mode:'single',
    view:clone(view),scale:{mode:'auto'},overlays:clone(value.overlays),
    markers:[],point:null,frame:null,title:value.title,notes:value.notes,
    previous_review_id:null,pendingSave:null,atlas_review:null,swipe:50};
}
