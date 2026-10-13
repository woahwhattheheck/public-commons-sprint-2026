/** Original simulated headwaters input accounting, before native retention/delivery.
 * Consume the retained input-recipe, matched-control and original biophysical CSV.
 * This does not estimate native stream export, LS, connectivity or calibration.
 */
export function analyzeInputs(recipe, control, coefficientRows, sources) {
  const fail = message => { throw new Error(message); };
  const finite = (v, name) => Number.isFinite(v) ? v : fail("Nonfinite " + name);
  if (recipe.schema !== "upstate.simulated-input-recipe/v1" ||
      recipe.classification !== "SIMULATED DEMONSTRATION INPUTS" ||
      control.source_recipe_sha256 !== sources.recipe.sha256)
    fail("Use the same retained simulated recipe and original control");
  const g = recipe.grid, a = recipe.arrays, count = g.width * g.height;
  if (!Number.isSafeInteger(count) || count <= 0 || !(g.pixel_area_ha > 0))
    fail("Invalid original grid");
  if (JSON.stringify(g) !== JSON.stringify(control.grid))
    fail("Original control grid differs");
  for (const key of ["NLCD","DEM","PRECIPITATION","R_FACTOR","K_FACTOR","RESTORATION_MASK"]) {
    if (!Array.isArray(a[key]) || a[key].length !== count)
      fail("Incomplete original input " + key);
    a[key].forEach(v => finite(v, key));
  }
  const coefficients = new Map();
  for (const row of coefficientRows) {
    const code = Number(row.lucode);
    if (coefficients.has(code) || !Number.isInteger(code))
      fail("Repeated or invalid coefficient code");
    if (row.load_type_n !== "measured-runoff" || row.load_type_p !== "measured-runoff" ||
        Number(row.proportion_subsurface_n) !== 0)
      fail("This source accounting is for the original runoff-coefficient/surface-only profile");
    const value = {n:Number(row.load_n), p:Number(row.load_p), c:Number(row.usle_c)};
    Object.entries(value).forEach(([k,v]) => { if (!(finite(v,k) >= 0)) fail("Negative coefficient"); });
    coefficients.set(code, value);
  }
  a.NLCD.forEach(v => { if (!coefficients.has(v)) fail("Missing actual coefficient " + v); });
  const targetCode = recipe.scenario.to_code;
  if (!coefficients.has(targetCode) || control.scenario.to_code !== targetCode)
    fail("Different target cover");
  const from = new Set(recipe.scenario.from_codes);
  const riparian = a.NLCD.map((v,i) => from.has(v) && a.RESTORATION_MASK[i] === 1 ? i : -1)
                         .filter(i => i >= 0);
  const matched = control.changed_indices.slice();
  if (new Set(matched).size !== matched.length ||
      matched.some(i => !Number.isInteger(i) || i < 0 || i >= count ||
                        !from.has(a.NLCD[i]) || a.RESTORATION_MASK[i] !== 0))
    fail("Control must retain original eligible, unique off-corridor cells");
  if (matched.length !== riparian.length) fail("Treated counts differ");
  if (!Array.isArray(control.mask) || control.mask.length !== count)
    fail("Incomplete original control mask");
  const chosen = new Set(matched);
  control.mask.forEach((v,i) => { if (v !== (chosen.has(i) ? 1 : 0)) fail("Control mask differs"); });
  const precipitationMean = a.PRECIPITATION.reduce((s,v) => s+v,0) / count;
  if (!(precipitationMean > 0) || a.PRECIPITATION.some(v => !(v > 0)))
    fail("Original positive runoff-proxy assumption changed");
  const classCounts = indices => indices.reduce((out,i) => {
    out[a.NLCD[i]] = (out[a.NLCD[i]] || 0) + 1; return out;
  }, {});
  if (JSON.stringify(classCounts(riparian)) !== JSON.stringify(classCounts(matched)))
    fail("Original land-cover counts differ");
  const selections = [["baseline", []],["riparian", riparian],["matched_control", matched]];
  const loads = selections.map(([id, indices]) => {
    const changed = new Set(indices);
    let nitrogen = 0, phosphorus = 0;
    for (let i=0;i<count;i++) {
      const row=coefficients.get(changed.has(i) ? targetCode : a.NLCD[i]);
      const weight=g.pixel_area_ha*a.PRECIPITATION[i]/precipitationMean;
      nitrogen += weight*row.n; phosphorus += weight*row.p;
    }
    return {id, changed_cells:indices.length, changed_area_ha:indices.length*g.pixel_area_ha,
      by_original_class:classCounts(indices),
      assumed_source_n_kg_year:nitrogen, assumed_source_p_kg_year:phosphorus};
  });
  for (const row of loads) for (const p of ["n","p"])
    row["assumed_source_"+p+"_reduction_kg_year"] =
      loads[0]["assumed_source_"+p+"_kg_year"]-row["assumed_source_"+p+"_kg_year"];
  function statistics(indices, variable) {
    const values=indices.map(i=>a[variable][i]);
    const mean=values.reduce((s,v)=>s+v,0)/values.length;
    return {cells:values.length, minimum:Math.min(...values), maximum:Math.max(...values),
      mean, population_sd:Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length)};
  }
  const balance=[];
  for (const originalClass of [null,...[...from].sort((a,b)=>a-b)]) {
    const r=riparian.filter(i=>originalClass===null || a.NLCD[i]===originalClass);
    const c=matched.filter(i=>originalClass===null || a.NLCD[i]===originalClass);
    if (!r.length || r.length!==c.length) fail("Unmatched original class");
    for (const variable of ["DEM","PRECIPITATION","R_FACTOR","K_FACTOR"]) {
      const rr=statistics(r,variable),cc=statistics(c,variable);
      balance.push({original_class:originalClass,variable,riparian:rr,matched_control:cc,
        mean_control_minus_riparian:cc.mean-rr.mean});
    }
  }
  return {schema:"upstate.headwaters-original-input-interpretation/v1",
    classification:recipe.classification, demo_id:recipe.demo_id, sources,
    grid:g, precipitation_mean_mm_year:precipitationMean,
    formula:"Sum original cell area in ha × assumed class runoff coefficient in kg/ha/year × cell proxy / full original proxy mean, before native delivery and retention.",
    quantities:loads, covariate_balance:balance,
    control_minus_riparian_source_reduction:{
      n_kg_year:loads[2].assumed_source_n_reduction_kg_year-loads[1].assumed_source_n_reduction_kg_year,
      p_kg_year:loads[2].assumed_source_p_reduction_kg_year-loads[1].assumed_source_p_reduction_kg_year},
    interpretation:[
      "The same grid and assumed fields are held fixed across each baseline and alternative.",
      "Both alternatives retain exact original treated area and original land-cover counts.",
      "Rainfall matching is approximate; original per-pair residuals remain in the control source.",
      "Pooled covariate means can conceal opposing class-specific differences.",
      "DEM values are original elevations, not native slope or routing estimates.",
      "Native stream export must come from the completed run and original paired valid support.",
      "The original demonstration geometry is a 1296ha simulated square; regional geometry is a separate source edition.",
      "Parameter-case ranges describe selected assumptions and are not confidence intervals."
    ]};
}
