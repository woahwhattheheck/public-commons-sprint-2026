import {mkdir,writeFile,readFile,open,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Run inside the original supplier-statement browser owner's admitted host,
// authenticated page and lifetime lease. This module starts no process/server.
export async function runWorkbookCourse({page,native,output,caseId,preparedBookId,emptyBookId}){
  if(!page||!caseId||!preparedBookId||!emptyBookId)throw new Error('Supply the original workbook native receiving selections.');
  await mkdir(output,{recursive:true,mode:0o700});
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const files=[];
  let prior=null;
  try{prior=JSON.parse(await readFile(join(output,'workbook-browser-receiving.json'),'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior){
    if(prior.caseId!==caseId||prior.preparedBookId!==preparedBookId||prior.emptyBookId!==emptyBookId)
      throw new Error('Continue the original workbook browser selections.');
    for(const item of [...prior.files,{name:'saved-workbook.xlsx',...prior.xlsx},{name:'work-invoice-working-copy.json',...prior.workingCopy}]){
      const bytes=await readFile(join(output,item.name));
      if(bytes.length!==item.bytes||digest(bytes)!==item.sha256)throw new Error('Original workbook receiving file changed: '+item.name);
    }
    return prior;
  }
  async function atomic(name,bytes){
    const path=join(output,name),value=typeof bytes==='string'?Buffer.from(bytes):bytes;
    try{const old=await readFile(path);if(!old.equals(value))throw new Error('Retained browser output differs: '+name);return path;}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const temp=path+'.prepared-'+process.pid;const handle=await open(temp,'wx',0o600);
    try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
    try{await link(temp,path);}finally{await unlink(temp);}
    return path;
  }
  async function capture(name,viewport){
    await page.setViewportSize(viewport);
    let bytes;try{bytes=await readFile(join(output,name));}catch(e){if(e.code!=='ENOENT')throw e;bytes=await page.screenshot({fullPage:true});}
    const path=await atomic(name,bytes);files.push({name,path,bytes:bytes.length,sha256:digest(bytes),viewport});
  }
  const desk=page.locator('.workbook-desk');
  async function ready(){
    await desk.waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.workbook-desk')?.getAttribute('aria-busy')!=='true');
  }
  async function click(selector){await desk.locator(selector).click();await ready();}
  async function selectBook(id){await desk.locator('[data-book]').selectOption(id);await ready();
    await page.waitForFunction(expected=>document.querySelector('.workbook-desk [data-book]')?.value===expected,id);}
  async function openDesk(){
  if(!(await page.locator('[name=caseSelect]').count()))await page.locator('[data-tab=operations]').click();
  await page.locator('[name=caseSelect]').selectOption(caseId);
  const navigation=page.locator('[data-ops-navigation]');
  if(await navigation.count()){
    const browse=navigation.getByRole('button',{name:'Browse sections',exact:true});
    if(await browse.isVisible()&&await browse.getAttribute('aria-expanded')!=='true')await browse.click();
    const group=navigation.locator('details[data-nav-group]').filter({has:page.locator('[data-nav-section="workbook"]')}).first();
    if(await group.count()&&!(await group.evaluate(el=>el.open)))await group.locator('summary').click();
    for(const button of await navigation.locator('[data-nav-section="workbook"]').all()){if(await button.isVisible()){await button.click();break;}}
  }else await page.locator('[data-ops-tab="workbook"]').click();
  await ready();
  }
  await openDesk();
  await ready();await selectBook(preparedBookId);
  await capture('workbook-desktop.png',{width:1440,height:1000});
  await click('[data-wb-action="tab"][data-value="INVOICES"]');
  await capture('invoice-desktop.png',{width:1440,height:1000});
  await capture('invoice-narrow.png',{width:390,height:844});
  await selectBook(emptyBookId);
  await capture('workbook-empty.png',{width:1440,height:1000});
  await selectBook(preparedBookId);
  // Open, download and reopen the full original browser preparation.
  const workingDownload=page.waitForEvent('download');await click('[data-wb-action="working-download"]');
  const working=await workingDownload;const workingPath=join(output,'work-invoice-working-copy.json');
  const workingTemp=workingPath+'.download';await working.saveAs(workingTemp);
  let workingBytes;try{workingBytes=await readFile(workingPath);}catch(e){if(e.code!=='ENOENT')throw e;workingBytes=await readFile(workingTemp);}
  await atomic('work-invoice-working-copy.json',workingBytes);await unlink(workingTemp);
  const workingValue=JSON.parse(workingBytes.toString('utf8'));
  if(workingValue.caseId!==caseId||workingValue.selectedId!==preparedBookId)throw new Error('The complete browser copy differs from its selected original edition.');
  await desk.locator('[data-working]').setInputFiles(workingPath);await ready();
  // Download actual original XLSX and reopen it through the native source reader.
  const xlsxDownload=page.waitForEvent('download');await click('[data-wb-action="xlsx"]');
  const xlsx=await xlsxDownload;const xlsxTemp=join(output,'saved-workbook.xlsx.download');
  await xlsx.saveAs(xlsxTemp);let bytes;
  try{bytes=await readFile(join(output,'saved-workbook.xlsx'));}catch(e){if(e.code!=='ENOENT')throw e;bytes=await readFile(xlsxTemp);}
  const xlsxPath=await atomic('saved-workbook.xlsx',bytes);await unlink(xlsxTemp);
  await desk.getByText('Receive returned XLSX',{exact:true}).click();
  await desk.locator('[data-xlsx]').setInputFiles(xlsxPath);await ready();
  if(!(await desk.locator('[data-xlsx]').isVisible()))await desk.getByText('Receive returned XLSX',{exact:true}).click();
  await click('[data-wb-action="return-preview"]');
  await capture('workbook-reopened-xlsx.png',{width:1440,height:1000});
  // The desk's parser must show its actual error when supplied an invalid workbook.
  await desk.locator('[data-xlsx]').setInputFiles({name:'invalid.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('invalid workbook')});
  await ready();
  if(!(await desk.locator('[data-xlsx]').isVisible()))await desk.getByText('Receive returned XLSX',{exact:true}).click();
  await click('[data-wb-action="return-preview"]');
  await desk.locator('[data-wb-message][role="alert"]').waitFor({state:'visible'});
  await capture('workbook-source-error.png',{width:1440,height:1000});
  await desk.locator('[data-xlsx]').setInputFiles(xlsxPath);await ready();
  // Use a real row dialog and preserve the existing record by cancelling.
  await click('[data-wb-action="tab"][data-value="WORK"]');
  await desk.locator('[data-wb-action="edit"]').first().click();
  await desk.locator('dialog[open]').waitFor();
  const description=desk.locator('dialog [name="description"]'),original=await description.inputValue();
  await description.fill(original+' — internal operator exercise');
  await capture('workbook-row-editor.png',{width:1440,height:1000});
  await capture('workbook-row-editor-narrow.png',{width:390,height:844});
  await page.keyboard.press('Escape');
  const rowCopyEvent=page.waitForEvent('download');await click('[data-wb-action="working-download"]');
  const rowCopy=await rowCopyEvent,rowCopyTemp=join(output,'row-working-copy.download');
  await rowCopy.saveAs(rowCopyTemp);
  const rowCopyBytes=await readFile(rowCopyTemp);
  const rowCopyValue=JSON.parse(rowCopyBytes.toString('utf8'));
  if(rowCopyValue.editing?.row?.description!==original+' — internal operator exercise')
    throw new Error('The complete working copy lost its unfinished row form.');
  await atomic('row-working-copy.json',rowCopyBytes);await unlink(rowCopyTemp);
  await page.reload({waitUntil:'domcontentloaded'});await openDesk();
  await desk.locator('dialog[open]').waitFor();
  if(await desk.locator('dialog [name="description"]').inputValue()!==original+' — internal operator exercise')
    throw new Error('Reopening lost the unfinished original row form.');
  await capture('workbook-reopened-row.png',{width:1440,height:1000});
  await click('[data-wb-action="close-row"]');
  // Reopen the browser page, using its already authenticated original URL.
  await page.reload({waitUntil:'domcontentloaded'});
  await openDesk();await selectBook(preparedBookId);
  await capture('workbook-reopened-browser.png',{width:1440,height:1000});
  const nativeCase=typeof native==='function'?await native('/api/operations/'+caseId):null;
  const receipt={schema:'stellar-forge.sf47-workbook-browser-receiving.v1',caseId,preparedBookId,emptyBookId,
    files,xlsx:{bytes:bytes.length,sha256:digest(bytes)},workingCopy:{bytes:workingBytes.length,sha256:digest(workingBytes)},
    nativeCaseVersion:nativeCase?.program?.version??null,
    visualReview:'Open and inspect every captured image and the original workbook in the producing session.'};
  await atomic('workbook-browser-receiving.json',JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}
