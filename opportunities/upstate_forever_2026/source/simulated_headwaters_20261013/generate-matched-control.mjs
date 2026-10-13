/** Deterministic matched-area control for the original simulated headwaters case.
 * Uses only retained input cells. The original Workspace produces model outputs.
 */
export function buildMatchedControl(recipe, sourceRecipeSHA256) {
  if (recipe.schema !== "upstate.simulated-input-recipe/v1"
      || recipe.demo_id !== "upstate-simulated-piedmont-headwaters-v1"
      || !/^[a-f0-9]{64}$/.test(sourceRecipeSHA256)) throw Error("Bind the original demo recipe");
  const {width, height, pixel_area_ha: pixelArea} = recipe.grid;
  const length = width * height;
  const {NLCD: landcover, PRECIPITATION: rainfall, RESTORATION_MASK: corridor} = recipe.arrays;
  if (![width,height].every(Number.isSafeInteger) || width < 1 || height < 1
      || !Number.isFinite(pixelArea) || pixelArea <= 0
      || ![landcover,rainfall,corridor].every(a => Array.isArray(a) && a.length === length)
      || !rainfall.every(p => Number.isFinite(p) && p > 0)
      || !corridor.every(p => p === 0 || p === 1)) throw Error("Original input grid/masks are incomplete");
  const fromCodes = [...recipe.scenario.from_codes].sort((a,b) => a-b);
  if (new Set(fromCodes).size !== fromCodes.length || fromCodes.includes(recipe.scenario.to_code))
    throw Error("Original conversion classes are ambiguous");
  const order = (a,b) => rainfall[a] - rainfall[b] || a - b;
  const pairs = [], classes = [], mask = Array(length).fill(0);
  for (const code of fromCodes) {
    const target = [], candidates = [];
    for (let i=0;i<length;i++) if (landcover[i] === code) {
      if (corridor[i] === 1) target.push(i); else candidates.push(i);
    }
    target.sort(order); candidates.sort(order);
    const n=target.length, m=candidates.length;
    if (m<n) throw Error("Insufficient disjoint off-corridor cells for class " + code);
    // Ordered absolute-distance matching is optimal in one dimension.
    // dp[i,j] selects i of the first j candidates for the first i target cells.
    // Equal costs retain the earlier candidate subset; rainfall/index sort fixes ties.
    let previous = new Float64Array(m+1);
    const take = Array.from({length:n+1}, () => new Uint8Array(m+1));
    for (let i=1;i<=n;i++) {
      const current = new Float64Array(m+1); current.fill(Infinity);
      for (let j=i;j<=m;j++) {
        const use = previous[j-1] + Math.abs(rainfall[target[i-1]] - rainfall[candidates[j-1]]);
        const skip = current[j-1];
        if (use < skip) { current[j]=use; take[i][j]=1; }
        else current[j]=skip;
      }
      previous=current;
    }
    let i=n,j=m; const selected=[];
    while(i) {
      if(j<i) throw Error("Incomplete matched-area reconstruction");
      if(take[i][j]) { selected.push([target[i-1],candidates[j-1]]); i--; }
      j--;
    }
    selected.reverse();
    let targetSum=0,controlSum=0,absolute=0,maxAbsolute=0;
    for(const [a,b] of selected) {
      if(mask[b] || corridor[b] || landcover[a]!==landcover[b]) throw Error("Control cell repeats/overlaps target");
      mask[b]=1;
      const residual=rainfall[b]-rainfall[a];
      targetSum+=rainfall[a]; controlSum+=rainfall[b];
      absolute+=Math.abs(residual); maxAbsolute=Math.max(maxAbsolute,Math.abs(residual));
      pairs.push({from_code:code,target_index:a,target_row:Math.floor(a/width),target_col:a%width,
        control_index:b,control_row:Math.floor(b/width),control_col:b%width,
        target_precipitation_mm_year:rainfall[a],control_precipitation_mm_year:rainfall[b],
        precipitation_residual_mm_year:residual});
    }
    classes.push({from_code:code,to_code:recipe.scenario.to_code,
      target_cells:n,control_cells:selected.length,area_ha:n*pixelArea,
      eligible_off_corridor_cells:m,target_precipitation_sum_mm_year:targetSum,
      control_precipitation_sum_mm_year:controlSum,
      precipitation_sum_residual_mm_year:controlSum-targetSum,
      mean_absolute_paired_precipitation_residual_mm_year:n?absolute/n:0,
      max_absolute_paired_precipitation_residual_mm_year:maxAbsolute,
      objective_sum_absolute_precipitation_residual_mm_year:previous[m]});
  }
  const count=mask.reduce((a,b)=>a+b,0);
  const targetCount=classes.reduce((a,b)=>a+b.target_cells,0);
  if (!count || count!==targetCount || count!==recipe.input_summary.changed_cells)
    throw Error("Matched control differs from original actual target area");
  const indices=mask.flatMap((value,index)=>value?[index]:[]);
  const commonMean=rainfall.reduce((a,b)=>a+b,0)/length;
  return {schema:"upstate.simulated-matched-control/v1",
    demo_id:recipe.demo_id,classification:recipe.classification,
    source_recipe_sha256:sourceRecipeSHA256,grid:recipe.grid,
    source_mask_role:"RESTORATION_MASK",mask_role:"MATCHED_CONTROL_MASK",
    mask,changed_indices:indices,changed_cells:count,changed_area_ha:count*pixelArea,
    scenario:{title:"Simulated matched-area off-riparian restoration",
      from_codes:fromCodes,to_code:recipe.scenario.to_code,mask_role:"MATCHED_CONTROL_MASK",
      reason:"Convert the same number of original pasture and crop cells to forest outside the original complete restoration corridor; minimize paired absolute annual precipitation difference within each original land-cover class."},
    matching:{method:"class-stratified-monotone-minimum-L1-precipitation-subset/v1",
      target_order:"Annual precipitation ascending, then original row-major index",
      candidate_order:"Annual precipitation ascending, then original row-major index",
      equal_cost_choice:"Earlier candidate subset retained",
      exclusion:"Every original RESTORATION_MASK cell, including existing forest and developed cells",
      common_grid_precipitation_mean_mm_year:commonMean,
      by_original_class:classes,pairs},
    interpretation:[
      "This is an explicitly simulated input counterfactual, with the same grid, terrain, native parameter profile, original land cover and forcing as the saved baseline.",
      "Class counts and changed model area match exactly. Pairing minimizes total absolute precipitation mismatch within each class among all disjoint candidate subsets.",
      "Rows retain the residual precipitation differences; exact matching is not assumed. Divide class precipitation sums by the common grid precipitation mean when inspecting the original NDR source-load normalization.",
      "The selection does not match soil erodibility, erosivity, slope, routing distance, patch shape or upstream contributing area. Those physical siting differences remain part of the actual modeled intervention response.",
      "The final native stream mask must be inspected alongside the original restoration corridor. Neither this input selection nor its rainfall residuals is a modeled export result.",
      "Report baseline, riparian and control annual exports and signed differences on common valid support, then reporting-area avoided export per net changed model hectare. Use actual native final ownership for the area denominator."
    ]};
}
