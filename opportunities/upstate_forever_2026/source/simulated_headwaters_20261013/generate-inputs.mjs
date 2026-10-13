/** Deterministic simulated input recipe for the maintained Upper Savannah demo.
 * No model outputs are computed here. The native Workspace executes NDR and SDR.
 */
export const DEMO_ID = "upstate-simulated-piedmont-headwaters-v1";
export const TITLE = "Simulated Piedmont headwaters — conservation demonstration";
export function buildInputs() {
  const width=120,height=120,resolution=30,west=330000,north=3861000;
  const arrays={DEM:[],NLCD:[],PRECIPITATION:[],R_FACTOR:[],K_FACTOR:[],RESTORATION_MASK:[]};
  const round=(n,digits=6)=>Number(n.toFixed(digits));
  const centres=v=>v<.60?[.50-.28*(1-v/.60),.50+.28*(1-v/.60)]:[.50];
  const segmentDistance=(u,v,ax,ay,bx,by)=>{
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((u-ax)*dx+(v-ay)*dy)/(dx*dx+dy*dy)));
    return Math.hypot(u-ax-t*dx,v-ay-t*dy)*width*resolution;
  };
  const streamDistance=(u,v)=>Math.min(segmentDistance(u,v,.22,0,.5,.6),
    segmentDistance(u,v,.78,0,.5,.6),segmentDistance(u,v,.5,.6,.5,1));
  const ellipse=(u,v,x,y,rx,ry)=>((u-x)/rx)**2+((v-y)/ry)**2<1;
  for(let row=0;row<height;row++){
    const v=(row+.5)/height;
    for(let col=0;col<width;col++){
      const u=(col+.5)/width,d=Math.min(...centres(v).map(x=>Math.abs(u-x)));
      // Two upland tributary valleys join a south-flowing trunk. Positive
      // downslope relief and convex valley sides give real routing terrain.
      const elevation=205+150*(1-v)+250*d*d+12*(u-.5)**2;
      let landcover=41;
      if(ellipse(u,v,.70,.36,.19,.27)||ellipse(u,v,.56,.82,.27,.16))landcover=82;
      if(ellipse(u,v,.30,.55,.22,.29))landcover=81;
      if(v>.20&&Math.abs(u-(.12+.025*Math.sin(v*6)))<.022)landcover=21;
      if(d*width*resolution<20)landcover=41;
      const precipitation=1375+210*(1-v)+25*(u-.5);
      const erosivity=4300+450*(1-v)+120*u;
      const erodibility=.025+.008*v+.003*u;
      arrays.DEM.push(round(elevation));arrays.NLCD.push(landcover);
      arrays.PRECIPITATION.push(round(precipitation));arrays.R_FACTOR.push(round(erosivity));
      arrays.K_FACTOR.push(round(erodibility,8));
      arrays.RESTORATION_MASK.push(streamDistance(u,v)<=90?1:0);
    }
  }
  const codes=[21,41,81,82],counts=Object.fromEntries(codes.map(code=>[code,arrays.NLCD.filter(x=>x===code).length]));
  const treatment=arrays.NLCD.map((code,i)=>arrays.RESTORATION_MASK[i]&&[81,82].includes(code)?41:code);
  const changed=arrays.NLCD.flatMap((code,i)=>code===treatment[i]?[]:[i]);
  const areaHa=resolution*resolution/10000;
  const bounds=[west,north-height*resolution,west+width*resolution,north];
  const polygon=(id,title,ring)=>({type:"Feature",id,properties:{demo_id:DEMO_ID,simulated:true,id,title},
    geometry:{type:"Polygon",coordinates:[ring]}});
  const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
  const domain=polygon("SIM_HEADWATERS","Simulated model and reporting watershed",rect(...bounds));
  const drinking=polygon("SIM_SOURCE_WATER","Simulated source-water planning area",
    rect(west+resolution*35,north-height*resolution,west+resolution*85,north-resolution*55));
  const highQuality=polygon("SIM_HEADWATER_PRIORITY","Simulated headwater priority area",
    rect(west+resolution*10,north-resolution*58,west+resolution*65,north-resolution*4));
  const protection=polygon("SIM_EXISTING_PROTECTION","Simulated existing protected parcel",
    rect(west+resolution*82,north-resolution*25,west+resolution*116,north-resolution*4));
  const allFinite=Object.entries(arrays).every(([role,values])=>values.length===width*height&&values.every(Number.isFinite));
  if(!allFinite||!changed.length||!codes.every(code=>counts[code]>0))throw Error("Incomplete simulated input recipe");
  const noLower=[];
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const i=row*width+col,z=arrays.DEM[i];
    let lower=false;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const y=row+dy,x=col+dx;
      if(y>=0&&y<height&&x>=0&&x<width&&arrays.DEM[y*width+x]<z)lower=true;
    }
    if(!lower)noLower.push({row,col,elevation_m:z,boundary:row===0||col===0||row===height-1||col===width-1});
  }
  if(noLower.some(cell=>!cell.boundary))throw Error("The simulated terrain contains an unintended interior pit");
  return {
    schema:"upstate.simulated-input-recipe/v1",demo_id:DEMO_ID,title:TITLE,
    classification:"SIMULATED DEMONSTRATION INPUTS",
    model_version:"3.20.0",created_for:"Bryce owner request 2026-10-13",
    grid:{width,height,resolution_m:resolution,pixel_area_ha:areaHa,crs:"EPSG:26917",
      transform:[resolution,0,west,0,-resolution,north],bounds},
    arrays,features:{model_domain:domain,reporting_area:domain,drinking_water:drinking,
      high_quality:highQuality,existing_protection:protection},
    scenario:{title:"Simulated 90 m riparian restoration",from_codes:[81,82],to_code:41,
      mask_role:"RESTORATION_MASK",baseline_title:"Simulated present land cover",
      reason:"Convert simulated pasture and cultivated-crop cells within a true 90 m Euclidean buffer of the generated stream-axis line segments to forest; retain developed and existing forest cells."},
    input_summary:{cells:width*height,area_ha:width*height*areaHa,baseline_class_cells:counts,
      alternative_class_cells:Object.fromEntries(codes.map(code=>[code,treatment.filter(x=>x===code).length])),
      changed_cells:changed.length,changed_area_ha:round(changed.length*areaHa,4),
      by_original_class:Object.fromEntries([81,82].map(code=>[code,changed.filter(i=>arrays.NLCD[i]===code).length])),
      terrain_local_minima:noLower,
      ranges:Object.fromEntries(Object.entries(arrays).map(([role,values])=>[role,{minimum:Math.min(...values),maximum:Math.max(...values)}]))},
    assumptions:[
      "All terrain, land-cover cells, source areas, parcel boundaries and parameter values in this package are simulated; this is not an observed catchment or an official designation.",
      "The 3.6 km square uses projected metre coordinates in the Upper Savannah region only to exercise the application's real geospatial contracts.",
      "The synthetic drainage surface has two tributary valleys joining a south-flowing trunk. Native InVEST computes the actual drainage and export results from this terrain.",
      "Annual precipitation, rainfall erosivity and soil erodibility are smooth, positive demonstration gradients. They are input assumptions, not downloaded regional climatology or soil estimates.",
      "Land-cover integers follow the application's expected NLCD-style schema: 21 developed/open space, 41 deciduous forest, 81 pasture/hay, 82 cultivated crops.",
      "The conservation case changes only the selected pasture/crop land-cover cells. The grid, terrain, climate, soil factors, profile and geographic support remain paired.",
      "Any claimed nutrient or sediment change must be read from actual completed native model results. No export totals, reductions or run times are embedded in this generator."
    ]
  };
}
