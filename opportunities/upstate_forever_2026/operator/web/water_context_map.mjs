/** Water and Habitat Context map. Authored by TokenJunkieLabs. */
const NS='http://www.w3.org/2000/svg';
const STYLES={
  selection:{label:'Reporting selection',stroke:'#222',fill:'none',width:2.2},
  huc:{label:'HUC boundary',stroke:'#777',fill:'none',width:1,dash:'5 3'},
  utility:{label:'Utility boundary',stroke:'#333',fill:'none',width:1.5,dash:'9 3'},
  wetlands:{label:'NWI aquatic inventory',stroke:'#686868',fill:'#b4b4b4',width:.7,opacity:.55},
  mapping_status:{label:'NWI mapping coverage',stroke:'#888',fill:'#eeeeee',width:.6,opacity:.65},
  flowlines:{label:'NHD mapped flowlines',stroke:'#454545',fill:'none',width:1.2},
  waterbodies:{label:'NHD waterbodies',stroke:'#666',fill:'#bcbcbc',width:1,opacity:.7},
  protected_lands:{label:'PAD-US inventory overlap',stroke:'#777',fill:'#dedede',width:1,dash:'3 2',opacity:.5},
  stream_order:{label:'Authoritative stream order',stroke:'#111',fill:'none',width:2,dash:'2 2'}
};
function element(tag,attrs={}){
  const value=document.createElementNS(NS,tag);
  for(const [key,item] of Object.entries(attrs))value.setAttribute(key,String(item));
  return value;
}
function node(tag,text,className){
  const value=document.createElement(tag);
  if(text!==undefined)value.textContent=text;
  if(className)value.className=className;
  return value;
}
function coordinates(geometry,visit){
  if(!geometry)return;
  if(geometry.type==='GeometryCollection'){for(const g of geometry.geometries||[])coordinates(g,visit);return;}
  function walk(value){
    if(Array.isArray(value)&&value.length>=2&&typeof value[0]==='number'){
      if(Number.isFinite(value[0])&&Number.isFinite(value[1])&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90)visit(value[0],value[1]);
    }else if(Array.isArray(value))for(const v of value)walk(v);
  }
  walk(geometry.coordinates);
}
function geometryPath(geometry,project){
  if(!geometry)return '';
  const chain=(values,close)=>{
    const points=values.map(v=>project(v[0],v[1]));
    if(!points.length||points.some(v=>!v.every(Number.isFinite)))return '';
    return points.map((p,i)=>(i?'L':'M')+p[0].toFixed(5)+' '+p[1].toFixed(5)).join(' ')+(close?'Z':'');
  };
  if(geometry.type==='Polygon')return geometry.coordinates.map(v=>chain(v,true)).join(' ');
  if(geometry.type==='MultiPolygon')return geometry.coordinates.flatMap(p=>p.map(v=>chain(v,true))).join(' ');
  if(geometry.type==='LineString')return chain(geometry.coordinates,false);
  if(geometry.type==='MultiLineString')return geometry.coordinates.map(v=>chain(v,false)).join(' ');
  if(geometry.type==='GeometryCollection')return (geometry.geometries||[]).map(g=>geometryPath(g,project)).join(' ');
  return '';
}
export function createWaterContextMap(container,preview){
  const features=preview?.geojson?.features||[];
  container.replaceChildren();
  const toolbar=node('div',undefined,'wc-map-toolbar');
  const canvas=node('div',undefined,'wc-map-canvas');
  const detail=node('div',undefined,'wc-feature-detail');
  const legend=node('div',undefined,'wc-map-legend');
  const notes=node('p',undefined,'wc-note');
  container.append(toolbar,canvas,legend,notes,detail);
  if(!features.length){canvas.append(node('p','No preview geometry is available for this saved analysis.'));return {destroy(){}};}
  let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
  for(const feature of features)coordinates(feature.geometry,(lon,lat)=>{
    minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);
  });
  if(!Number.isFinite(minLon)){canvas.append(node('p','The preview contains no finite WGS84 coordinates.'));return {destroy(){}};}
  const cosine=Math.max(.001,Math.cos((minLat+maxLat)*Math.PI/360));
  const project=(lon,lat)=>[(lon-minLon)*cosine,maxLat-lat];
  const width=Math.max((maxLon-minLon)*cosine,.000001),height=Math.max(maxLat-minLat,.000001);
  const pad=Math.max(width,height)*.04;
  const initial={x:-pad,y:-pad,w:width+2*pad,h:height+2*pad};
  let view={...initial},drag=null,destroyed=false;
  const svg=element('svg',{role:'img',tabindex:'0','aria-label':'Water and habitat map. Drag to pan; use plus and minus to zoom.','preserveAspectRatio':'xMidYMid meet'});
  svg.classList.add('wc-map-svg');
  canvas.append(svg);
  const roles=[...new Set(features.map(f=>f.properties?.context_role||'unknown'))];
  const layers=new Map();
  for(const role of roles){
    const group=element('g',{'data-role':role});layers.set(role,group);svg.append(group);
  }
  let selectedPath=null;
  function inspect(feature,path){
    if(selectedPath)selectedPath.classList.remove('wc-feature-selected');
    selectedPath=path;selectedPath?.classList.add('wc-feature-selected');detail.replaceChildren();
    const props=feature.properties||{};
    detail.append(node('h4',props.label||props.feature_id||'Selected feature'));
    detail.append(node('p',(STYLES[props.context_role]?.label||props.context_role||'Context')+
      ' · source '+(props.source_id||'')+' · '+(props.identity_kind==='native_feature'?'native ID ':'derived component ')+(props.feature_id||''),'wc-note'));
    const table=node('table'),body=node('tbody');
    for(const [key,value] of Object.entries(props.native_properties||{})){
      const row=node('tr');row.append(node('th',key),node('td',typeof value==='object'?JSON.stringify(value):String(value??'')));body.append(row);
    }
    table.append(body);detail.append(table);
  }
  features.forEach((feature,index)=>{
    const role=feature.properties?.context_role||'unknown',style=STYLES[role]||{stroke:'#555',fill:'none',width:1};
    const data=geometryPath(feature.geometry,project);if(!data)return;
    const path=element('path',{d:data,stroke:style.stroke,fill:style.fill,'stroke-width':style.width,
      'fill-opacity':style.opacity??1,'fill-rule':'evenodd','vector-effect':'non-scaling-stroke','data-feature':index});
    if(style.dash)path.setAttribute('stroke-dasharray',style.dash);
    if(role==='mapping_status'){
      const props=feature.properties?.native_properties||{};
      const status=Object.entries(props).find(([k])=>k.toLowerCase().split('.').at(-1)==='status')?.[1];
      const shades={Digital:'#eee',No_Data:'#a6a6a6',Unknown:'#ccc',Conflict:'#888'};
      path.setAttribute('fill',shades[status]||'#ccc');
    }
    const title=element('title');title.textContent=feature.properties?.label||feature.properties?.feature_id||style.label;
    path.append(title);
    path.addEventListener('click',event=>{if(!drag?.moved)inspect(feature,path);event.stopPropagation();});
    layers.get(role).append(path);
  });
  // Place the reporting outline above thematic fills.
  if(layers.has('selection'))svg.append(layers.get('selection'));
  function display(){svg.setAttribute('viewBox',[view.x,view.y,view.w,view.h].join(' '));}
  function zoom(factor,point){
    const nw=view.w/factor,nh=view.h/factor;
    if(nw<initial.w/10000||nw>initial.w*50)return;
    const px=point?.x??(view.x+view.w/2),py=point?.y??(view.y+view.h/2);
    view={x:px-(px-view.x)/factor,y:py-(py-view.y)/factor,w:nw,h:nh};display();
  }
  const fit=node('button','Fit'),plus=node('button','Zoom in'),minus=node('button','Zoom out');
  for(const button of [fit,plus,minus])button.type='button';
  fit.addEventListener('click',()=>{view={...initial};display();});
  plus.addEventListener('click',()=>zoom(1.4));minus.addEventListener('click',()=>zoom(1/1.4));
  toolbar.append(fit,plus,minus,node('span','Drag to pan · click a feature for native attributes','wc-note'));
  for(const role of roles){
    const label=node('label'),check=node('input');check.type='checkbox';check.checked=true;
    check.addEventListener('change',()=>{layers.get(role).style.display=check.checked?'':'none';});
    const mark=node('span',undefined,'wc-legend-swatch');mark.style.borderColor=(STYLES[role]||{}).stroke||'#777';
    mark.style.background=(STYLES[role]||{}).fill==='none'?'white':((STYLES[role]||{}).fill||'#ddd');
    label.append(check,mark,node('span',STYLES[role]?.label||role));legend.append(label);
  }
  notes.textContent=String(preview.shown_features??features.length)+' of '+String(preview.feature_count??features.length)+
    ' derived features shown. Display simplification: '+String(preview.display_simplification_m??0)+
    ' m. Quantities use the full analysis geometry; full geometry is available in the GeoJSON export.';
  function svgPoint(event){
    const matrix=svg.getScreenCTM();
    if(!matrix)return {x:view.x+view.w/2,y:view.y+view.h/2};
    const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    return point.matrixTransform(matrix.inverse());
  }
  const pointerDown=event=>{
    if(event.button!==0)return;
    drag={x:event.clientX,y:event.clientY,view:{...view},moved:false};
    svg.setPointerCapture(event.pointerId);
  };
  const pointerMove=event=>{
    if(!drag)return;
    const rect=svg.getBoundingClientRect(),scale=Math.min(rect.width/drag.view.w,rect.height/drag.view.h);
    if(!scale)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    drag.moved=drag.moved||Math.abs(dx)+Math.abs(dy)>4;
    view={...drag.view,x:drag.view.x-dx/scale,y:drag.view.y-dy/scale};display();
  };
  const pointerUp=event=>{
    if(drag&&!drag.moved){
      const path=document.elementFromPoint(event.clientX,event.clientY)?.closest('path[data-feature]');
      if(path&&svg.contains(path))inspect(features[Number(path.getAttribute('data-feature'))],path);
    }
    const previous=drag;setTimeout(()=>{if(drag===previous)drag=null;},0);
  };
  const wheel=event=>{event.preventDefault();zoom(event.deltaY<0?1.2:1/1.2,svgPoint(event));};
  const keydown=event=>{
    if(event.key==='+'||event.key==='=')zoom(1.4);
    else if(event.key==='-')zoom(1/1.4);
    else if(event.key==='Home'){view={...initial};display();}
    else if(event.key.startsWith('Arrow')){
      const step=.12;if(event.key==='ArrowLeft')view.x-=view.w*step;if(event.key==='ArrowRight')view.x+=view.w*step;
      if(event.key==='ArrowUp')view.y-=view.h*step;if(event.key==='ArrowDown')view.y+=view.h*step;display();
    }else return;event.preventDefault();
  };
  svg.addEventListener('pointerdown',pointerDown);svg.addEventListener('pointermove',pointerMove);
  svg.addEventListener('pointerup',pointerUp);svg.addEventListener('pointercancel',pointerUp);
  svg.addEventListener('wheel',wheel,{passive:false});svg.addEventListener('keydown',keydown);display();
  return {destroy(){if(destroyed)return;destroyed=true;drag=null;container.replaceChildren();}};
}
