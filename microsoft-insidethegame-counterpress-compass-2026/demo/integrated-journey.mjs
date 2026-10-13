/** The complete saved-match, explanation, coaching and broadcast journey. */
import fs from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createMatchPackage} from '../src/match_archive.mjs';
import {buildPlayerRecap} from '../src/player_recap.mjs';

const ORIGINAL_INSIGHT='insight-f02c6cdd492625ec06bf2e04f86367aeff5a1aed33e18629b66c7dabdeb73c64';
const FIRST_CAPTION='H10 keeps pressing after the loss; H7 wins the ball back within four seconds.';
const SECOND_CAPTION='Harbor FC win it back in five seconds. H3 and H9 apply pressure; H10 completes the recovery.';
const TITLE='Harbor FC: two recoveries for broadcast';
const NOTES='Two source-linked selections from the complete high-press match. Video time follows this recorded player demonstration; match clock follows the original events.';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function requireValue(ok,message){if(!ok)throw new Error(message);}
const equal=(a,b,label)=>requireValue(isDeepStrictEqual(a,b),label);
const json=async path=>JSON.parse(await fs.readFile(path,'utf8'));
const saveJSON=(path,value)=>fs.writeFile(path,JSON.stringify(value,null,2)+'\n');
const fixed=value=>Math.round(value*1000)/1000;
const playerLink=(origin,id,count,view)=>origin+'/#'+new URLSearchParams({
  saved:'1',archive:id,event:String(count),team:view.team,audience:view.audience,locale:view.locale
});
async function readArchive(page,id){
  return page.evaluate(async id=>{
    const key=localStorage.getItem('counterpress.library.v1');
    const response=await fetch('/api/archives/'+id+'/export',{headers:key?{'X-Counterpress-Library':key}:{}});
    if(!response.ok)throw new Error('Saved match read failed: '+response.status);
    return response.json();
  },id);
}
async function collection(page){
  return page.evaluate(async()=>{
    const key=localStorage.getItem('counterpress.library.v1');
    const response=await fetch('/api/archives',{headers:key?{'X-Counterpress-Library':key}:{}});
    if(!response.ok)throw new Error('Saved collection read failed: '+response.status);
    return (await response.json()).archives;
  });
}
async function download(page,selector,path){
  const pending=page.waitForEvent('download');
  await page.locator(selector).click();
  const result=await pending;
  await result.saveAs(path);
  const failed=await result.failure();
  requireValue(!failed,'Application download failed: '+failed);
  return path;
}
async function waitPlayer(page,count){
  await page.locator('#play:enabled').waitFor();
  await page.waitForFunction(count=>Number(document.querySelector('#scrub')?.value)===count&&
    document.querySelector('#state')?.textContent==='PAUSED',count);
}
async function openBroadcast(page,origin,id){
  await page.goto(origin+'/broadcast-handover#'+new URLSearchParams({archive:id}),{waitUntil:'domcontentloaded'});
  await page.locator('#editor:not([hidden])').waitFor();
  await page.locator('#preview:enabled').waitFor();
}
async function saveBroadcast(page,id){
  const pending=page.waitForResponse(response=>response.request().method()==='PUT'&&
    new URL(response.url()).pathname==='/api/archives/'+id);
  await page.locator('#save').click();
  const response=await pending;
  requireValue(response.ok(),'Broadcast save failed: '+response.status());
  await page.locator('#preview:enabled').waitFor();
}
async function importCoach(page,origin,path){
  await page.goto(origin+'/coach-review',{waitUntil:'domcontentloaded'});
  await page.locator('#import:enabled').waitFor();
  await page.locator('#importFile').setInputFiles(path);
  await page.locator('#import').click();
  await page.waitForFunction(()=>document.querySelectorAll('.match-detail').length===2);
  await page.locator('#compare:enabled').waitFor();
}
async function sequenceButton(page,id){
  for(let i=0;i<10;i++){
    const button=page.locator('[data-recap-key="play:'+id+'"]');
    if(await button.count())return button;
    if(!await page.locator('#recapNextPage').isEnabled())break;
    await page.locator('#recapNextPage').click();
  }
  throw new Error('The saved replay playlist does not contain '+id);
}
async function assertInspector(page,expected){
  await page.locator('#inspection:not([hidden])').waitFor();
  equal(await page.locator('#answerCaption').innerText(),expected.response.caption,'The saved caption changed');
  equal(await page.locator('#answerText').innerText(),expected.response.text,'The saved answer changed');
  equal(await page.locator('#executedActions [data-tool]').evaluateAll(rows=>rows.map(row=>row.dataset.tool)),
    ['get_match_state'],'The executed-tool list differs from the original trace');
  equal(await page.locator('#sourcePlays [data-event-id]').evaluateAll(rows=>rows.map(row=>row.dataset.eventId)),
    ['e011','e012','e013','e014','e015'],'The explanation source sequence changed');
  equal(await page.locator('#providerTurns tr').count(),2,'The original two provider turns were not retained');
}
async function widthReport(page,label){
  const result=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,
    title:document.title}));
  requireValue(result.width<=result.viewport+2,label+' overflows its viewport');
  return {surface:label,...result};
}

