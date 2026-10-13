// MIT. One complete author/colleague course in the existing browser operation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const need=(value,message)=>{if(!value)throw new Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** The existing 22B7/81CF owner supplies its Page and original saved application. */
export async function receiveApplicationReturns({page,baseUrl,draftId,directory}){
  need(page&&typeof page.goto==='function'&&draftId,'Supply the existing browser Page and original saved application.');
  directory=path.resolve(directory);await fs.mkdir(directory,{recursive:true});
  const files=[],screenshots=[];
  const record=async(name,body,type='application/json')=>{
    const target=path.join(directory,name);await fs.writeFile(target,body);
    const bytes=await fs.readFile(target);need(bytes.equals(Buffer.from(body)),'The complete receiving file changed.');
    const item={name,path:target,bytes:bytes.length,sha256:hash(bytes),mediaType:type};files.push(item);return item;
  };
  const download=async(p,button,name,type='application/json')=>{
    const waiting=p.waitForEvent('download');await button.click();const item=await waiting,target=path.join(directory,name);
    await item.saveAs(target);return record(name,await fs.readFile(target),type);
  };
  const settled=p=>p.waitForFunction(()=>document.getElementById('working-status')?.textContent.includes('Complete working copy saved')&&!document.getElementById('workspace-root').inert);
  const ready=p=>p.waitForFunction(()=>document.getElementById('workspace-root')?.dataset.draftId&&!document.getElementById('workspace-root').inert);
  const snapshot=p=>p.evaluate(async()=>{
    const root=document.getElementById('workspace-root');
    return (await (await import('./grant-submission-working-copy.mjs')).loadSubmissionWorkingCopy(root.dataset.workingId)).input;
  });
  const native=p=>p.evaluate(async()=>{
    const root=document.getElementById('workspace-root');
    return (await import('./drafts.mjs')).loadDraft(root.dataset.savedDraftId);
  });
  const screen=async(p,name,width)=>{
    await p.setViewportSize({width,height:980});const target=path.join(directory,name);await p.screenshot({path:target,fullPage:true});
    screenshots.push({path:target,width,height:980,viewed:false});
  };
  const app=new URL('grant-submission.html',baseUrl);app.searchParams.set('draft',draftId);
  await page.goto(app.href);await settled(page);
  const original=await native(page);need(original.id===draftId,'The selected native application changed.');
  await record('original-native-record.json',JSON.stringify(original)+'\n');
  // Continue on an explicitly separate ordinary draft inside the same store.
  await page.locator('#save-copy').click();await settled(page);
  let author=await native(page);need(author.id!==draftId&&author.input.id!==original.input.id,'The course must preserve the original native record.');
  await page.locator('#draft-title').fill(original.input.title+' — internal returned-application exercise');
  await page.locator('#view').selectOption('returns');
  await page.getByLabel('Copy label',{exact:true}).fill('Original application author/colleague receiving');
  await page.getByLabel('Colleague or receiving team',{exact:true}).fill('Internal receiving colleague');
  await page.getByLabel('Instructions for this copy',{exact:true}).fill('Preserve the original sources. Return edited answer text to the issuing author.');
  const issued=await download(page,page.getByRole('button',{name:'Save and issue editable copy',exact:true}),'issued-application.json');
  await settled(page);author=await native(page);
  const history=await page.evaluate(async value=>(await import('./grant-application-return.mjs')).listApplicationReturns(value),author.input);
  const issue=history.issues.at(-1);need(issue,'The issued baseline was not saved.');
  const issueCard=page.locator('[data-application-issue="'+issue.id+'"]');
  const offline=await download(page,issueCard.getByRole('button',{name:'Download issued offline editor',exact:true}),'issued-editor.html','text/html;charset=utf-8');
  await screen(page,'issued-author-wide.png',1360);
  const authorProject=author.input.answers.find(row=>row.id==='project').text+'\n ';
  await page.locator('#view').selectOption('answers');
  await page.locator('[data-grant-answer-id="project"]').click();
  await page.getByLabel('Draft answer',{exact:true}).fill(authorProject);
  await page.locator('#save').click();await settled(page);
  const current=await native(page),authorUrl=page.url();
  let colleague;
  try{
    colleague=await page.context().newPage();
    await colleague.goto(pathToFileURL(offline.path).href);await ready(colleague);
    await colleague.locator('#view').selectOption('answers');
    await colleague.locator('[data-grant-answer-id="project"]').click();
    await colleague.getByLabel('Draft answer',{exact:true}).fill(author.input.answers.find(row=>row.id==='project').text+'\n');
    await colleague.locator('[data-grant-answer-id="need"]').click();
    const returnedNeed=author.input.answers.find(row=>row.id==='need').text+'\n';
    await colleague.getByLabel('Draft answer',{exact:true}).fill(returnedNeed);
    await colleague.locator('#view').selectOption('returns');
    await screen(colleague,'issued-colleague-narrow.png',390);
    const returned=await download(colleague,colleague.getByRole('button',{name:'Download complete returned application',exact:true}),'returned-application.json');
    const raw=await fs.readFile(returned.path,'utf8'),returnedDraft=JSON.parse(raw).draft;
    need(returnedDraft.answers.find(row=>row.id==='need').text===returnedNeed,'The downloaded colleague edit changed.');
    await page.goto(authorUrl);await settled(page);await page.locator('#view').selectOption('returns');
    await page.getByLabel('Returned application file',{exact:true}).setInputFiles(returned.path);await settled(page);
    await page.getByRole('button',{name:'Preview returned changes',exact:true}).click();await settled(page);
    await page.getByRole('button',{name:'Keep all current author values',exact:true}).click();
    await page.locator('[data-application-return-key="answer:need:text"] select').selectOption('returned');
    await page.getByLabel('Reviewing author',{exact:true}).fill('Internal receiving author');
    await page.getByLabel('Acceptance note',{exact:true}).fill('Retain the current project answer and accept the colleague’s need answer in this separate internal exercise.');
    await settled(page);
    const pending=await snapshot(page);
    need(pending.applicationReturn.raw===raw&&pending.applicationReturn.choices['answer:need:text']==='returned','The exact incoming file and choices were not retained.');
    const pendingFile=await download(page,page.getByRole('button',{name:'Download complete working file',exact:true}),'pending-return-working.json');
    need(JSON.parse(await fs.readFile(pendingFile.path,'utf8')).working.applicationReturn.raw===raw,'The working attachment lost its original return.');
    await screen(page,'returned-comparison-wide.png',1360);
    await page.reload();await settled(page);await page.locator('#view').selectOption('returns');
    await page.getByRole('button',{name:'Preview returned changes',exact:true}).click();await settled(page);
    need(await page.locator('[data-application-return-key="answer:need:text"] select').inputValue()==='returned','Reload lost the original reviewed choice.');
    await screen(page,'returned-comparison-narrow.png',390);
    await page.getByRole('button',{name:'Save chosen changes to original draft',exact:true}).click();await settled(page);
    const accepted=await native(page);
    need(accepted.id===current.id&&accepted.revision===current.revision+1,'Acceptance must use the same author record and its actual revision.');
    need(accepted.input.answers.find(row=>row.id==='project').text===authorProject,'Acceptance overwrote a retained author conflict choice.');
    need(accepted.input.answers.find(row=>row.id==='need').text===returnedNeed,'Acceptance omitted the selected colleague change.');
    const adopted=await page.evaluate(async value=>(await import('./grant-application-return.mjs')).listApplicationReturns(value),accepted.input);
    const adoption=adopted.adoptions.at(-1);need(adoption?.issueId===issue.id,'Acceptance lost its original issued baseline.');
    const card=page.locator('[data-application-adoption="'+adoption.id+'"]');
    const exported={};
    for(const [branch,label]of [['baseline','issued baseline'],['current','author before acceptance'],['returned','returned application'],['result','accepted result']]){
      const file=await download(page,card.getByRole('button',{name:'Download '+label,exact:true}),branch+'-application.json');
      exported[branch]=JSON.parse(await fs.readFile(file.path,'utf8')).draft;
      await colleague.locator('#file-input').setInputFiles(file.path);await ready(colleague);
      await colleague.locator('#view').selectOption('answers');await colleague.locator('[data-grant-answer-id="project"]').click();
      need(await colleague.getByLabel('Draft answer',{exact:true}).inputValue()===exported[branch].answers.find(row=>row.id==='project').text,'The downloaded '+branch+' branch did not reopen in its original editor.');
      await screen(colleague,branch+'-reopened.png',branch==='returned'?390:1360);
    }
    need(exported.current.answers.find(row=>row.id==='project').text===authorProject&&exported.returned.answers.find(row=>row.id==='need').text===returnedNeed,'The reconstructed original branches changed.');
    need(exported.result.answers.find(row=>row.id==='need').text===returnedNeed,'The exact accepted result was not retained.');
    await download(page,page.getByRole('button',{name:'Download full draft',exact:true}),'accepted-full-application.json');
    await screen(page,'accepted-return-history-wide.png',1360);
    const untouched=await page.evaluate(async id=>(await import('./drafts.mjs')).loadDraft(id),draftId);
    need(JSON.stringify(untouched)===JSON.stringify(original),'The internal course changed the original saved application.');
    const result={schema:'stellar-forge.grant-application-return-receiving.v1',state:'OPERATED_AWAITING_PIXEL_INSPECTION',
      originalDraftId:draftId,authorDraftId:accepted.id,issueId:issue.id,adoptionId:adoption.id,
      beforeRevision:current.revision,afterRevision:accepted.revision,files,screenshots,
      instruction:'The producing owner must open every delivered file and personally view all actual desktop/narrow images. These captures do not assert that inspection.'};
    await record('application-return-result.json',JSON.stringify(result,null,2)+'\n');return result;
  }finally{if(colleague)await colleague.close();}
}
