/** Compare two original annual NLCD class grids on the exact same pixel geometry. */
import {NLCD_CODES, prepareZones} from "./original_landcover_zonal.mjs";
const CATEGORY = new Map([
  [11,"water"],[12,"snow_ice"],[21,"developed"],[22,"developed"],[23,"developed"],[24,"developed"],
  [31,"barren"],[41,"forest"],[42,"forest"],[43,"forest"],[52,"shrub"],[71,"grass"],
  [81,"agriculture"],[82,"agriculture"],[90,"wetland"],[95,"wetland"],
]);
function validatePair(beforeGrid, afterGrid, metadata) {
  for (const k of ["width","height"]) if(beforeGrid[k]!==afterGrid[k])
    throw Error("Annual raster "+k+" differs");
  if(beforeGrid.affine.length!==6 || afterGrid.affine.length!==6 ||
     beforeGrid.affine.some((x,i)=>x!==afterGrid.affine[i]))
    throw Error("Annual raster affine grids differ; use the same native cells");
  if(metadata.before?.epsg!==5070 || metadata.after?.epsg!==5070)
    throw Error("Declare EPSG:5070 for both original annual rasters");
  const years=[metadata.before?.year,metadata.after?.year];
  if(!years.every(Number.isInteger)||years[0]>=years[1])
    throw Error("Declare two increasing original annual product years");
  for(const m of [metadata.before,metadata.after])
    if(!/^[a-f0-9]{64}$/.test(m.sha256??""))throw Error("Bind each original raster SHA256");
}
function emptyCounter(size){return {cells:0,paired:0,before_only:0,after_only:0,both_nodata:0,matrix:new Float64Array(size*size)};}
function count(counter,a,b,index,nodataBefore,nodataAfter,size){
  counter.cells++;
  const missingBefore=a===nodataBefore,missingAfter=b===nodataAfter;
  if(missingBefore&&missingAfter){counter.both_nodata++;return;}
  if(missingBefore){counter.after_only++;return;}
  if(missingAfter){counter.before_only++;return;}
  counter.paired++;counter.matrix[index.get(a)*size+index.get(b)]++;
}
function describe(counter,area){
  const n=NLCD_CODES.length,rows=[],margins=[],groups=new Map();
  let stable=0;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const cells=counter.matrix[i*n+j];
    if(i===j)stable+=cells;
    rows.push({before_class:NLCD_CODES[i],after_class:NLCD_CODES[j],cells,area_ha:cells*area/10000});
    const key=CATEGORY.get(NLCD_CODES[i])+"|"+CATEGORY.get(NLCD_CODES[j]);
    groups.set(key,(groups.get(key)||0)+cells);
  }
  for(let i=0;i<n;i++){
    let before=0,after=0;
    for(let j=0;j<n;j++){before+=counter.matrix[i*n+j];after+=counter.matrix[j*n+i];}
    margins.push({class_code:NLCD_CODES[i],before_cells:before,after_cells:after,
      net_cells:after-before,before_area_ha:before*area/10000,after_area_ha:after*area/10000,
      net_area_ha:(after-before)*area/10000});
  }
  return {selected_cells:counter.cells,paired_valid_cells:counter.paired,
    valid_before_only_cells:counter.before_only,valid_after_only_cells:counter.after_only,
    both_nodata_cells:counter.both_nodata,stable_class_cells:stable,changed_class_cells:counter.paired-stable,
    changed_percent_of_paired_valid:counter.paired?100*(counter.paired-stable)/counter.paired:null,
    paired_valid_area_ha:counter.paired*area/10000,classes:margins,transitions:rows,
    grouped_transitions:[...groups].map(([key,cells])=>{const [before_group,after_group]=key.split("|");return {before_group,after_group,cells,area_ha:cells*area/10000};})};
}
async function summarizeAnnualTransitions(features,sourceEpsg,beforeGrid,afterGrid,readBeforeRow,readAfterRow,metadata,idField="huc12"){
  validatePair(beforeGrid,afterGrid,metadata);
  const prepared=prepareZones(features,sourceEpsg,beforeGrid,idField);
  const {zones,starts,grid}=prepared,{width,height}=grid,size=NLCD_CODES.length;
  const area=Math.abs(grid.affine[0]*grid.affine[4]),index=new Map(NLCD_CODES.map((x,i)=>[x,i]));
  const nodataBefore=metadata.before.nodata??250,nodataAfter=metadata.after.nodata??250;
  if(index.has(nodataBefore)||index.has(nodataAfter)||![nodataBefore,nodataAfter].every(x=>Number.isInteger(x)&&x>=0&&x<=255))
    throw Error("NoData must be a distinct unsigned byte code for each raster");
  const full=emptyCounter(size),union=emptyCounter(size),counts=zones.map(()=>emptyCounter(size));
  const active=new Map(),seen=new Uint8Array(width);
  let overlapCells=0;
  for(let row=0;row<height;row++){
    const before=await readBeforeRow(row),after=await readAfterRow(row);
    if(!before||!after||before.length!==width||after.length!==width)throw Error("Annual row width differs at "+row);
    for(let col=0;col<width;col++){
      const a=before[col],b=after[col];
      if((!index.has(a)&&a!==nodataBefore)||(!index.has(b)&&b!==nodataAfter))
        throw Error("Unexpected annual land-cover class at row "+row+", column "+col);
      count(full,a,b,index,nodataBefore,nodataAfter,size);
    }
    seen.fill(0);
    for(const [z,edges]of active){const remaining=edges.filter(e=>e.end>row);if(remaining.length)active.set(z,remaining);else active.delete(z);}
    for(const e of starts[row]){if(!active.has(e.zone))active.set(e.zone,[]);active.get(e.zone).push(e);}
    for(const [z,edges]of active){
      const xs=edges.map(e=>e.u1+(row+0.5-e.v1)*e.slope).sort((a,b)=>a-b);
      if(xs.length%2)throw Error("Odd original polygon intersections at "+zones[z].id+" row "+row);
      for(let k=0;k<xs.length;k+=2){
        const first=Math.max(0,Math.ceil(xs[k]-0.5)),last=Math.min(width,Math.ceil(xs[k+1]-0.5));
        for(let col=first;col<last;col++){
          count(counts[z],before[col],after[col],index,nodataBefore,nodataAfter,size);
          if(!seen[col]){count(union,before[col],after[col],index,nodataBefore,nodataAfter,size);seen[col]=1;}
          else if(seen[col]===1){seen[col]=2;overlapCells++;}
        }
      }
    }
  }
  return {schema:"upstate.annual-landcover-transitions/v1",metadata,grid,source_epsg:sourceEpsg,
    method:{pixel_rule:"centre inclusion; half-open scanline edges; even-odd ring parity",
      temporal_pairing:"same original native-grid pixel in both declared product years",
      cell_area_m2:area,matrix_classes:NLCD_CODES,
      area_scope:"class margins and transition areas use cells valid in both years; unmatched valid cells are reported separately",
      interpretation:"Annual product class transitions. A changed classification alone does not identify cause, timing within the interval, or classification accuracy."},
    raster:describe(full,area),domain:{...describe(union,area),overlap_cells:overlapCells,
      outside_domain_cells:width*height-union.cells},
    [prepared.identifier_kind==="basin"?"basins":"watersheds"]:zones.map((z,i)=>({...(
      prepared.identifier_kind==="basin"?{basin_id:z.id,title:z.title}:{huc12:z.id}),properties:z.properties,...describe(counts[i],area)}))};
}
export {summarizeAnnualTransitions};
