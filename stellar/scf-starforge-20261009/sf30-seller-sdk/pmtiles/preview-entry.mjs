// MIT. Actual OpenLayers and Geoblocks MapLibre rendering of the selected native release.
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {fromLonLat,toLonLat} from 'ol/proj.js';
import {defaults as defaultControls} from 'ol/control/defaults.js';
import {MapLibreLayer} from '@geoblocks/ol-maplibre-layer';
import {setWorkerUrl} from 'maplibre-gl';
import 'ol/ol.css';
import 'maplibre-gl/dist/maplibre-gl.css';

export async function createNativeMap(target,{style,workerUrl,signal,onError=()=>{}}={}){
  if(!(target instanceof HTMLElement)||typeof workerUrl!=='string')throw Error('A visible map target and original worker URL are required.');
  const selected=new URL(style,location.href),worker=new URL(workerUrl,location.href);
  if(selected.origin!==location.origin||worker.origin!==location.origin)throw Error('The native preview must use this workspace origin.');
  const response=await fetch(selected.href,{cache:'no-store',signal});
  if(!response.ok)throw Error('The selected native style is no longer available.');
  const original=await response.json();signal?.throwIfAborted();
  setWorkerUrl(worker.href);
  const layer=new MapLibreLayer({mapLibreOptions:{style:selected.href,attributionControl:false,preserveDrawingBuffer:false}});
  const map=new Map({target,layers:[layer],controls:defaultControls({attribution:false}),
    view:new View({center:fromLonLat(original.center??[0,0]),zoom:original.zoom??2,maxZoom:26})});
  let closed=false;
  const onNativeError=event=>{if(!closed)onError(event.error??event);};
  const attach=()=>{
    const native=layer.mapLibreMap;
    if(native)native.on('error',onNativeError);
  };
  layer.on('load',attach);
  if(layer.mapLibreMap)attach();
  const resize=new ResizeObserver(()=>{if(!closed)map.updateSize();});resize.observe(target);map.updateSize();
  return Object.freeze({
    view(){const v=map.getView(),center=toLonLat(v.getCenter());return {center:[center[0],center[1]],zoom:v.getZoom()};},
    dispose(){
      if(closed)return;closed=true;resize.disconnect();layer.un('load',attach);
      layer.mapLibreMap?.off('error',onNativeError);map.setTarget(undefined);map.removeLayer(layer);layer.dispose();map.dispose();
    }
  });
}
