/** Deterministic terrain geometry diagnostic; the native wrapper supplies MFD. */
export function axisDistanceMetres(u, v) {
  const segments = [[[.22, 0], [.5, .6]], [[.78, 0], [.5, .6]], [[.5, .6], [.5, 1]]];
  return 3600 * Math.min(...segments.map(([a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((u-a[0])*dx + (v-a[1])*dy)/(dx*dx+dy*dy)));
    return Math.hypot(u-a[0]-t*dx, v-a[1]-t*dy);
  }));
}
export function revisedElevation(u, v) {
  const centres = v < .60 ? [.50-.28*(1-v/.60), .50+.28*(1-v/.60)] : [.50];
  const d = Math.min(...centres.map(x => Math.abs(u-x)));
  return Number((205 + 60*(1-v) + 120*d + 400*d*d + 4.8*(u-.5)**2).toFixed(6));
}
export function diagnose(recipe, dem = recipe.arrays.DEM) {
  const {width, height, resolution_m} = recipe.grid, n = width*height;
  if (width!==120 || height!==120 || resolution_m!==30 || dem.length!==n)
    throw new Error("This diagnostic selects the original 120x120,30m virtual case");
  const next = new Int32Array(n).fill(-1), accumulation = new Float64Array(n).fill(1);
  const axes = Float64Array.from({length:n}, (_,i) =>
    axisDistanceMetres((i%width+.5)/width, (Math.floor(i/width)+.5)/height));
  const changed = Array.from({length:n}, (_,i) =>
    axes[i] <= 90 && [81,82].includes(recipe.arrays.NLCD[i]));
  const terminal = [];
  // PGP direction-index order; strict slope comparison preserves first exact tie.
  const steps = [[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1],[1,0],[1,1]];
  for (let i=0;i<n;i++) {
    const row=Math.floor(i/width), col=i%width;
    let steepest=0;
    for (const [dr,dc] of steps) {
      const r=row+dr,c=col+dc;
      if (r<0||r>=height||c<0||c>=width) continue;
      const j=r*width+c, slope=(dem[i]-dem[j])/Math.hypot(dr,dc);
      if (slope>steepest) {steepest=slope;next[i]=j;}
    }
    if (next[i]<0) terminal.push(i);
  }
  const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>dem[b]-dem[a]||a-b);
  for (const i of order) if(next[i]>=0) accumulation[next[i]]+=accumulation[i];
  const streams=[100,300].map(threshold=>{
    const cells=order.filter(i=>accumulation[i]>=threshold);
    const interior=cells.filter(i=>Math.floor(i/width)<height-1);
    return {threshold_cells:threshold,threshold_hectares:threshold*.09,
      stream_cells:cells.length,
      stream_cells_inside_90m:cells.filter(i=>axes[i]<=90).length,
      interior_stream_cells:interior.length,
      interior_stream_cells_inside_90m:interior.filter(i=>axes[i]<=90).length,
      stream_cells_on_changed_land:cells.filter(i=>changed[i]).length,
      mean_axis_distance_m:cells.reduce((s,i)=>s+axes[i],0)/cells.length,
      max_axis_distance_m:Math.max(...cells.map(i=>axes[i])),
      changed_cells:changed.filter(Boolean).length,
      row100_central_accumulation:[accumulation[100*width+59],accumulation[100*width+60]]};
  });
  return {method:"independent steepest-slope D8 input-geometry diagnostic",
    native_model_result:false, min_elevation_m:Math.min(...dem),max_elevation_m:Math.max(...dem),
    interior_sinks:terminal.filter(i=>Math.floor(i/width)!==height-1).length,
    terminal_cells:terminal.map(i=>({row:Math.floor(i/width),col:i%width,contributing_cells:accumulation[i]})),
    streams};
}
