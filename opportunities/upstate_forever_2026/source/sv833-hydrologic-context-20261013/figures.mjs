export function renderSV833HydrologyFigure(result) {
 const e=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const collect=(g)=>{const out=[],walk=v=>{if(Array.isArray(v)&&typeof v[0]==="number")out.push(v);else if(Array.isArray(v))v.forEach(walk)};walk(g.coordinates);return out};
 const n=(v,d=2)=>Number(v).toFixed(d);
 const projection=(points,x,y,w,h)=>{
  const lo=Math.min(...points.map(p=>p[0])),hi=Math.max(...points.map(p=>p[0])),south=Math.min(...points.map(p=>p[1])),north=Math.max(...points.map(p=>p[1])),lat0=(south+north)/2,cos=Math.cos(lat0*Math.PI/180),cx=(lo+hi)/2,cy=lat0,spanX=(hi-lo)*cos,spanY=north-south,scale=Math.min(w/spanX,h/spanY)*.88;
  const project=p=>[x+w/2+(p[0]-cx)*cos*scale,y+h/2-(p[1]-cy)*scale];
  return {project,lo,hi,south,north,cos,scale,cx,cy};
 };
 const path=(g,project)=>{
   const line=a=>"M"+a.map(p=>project(p).map(x=>n(x,2)).join(",")).join("L");
   if(g.type==="LineString")return line(g.coordinates);
   if(g.type==="MultiLineString")return g.coordinates.map(line).join("");
   const polygons=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:[];
   return polygons.map(p=>p.map(r=>line(r)+"Z").join("")).join("");
 };
 const frame=(label,p,x,y,w,h)=>{
  let s=`<text x="${x}" y="${y-25}" font-size="18" font-weight="bold">${e(label)}</text><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#888"/>`;
  for(let i=0;i<5;i++){
   const lon=p.lo+(p.hi-p.lo)*i/4,lat=p.south+(p.north-p.south)*i/4,px=p.project([lon,p.cy])[0],py=p.project([p.cx,lat])[1];
   s+=`<line x1="${px}" x2="${px}" y1="${y}" y2="${y+h}" stroke="#eee"/><text x="${px}" y="${y+h+20}" text-anchor="middle" font-size="10">${n(lon,3)}°</text>`;
   s+=`<line x1="${x}" x2="${x+w}" y1="${py}" y2="${py}" stroke="#eee"/><text x="${x-8}" y="${py+3}" text-anchor="end" font-size="10">${n(lat,3)}°</text>`;
  }
  s+=`<path d="M${x+w-24},${y+47}V${y+17}m-5,8l5,-8l5,8" fill="none" stroke="#222"/><text x="${x+w-24}" y="${y+12}" font-size="11" text-anchor="middle">N</text>`;
  return s;
 };
 const basin=result.layers.whole_basin.features[0].geometry;
 const network=result.layers.upstream_reaches.features;
 const p1=projection([...collect(basin),...network.flatMap(f=>collect(f.geometry))],70,75,530,480);
 const p2=projection([...collect(basin),...result.sites.map(s=>[s.longitude,s.latitude])],720,75,340,480);
 let body=frame("Upstream catchments and original reaches",p1,70,75,530,480);
 body+=`<path d="${path(basin,p1.project)}" fill="#ededed" stroke="#666" stroke-width="1.3" fill-rule="evenodd"/>`;
 for(const f of network){const local=f.properties.containing_station_reach;body+=`<path d="${path(f.geometry,p1.project)}" fill="none" stroke="${local?"#111":"#777"}" stroke-width="${local?3:1.2}" stroke-linejoin="round"><title>Original COMID ${f.properties.comid} · ${e(n(f.properties.original_geometry_length_km,3))} km geometric length</title></path>`;}
 const observed=result.original_station_coordinate;
 const [sx,sy]=p1.project(observed);
 body+=`<path d="M${sx-6},${sy}H${sx+6}M${sx},${sy-6}V${sy+6}" stroke="#000" stroke-width="2.6"><title>Original WQP sampling station SV-833</title></path>`;
 body+=`<rect x="${sx+10}" y="${sy-24}" width="83" height="22" fill="white" stroke="#bbb"/><text x="${sx+16}" y="${sy-9}" font-size="12" font-weight="bold">SV-833</text>`;
 const [hx,hy]=p1.project(result.layers.locations.features[2].geometry.coordinates);
 body+=`<circle cx="${hx}" cy="${hy}" r="3" fill="white" stroke="#222"><title>NLDI coordinate hydrolocation · ${n(result.location_comparisons[2].separation_from_original_m,3)} m from original station</title></circle>`;
 body+=`<text x="70" y="603" font-size="13">45 original whole reaches · ${n(result.network_length_km,3)} km summed geometric length</text><text x="70" y="626" font-size="13">Dark reach: COMID ${result.comid} · cross: original station location</text><text x="70" y="649" font-size="13">Basin retains whole catchments, including the containing catchment.</text>`;
 body+=frame("Downstream indexed NWIS sites",p2,720,75,340,480);
 body+=`<path d="${path(basin,p2.project)}" fill="#ddd" stroke="#777" stroke-width="1" fill-rule="evenodd"/>`;
 const station=p2.project(observed);
 body+=`<path d="M${station[0]-5},${station[1]}H${station[0]+5}M${station[0]},${station[1]-5}V${station[1]+5}" stroke="#111" stroke-width="2"/><text x="${station[0]-11}" y="${station[1]-10}" text-anchor="end" font-size="11">SV-833</text>`;
 const groups=new Map();for(const site of result.sites){const key=site.longitude+","+site.latitude;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(site);}
 for(const sites of groups.values()){
  const [x,y]=p2.project([sites[0].longitude,sites[0].latitude]),indices=sites.map(s=>result.sites.indexOf(s)+1);
  body+=`<circle cx="${x}" cy="${y}" r="${sites.length>1?5:3.5}" fill="#333" stroke="white" stroke-width=".5"><title>${e(sites.map(s=>s.site_id+" · "+s.name).join(" | "))}</title></circle>`;
 }
 // Three group labels identify broad clusters without implying flow paths between indexed sites.
 for(const id of ["USGS-02187000","USGS-02187250","USGS-02189000"]){
  const site=result.sites.find(s=>s.site_id===id);if(!site)continue;const [x,y]=p2.project([site.longitude,site.latitude]);
  const label=id==="USGS-02187000"?"Seneca / Anderson":id==="USGS-02187250"?"Hartwell":"Calhoun Falls";
  body+=`<text x="${x>950?x-10:x+10}" y="${y-9}" text-anchor="${x>950?"end":"start"}" font-size="11">${e(label)}</text>`;
 }
 body+=`<text x="720" y="603" font-size="13">100 km downstream-mainstem query: 14 indexed sites.</text><text x="720" y="626" font-size="13">Site positions are shown; a connecting route is not drawn.</text><text x="720" y="649" font-size="13">Current parameter/date coverage is a separate source check.</text>`;
 body+=`<text x="70" y="688" font-size="12">Original NLDI GeoJSON · longitude/latitude graticule · local equirectangular display in each panel · source capture 2026-10-13</text>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="720" viewBox="0 0 1120 720" role="img" aria-labelledby="hydrology-title hydrology-desc"><title id="hydrology-title">SV-833 original upstream network and downstream indexed monitoring sites</title><desc id="hydrology-desc">Left: original full upstream catchment polygon and all 45 whole reaches, with the original sampling point and NLDI hydrolocation. Right: the 14 original downstream-mainstem NWIS surface-water site positions. Both panels retain original source coordinates.</desc><rect width="1120" height="720" fill="white"/><g font-family="Arial,Helvetica,sans-serif" fill="#222">${body}</g></svg>\n`;
}