export async function createIntegratedJourney({root,output,options}){
  const original=await json(resolve(options.match));
  const priorCoach=await json(resolve(options.review));
  const recapPackage=await json(resolve(options['recap-match']||join(root,'demo/player-recap-high-press-2026.json')));
  requireValue(original.format==='counterpress.match.v1','The original completed match package is required');
  requireValue(priorCoach.format==='counterpress.coach-review.v1','The original complete coach review is required');
  equal(original.match,recapPackage.match,'The saved recap and original insight must use the same complete match');
  const insight=original.review.insights.find(item=>item.id===ORIGINAL_INSIGHT);
  requireValue(insight,'The accepted original tool-assisted insight is missing');
  equal(insight.response.toolCalls.map(item=>item.name),['get_match_state'],'Unexpected original executed tools');
  requireValue(insight.response.providerTurns.length===2,'Unexpected original provider-turn count');
  const bookmarks=[...original.review.bookmarks];
  for(const item of recapPackage.review.bookmarks)
    if(!bookmarks.some(saved=>saved.eventId===item.eventId))bookmarks.push(structuredClone(item));
  const high=createMatchPackage(original.match,{...original.review,
    title:'Harbor FC: full pressing review',recap:recapPackage.review.recap,bookmarks});
  const oldLow=priorCoach.matches.find(item=>item.package?.match?.scenario==='low-block');
  requireValue(oldLow,'The original low-block match is missing');
  const low=createMatchPackage(oldLow.package.match,oldLow.package.review);
  const playerRecap=buildPlayerRecap(high.match.events,{team:'Harbor FC',player:'H10',period:'all',locale:'en'});
  requireValue(playerRecap.selectedStats.actions.regain===6&&playerRecap.selectedStats.successes===18,
    'The original H10 match profile changed');
  const prepared=join(output,'prepared'),privateQA=join(output,'review-images');
  await fs.mkdir(prepared,{recursive:true,mode:0o700});await fs.mkdir(privateQA,{recursive:true,mode:0o700});
  const preparedCoach=join(prepared,'original-complete-review.json');
  const sourceBundle={format:'counterpress.coach-review.v1',title:'Harbor FC: high press and low block',
    generatedAt:new Date().toISOString(),view:{team:'Harbor FC',audience:'analyst',locale:'en'},period:'all',
    matches:[{count:high.match.events.length,sourceSha256:digest(high.match),package:high},
      {count:low.match.events.length,sourceSha256:digest(low.match),package:low}]};
  if(!options.resume)await saveJSON(preparedCoach,sourceBundle);
  const state={highId:null,lowId:null,replayStart:null,replayEnd:null,insight,originalMatch:digest(high.match),
    originalLowMatch:digest(low.match),bookmarks:recapPackage.review.bookmarks.map(item=>item.eventId)};
  const artifacts={
    match:'Counterpress_Broadcast_Match.json',html:'Counterpress_Broadcast_Handover.html',
    vtt:'Counterpress_Broadcast_Captions.vtt',coach:'Counterpress_Coach_Review.json',
    recap:'Counterpress_Player_Recap.json',recapHtml:'Counterpress_Player_Recap.html',
    guide:'READ_ME.html',video:'Counterpress_Compass_Running_Demo.mp4',story:'Counterpress_Automatic_Story.json',
    recipientMatch:'Counterpress_Recipient_Revised_Match.json',recipientCoach:'Counterpress_Recipient_Revised_Coach_Review.json',
    recipientHtml:'Counterpress_Recipient_Revised_Broadcast.html',recipientVtt:'Counterpress_Recipient_Revised_Captions.vtt'
  };
  function retained(packet){
    equal(packet.match,original.match,'The original complete match changed');
    equal(packet.review.insights.find(item=>item.id===ORIGINAL_INSIGHT),insight,'The original saved insight changed');
    requireValue(packet.review.recap.player==='H10'&&packet.review.recap.observedCount===941&&
      packet.review.recap.selectedSequenceId==='e632'&&packet.review.recap.outcome==='success',
      'The saved H10 replay selection was not retained');
    requireValue(state.bookmarks.every(id=>packet.review.bookmarks.some(item=>item.eventId===id)),
      'The saved player playlist is incomplete');
    const cues=packet.review.broadcast?.cues;
    requireValue(cues?.length===2&&cues[0].eventId==='e015'&&cues[1].eventId==='e636',
      'The broadcaster source selections changed');
    equal(cues.map(item=>item.caption),[FIRST_CAPTION,SECOND_CAPTION],'An edited caption changed');
    equal(cues.map(item=>[item.videoStart,item.videoEnd]),[[0.15,6.8],[state.replayStart,state.replayEnd]],
      'The recorded video timing changed');
  }
  return {
    duration:112,
    checkpoint(){return structuredClone(state);},
    restore(snapshot){if(snapshot)Object.assign(state,structuredClone(snapshot));},
    async restoreCaptured({page,origin,trace},coachPath){
      const captured=await json(coachPath);
      const capturedHigh=captured.matches.find(item=>item.package?.match?.scenario==='high-press')?.package;
      requireValue(capturedHigh,'The recorded high-press review is missing');
      const cues=capturedHigh.review.broadcast?.cues;
      requireValue(cues?.length===2,'The recorded broadcast cues are missing');
      state.replayStart=cues[1].videoStart;state.replayEnd=cues[1].videoEnd;
      const story=await json(join(output,artifacts.story));
      state.storyBrief=story.brief;
      state.automaticStory={player:story.selection.player,sourceCount:story.source.count,
          cues:story.cues.map(cue=>({momentId:cue.momentId,eventId:cue.eventId,count:cue.count,
            fromSecond:cue.fromSecond,toSecond:cue.toSecond}))};
      retained(capturedHigh);
      await importCoach(page,origin,coachPath);
      const items=await collection(page);
      state.highId=items.find(item=>item.scenario==='high-press')?.id;
      state.lowId=items.find(item=>item.scenario==='low-block')?.id;
      requireValue(items.length===2&&state.highId&&state.lowId,'Captured reviews did not import into the recovered collection');
      equal(await readArchive(page,state.highId),capturedHigh,'Import changed the completed recorded review');
      state.restoredFromCapturedPackages=true;
      trace.push({operation:'recover-captured-review',completeEvents:[941,948],
        savedCaptionTimes:[state.replayStart,state.replayEnd],originalMatchUnchanged:true});
    },
    async prepare({page,origin}){
      await importCoach(page,origin,preparedCoach);
      const items=await collection(page);
      const highItem=items.find(item=>item.scenario==='high-press'),lowItem=items.find(item=>item.scenario==='low-block');
      requireValue(items.length===2&&highItem&&lowItem,'The original comparison did not import both matches');
      state.highId=highItem.id;state.lowId=lowItem.id;
      const retainedHigh=await readArchive(page,state.highId);
      equal(retainedHigh.match,original.match,'Import changed the original match');
      equal(retainedHigh.review.insights.find(item=>item.id===ORIGINAL_INSIGHT),insight,'Import changed the accepted insight');
      await page.goto(playerLink(origin,state.highId,15,original.review.view),{waitUntil:'domcontentloaded'});
      await waitPlayer(page,15);
      await page.locator('#opusAgentResult').waitFor({state:'visible'});
      await page.evaluate(()=>scrollTo(0,0));
    },
    async run({page,origin,scene,seconds,wait,trace}){
      await scene(0,'Counterpress Compass: follow the match, explain the pressure, and prepare a useful broadcast.',async()=>{
        equal(await page.locator('#clock').innerText(),'00:57','The original match frame is not open');
      });
      await scene(7,'Open the saved tool-assisted explanation alongside the original football sequence.',async()=>{
        await page.locator('[data-insight-review="'+ORIGINAL_INSIGHT+'"]').click();
        await assertInspector(page,insight);
        await page.locator('#savedAnswer').scrollIntoViewIfNeeded();
      });
      await scene(16,'One match-state tool call, two model turns: the explanation stays connected to its source plays.',async()=>{
        await page.locator('#workflowHeading').scrollIntoViewIfNeeded();
        trace.push({originalExplanation:{id:ORIGINAL_INSIGHT,sourceEventIds:['e011','e012','e013','e014','e015'],
          executedTools:['get_match_state'],providerTurns:2,sourcePrefixSha256:insight.source.prefixSha256}});
      });
      await scene(24,'H10 has six regains and takes part in eighteen successful team sequences across the saved match.',async()=>{
        await page.locator('#answerReplay').click();await waitPlayer(page,15);
        await page.locator('#audience').selectOption('analyst');
        await page.waitForFunction(()=>document.querySelector('#recapPlayer').value==='H10'&&
          document.querySelector('#recapCoverage').textContent.startsWith('941 '));
        await page.locator('#playerRecap').scrollIntoViewIfNeeded();
        trace.push({recapStats:await page.locator('#recapStats').innerText(),coverage:await page.locator('#recapCoverage').innerText()});
      });
      await scene(34,'Replay the loss at 52:44.6 through H10’s recovery at 52:49.6, using the original player.',async()=>{
        await page.locator('#speed').selectOption('1');
        const button=await sequenceButton(page,'e632');
        state.replayStart=fixed(seconds());
        await button.click();
        await page.waitForFunction(()=>Number(document.querySelector('#scrub').value)===636&&
          document.querySelector('#state').textContent==='PAUSED');
        await wait(600);state.replayEnd=fixed(seconds());
        requireValue(state.replayEnd>state.replayStart,'The replay has no observed video interval');
        trace.push({recordedReplay:{sequence:'e632',sourceStartCount:631,sourceEndCount:636,
          matchLossSecond:3164.6,matchRegainSecond:3169.6,videoStart:state.replayStart,videoEnd:state.replayEnd}});
      });
      await scene(45,'Save the replay playlist and coaching notes with the complete original match.',async()=>{
        await page.locator('#recapSavePlaylist').click();
        await page.locator('#archiveNotes').fill('Broadcast review: H10 completes the recovery from 52:44.6 to 52:49.6. Compare the high-press match with the low block before choosing captions.');
        const pending=page.waitForResponse(response=>response.request().method()==='PUT'&&
          new URL(response.url()).pathname==='/api/archives/'+state.highId);
        await page.locator('#archiveSave').click();
        requireValue((await pending).ok(),'The saved playlist update failed');
        await page.locator('#archiveTitle:enabled').waitFor();
        await page.reload({waitUntil:'domcontentloaded'});await waitPlayer(page,636);
        await page.locator('#playerRecap').scrollIntoViewIfNeeded();
      });
      await scene(55,'Compare the complete high-press and low-block matches, with each result linked to its original play.',async()=>{
        await page.goto(origin+'/coach-review',{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelectorAll('.match-detail').length===2);
        await page.locator('#setTitle').fill('Harbor FC: high press and low block');
        await page.locator('#saveSet').click();
        await page.locator('#comparison').scrollIntoViewIfNeeded();
        trace.push({comparison:await page.locator('#comparison').innerText()});
      });
      await scene(67,'Build a five-play H10 story from the original sequences and choose the recovery for this recording.',async()=>{
        await openBroadcast(page,origin,state.highId);
        await page.locator('#fullMatch').click();await page.locator('#preview:enabled').waitFor();
        await page.locator('#sourceType').selectOption('sequence');await page.locator('#focus').selectOption('H10');
        await page.locator('#sourceList > li').filter({hasText:'e015'}).getByRole('button',{name:'Add caption',exact:true}).click();
        const builder=page.locator('#rundownBuilder');
        await page.locator('#rundown-player').selectOption('H10');
        await page.locator('#rundown-period').selectOption('all');
        await page.locator('#rundown-focus').selectOption('recoveries');
        await page.locator('#rundown-limit').selectOption('5');
        const pending=page.waitForResponse(response=>response.request().method()==='POST'&&
          new URL(response.url()).pathname==='/api/broadcast-rundown');
        await builder.getByRole('button',{name:'Build draft',exact:true}).click();
        const response=await pending;requireValue(response.ok(),'The automatic story draft failed');
        const story=await response.json();
        equal(story.cues.map(cue=>cue.momentId),['e107','e386','e632','e791','e931'],
          'The complete original H10 five-play story changed');
        await page.waitForFunction(()=>document.querySelectorAll('#rundownBuilder .rundown-list > li').length===5);
        await saveJSON(join(output,artifacts.story),story);
        state.storyBrief=story.brief;
        state.automaticStory={player:story.selection.player,sourceCount:story.source.count,
          cues:story.cues.map(cue=>({momentId:cue.momentId,eventId:cue.eventId,count:cue.count,
            fromSecond:cue.fromSecond,toSecond:cue.toSecond}))};
        await builder.scrollIntoViewIfNeeded();await wait(1400);
        const choices=builder.locator('.rundown-list > li input[type="checkbox"]');
        for(let i=0;i<story.cues.length;i++)await choices.nth(i).setChecked(story.cues[i].momentId==='e632');
        await builder.getByRole('button',{name:'Use story title and summary',exact:true}).click();
        await builder.getByRole('button',{name:'Add selected plays',exact:true}).click();
        requireValue(await page.locator('#cues > .cue').count()===2,'The chosen automatic recovery was not added');
        await page.locator('#cues').scrollIntoViewIfNeeded();
        trace.push({automaticStory:state.automaticStory});
      });
      await scene(78,'Edit the commentary and align each caption to the actual recording, separately from the match clock.',async()=>{
        await page.locator('#title').fill(TITLE);await page.locator('#notes').fill(NOTES+'\n\n'+state.storyBrief);
        await page.locator('#recordingName').fill(artifacts.video);
        const rows=page.locator('#cues > .cue');
        await rows.nth(0).locator('textarea').fill(FIRST_CAPTION);
        await rows.nth(0).locator('input[type="number"]').nth(0).fill('0.150');
        await rows.nth(0).locator('input[type="number"]').nth(1).fill('6.800');
        await rows.nth(1).locator('textarea').fill(SECOND_CAPTION);
        await rows.nth(1).locator('input[type="number"]').nth(0).fill(state.replayStart.toFixed(3));
        await rows.nth(1).locator('input[type="number"]').nth(1).fill(state.replayEnd.toFixed(3));
        await rows.nth(1).scrollIntoViewIfNeeded();
      });
      await scene(91,'Save and reopen the handover: original match, player playlist, explanation, and edited captions stay together.',async()=>{
        await saveBroadcast(page,state.highId);
        retained(await readArchive(page,state.highId));
        await page.reload({waitUntil:'domcontentloaded'});await page.locator('#preview:enabled').waitFor();
        requireValue(await page.locator('#cues > .cue').count()===2,'The saved captions did not reopen');
        await page.locator('#cues').scrollIntoViewIfNeeded();
      });
      await scene(101,'Hand over a standalone replay, an editable match, and timed captions for the recorded video.',async()=>{
        const preview=await download(page,'#downloadHtml',join(prepared,'broadcast-preview.html'));
        await page.goto(pathToFileURL(preview).href,{waitUntil:'domcontentloaded'});
        await page.locator('.jump[data-count="636"]').click();
        await page.waitForFunction(()=>document.querySelector('#eventPosition').textContent.includes('e636'));
        equal(await page.locator('#eventCaption').innerText(),SECOND_CAPTION,'The portable replay lost its caption');
        await page.locator('#prev').click();await page.locator('#next').click();
      });
    },
    async receive({page,context,browser,origin,video,trace}){
      requireValue(video?.encodedDurationSeconds<120,'The completed recording is required for receiving');
      await openBroadcast(page,origin,state.highId);
      retained(await readArchive(page,state.highId));
      await page.locator('#videoFile').setInputFiles(join(output,artifacts.video));
      await page.waitForFunction(()=>Number.isFinite(document.querySelector('#video').duration)&&
        document.querySelector('#video').videoWidth>0);
      const previewTime=(state.replayStart+state.replayEnd)/2;
      await page.locator('#video').evaluate((element,time)=>{element.currentTime=time;},previewTime);
      await page.waitForFunction(caption=>document.querySelector('#videoCaption').textContent===caption,SECOND_CAPTION);
      const actualDuration=await page.locator('#video').evaluate(element=>element.duration);
      requireValue(Math.abs(actualDuration-video.encodedDurationSeconds)<0.1,'Video metadata differs from the encoded clip');
      await saveBroadcast(page,state.highId);
      const finalMatch=await readArchive(page,state.highId);retained(finalMatch);
      equal(finalMatch.review.broadcast.recording.durationSeconds,fixed(actualDuration),'Video duration was not saved');
      await page.locator('#video').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(privateQA,'broadcast-video-desktop.png')});
      await download(page,'#downloadMatch',join(output,artifacts.match));
      await download(page,'#downloadHtml',join(output,artifacts.html));
      await download(page,'#downloadVtt',join(output,artifacts.vtt));
      equal(await json(join(output,artifacts.match)),finalMatch,'The editable match download differs from its saved source');

      await page.goto(origin+'/coach-review',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelectorAll('.match-detail').length===2);
      await download(page,'#export',join(output,artifacts.coach));
      const coach=await json(join(output,artifacts.coach));
      requireValue(coach.matches.length===2,'The complete coach handover needs both original matches');
      const exportedHigh=coach.matches.find(item=>item.package.match.scenario==='high-press');
      const exportedLow=coach.matches.find(item=>item.package.match.scenario==='low-block');
      equal(exportedHigh.package,finalMatch,'Coach export changed the completed high-press review');
      equal(exportedLow.package.match,low.match,'Coach export changed the original low-block match');
      equal(coach.matches.map(item=>item.count),[941,948],'Coach comparison changed its complete event cutoffs');

      await page.goto(playerLink(origin,state.highId,636,{team:'Harbor FC',audience:'analyst',locale:'en'}),{waitUntil:'domcontentloaded'});
      await waitPlayer(page,636);await page.locator('#playerRecap').scrollIntoViewIfNeeded();
      await download(page,'#recapJson',join(output,artifacts.recap));
      await download(page,'#recapHtml',join(output,artifacts.recapHtml));
      await page.goto(origin+'/insight-review#'+new URLSearchParams({archive:state.highId,insight:ORIGINAL_INSIGHT}),{waitUntil:'domcontentloaded'});
      await assertInspector(page,insight);
      await page.locator('#savedAnswer').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(privateQA,'saved-explanation-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      const mobile=[await widthReport(page,'Saved explanation')];
      await page.locator('#savedAnswer').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(privateQA,'saved-explanation-mobile.png')});
      await page.locator('#answerReplay').click();await waitPlayer(page,15);
      mobile.push(await widthReport(page,'Saved match player'));
      await openBroadcast(page,origin,state.highId);
      mobile.push(await widthReport(page,'Broadcast handover'));
      await page.locator('#cues').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(privateQA,'broadcast-mobile.png')});

      const receiver=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
      let recipientId,portable;
      try{
        const receivingPage=await receiver.newPage();receivingPage.setDefaultTimeout(12000);
        const errors=[];receivingPage.on('pageerror',error=>errors.push(error.message));
        await importCoach(receivingPage,origin,join(output,artifacts.coach));
        const received=await collection(receivingPage);
        requireValue(received.length===2,'Recipient did not receive both matches in a new collection');
        recipientId=received.find(item=>item.scenario==='high-press').id;
        requireValue(recipientId!==state.highId,'Recipient reused the sender archive');
        equal(await readArchive(receivingPage,recipientId),finalMatch,'The portable review changed in the recipient collection');
        await receivingPage.goto(origin+'/insight-review#'+new URLSearchParams({archive:recipientId,insight:ORIGINAL_INSIGHT}),{waitUntil:'domcontentloaded'});
        await assertInspector(receivingPage,insight);
        await openBroadcast(receivingPage,origin,recipientId);
        await receivingPage.locator('#title').fill('Harbor FC: producer copy');
        await saveBroadcast(receivingPage,recipientId);
        requireValue((await readArchive(receivingPage,recipientId)).review.broadcast.title==='Harbor FC: producer copy',
          'Recipient cannot edit its imported review');
        equal(await readArchive(page,state.highId),finalMatch,'Recipient editing changed the sender review');
        await receivingPage.reload({waitUntil:'domcontentloaded'});
        await receivingPage.locator('#preview:enabled').waitFor();
        const edited=structuredClone(finalMatch);edited.review.broadcast.title='Harbor FC: producer copy';
        equal(await readArchive(receivingPage,recipientId),edited,'Recipient revision did not reopen intact');
        await download(receivingPage,'#downloadMatch',join(output,artifacts.recipientMatch));
        await download(receivingPage,'#downloadHtml',join(output,artifacts.recipientHtml));
        await download(receivingPage,'#downloadVtt',join(output,artifacts.recipientVtt));
        equal(await json(join(output,artifacts.recipientMatch)),edited,'Recipient match export changed its revision');
        await receivingPage.goto(origin+'/coach-review',{waitUntil:'domcontentloaded'});
        await receivingPage.waitForFunction(()=>document.querySelectorAll('.match-detail').length===2);
        await download(receivingPage,'#export',join(output,artifacts.recipientCoach));
        const editedCoach=await json(join(output,artifacts.recipientCoach));
        equal(editedCoach.matches.find(item=>item.package.match.scenario==='high-press').package,edited,
          'Recipient coach export changed its revised match');
        equal(editedCoach.matches.find(item=>item.package.match.scenario==='low-block').package.match,low.match,
          'Recipient coach export changed the other complete match');
        const reopenedContext=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
        try{
          const reopenedPage=await reopenedContext.newPage();reopenedPage.setDefaultTimeout(12000);
          const reopenedErrors=[];reopenedPage.on('pageerror',error=>reopenedErrors.push(error.message));
          await importCoach(reopenedPage,origin,join(output,artifacts.recipientCoach));
          const reopenedItems=await collection(reopenedPage);
          const reopenedId=reopenedItems.find(item=>item.scenario==='high-press')?.id;
          requireValue(reopenedItems.length===2&&reopenedId&&reopenedId!==recipientId&&reopenedId!==state.highId,
            'Reopening the recipient edition did not create its independent collection');
          equal(await readArchive(reopenedPage,reopenedId),edited,'Reimport changed the complete recipient edition');
          await openBroadcast(reopenedPage,origin,reopenedId);
          equal(await reopenedPage.locator('#title').inputValue(),'Harbor FC: producer copy','The later title did not reopen');
          await reopenedPage.reload({waitUntil:'domcontentloaded'});
          await reopenedPage.locator('#preview:enabled').waitFor();
          equal(await readArchive(reopenedPage,reopenedId),edited,'Reload changed the reimported recipient edition');
          requireValue(!reopenedErrors.length,'Reopened recipient browser errors: '+reopenedErrors.join('; '));
        }finally{await reopenedContext.close();}
        equal(await readArchive(page,state.highId),finalMatch,'Reopening a later edition changed the original sender');
        await receivingPage.goto(pathToFileURL(join(output,artifacts.html)).href,{waitUntil:'domcontentloaded'});
        await receivingPage.locator('.jump[data-count="636"]').click();
        await receivingPage.waitForFunction(()=>document.querySelector('#eventPosition').textContent.includes('e636'));
        equal(await receivingPage.locator('#eventCaption').innerText(),SECOND_CAPTION,'The standalone handover replay changed');
        await receivingPage.locator('#prev').click();
        requireValue(await receivingPage.locator('#cursor').inputValue()==='635','The standalone previous-event control failed');
        await receivingPage.locator('#next').click();
        await receivingPage.locator('#play').click();
        await receivingPage.waitForFunction(()=>Number(document.querySelector('#cursor').value)>636);
        await receivingPage.locator('#play').click();
        const embedded=await download(receivingPage,'#download',join(prepared,'received-from-handover.json'));
        equal(await json(embedded),finalMatch,'The standalone editable download lost original review content');
        const embeddedVtt=await download(receivingPage,'#vtt',join(prepared,'received-from-handover.vtt'));
        equal(await fs.readFile(embeddedVtt,'utf8'),await fs.readFile(join(output,artifacts.vtt),'utf8'),
          'The standalone timed-caption download differs');
        requireValue(!errors.length,'Recipient browser errors: '+errors.join('; '));
        portable={coachImported:true,independentCollection:true,editableCopy:true,sourceReplay:true,embeddedMatchDownload:true,
          recipientRevisionExported:true,recipientRevisionReimported:true,recipientRevisionReloaded:true,originalSenderPreserved:true};
      }finally{await receiver.close();}

      const guide='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        '<title>Counterpress Compass — working product handover</title><style>body{margin:0;background:#f2f2f2;color:#222;font:16px/1.55 system-ui}main{max-width:1020px;margin:auto;padding:32px}section{background:#fff;border:1px solid #ccc;padding:24px;margin:20px 0}h1{font-size:34px;line-height:1.2}h2{font-size:22px}a{color:#222}video{width:100%;background:#111}li{margin:10px 0}code{overflow-wrap:anywhere}pre{padding:16px;background:#eee;overflow:auto}@media(max-width:600px){main{padding:16px}section{padding:16px}}</style><main>'+
        '<p>COUNTERPRESS / COMPASS</p><h1>Match review to broadcast handover</h1><p>Open the running-product film, review the original source plays, or continue editing the complete saved match.</p>'+
        '<section><h2>Watch the working product</h2><video controls preload="metadata" src="'+artifacts.video+'"><track kind="captions" label="English chapters" srclang="en" src="captions.vtt"></video>'+
        '<p>The '+video.encodedDurationSeconds.toFixed(2)+'-second clip records the actual application. '+
        (video.captionDelivery==='switchable-track-and-sidecars'?'English chapter captions are included as a switchable subtitle track and editable subtitle files.':'English chapter captions are included in the picture and as editable subtitle files.')+'</p></section>'+
        '<section><h2>Open the delivered review</h2><ul><li><a href="'+artifacts.html+'">Broadcast handover with original-event replay</a></li>'+
        '<li><a href="'+artifacts.recapHtml+'">H10 player recap and half-by-half comparison</a></li>'+
        '<li><a href="'+artifacts.story+'">Automatic H10 five-play broadcast draft</a></li>'+
        '<li><a href="'+artifacts.match+'">Complete editable match and broadcast captions</a></li>'+
        '<li><a href="'+artifacts.coach+'">Complete high-press and low-block coach review</a></li>'+
        '<li><a href="'+artifacts.vtt+'">Broadcast subtitles aligned to this recording</a></li>'+ 
        '<li><a href="'+artifacts.recipientCoach+'">Recipient’s revised complete coach review, exported and reopened independently</a></li>'+
        '<li><a href="'+artifacts.recipientHtml+'">Recipient’s revised broadcast handover</a></li></ul></section>'+
        '<section><h2>Continue in the application</h2><p>Use Node 22 or later. From the extracted handover directory, start the included application:</p>'+
        '<pre>node application/src/server.mjs</pre><p>Open <a href="http://127.0.0.1:3167">http://127.0.0.1:3167</a>, choose <strong>Compare saved matches</strong>, and import <strong>'+artifacts.coach+'</strong>. Both matches become editable in that browser. The high-press match includes the original saved explanation, H10 playlist and broadcaster captions.</p>'+
        '<p>In <strong>Broadcast handover</strong>, open that match and choose <strong>'+artifacts.video+'</strong> as its recording. The video stays on your machine. Each caption keeps its original match event and its separate video in/out times.</p>'+
        '<p>The standalone broadcast HTML can also download the complete editable match for another recipient.</p></section>'+
        '<section><h2>Included source</h2><p>The <strong>application</strong> directory contains the working player, saved explanation review, coach comparison, broadcaster editor and recorder. Its README describes the optional Microsoft Agent Framework integration. The retained example uses the original completed get_match_state call and two provider turns; opening it does not request another model response.</p>'+
        '<p>Teams, players and events are the project’s original football-realistic synthetic match data. H10 has six regains and involvement in eighteen successful sequences in this complete high-press match.</p></section></main></html>\n';
      await fs.writeFile(join(output,artifacts.guide),guide);
      const report={artifacts,originalMatchSha256:state.originalMatch,originalLowMatchSha256:state.originalLowMatch,
        originalInsightId:ORIGINAL_INSIGHT,executedToolCount:1,providerTurnCount:2,
        completeEvents:[941,948],automaticStory:state.automaticStory,recap:{player:'H10',regains:6,successfulSequenceInvolvements:18},
        captions:finalMatch.review.broadcast.cues.map(cue=>({eventId:cue.eventId,videoStart:cue.videoStart,videoEnd:cue.videoEnd})),
        savedRecordingDuration:finalMatch.review.broadcast.recording.durationSeconds,
        originalArchiveReopenedAfterServerRestart:!state.restoredFromCapturedPackages,
        capturedReviewRecoveredAfterInterruption:Boolean(state.restoredFromCapturedPackages),recipient:portable,mobile};
      trace.push({operation:'completed-handover',...report});
      return report;
    }
  };
}
