/** Exact retained Receiving selections, edited without reconstructing scientific records.
 * TokenJunkieLabs. The original prepare/analyze engine remains authoritative.
 */
export const copySelection=value=>JSON.parse(JSON.stringify(value));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function selectionObject(value,label='Retained selection'){
  if(!object(value))throw Error(label+' must be a JSON object.');
  return copySelection(value);
}
const get=(value,path)=>path.reduce((row,key)=>row?.[key],value);
const text=value=>value===undefined||value===null?'':String(value).trim();
const json=value=>value===undefined?'':JSON.stringify(value,null,2);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function write(target,path,value){
  let row=target;for(const key of path.slice(0,-1)){if(!object(row[key]))row[key]={};row=row[key];}
  if(value===undefined)delete row[path.at(-1)];else row[path.at(-1)]=copySelection(value);
}
function change(target,path,current,initial,parse=value=>value){
  if(current!==initial)write(target,path,parse(current));
}
function optionalJSON(value,label){
  if(!value)return undefined;
  let result;try{result=JSON.parse(value);}catch{throw Error(label+' must contain valid JSON.');}
  if(!object(result))throw Error(label+' must contain a JSON object.');return result;
}
export function sourceKey(value){
  return value?.source_collection_id&&value?.source_id?
    JSON.stringify({source_collection_id:value.source_collection_id,source_id:value.source_id}):'';
}
function changeSource(target,path,current,initial){
  if(current===initial)return;
  const choice=current?JSON.parse(current):{};
  change(target,[...path,'source_collection_id'],choice.source_collection_id,get(target,[...path,'source_collection_id']));
  change(target,[...path,'source_id'],choice.source_id,get(target,[...path,'source_id']));
}
export function featureText(value){return value===undefined?'':JSON.stringify(value);}
function features(value){
  if(!value)return undefined;
  if(value.trim().startsWith('[')){
    let result;try{result=JSON.parse(value);}catch{throw Error('Feature IDs must be a JSON array or comma-separated IDs.');}
    if(!Array.isArray(result))throw Error('Feature IDs must be an array.');return result;
  }
  return value.split(',').map(x=>x.trim()).filter(Boolean);
}
export function newReceptor(index){
  return {id:'water-'+index,title:'',family:'critical_drinking_water',source:{},
    relation:{method:'source_area',rationale:''},classification:{original_class:''}};
}
export function receptorFields(row){
  return {title:text(row.title),id:text(row.id),family:text(row.family),
    source:sourceKey(row.source),layer:text(row.source?.layer),features:featureText(row.source?.feature_ids),
    where:json(row.source?.where)||'{}',method:row.relation?.method||'source_area',
    rationale:text(row.relation?.rationale),buffer:text(row.relation?.buffer_m??0),
    designation:text(row.classification?.original_class)};
}
export function reviseReceptor(original,fields){
  const out=selectionObject(original,'Receiving area'),before=receptorFields(original);
  for(const key of ['title','id','family'])change(out,[key],fields[key],before[key]);
  changeSource(out,['source'],fields.source,before.source);
  change(out,['source','layer'],fields.layer,before.layer,value=>value||undefined);
  change(out,['source','feature_ids'],fields.features,before.features,features);
  change(out,['source','where'],fields.where,before.where,value=>optionalJSON(value,'Exact attribute selection'));
  change(out,['relation','method'],fields.method,before.method);
  change(out,['relation','rationale'],fields.rationale,before.rationale);
  change(out,['relation','buffer_m'],fields.buffer,before.buffer,value=>{
    const result=Number(value);if(!Number.isFinite(result)||result<0)throw Error('Enter a nonnegative context buffer.');return result;
  });
  change(out,['classification','original_class'],fields.designation,before.designation,value=>value||undefined);
  if(!out.source?.source_collection_id||!out.source?.source_id)throw Error('Choose the original source for every receiving area.');
  if(!out.relation?.rationale)throw Error('Describe the contribution relationship for every receiving area.');
  return out;
}
export function planFields(seed){
  return {title:text(seed.title),crs:text(seed.analysis_crs||'EPSG:5070'),catchments:sourceKey(seed.catchments),
    catchmentLayer:text(seed.catchments?.layer),huc:text(seed.catchments?.id_field||'huc12'),
    tohuc:text(seed.catchments?.downstream_field||'tohuc')};
}
export function revisePlan(seed,fields,rows){
  const out=selectionObject(seed),before=planFields(seed);
  change(out,['title'],fields.title,before.title);
  change(out,['analysis_crs'],fields.crs,before.crs);
  changeSource(out,['catchments'],fields.catchments,before.catchments);
  change(out,['catchments','layer'],fields.catchmentLayer,before.catchmentLayer,value=>value||undefined);
  change(out,['catchments','id_field'],fields.huc,before.huc);
  change(out,['catchments','downstream_field'],fields.tohuc,before.tohuc);
  out.receptors=rows.map(row=>reviseReceptor(row.seed,row.fields));
  if(!out.receptors.length)throw Error('Define at least one receiving area.');
  if(out.receptors.some(row=>row.relation?.method==='upstream_huc')){
    if(!out.catchments?.source_collection_id||!out.catchments?.source_id)throw Error('Choose the original catchment network for upstream relationships.');
    // These are native defaults; only a newly selected network needs them materialized.
    if(!seed.catchments&&out.catchments){out.catchments.id_field=fields.huc;out.catchments.downstream_field=fields.tohuc;}
  }
  return out;
}
export function analysisFields(seed){
  return {title:text(seed.title),plan:text(seed.plan_id),baseline:text(seed.baseline_run_id),
    alternatives:[...(seed.alternative_run_ids||[])],scope:seed.quantity_scope||'reporting',
    weights:json(seed.weights),normalization:json(seed.normalization)};
}
export function reviseAnalysis(seed,fields,accounting){
  const out=selectionObject(seed),before=analysisFields(seed);
  for(const [field,key]of [['title','title'],['plan','plan_id'],['baseline','baseline_run_id'],['scope','quantity_scope']])
    change(out,[key],fields[field],before[field],value=>field==='title'?(value||undefined):value);
  // Preserve exact original alternative order when the selected set is unchanged.
  const original=[...before.alternatives].sort(),current=[...fields.alternatives].sort();
  if(!equal(original,current))out.alternative_run_ids=[...fields.alternatives];
  for(const key of ['weights','normalization'])change(out,[key],fields[key],before[key],value=>optionalJSON(value,key));
  if(!equal(accounting,seed.accounting)){
    if(accounting===undefined)delete out.accounting;else out.accounting=copySelection(accounting);
  }
  return out;
}
export function groupFields(seed){
  const refs=seed.references;
  return {id:text(seed.id),title:text(seed.title),parent:text(seed.parent_receptor_id),
    references:Array.isArray(refs)&&refs.every(x=>typeof x==='string')?refs.join('\n').trim():json(refs),
    rationale:text(seed.rationale)};
}
export function reviseGroup(seed,fields,members){
  const out=selectionObject(seed,'Accounting group'),before=groupFields(seed);
  for(const [field,key]of [['id','id'],['title','title'],['parent','parent_receptor_id'],['rationale','rationale']])
    change(out,[key],fields[field],before[field]);
  change(out,['references'],fields.references,before.references,value=>{
    if(value.trim().startsWith('[')){const result=JSON.parse(value);if(!Array.isArray(result))throw Error('Use an array of references.');return result;}
    return value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  });
  const upstream=members.filter(row=>['upstream','reservoir'].includes(row.role)).map(row=>row.id);
  const reservoir=members.filter(row=>row.role==='reservoir').map(row=>row.id);
  for(const [key,ids]of [['upstream_receptor_ids',upstream],['reservoir_receptor_ids',reservoir]]){
    if(!equal([...(seed[key]||[])].sort(),[...ids].sort()))out[key]=ids;
  }
  if(!out.id||!out.title||!out.parent_receptor_id||!upstream.length||!out.references?.length||!out.rationale)
    throw Error('Retain each catchment group name, ID, downstream area, upstream membership, references and rationale.');
  return out;
}
export function changedPaths(before,after,path='',result=[]){
  if(equal(before,after))return result;
  if(object(before)&&object(after)){
    for(const key of new Set([...Object.keys(before),...Object.keys(after)]))
      changedPaths(before[key],after[key],path?path+'.'+key:key,result);
  }else if(Array.isArray(before)&&Array.isArray(after)&&before.length===after.length){
    before.forEach((row,index)=>changedPaths(row,after[index],path+'['+index+']',result));
  }else result.push(path||'selection');
  return result;
}
