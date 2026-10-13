/* TokenJunkieLabs. Presentation of retained original Climate Management results. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:8}):value==null?'Unavailable':String(value);
const metricLabel=value=>({nitrogen_export:'Nitrogen export',phosphorus_export:'Phosphorus export',sediment_export:'Sediment export'}[value]||value);
const unique=rows=>[...new Map(rows.map(row=>[row[0],row])).values()];
const option=(id,label,selected)=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(label)+'</option>';
const button=(action,label,data='')=>'<button type="button" data-cm="'+action+'" '+data+'>'+esc(label)+'</button>';
const table=(columns,rows,caption)=>'<div class="cm-table" tabindex="0" role="region" aria-label="'+esc(caption)+'"><table><caption>'+esc(caption)+'</caption><thead><tr>'+
 columns.map(([,label])=>'<th scope="col">'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+
 rows.map(row=>'<tr>'+columns.map(([key])=>'<td>'+esc(fmt(row[key]))+'</td>').join('')+'</tr>').join('')+
 '</tbody></table></div>';
const ticket=(report,path)=>(report._downloads||[]).find(item=>item.artifact_id===path);
function download(report,path,label){
 const item=ticket(report,path);
 return item?'<a href="'+esc(item.url+(item.url.includes('?')?'&':'?')+'download=1')+'" download="'+esc(item.filename)+'">'+esc(label||item.label||path)+'</a>':'';
}
function units(rows){return [...new Set(rows.map(row=>row.units).filter(Boolean))].join(' / ');}
function choices(report){
 return {areas:unique((report.rows||[]).map(row=>[row.area_id,row.area||row.area_id])),
  metrics:unique((report.rows||[]).map(row=>[row.pollutant,metricLabel(row.pollutant)+' · '+row.units]))};
}
export function reconcileManagementView(report,view={}){
 const {areas,metrics}=choices(report);
 return {area_id:areas.some(([id])=>id===view.area_id)?view.area_id:areas[0]?.[0]||'',
  pollutant:metrics.some(([id])=>id===view.pollutant)?view.pollutant:metrics[0]?.[0]||''};
}
export function managementGISRequest(report,workspace_key){
 const selection=report?._gis_selection;
 if(!workspace_key||!selection?.source_collection_id||!Array.isArray(selection.sources)||!selection.sources.length)
  throw Error('Open the original management result with its registered geographic sources.');
 if(selection.sources.some(item=>item.source_collection_id!==selection.source_collection_id||!item.source_id))
  throw Error('The management GIS selection differs from its original source collection.');
 return {workspace_key,selection:structuredClone(selection)};
}
function figureMarkup(report,view){
 const selected=(report.figures||[]).filter(figure=>
  (figure.area_id??figure.spec?.area_id)===view.area_id&&(figure.pollutant??figure.spec?.pollutant)===view.pollutant);
 if(!selected.length)return '<p>This saved edition has its original numeric tables and native files. Saved vector figures are included in subsequently built editions.</p>';
 return selected.map(figure=>{
  const file=ticket(report,figure.path);
  if(!file)return '<p>Restore the original figure member '+esc(figure.path)+' to view this saved comparison.</p>';
  return '<figure class="cm-figure"><h4>'+esc(figure.title||'Saved management comparison')+'</h4>'+
   '<div class="cm-figure-scroll" tabindex="0" role="region" aria-label="'+esc(figure.title||'Saved scientific figure')+'">'+
   '<img loading="lazy" src="'+esc(file.url)+'" alt="'+esc(figure.alt||figure.title||figure.caption)+'"></div>'+
   '<figcaption>'+esc(figure.caption)+'</figcaption>'+table([['position','Figure key'],['label','Original period label'],['id','Original period ID'],['reference','Reference period']],(figure.spec?.periods||[]).map((period,index)=>({position:'P'+(index+1),label:period.label,id:period.id,reference:period.id===report.selection?.reference_period_id?'Yes':'No'})),'Original categorical period labels for this figure')+'<div class="cm-actions">'+
   download(report,figure.path,'Download original SVG')+download(report,'figure-data.json','Complete figure data')+'</div></figure>';
 }).join('');
}
function supportMarkup(report,view,rows){
 const matches=row=>row.area_id===view.area_id&&row.pollutant===view.pollutant;
 const support=(report.support||[]).filter(matches);
 const independent=(report.independent_totals||[]).filter(matches);
 return '<section class="cm-result-section"><h3>Shared support and exclusions</h3>'+
 '<p>Every period and scenario in this selected metric uses the same finite reporting cells. Independent totals retain each original run’s own valid cells. Excluded finite export stays visible below.</p>'+
 table([['area','Area'],['reporting_cells','Reporting cells'],['common_cells','Common cells'],['common_hectares','Common hectares'],['common_percent_of_reporting','Reporting area retained (%)'],['excluded_from_common_cells','Cells outside common support'],['status','Support status']],support,'Finite support for this area and metric')+
 table([['period','Period'],['role','Scenario role'],['units','Annual unit'],['independent_total','Independent export'],['common_total','Export on common support'],['excluded_finite_total','Export outside common support'],['valid_cells','Original valid cells'],['excluded_finite_cells','Valid cells excluded'],['missing_reporting_cells','Missing reporting cells']],independent,'Independent export and exclusions for each original run')+
 '<p>Areas can overlap; totals across areas must not be added without an explicit nonoverlapping selection. A zero common-cell count leaves benefits unavailable.</p></section>';
}
function nativeFiles(report,view){
 const periods=report.selection?.periods||[];
 const entries=[];
 const add=(path,label)=>{if(ticket(report,path))entries.push({path,label});};
 add('common-support/'+view.pollutant+'.tif','Common finite support · complete reporting footprint');
 for(const period of periods){
  const kinds=[['benefit','Reference minus treatment'],['interaction','Change in benefit from reference period'],
   ...(report.roles?.includes('control')?[['control-adjusted-benefit','Control minus treatment'],['control-adjusted-interaction','Change in control-adjusted benefit']]:[])];
  for(const [kind,label]of kinds)add('maps/'+period.id+'/'+kind+'-'+view.pollutant+'.tif',period.label+' · '+label);
  for(const role of report.roles||[])add('native-outputs/'+period.id+'/'+role+'/'+view.pollutant+'.tif',period.label+' · original '+role+' export');
 }
 const crs=report.lattice?.crs_wkt||'Original projected model coordinate system';
 return '<section class="cm-result-section"><h3>Original maps and GIS</h3>'+
 '<p>Raster files cover the complete retained reporting footprint. The selected area filters the tables and figures; it does not crop or change these original rasters. Benefit and interaction maps retain signed annual mass per pixel. The support mask identifies included pixels.</p>'+
 (entries.length?'<ul class="cm-file-list">'+entries.map(row=>'<li>'+download(report,row.path,row.label)+'<small>'+esc(report.files?.[row.path]?.units||'Original retained raster units')+'</small></li>').join('')+'</ul>':'<p>This edition was built without difference maps. Its support mask and original reporting geometry remain in the complete archive.</p>')+
 '<div class="cm-actions">'+download(report,'reporting-area.gpkg','Download reporting geometry')+
 (report._gis_selection?button('gis','Prepare editable GIS project'):'')+'</div>'+
 '<details><summary>Original coordinate system and lattice</summary><p>'+esc(crs)+'</p>'+
 '<pre>'+esc(JSON.stringify(report.lattice,null,2))+'</pre></details></section>';
}
function sourcesMarkup(report){
 const roles={reference:'Reference',treatment:'Treatment',control:'Control'};
 const cohort=report.cohort||[];
 return '<section class="cm-result-section"><h3>Original cases and forcing editions</h3>'+
 '<p>Period order is the scientist’s selected order. A period label is retained source context; these comparisons do not infer a chronological trend or event response.</p>'+
 '<div class="cm-case-grid">'+cohort.map(cell=>{
  const sources=Object.entries(cell.source_inputs||{}).map(([role,value])=>{
   const entry=value.entry||{},choice=value.selection||{};
   return '<tr><td>'+esc(role)+'</td><td>'+esc(entry.title||choice.source_id)+'</td><td>'+esc(entry.vintage||'Publisher period retained with source')+'</td><td>'+esc(entry.units||'See original source')+'</td></tr>';
  }).join('');
  return '<article><h4>'+esc(cell.period)+' · '+esc(roles[cell.role]||cell.role)+'</h4>'+
   '<div class="cm-table"><table><thead><tr><th>Input</th><th>Original source</th><th>Publisher vintage</th><th>Units</th></tr></thead><tbody>'+sources+'</tbody></table></div>'+
   '<p>Original case '+esc(cell.case_id)+'</p>'+button('run','Open native run','data-run="'+esc(cell.run_id)+'"')+'</article>';
 }).join('')+'</div></section>';
}
export function managementResultsMarkup(report,requested={}){
 if(!report)return '';
 const view=reconcileManagementView(report,requested),catalog=choices(report);
 const rows=(report.rows||[]).filter(row=>row.area_id===view.area_id&&row.pollutant===view.pollutant);
 const selectedArea=catalog.areas.find(([id])=>id===view.area_id)?.[1]||'Selected area';
 const reference=(report.selection?.periods||[]).find(row=>row.id===report.selection.reference_period_id);
 const hasControl=report.roles?.includes('control'),unit=units(rows);
 const benefits=[['period','Period'],['units','Annual unit'],['benefit','Reference − treatment'],
  ...(hasControl?[['control_adjusted_benefit','Control − treatment']]:[]),
  ['interaction','Change in benefit'],...(hasControl?[['control_adjusted_interaction','Change in control-adjusted benefit']]:[]),
  ['benefit_percent_of_reference','Benefit / reference (%)']];
 const totals=[['period','Period'],['units','Annual unit'],['reference_total','Reference export'],['treatment_total','Treatment export'],
  ...(hasControl?[['control_total','Control export']]:[]),['common_cells','Common cells'],['common_hectares','Common hectares']];
 const primary=['report.html','climate-management-results.zip','benefits.csv','figure-data.json','results.json'];
 return '<section><h2>3. Saved results</h2><h3>'+esc(report.title)+'</h3>'+
 '<p>Compare annual modeled export reaching streams, management benefit, and change in benefit relative to '+esc(reference?.label||report.selection?.reference_period_id)+'.</p>'+
 '<div class="cm-actions">'+primary.map(path=>download(report,path)).join('')+
 button('export','Export editable comparison')+(report.source?button('source','Open report source'):'')+'</div>'+
 '<div class="cm-columns"><label>Reporting area<select data-cm-view="area_id">'+catalog.areas.map(([id,title])=>option(id,title,view.area_id)).join('')+'</select></label>'+
 '<label>Export metric and units<select data-cm-view="pollutant">'+catalog.metrics.map(([id,title])=>option(id,title,view.pollutant)).join('')+'</select></label></div>'+
 '<p class="cm-selection-note">Viewing '+esc(selectedArea)+' · '+esc(unit)+'. View controls leave the saved scientific selection and current preparation draft unchanged.</p>'+
 '<section class="cm-result-section"><h3>Benefit across the selected periods</h3>'+
 '<p>Positive benefit means lower export with treatment. Positive change means a larger benefit than in the reference period. Negative values remain visible. Unavailable values retain their missing-support or zero-denominator meaning.</p>'+
 figureMarkup(report,view)+table(benefits,rows,'Management benefit and change in benefit')+
 table(totals,rows,'Original scenario exports on common finite support')+'</section>'+
 supportMarkup(report,view,rows)+nativeFiles(report,view)+sourcesMarkup(report)+
 '<details><summary>All original downloads</summary><ul class="cm-file-list">'+(report._downloads||[]).map(file=>'<li>'+download(report,file.artifact_id)+'</li>').join('')+'</ul></details>'+
 '<details><summary>Native versions and forcing diagnostics</summary><pre>'+esc(JSON.stringify({normalization:report.normalization,native_versions:report.native_versions,forcing_diagnostics:report.forcing_diagnostics},null,2))+'</pre></details>'+
 (report.limitations?.length?'<details><summary>Scientific interpretation and limits</summary><ul>'+report.limitations.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul></details>':'')+'</section>';
}
