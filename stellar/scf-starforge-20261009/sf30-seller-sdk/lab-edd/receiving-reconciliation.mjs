// MIT. Complete cross-profile operator receiving on the original result browser.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory } from '../jobs/inputs/files.mjs';
import { canonicalJson, sha256 } from './model.mjs';
import { normalizeReconciliation, compareReconciliationFields } from './reconciliation.mjs';
import { parseReconciliationTable } from './reconciliation-table.mjs';
const equal=(a,b,message)=>{if(canonicalJson(a)!==canonicalJson(b))throw Error(message);};
export async function receiveLabReconciliationBrowser({page,origin,family,retained,directory,downloaded,signal}){
  await privateDirectory(directory);
  const comparison=JSON.parse(await readFile(join(retained.extractedDirectory,'comparison.json'),'utf8'));
  const document=JSON.parse(await readFile(join(retained.extractedDirectory,'reconciliation/decisions.json'),'utf8'));
  const expected=normalizeReconciliation(comparison,document),exports=[];
  const response=await page.goto(origin+'/'+family+'/reconciliation.html',{waitUntil:'load'});
  if(!response||response.status()!==200)throw Error('The full cross-profile report did not open.');
  const report=retained.files.find(file=>file.path==='reconciliation.html');
  equal(sha256(await response.body()),report.sha256,'The complete cross-profile browser source changed.');
  await page.locator('#groups tr').first().waitFor();
  await page.screenshot({path:join(directory,'desktop.png'),fullPage:false});
  const links=await page.locator('.downloads a[download]').evaluateAll(elements=>elements.map(element=>({path:element.getAttribute('href'),label:element.textContent.trim()})));
  for(let i=0;i<links.length;i++){
    signal?.throwIfAborted();const link=links[i],member=retained.files.find(file=>file.path===link.path);
    if(!member)throw Error('The complete cross-profile download is absent: '+link.path);
    const file=await downloaded(page,()=>page.locator('.downloads a[download]').nth(i).click(),join(directory,'downloads',link.path));
    equal({bytes:file.bytes.length,sha256:file.sha256},{bytes:member.bytes,sha256:member.sha256},'The cross-profile browser download changed: '+link.path);
    exports.push({path:link.path,bytes:file.bytes.length,sha256:file.sha256});
  }
  for(const format of ['json','csv','tsv']){
    const file=await downloaded(page,()=>page.locator('#download-'+format).click(),join(directory,'saved-correspondence.'+format));
    const actual=format==='json'?normalizeReconciliation(comparison,JSON.parse(file.bytes)):
      parseReconciliationTable(comparison,file.bytes.toString('utf8'),{format});
    equal(actual,expected,'The complete saved browser correspondence changed: '+format);
  }
  const chosen=comparison.groups.find(group=>group.kind==='results'&&group.baselineIds.length&&group.currentIds.length);
  if(!chosen)throw Error('Select an actual complete two-sided result cohort for this receiving.');
  const before=new Map(comparison.baselineProjection.entities.map(entity=>[entity.entityId,entity]));
  const after=new Map(comparison.currentProjection.entities.map(entity=>[entity.entityId,entity]));
  await page.locator('#kind').selectOption('results');
  const needle=before.get(chosen.baselineIds[0]).fields.cas_rn?.value??'';
  await page.locator('#search').fill(needle);
  const button=page.locator('[data-group="'+chosen.groupId+'"]');
  while(!await button.count()){
    if(await page.locator('#next').isDisabled())throw Error('The original candidate group is missing from its complete browser catalogue.');
    await page.locator('#next').click();
  }
  await button.click();
  equal(await page.locator('#baseline-candidates input').count(),chosen.baselineIds.length,'The browser lost a baseline candidate.');
  equal(await page.locator('#current-candidates input').count(),chosen.currentIds.length,'The browser lost a current candidate.');
  const actualFields=compareReconciliationFields(chosen.baselineIds.map(id=>before.get(id)),chosen.currentIds.map(id=>after.get(id)));
  equal(await page.locator('#field-differences tr').count(),actualFields.length,'The complete original field differences did not open.');
  const sourceLink=page.locator('#baseline-candidates a').first(),sourceRow=before.get(chosen.baselineIds[0]).rows[0];
  await page.locator('#baseline-candidates details > summary').first().click();
  const popupWait=page.context().waitForEvent('page');await sourceLink.click();const popup=await popupWait;
  try{
    await popup.waitForLoadState('load');await popup.locator('#detail').waitFor({state:'visible'});
    const identity=await popup.locator('#detail-identity').textContent();
    if(!identity.includes(sourceRow.recordId)||!identity.includes(sourceRow.rowSha256))throw Error('The source link did not open its original baseline row.');
    await popup.screenshot({path:join(directory,'baseline-source.png'),fullPage:false});
  }finally{await popup.close();}
  const reason='During complete native browser receiving, retain every candidate and defer this correspondence for source review; both native file families stay unchanged.';
  await page.locator('#reason').fill(reason);await page.locator('#defer').click();
  const next=normalizeReconciliation(comparison,{...expected,decisions:[...expected.decisions.filter(choice=>choice.groupId!==chosen.groupId),
    {groupId:chosen.groupId,groupSha256:chosen.groupSha256,action:'defer',reason}]});
  const edited=await downloaded(page,()=>page.locator('#download-tsv').click(),join(directory,'edited-correspondence.tsv'));
  equal(parseReconciliationTable(comparison,edited.bytes.toString('utf8'),{format:'tsv'}),next,'The complete edited table lost the exact original group or reason.');
  await page.locator('#load-decisions').setInputFiles({name:'edited-correspondence.tsv',mimeType:'text/tab-separated-values',buffer:edited.bytes});
  await page.getByText('The complete saved correspondence document is open against this exact source pair and mapping.',{exact:true}).waitFor();
  const reopened=await downloaded(page,()=>page.locator('#download-json').click(),join(directory,'edited-reopened.json'));
  equal(normalizeReconciliation(comparison,JSON.parse(reopened.bytes)),next,'The edited source-bound correspondence did not reopen.');
  await page.locator('#close-detail').click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:join(directory,'mobile.png'),fullPage:false});
  const width=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
  if(width.page>width.viewport+2)throw Error('The cross-profile mobile page exceeds its viewport.');
  await page.setViewportSize({width:1440,height:1000});
  const accept=dialog=>dialog.accept();page.on('dialog',accept);
  try{await page.reload({waitUntil:'load'});}finally{page.off('dialog',accept);}
  await page.locator('#groups tr').first().waitFor();
  const original=await downloaded(page,()=>page.locator('#download-json').click(),join(directory,'original-after-reload.json'));
  equal(normalizeReconciliation(comparison,JSON.parse(original.bytes)),expected,'A draft changed the complete immutable correspondence edition.');
  return {comparisonSha256:comparison.comparisonSha256,documentSha256:sha256(canonicalJson(expected)),counts:comparison.counts,
    byKind:comparison.byKind,downloads:exports,tableRoundTrips:['json','csv','tsv'],baselineOriginalRow:sourceRow,
    editedDocumentSha256:sha256(canonicalJson(next)),editedReopened:true,immutableReload:true,
    desktop:join(directory,'desktop.png'),mobile:join(directory,'mobile.png'),baselineSource:join(directory,'baseline-source.png')};
}
