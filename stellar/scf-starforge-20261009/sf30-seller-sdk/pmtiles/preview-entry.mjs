// MIT. Original installed OpenLayers / MapLibre release preview.
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {fromLonLat,toLonLat} from 'ol/proj.js';
import {defaults as defaultControls} from 'ol/control/defaults.js';
import {MapLibreLayer} from '@geoblocks/ol-maplibre-layer';
import {setWorkerUrl} from 'maplibre-gl';
import {createReleaseMapPreview} from './preview.mjs';
import 'ol/ol.css';
import 'maplibre-gl/dist/maplibre-gl.css';

function localUrl(value,label){
  if(typeof value!=='string'||!value)throw Error(label+' is required.');
  const url=new URL(value,location.href);
  if(url.origin!==location.origin||url.username||url.password)throw Error(label+' must use this original workspace.');
  return url.href;
}
const clone=value=>JSON.parse(JSON.stringify(value));
export async function createNativeMap(target,{
  style,workerUrl,signal,selection={},onState=()=>{},onLayers=()=>{},onSources=()=>{},
  onLocation=()=>{},onFeature=()=>{},onError=()=>{}
}={}){
  if(!(target instanceof HTMLElement))throw TypeError('The original map element is required.');
  const styleUrl=localUrl(style,'The selected style'),worker=localUrl(workerUrl,'The installed map worker');
  signal?.throwIfAborted();
  const response=await fetch(styleUrl,{cache:'no-store',signal});
  if(!response.ok)throw Error('The selected native style returned HTTP '+response.status+'.');
  const selected=await response.json();
  if(selected?.version!==8||!selected.sources||!Array.isArray(selected.layers))throw Error('The selected release has no complete MapLibre v8 style.');
  signal?.throwIfAborted();setWorkerUrl(worker);
  const originalCenter=Array.isArray(selected.center)&&selected.center.length===2?selected.center:[0,0];
  const originalZoom=Number.isFinite(selected.zoom)?selected.zoom:2;
  const initialView={center:[...originalCenter],zoom:originalZoom};
  const engine={Map,View,fromLonLat,toLonLat,MapLibreLayer,defaultControls};
  let disposed=false;
  const preview=createReleaseMapPreview({
    target,loadEngine:async()=>engine,
    onState:value=>{if(!disposed)onState(value);},
    onLayers:value=>{if(!disposed)onLayers(value);},
    onSources:value=>{if(!disposed)onSources(value);},
    onLocation:value=>{if(!disposed)onLocation(value);},
    onFeature:value=>{if(!disposed)onFeature(value);},
    onError:value=>{if(!disposed)onError(value);}
  });
  const dispose=()=>{if(disposed)return;disposed=true;signal?.removeEventListener('abort',dispose);preview.destroy();};
  signal?.addEventListener('abort',dispose,{once:true});
  try{
    const opened=await preview.open({
      ...selection,key:selection.key??styleUrl,styleUrl,
      center:[...originalCenter,originalZoom],
      minZoom:selection.minZoom??0,maxZoom:selection.maxZoom??24,
      fitOnOpen:!Array.isArray(selected.center)&&!!selection.bounds
    });
    signal?.throwIfAborted();
    if(!opened.opened||disposed)throw Error('The selected native preview was replaced.');
    return Object.freeze({
      view(){
        const location=preview.view().location;if(!location)throw Error('The native map view is still opening.');
        const longitude=((location.longitude+180)%360+360)%360-180;
        return {center:[longitude,location.latitude],zoom:location.zoom};
      },
      observation(){return {...preview.view(),originalView:clone(initialView)};},
      fit(){return preview.fit();},
      restoreView(){preview.setView(initialView);},
      resize(){preview.resize();},
      setLayerVisibility(id,visible){preview.setLayerVisibility(id,visible);},
      dispose
    });
  }catch(error){dispose();throw error;}
}
