/** Operate the maintained Geographic allocation controls against their original saved source. */
export async function operateGeographicAllocation({page,workspace,prepared,saved,api,readJSON,regular,verified,equal,requireValue,check,waitFor,saveRecord,screenshot,action,ticketDownloads,downloadedURLs,context}){
 const editions=saved.allocation_editions;
 requireValue(Array.isArray(editions),'Install the maintained Geographic allocation provider in this existing application');
 if(!editions.length){
  requireValue((await page.locator('[data-geo-allocation-body]').textContent()).includes('no completed allocation report'),'The workbench must disclose an absent allocation report');
  action('allocation_unavailable',{case_id:prepared.id,reason:'No completed saved allocation edition is present in this original archive.'});
  return;
 }
 const editionSelect=page.locator('[data-geo-allocation-edition]');
 await editionSelect.waitFor({state:'visible'});
 requireValue(equal(await editionSelect.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),editions.map(item=>item.id)),'The workbench omitted or reordered original allocation editions');
 const visitedFigures=new Set();
 for(const edition of editions){
  check();
  if(await editionSelect.inputValue()!==edition.id){
   const [response]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/geographic-headwaters/allocation'&&u.searchParams.get('allocation_id')===edition.id;}),editionSelect.selectOption(edition.id)]);
   requireValue(response.ok(),'The saved allocation edition did not open');
  }
  const result=await api('/api/geographic-headwaters/allocation',{case_id:prepared.id,allocation_id:edition.id});
  requireValue(result.case_id===prepared.id&&result.allocation_id===edition.id,'The allocation belongs to another original case');
  const base='geographic-scenario-allocations/'+edition.id+'/';
  const retained=await readJSON(await regular(workspace,base+'result.json'));
  const descriptor=retained.files.find(item=>item.path==='allocation.json');
  const original=await readJSON(await verified(workspace,{...descriptor,path:base+descriptor.path}));
  requireValue(equal(result.report,original)&&original.prepared_id===prepared.id&&original.project_id===prepared.project_id&&equal(original.run_ids,{baseline:prepared.baseline_run_id,restoration:prepared.alternative_run_ids[0],control:prepared.alternative_run_ids[1]}),'The allocation API changed its exact original source or three native runs');
  await saveRecord('allocation-'+edition.id,result);
  const body=page.locator('[data-geo-allocation-body]');
  await waitFor(async()=>await body.locator('[data-geo-allocation-scope]').count()===1,'saved allocation scope controls');
  const scopes=[...new Set(original.regions.map(row=>row.quantity_scope))];
  requireValue(equal(await body.locator('[data-geo-allocation-scope] option').evaluateAll(nodes=>nodes.map(n=>n.value)),scopes),'The quantity scope control omits original support');
  let captures=0,regionCount=0;
  for(const scope of scopes){
   await body.locator('[data-geo-allocation-scope]').selectOption(scope);
   const scoped=original.regions.filter(row=>row.quantity_scope===scope);
   const groupKey=row=>JSON.stringify([row.kind,row.relationship]);
   const groups=[...new Set(scoped.map(groupKey))];
   requireValue(equal(await body.locator('[data-geo-allocation-group] option').evaluateAll(nodes=>nodes.map(n=>n.value)),groups),'The geographic relationship control changed its original support groups');
   for(const group of groups){
    await body.locator('[data-geo-allocation-group]').selectOption(group);
    const regions=scoped.filter(row=>groupKey(row)===group);
    requireValue(equal(await body.locator('[data-geo-allocation-region] option').evaluateAll(nodes=>nodes.map(n=>n.value)),regions.map(row=>row.id)),'The region control omits an original watershed or utility');
    for(let i=0;i<regions.length;i++){
     check();const region=regions[i];
     await body.locator('[data-geo-allocation-region]').selectOption(region.id);
     await waitFor(async()=>await body.locator('h4').first().textContent()===region.title,'selected original geographic region');
     requireValue(await body.locator('[data-geo-allocation-scope]').inputValue()===scope&&await body.locator('[data-geo-allocation-group]').inputValue()===group,'Region selection changed its upstream/reporting or relationship scope');
     const classes=region.physical_contrasts?.classes||[];
     if(classes.length){
      const values=classes.map(row=>String(row.baseline_class));
      requireValue(equal(await body.locator('[data-geo-allocation-physical] option').evaluateAll(nodes=>nodes.map(n=>n.value)),values),'The physical-input class selector changed its original classes');
      for(const value of values){await body.locator('[data-geo-allocation-physical]').selectOption(value);requireValue(await body.locator('[data-geo-allocation-physical]').inputValue()===value,'The original physical class did not reopen');}
     }
     const details=body.locator('details');
     for(const node of await details.all()){await node.locator('summary').click();requireValue(await node.evaluate(x=>x.open),'An original allocation detail did not open');}
     if(i===0||region.common_valid_cells===0){
      const label='allocation-'+edition.id.slice(0,8)+'-'+captures++;
      await screenshot(page,label,1440);await screenshot(page,label,390);
     }
     const figures=(result.figures||[]).filter(figure=>(figure.region_ids||[]).includes(region.id));
     for(const figure of figures){
      const key=edition.id+':'+figure.id;if(visitedFigures.has(key))continue;
      const link=body.locator('figure a').filter({has:page.locator('img[alt]')});
      const candidates=await link.all();let actual=null;
      for(const candidate of candidates)if(new URL(await candidate.getAttribute('href'),'http://original').pathname===new URL(figure.download.url,'http://original').pathname){actual=candidate;break;}
      requireValue(actual,'The original region figure has no opening control');
      const figurePath=new URL(figure.download.url,'http://original').pathname;
      const [popup,response]=await Promise.all([page.waitForEvent('popup'),
       context.waitForEvent('response',{predicate:r=>r.request().resourceType()==='document'&&new URL(r.url()).pathname===figurePath}),
       actual.click()]);
      try{
       requireValue(response.ok(),'The original figure ticket did not render');
       await popup.waitForLoadState('load');
       requireValue(new URL(popup.url()).pathname===new URL(figure.download.url,'http://original').pathname,'The figure opened another original source');
       await screenshot(popup,'allocation-figure-'+edition.id.slice(0,8)+'-'+visitedFigures.size,1440);
       action('allocation_figure_opened',{allocation_id:edition.id,figure_id:figure.id,region_id:region.id,source:figure.download});
      }finally{await popup.close();}
      visitedFigures.add(key);
     }
     action('allocation_region_selected',{allocation_id:edition.id,scope,group,region_id:region.id,physical_classes:classes.map(row=>row.baseline_class),categorical_common_cells:region.common_valid_cells});
     regionCount++;
    }
   }
  }
  const sourceDetails=body.locator('details').filter({has:page.locator('summary').filter({hasText:'Complete original data and source files'})});
  if(!(await sourceDetails.evaluate(node=>node.open)))await sourceDetails.locator('summary').click();
  await ticketDownloads('[data-geo-allocation-body]',result._downloads,'allocation-original-download');
  requireValue(result._downloads.every(row=>downloadedURLs.has(new URL(row.url,'http://original').pathname)),'The allocation source omits an original download control');
  requireValue((result.figures||[]).every(figure=>visitedFigures.has(edition.id+':'+figure.id)),'An original saved figure was not opened through its region');
  action('allocation_controls_completed',{allocation_id:edition.id,regions:regionCount,scopes,figures:(result.figures||[]).length});
  const [reload]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/geographic-headwaters/allocation'&&u.searchParams.get('allocation_id')===edition.id;}),page.locator('[data-geo-allocation-refresh]').click()]);
  requireValue(reload.ok()&&equal((await reload.json()).report,original),'Reload changed the original saved allocation');
 }
}
