/** Native-grid land-cover areas from retained NAD83 or EPSG:5070 polygons.
 * Albers equations: USGS Professional Paper 1395, equations 3-12,14-12..18.
 * https://pubs.usgs.gov/pp/1395/report.pdf
 * https://proj.org/en/stable/operations/projections/aea.html
 */
const NLCD_CODES = [11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95];
function nad83To5070(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) >= 90)
    throw Error("Expected finite NAD83 longitude/latitude in degrees");
  const rad=Math.PI/180, a=6378137, f=1/298.257222101, e2=f*(2-f), e=Math.sqrt(e2);
  function q(phi) {
    const s=Math.sin(phi), es=e*s;
    return (1-e2)*(s/(1-es*es)-Math.log((1-es)/(1+es))/(2*e));
  }
  function m(phi) {const s=Math.sin(phi);return Math.cos(phi)/Math.sqrt(1-e2*s*s);}
  const p1=29.5*rad,p2=45.5*rad,n=(m(p1)**2-m(p2)**2)/(q(p2)-q(p1));
  const c=m(p1)**2+n*q(p1),rho=a*Math.sqrt(c-n*q(lat*rad))/n;
  const rho0=a*Math.sqrt(c-n*q(23*rad))/n,theta=n*(lon+96)*rad;
  return [rho*Math.sin(theta),rho0-rho*Math.cos(theta)];
}
function exactRings(feature) {
  const g=feature.geometry;
  if (!g || g.curveRings || g.curvePaths) throw Error("Supply the retained ordinary polygon rings");
  if (g.rings) return g.rings;
  if (g.type==="Polygon") return g.coordinates;
  if (g.type==="MultiPolygon") return g.coordinates.flat();
  throw Error("Expected polygon or multipolygon geometry");
}
function prepareZones(features, sourceEpsg, grid, idField="huc12") {
  if (![4269,5070].includes(sourceEpsg))
    throw Error("Declare the actual retained source CRS; supported EPSG:4269 and EPSG:5070");
  const [dx,rx,x0,ry,dy,y0]=grid.affine, {width,height}=grid;
  if (!(dx>0 && dy<0 && rx===0 && ry===0 && Number.isInteger(width) && Number.isInteger(height)))
    throw Error("Expected a north-up regular native grid");
  const starts=Array.from({length:height},()=>[]),ids=new Set(),zones=[];
  let vertexCount=0;
  for (const feature of features) {
    const props=feature.attributes||feature.properties||{},id=String(props[idField]??"");
    if (!/^\d{12}$/.test(id)||ids.has(id)) throw Error("Expected unique original HUC12 identifiers");
    ids.add(id);
    const rings=exactRings(feature),zone=zones.length;
    if (!rings.length) throw Error("Empty original polygon: "+id);
    let minU=Infinity,minV=Infinity,maxU=-Infinity,maxV=-Infinity,edges=0;
    for(const ring of rings){
      if(ring.length<4)throw Error("Short original polygon ring: "+id);
      if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error("Open original ring: "+id);
      const points=ring.map(p=>{
        const xy=sourceEpsg===4269?nad83To5070(p[0],p[1]):[p[0],p[1]];
        if(!xy.every(Number.isFinite))throw Error("Nonfinite original coordinate");
        const u=(xy[0]-x0)/dx,v=(xy[1]-y0)/dy;
        minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);
        return[u,v];
      });
      vertexCount+=points.length;
      for(let j=0;j<points.length-1;j++){
        const [u1,v1]=points[j],[u2,v2]=points[j+1];
        if(v1===v2)continue;
        const begin=Math.ceil(Math.min(v1,v2)-0.5),end=Math.ceil(Math.max(v1,v2)-0.5);
        if(begin===end)continue;
        const slope=(u2-u1)/(v2-v1),first=Math.max(0,begin),last=Math.min(height,end);
        if(first<last){starts[first].push({zone,u1,v1,slope,end:last});edges++;}
      }
    }
    if(minU<0||minV<0||maxU>width||maxV>height)
      throw Error("Full original polygon extends beyond the supplied raster: "+id);
    zones.push({huc12:id,properties:props,ring_count:rings.length,edge_count:edges,
      bounds_pixel:[minU,minV,maxU,maxV],counts:Array(256).fill(0),cell_count:0,nodata_count:0});
  }
  return {schema:"upstate.landcover-zones/v1",grid,source_epsg:sourceEpsg,id_field:idField,
    vertex_count:vertexCount,zones,starts};
}
async function summarizeRows(prepared, readRow, metadata={}) {
  const {grid,zones,starts}=prepared,{width,height}=grid,area=Math.abs(grid.affine[0]*grid.affine[4]);
  const nodata=metadata.nodata??250,valid=new Set(NLCD_CODES),active=new Map();
  const fullCounts=Array(256).fill(0),unionCounts=Array(256).fill(0),pairs=new Map();
  const owner=new Int32Array(width),overlap=new Uint8Array(width);
  let unionCells=0,overlapCells=0,outsideCells=0,totalNoData=0;
  for(let row=0;row<height;row++){
    const pixels=await readRow(row);
    if(!pixels||pixels.length!==width)throw Error("Native raster row width differs at "+row);
    for(const v of pixels){
      if(!Number.isInteger(v)||(!valid.has(v)&&v!==nodata))throw Error("Unexpected source class "+v+" in row "+row);
      fullCounts[v]++;
      if(v===nodata)totalNoData++;
    }
    owner.fill(-1);overlap.fill(0);
    for(const [zone,edges] of active){const remaining=edges.filter(e=>e.end>row);if(remaining.length)active.set(zone,remaining);else active.delete(zone);}
    for(const edge of starts[row]){if(!active.has(edge.zone))active.set(edge.zone,[]);active.get(edge.zone).push(edge);}
    for(const [zone,edges] of active){
      const xs=edges.map(e=>e.u1+(row+0.5-e.v1)*e.slope).sort((a,b)=>a-b);
      if(xs.length%2)throw Error("Odd scanline intersection count: "+zones[zone].huc12+" row "+row);
      const output=zones[zone];
      for(let k=0;k<xs.length;k+=2){
        const first=Math.max(0,Math.ceil(xs[k]-0.5)),last=Math.min(width,Math.ceil(xs[k+1]-0.5));
        for(let col=first;col<last;col++){
          const code=pixels[col];output.counts[code]++;output.cell_count++;if(code===nodata)output.nodata_count++;
          if(owner[col]===-1){owner[col]=zone;unionCounts[code]++;unionCells++;}
          else if(owner[col]!==zone){
            if(!overlap[col]){overlap[col]=1;overlapCells++;}
            const pair=[zones[owner[col]].huc12,output.huc12].sort().join("|");
            pairs.set(pair,(pairs.get(pair)||0)+1);
          }
        }
      }
    }
    for(let col=0;col<width;col++)if(owner[col]===-1)outsideCells++;
  }
  const classRows=(counts)=>NLCD_CODES.map(code=>({class_code:code,cells:counts[code],area_m2:counts[code]*area,area_ha:counts[code]*area/10000}));
  return {schema:"upstate.landcover-zonal-summary/v1",metadata,grid,source_epsg:prepared.source_epsg,
    method:{pixel_rule:"centre inclusion; half-open scanline edges; even-odd ring parity",
      coordinate_conversion:prepared.source_epsg===4269?"NAD83 GRS80 ellipsoidal Albers, EPSG:5070":"original EPSG:5070 coordinates",
      polygon_edges:"straight segments between transformed original vertices",
      cell_area_m2:area,source_vertex_count:prepared.vertex_count,
      coverage:"every original polygon is wholly inside the supplied native raster rectangle"},
    raster:{cell_count:width*height,nodata_count:totalNoData,classes:classRows(fullCounts)},
    domain:{unique_cells:unionCells,overlap_cells:overlapCells,outside_domain_cells:outsideCells,
      nodata_cells:unionCounts[nodata],classes:classRows(unionCounts),
      overlaps:[...pairs].map(([key,cells])=>({huc12s:key.split("|"),cells}))},
    watersheds:zones.map(z=>({huc12:z.huc12,properties:z.properties,ring_count:z.ring_count,
      selected_cells:z.cell_count,nodata_cells:z.nodata_count,area_m2:z.cell_count*area,
      valid_area_m2:(z.cell_count-z.nodata_count)*area,classes:classRows(z.counts)}))};
}
export {NLCD_CODES,nad83To5070,prepareZones,summarizeRows};
