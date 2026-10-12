// MIT. Regional PMTiles source, style and immutable release decisions.
import {createHash} from 'node:crypto';
export const SCHEMA='starforge.pmtiles-workspace.v1';
export const EDITION_SCHEMA='starforge.pmtiles-edition.v1';
export const REVIEW_SCHEMA='starforge.pmtiles-review.v1';
export const HASH=/^[a-f0-9]{64}$/;
export function fail(code,message=code){throw Object.assign(new Error(message),{code});}
export function need(ok,code,message){if(!ok)fail(code,message);}
export function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function canonical(value){
  if(value===null||typeof value!=='object'){
    need(value!==undefined&&(typeof value!=='number'||Number.isFinite(value)),'PMTILES_JSON_INVALID');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const digest=value=>hash(canonical(value));
export const clone=value=>JSON.parse(canonical(value));
export const timestamp=()=>new Date().toISOString();
export function identifier(value){
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value),'PMTILES_ID_INVALID');
  return value;
}
export function text(value,max=20000,{empty=false}={}){
  need(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0)&&!value.includes('\0'),'PMTILES_TEXT_INVALID');
  return value;
}
export function pathName(value){
  text(value,1024);
  need(!/[\\\x00-\x1f\x7f]/.test(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'),'PMTILES_MEMBER_PATH_INVALID');
  return value;
}
export function rights(value){
  need(plain(value),'PMTILES_SOURCE_RIGHTS_REQUIRED');
  const out={license:text(value.license,2000),attribution:text(value.attribution,16000),sourceUrl:text(value.sourceUrl,4096)};
  const url=new URL(out.sourceUrl);
  need(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password,'PMTILES_SOURCE_URL_INVALID');
  return out;
}
export function resourceDescriptor(row){
  need(plain(row)&&HASH.test(row.sha256??'')&&Number.isSafeInteger(row.bytes)&&row.bytes>0,
    'PMTILES_RESOURCE_DESCRIPTOR_INVALID');
  need(['pmtiles','style','sprite-json','sprite-png','glyph','document'].includes(row.kind),'PMTILES_RESOURCE_KIND_INVALID');
  identifier(row.id);text(row.name,240);rights(row.rights);
  need(plain(row.source)&&['LOCAL','HTTPS','SF88_OBJECT'].includes(row.source.kind),'PMTILES_SOURCE_RECEIPT_REQUIRED');
  return row;
}
function resource(map,id,kind){
  identifier(id);const r=map.get(id);need(r,'PMTILES_RESOURCE_MISSING','Select the retained resource '+id+'.');
  resourceDescriptor(r);if(kind)need(r.kind===kind,'PMTILES_RESOURCE_KIND_MISMATCH');
  return r;
}
export function normalizeEdition(input,resources){
  need(plain(input)&&Array.isArray(resources),'PMTILES_EDITION_INPUT_INVALID');
  const map=new Map(resources.map(r=>[r.id,r]));
  const out={schema:EDITION_SCHEMA,name:text(input.name,240),notes:text(input.notes??'',20000,{empty:true}),
    style:resource(map,input.style,'style').id,archives:[],sprite:null,glyphs:[],layerDecisions:[],view:null};
  need(Array.isArray(input.archives)&&input.archives.length>=1&&input.archives.length<=32,'PMTILES_ARCHIVES_REQUIRED');
  const names=new Set();
  for(const row of input.archives){
    need(plain(row),'PMTILES_ARCHIVE_BINDING_INVALID');text(row.sourceId,512);
    need(!names.has(row.sourceId),'PMTILES_DUPLICATE_STYLE_SOURCE');names.add(row.sourceId);
    need(['vector','raster','raster-dem'].includes(row.type),'PMTILES_STYLE_SOURCE_TYPE_INVALID');
    out.archives.push({sourceId:row.sourceId,resourceId:resource(map,row.resourceId,'pmtiles').id,type:row.type});
  }
  if(input.sprite){
    const s=input.sprite;need(plain(s),'PMTILES_SPRITE_INVALID');
    out.sprite={json:resource(map,s.json,'sprite-json').id,png:resource(map,s.png,'sprite-png').id,retina:null};
    if(s.retina)out.sprite.retina={json:resource(map,s.retina.json,'sprite-json').id,png:resource(map,s.retina.png,'sprite-png').id};
  }
  need(Array.isArray(input.glyphs??[])&&(input.glyphs??[]).length<=8192,'PMTILES_GLYPH_INVENTORY_INVALID');
  const glyphKeys=new Set();
  for(const g of input.glyphs??[]){
    text(g.fontstack,512);text(g.range,40);
    need(!/[\/\\\x00-\x1f\x7f]/.test(g.fontstack)&&/^\d+-\d+$/.test(g.range),'PMTILES_GLYPH_PATH_INVALID');
    const [start,end]=g.range.split('-').map(Number);
    need(Number.isSafeInteger(start)&&start>=0&&start%256===0&&end===start+255&&end<=1114111,
      'PMTILES_GLYPH_RANGE_INVALID');
    const key=g.fontstack+'\0'+g.range;need(!glyphKeys.has(key),'PMTILES_DUPLICATE_GLYPH');glyphKeys.add(key);
    out.glyphs.push({fontstack:g.fontstack,range:g.range,resourceId:resource(map,g.resourceId,'glyph').id});
  }
  need(Array.isArray(input.layerDecisions??[])&&(input.layerDecisions??[]).length<=4096,'PMTILES_LAYER_DECISIONS_INVALID');
  const layers=new Set();
  for(const d of input.layerDecisions??[]){
    text(d.layerId,512);need(!layers.has(d.layerId)&&typeof d.visible==='boolean','PMTILES_LAYER_DECISION_INVALID');layers.add(d.layerId);
    out.layerDecisions.push({layerId:d.layerId,visible:d.visible,note:text(d.note??'',2000,{empty:true})});
  }
  if(input.view){
    const v=input.view;
    need(Array.isArray(v.center)&&v.center.length===2&&v.center.every(Number.isFinite)&&
      v.center[0]>=-180&&v.center[0]<=180&&v.center[1]>=-85.051129&&v.center[1]<=85.051129&&
      Number.isFinite(v.zoom)&&v.zoom>=0&&v.zoom<=24,'PMTILES_VIEW_INVALID');
    out.view={center:[...v.center],zoom:v.zoom};
  }
  return out;
}
export function editionResourceIds(edition){
  return [...new Set([edition.style,...edition.archives.map(a=>a.resourceId),
    ...(edition.sprite?[edition.sprite.json,edition.sprite.png,...(edition.sprite.retina?[edition.sprite.retina.json,edition.sprite.retina.png]:[])]:[]),
    ...edition.glyphs.map(g=>g.resourceId)])].sort();
}
export function validateInspection(inspection,resource){
  need(plain(inspection)&&inspection.schema==='starforge.pmtiles-inspection.v1'&&
    inspection.resourceSha256===resource.sha256&&inspection.bytes===resource.bytes&&
    inspection.status==='COMPLETE'&&inspection.nativeVerify?.exitCode===0&&inspection.verifierDiagnostics?.invalidDiagnostic===false&&
    plain(inspection.header)&&plain(inspection.metadata)&&HASH.test(inspection.runtimeSha256??''),
    'PMTILES_NATIVE_INSPECTION_REQUIRED');
  const h=inspection.header;
  need(h.specVersion===3&&Number.isInteger(h.minZoom)&&Number.isInteger(h.maxZoom)&&
    h.minZoom>=0&&h.maxZoom<=26&&h.minZoom<=h.maxZoom,'PMTILES_ARCHIVE_ZOOM_INVALID');
  return inspection;
}
export function prepareStyle(edition,original,resources,inspections){
  need(plain(original)&&original.version===8&&plain(original.sources)&&Array.isArray(original.layers),
    'PMTILES_MAPLIBRE_STYLE_REQUIRED');
  const selected=new Map(edition.archives.map(a=>[a.sourceId,a]));
  need(Object.keys(original.sources).length===selected.size&&Object.keys(original.sources).every(k=>selected.has(k)),
    'PMTILES_BIND_EVERY_STYLE_SOURCE','Every original style source needs a retained archive binding.');
  const resourceMap=new Map(resources.map(r=>[r.id,r])), style=clone(original), sourceRows=[];
  for(const [sourceId,source] of Object.entries(style.sources)){
    const binding=selected.get(sourceId), r=resource(resourceMap,binding.resourceId,'pmtiles');
    need(source.type===binding.type,'PMTILES_SOURCE_TYPE_CHANGED');
    const inspection=validateInspection(inspections.find(x=>x.resourceSha256===r.sha256),r), h=inspection.header;
    const supported=source.type==='vector'?[1]:[2,3,4,5];
    need(supported.includes(h.tileType),'PMTILES_ARCHIVE_TILE_TYPE_MISMATCH',source.type==='vector'?'This edition requires original MVT tiles.':'This raster edition requires original PNG, JPEG, WebP or AVIF tiles.');
    const nativeId='pm_'+r.sha256.slice(0,32);
    const row={sourceId,resourceId:r.id,sha256:r.sha256,bytes:r.bytes,nativeId,type:source.type,
      header:clone(h),metadata:clone(inspection.metadata),rights:clone(r.rights),originalSource:clone(original.sources[sourceId])};
    sourceRows.push(row);
    delete source.url;delete source.tiles;
    source.tiles=['__PMTILES_TILES__/'+nativeId+'/{z}/{x}/{y}'];
    source.minzoom=Math.max(Number.isFinite(source.minzoom)?source.minzoom:h.minZoom,h.minZoom);
    source.maxzoom=Math.min(Number.isFinite(source.maxzoom)?source.maxzoom:h.maxZoom,h.maxZoom);
    need(source.minzoom<=source.maxzoom,'PMTILES_STYLE_ZOOM_OUTSIDE_ARCHIVE');
    source.attribution=r.rights.attribution.replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  }
  const layerIds=new Set(original.layers.map(l=>l.id));
  need(layerIds.size===original.layers.length,'PMTILES_DUPLICATE_STYLE_LAYER');
  for(const layer of style.layers){
    need(plain(layer)&&typeof layer.id==='string','PMTILES_STYLE_LAYER_INVALID');
    if(layer.source){
      need(selected.has(layer.source),'PMTILES_LAYER_SOURCE_UNBOUND');
      const source=sourceRows.find(r=>r.sourceId===layer.source);
      if(source.type==='vector'){
        need(typeof layer['source-layer']==='string','PMTILES_VECTOR_SOURCE_LAYER_REQUIRED',layer.id);
        const declared=source.metadata.vector_layers;
        need(Array.isArray(declared)&&declared.some(r=>r.id===layer['source-layer']),
          'PMTILES_VECTOR_SOURCE_LAYER_MISSING',layer.id+' references '+layer['source-layer']);
      }
    }
  }
  for(const decision of edition.layerDecisions){
    need(layerIds.has(decision.layerId),'PMTILES_LAYER_DECISION_NOT_FOUND');
    const layer=style.layers.find(l=>l.id===decision.layerId);
    layer.layout={...(layer.layout??{}),visibility:decision.visible?'visible':'none'};
  }
  if(original.sprite!==undefined){
    need(typeof original.sprite==='string'&&edition.sprite,'PMTILES_SINGLE_SPRITE_BINDING_REQUIRED',
      'Select the original style sprite JSON and PNG, including its supplied retina edition.');
    style.sprite='__PMTILES_RESOURCES__/sprite';
  }else need(!edition.sprite,'PMTILES_UNUSED_SPRITE_BINDING');
  const fontstacks=[...new Set(edition.glyphs.map(g=>g.fontstack))].sort(), staticFonts=new Set();
  for(const layer of original.layers){
    const font=layer.layout?.['text-font'];
    if(Array.isArray(font)&&font.every(x=>typeof x==='string')&&font.length)
      staticFonts.add(font.join(','));
  }
  if(original.glyphs!==undefined){
    need(typeof original.glyphs==='string'&&edition.glyphs.length>0,'PMTILES_GLYPHS_REQUIRED');
    for(const font of staticFonts)need(fontstacks.includes(font),'PMTILES_STATIC_FONTSTACK_MISSING',font);
    style.glyphs='__PMTILES_RESOURCES__/glyphs/{fontstack}/{range}.pbf';
  }else need(edition.glyphs.length===0,'PMTILES_UNUSED_GLYPH_BINDING');
  if(edition.view){style.center=[...edition.view.center];style.zoom=edition.view.zoom;}
  return {style,sources:sourceRows,layerRows:style.layers.map(l=>({id:l.id,type:l.type,source:l.source??null,
    sourceLayer:l['source-layer']??null,visible:l.layout?.visibility!=='none',minzoom:l.minzoom??null,maxzoom:l.maxzoom??null})),
    glyphCoverage:fontstacks.map(fontstack=>({fontstack,ranges:edition.glyphs.filter(g=>g.fontstack===fontstack).map(g=>g.range).sort((a,b)=>parseInt(a)-parseInt(b))})),
    originalStyleSha256:resource(resourceMap,edition.style,'style').sha256,styleSha256:digest(style)};
}
export function resolveStyle(prepared,{tilesBase,resourcesBase}){
  need(typeof tilesBase==='string'&&typeof resourcesBase==='string','PMTILES_STYLE_BASE_REQUIRED');
  const style=clone(prepared.style);
  for(const source of Object.values(style.sources))source.tiles=source.tiles.map(v=>v.replace('__PMTILES_TILES__',tilesBase.replace(/\/$/,'')));
  if(style.sprite)style.sprite=style.sprite.replace('__PMTILES_RESOURCES__',resourcesBase.replace(/\/$/,''));
  if(style.glyphs)style.glyphs=style.glyphs.replace('__PMTILES_RESOURCES__',resourcesBase.replace(/\/$/,''));
  return style;
}
export function compareEditions(left,right){
  need(left?.schema===EDITION_SCHEMA&&right?.schema===EDITION_SCHEMA,'PMTILES_EDITIONS_REQUIRED');
  const fields=['name','notes','style','archives','sprite','glyphs','layerDecisions','view'];
  return {changedFields:fields.filter(k=>canonical(left[k])!==canonical(right[k])),
    beforeSha256:digest(left),afterSha256:digest(right)};
}
export function validatePaths(files){
  need(Array.isArray(files)&&files.length>0&&files.length<=30000,'PMTILES_FILE_INVENTORY_INVALID');
  const seen=new Map();
  for(const f of files){
    pathName(f.path);need(HASH.test(f.sha256??'')&&Number.isSafeInteger(f.bytes)&&f.bytes>=0,'PMTILES_FILE_RECORD_INVALID');
    const key=f.path.normalize('NFC').toLowerCase();need(!seen.has(key),'PMTILES_FILE_NAME_COLLISION');seen.set(key,f.path);
  }
  for(const key of seen.keys()){
    const parts=key.split('/');for(let i=1;i<parts.length;i++)need(!seen.has(parts.slice(0,i).join('/')),'PMTILES_FILE_DIRECTORY_COLLISION');
  }
  return files;
}
