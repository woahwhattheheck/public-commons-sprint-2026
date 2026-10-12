/**
 * Preview one controller-selected PMTiles release through the original
 * OpenLayers + @geoblocks/ol-maplibre-layer runtime.
 *
 * The host supplies its already installed engine and reviewed local style URL.
 * This component owns only its map, listeners and view choices. Publication,
 * archive receiving and persisted style decisions belong to the host.
 */
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const text=value=>value==null?'':String(value);
const latitude=value=>Math.max(-85.0511287798066,Math.min(85.0511287798066,value));
function selectionValue(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Select a retained release preview.');
 if(typeof value.key!=='string'||!value.key.trim())throw new Error('The preview needs its selected release identity.');
 if(typeof value.styleUrl!=='string'||!value.styleUrl)throw new Error('The preview needs its selected style URL.');
 const url=new URL(value.styleUrl,globalThis.location?.href);
 if(!['http:','https:'].includes(url.protocol))throw new Error('The selected preview style must use HTTP or HTTPS.');
 if(url.username||url.password)throw new Error('Use the original preview session for authentication.');
 let bounds=null;
 if(value.bounds!=null){
  if(!Array.isArray(value.bounds)||value.bounds.length!==4||!value.bounds.every(finite))throw new Error('The selected regional bounds are incomplete.');
  const [west,south,east,north]=value.bounds;
  if(west<-180||west>180||east<-180||east>180||south<-90||north>90||south>north)throw new Error('The selected regional bounds are invalid.');
  bounds=[west,south,east,north];
 }
 let center=null;
 if(value.center!=null){
  if(!Array.isArray(value.center)||value.center.length<2||value.center.length>3||!value.center.every(finite))throw new Error('The selected map center is invalid.');
  if(value.center[0]<-180||value.center[0]>180||value.center[1]<-90||value.center[1]>90)throw new Error('The selected map center is outside longitude/latitude bounds.');
  if(value.center.length===3&&(value.center[2]<0||value.center[2]>24))throw new Error('The selected map center zoom is invalid.');
  center=[...value.center];
 }
 for(const name of ['minZoom','maxZoom'])if(value[name]!=null&&(!finite(value[name])||value[name]<0||value[name]>24))throw new Error('The selected '+name+' is invalid.');
 const minZoom=value.minZoom??0,maxZoom=value.maxZoom??22;
 if(minZoom>maxZoom)throw new Error('The selected zoom interval is reversed.');
 return {key:value.key,styleUrl:url.href,bounds,center,
  minZoom,maxZoom,fitOnOpen:value.fitOnOpen===true,
  editionId:text(value.editionId),styleId:text(value.styleId),
  styleSha256:text(value.styleSha256),snapshot:text(value.snapshot)};
}
function errorValue(event){
 const original=event?.error??event;
 return {message:text(original?.message??event?.message??original??'The map reported an error.'),
  sourceId:text(event?.sourceId),tileId:text(event?.tile?.tileID?.canonical?.toString?.()),
  status:finite(original?.status)?original.status:null,url:text(original?.url),
  time:new Date().toISOString()};
}
function featureValue(feature){
 const native=typeof feature?.get==='function'?feature.get('vectorTileFeature'):null;
 if(native)return {id:native.id??null,source:native.source??null,sourceLayer:native.sourceLayer??null,
  layerId:native.layer?.id??null,layerType:native.layer?.type??null,
  geometry:clone(native.geometry??null),properties:clone(native.properties??{})};
 return {id:feature?.getId?.()??null,properties:clone(feature?.getProperties?.()??{})};
}
export function createReleaseMapPreview({
 target,loadEngine,onState=()=>{},onLayers=()=>{},onSources=()=>{},
 onLocation=()=>{},onFeature=()=>{},onError=()=>{}
}){
 if(!target||typeof target.replaceChildren!=='function')throw new TypeError('A map target element is required.');
 if(typeof loadEngine!=='function')throw new TypeError('The host must supply its installed map engine.');
 let generation=0,destroyed=false,current=null,enginePromise=null;
 let state={stage:'closed',key:null,loaded:false,idle:false,errorCount:0,errors:[]};
 const report=(handler,value)=>{try{handler(clone(value));}catch(error){queueMicrotask(()=>{throw error;});}};
 const emit=()=>report(onState,state);
 const active=record=>!!record&&!destroyed&&current===record&&record.generation===generation;
 function retainError(record,event){
  if(!active(record))return;
  const value=errorValue(event);record.errorCount++;record.errors.push(value);
  if(record.errors.length>100)record.errors.shift();
  state={...state,errorCount:record.errorCount,errors:[...record.errors]};
  report(onError,value);emit();
 }
 function listen(record,object,name,handler){
  object.on(name,handler);record.listeners.push(()=>object.off?object.off(name,handler):object.un(name,handler));
 }
 function mapRead(record){
  if(!active(record)||!record.native)return;
  const native=record.native;
  let style;try{style=native.getStyle();}catch{return;}
  if(!style)return;
  const layers=(style.layers??[]).map(layer=>({
   id:layer.id,type:layer.type,source:layer.source??null,sourceLayer:layer['source-layer']??null,
   minZoom:layer.minzoom??null,maxZoom:layer.maxzoom??null,
   visible:layer.layout?.visibility!=='none',filter:clone(layer.filter??null)
  }));
  const sources=Object.entries(style.sources??{}).map(([id,source])=>{
   let loaded=null;try{loaded=native.isSourceLoaded(id);}catch{}
   return {id,type:source.type,url:source.url??null,tiles:clone(source.tiles??null),
    minZoom:source.minzoom??null,maxZoom:source.maxzoom??null,
    attribution:source.attribution??null,loaded};
  });
  const layerJson=JSON.stringify(layers),sourceJson=JSON.stringify(sources);
  if(layerJson!==record.layersJson){record.layersJson=layerJson;report(onLayers,layers);}
  if(sourceJson!==record.sourcesJson){record.sourcesJson=sourceJson;report(onSources,sources);}
 }
 function queueRead(record){
  if(!active(record)||record.frame!=null)return;
  record.frame=requestAnimationFrame(()=>{record.frame=null;mapRead(record);});
 }
 function locationRead(record){
  if(!active(record)||!record.map)return;
  const view=record.map.getView(),coordinate=view.getCenter();if(!coordinate)return;
  const point=record.engine.toLonLat(coordinate,view.getProjection());
  record.location={longitude:point[0],latitude:point[1],zoom:view.getZoom()-1,rotation:view.getRotation(),
   key:record.selection.key,editionId:record.selection.editionId};
  report(onLocation,record.location);
 }
 function nativeReady(record){
  if(!active(record))return;
  const native=record.layer.mapLibreMap;
  if(!native||record.native===native)return;
  record.native=native;
  listen(record,native,'error',event=>retainError(record,event));
  listen(record,native,'dataloading',()=>{
   if(!active(record))return;
   state={...state,stage:'loading',idle:false};emit();
  });
  listen(record,native,'styledata',()=>queueRead(record));
  listen(record,native,'sourcedata',()=>queueRead(record));
  listen(record,native,'load',()=>{
   if(!active(record))return;
   state={...state,loaded:true,stage:'rendering'};emit();queueRead(record);
  });
  listen(record,native,'idle',()=>{
   if(!active(record))return;
   let loaded=false;
   try{loaded=native.isStyleLoaded()&&native.areTilesLoaded();}catch{}
   state={...state,loaded:state.loaded||loaded,idle:loaded,stage:loaded?'ready':'rendering'};
   emit();queueRead(record);locationRead(record);
  });
  try{
   if(native.isStyleLoaded())state={...state,loaded:true,stage:'rendering'};
  }catch{}
  queueRead(record);emit();
 }
 function disposeRecord(record){
  if(!record)return;
  record.observer?.disconnect();
  if(record.frame!=null)cancelAnimationFrame(record.frame);
  record.frame=null;
  for(const remove of record.listeners.splice(0).reverse())try{remove();}catch{}
  // Removing the original OpenLayers layer invokes its own MapLibre disposal.
  // Do not separately remove the underlying MapLibre map or its shared workers.
  try{if(record.map&&record.layer)record.map.removeLayer(record.layer);}catch(error){record.disposeErrors.push(errorValue(error));}
  try{record.layer?.dispose();}catch(error){record.disposeErrors.push(errorValue(error));}
  try{record.map?.dispose();}catch(error){record.disposeErrors.push(errorValue(error));}
  record.map=null;record.layer=null;record.native=null;
 }
 function reset({notify=true}={}){
  generation++;const previous=current;current=null;disposeRecord(previous);
  target.replaceChildren();target.removeAttribute('aria-busy');
  state={stage:'closed',key:null,loaded:false,idle:false,errorCount:0,errors:[]};
  if(notify){report(onLayers,[]);report(onSources,[]);report(onLocation,null);report(onFeature,null);emit();}
  if(previous?.disposeErrors.length)report(onError,{message:'Map disposal reported an error.',details:previous.disposeErrors});
 }
 async function engine(){
  if(!enginePromise)enginePromise=Promise.resolve().then(loadEngine).catch(error=>{enginePromise=null;throw error;});
  const value=await enginePromise;
  for(const name of ['Map','View','MapLibreLayer','fromLonLat','toLonLat'])if(typeof value?.[name]!=='function')throw new Error('The installed map engine is missing '+name+'.');
  return value;
 }
 function resizeRecord(record){
  if(!active(record)||!record.map)return;
  const rect=target.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0)return;
  record.map.updateSize();
  if(record.fitPending)fit();
  record.map.render();
 }
 function fit({padding=[24,24,24,24]}={}){
  const record=current;if(!active(record)||!record.map)return false;
  const bounds=record.selection.bounds;if(!bounds)return false;
  const size=record.map.getSize();
  if(!size||size[0]<=0||size[1]<=0){record.fitPending=true;return false;}
  const [west,south,east,north]=bounds;
  const unwrappedEast=east<west?east+360:east;
  const minimum=record.engine.fromLonLat([west,latitude(south)]),maximum=record.engine.fromLonLat([unwrappedEast,latitude(north)]);
  const extent=[minimum[0],minimum[1],maximum[0],maximum[1]];
  if(!extent.every(finite))throw new Error('The selected regional bounds cannot be shown in the map projection.');
  record.fitPending=false;
  record.map.getView().fit(extent,{size,padding,maxZoom:record.selection.maxZoom+1,duration:0});
  locationRead(record);return true;
 }
 async function open(value){
  if(destroyed)throw new Error('This map preview is closed.');
  reset();
  const selection=selectionValue(value),ticket=generation;
  const record={generation:ticket,selection,engine:null,map:null,layer:null,native:null,
   listeners:[],observer:null,frame:null,fitPending:!!selection.bounds&&selection.fitOnOpen,errors:[],errorCount:0,location:null,feature:null,
   layersJson:null,sourcesJson:null,disposeErrors:[]};
  current=record;
  state={stage:'loading-engine',key:selection.key,editionId:selection.editionId,
   styleId:selection.styleId,styleSha256:selection.styleSha256,snapshot:selection.snapshot,
   loaded:false,idle:false,errorCount:0,errors:[]};
  target.setAttribute('aria-busy','true');emit();
  try{
   record.engine=await engine();
   if(!active(record))return {opened:false,replaced:true};
   const center=selection.center??[0,0,selection.minZoom];
   const nativeCenter=[center[0],latitude(center[1])];
   const nativeZoom=Math.min(selection.maxZoom,Math.max(selection.minZoom,center[2]??selection.minZoom));
   record.layer=new record.engine.MapLibreLayer({mapLibreOptions:{
    style:selection.styleUrl,center:nativeCenter,zoom:nativeZoom,
    minZoom:selection.minZoom,maxZoom:selection.maxZoom
   }});
   record.map=new record.engine.Map({
    target,layers:[record.layer],
    ...(record.engine.defaultControls?{controls:record.engine.defaultControls({attribution:false,rotate:false})}:{}),
    view:new record.engine.View({center:record.engine.fromLonLat(nativeCenter),
     // The original bridge renders MapLibre zoom = OpenLayers zoom - 1.
     zoom:nativeZoom+1,minZoom:selection.minZoom+1,maxZoom:selection.maxZoom+1,enableRotation:false})
   });
   nativeReady(record);
   listen(record,record.layer,'load',()=>nativeReady(record));
   listen(record,record.map,'moveend',()=>locationRead(record));
   listen(record,record.map,'singleclick',event=>{
    if(!active(record))return;
    try{
     const coordinate=record.engine.toLonLat(event.coordinate,record.map.getView().getProjection());
     const features=(record.map.getFeaturesAtPixel(event.pixel,{hitTolerance:3})??[]).map(featureValue);
     record.feature={key:selection.key,longitude:coordinate[0],latitude:coordinate[1],features};
     report(onFeature,record.feature);
    }catch(error){retainError(record,error);}
   });
   if(typeof ResizeObserver==='function'){
    record.observer=new ResizeObserver(()=>resizeRecord(record));record.observer.observe(target);
   }
   listen(record,record.map,'change:size',()=>{if(record.fitPending)fit();});
   state={...state,stage:'loading',loaded:!!record.layer.loaded};emit();
   if(selection.bounds&&selection.fitOnOpen)fit();
   resizeRecord(record);locationRead(record);
   target.removeAttribute('aria-busy');
   return {opened:true,key:selection.key};
  }catch(error){
   if(active(record)){
    retainError(record,error);current=null;disposeRecord(record);
    state={...state,stage:'error',loaded:false,idle:false};target.removeAttribute('aria-busy');emit();
   }
   throw error;
  }
 }
 function setLayerVisibility(layerId,visible){
  const record=current;if(!active(record)||!record.native)throw new Error('Open the selected map preview first.');
  const layer=record.native.getLayer(layerId);if(!layer)throw new Error('That layer is absent from this selected style.');
  record.native.setLayoutProperty(layerId,'visibility',visible?'visible':'none');
  record.map.render();queueRead(record);
 }
 function setView(value){
  const record=current;if(!active(record)||!record.map)throw new Error('Open the selected map preview first.');
  if(!Array.isArray(value?.center)||value.center.length!==2||!value.center.every(finite)||
   value.center[0]<-180||value.center[0]>180||value.center[1]<-90||value.center[1]>90||!finite(value.zoom))
   throw new Error('A longitude, latitude and native map zoom are required.');
  const view=record.map.getView();view.setCenter(record.engine.fromLonLat([value.center[0],latitude(value.center[1])]));
  view.setZoom(Math.min(record.selection.maxZoom,Math.max(record.selection.minZoom,value.zoom))+1);
  record.map.render();locationRead(record);
 }
 function resize(){if(current)resizeRecord(current);}
 function view(){
  const record=current;
  return {state:clone(state),selection:record?clone(record.selection):null,
   location:clone(record?.location??null),feature:clone(record?.feature??null),
   layers:record?.layersJson?JSON.parse(record.layersJson):[],
   sources:record?.sourcesJson?JSON.parse(record.sourcesJson):[]};
 }
 function close(){if(destroyed)return;reset();}
 function destroy(){if(destroyed)return;reset();destroyed=true;enginePromise=null;}
 return {open,fit,resize,setLayerVisibility,setView,view,close,destroy};
}
