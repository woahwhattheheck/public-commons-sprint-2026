#!/usr/bin/env node
/** Record the original browser application and its real Node HTTP/SSE server. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {spawn, execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, resolve, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {server} from '../src/server.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)), ROOT=resolve(HERE,'..');
const options={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!['--out','--chromium','--playwright','--ffmpeg','--ffprobe'].includes(key)||!value)throw new Error('Usage: node demo/capture.mjs --out NEW_DIRECTORY --chromium EXECUTABLE [--playwright MODULE] [--ffmpeg EXECUTABLE] [--ffprobe EXECUTABLE]');
  options[key.slice(2)]=value;
}
if(!options.out||!options.chromium)throw new Error('--out and --chromium are required');
const output=resolve(options.out),require=createRequire(import.meta.url);
const {chromium}=require(options.playwright||'playwright');
await fs.mkdir(output,{recursive:false});
await fs.mkdir(join(output,'frames'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source={};
async function inventory(dir){
  for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(['node_modules','test','tests','demo'].includes(entry.name))continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory())await inventory(path);
    else if(entry.isFile())source[relative(ROOT,path)]=hash(await fs.readFile(path));
  }
}
await inventory(ROOT);
let gitHead=null;try{gitHead=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();}catch{}
const startedAt=new Date().toISOString(),trace=[],captions=[],frames=[],pageErrors=[],optionalRequests=[];
let browser,context,cdp,page,recordStart=0,frameQueue=Promise.resolve(),recording=false,firstFrame;
let resolveFirst;firstFrame=new Promise(resolve=>{resolveFirst=resolve;});
const seconds=()=>Math.max(0,(performance.now()-recordStart)/1000);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function at(time){while(seconds()<time)await wait(Math.min(200,time*1000-seconds()*1000));}
async function scene(target,label,action){
  await at(target);const start=seconds();
  if(captions.length)captions.at(-1).end=start;
  captions.push({start,end:110,text:label});
  console.log(JSON.stringify({scene:captions.length,second:Number(start.toFixed(2)),label}));
  await action();
  trace.push({second:Number(seconds().toFixed(3)),label,clock:await page.locator('#clock').innerText(),progress:await page.locator('#progress').innerText(),state:await page.locator('#state').innerText(),url:page.url()});
}
function stamp(seconds){const ms=Math.max(0,Math.round(seconds*1000));return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;}
function encode(args){return new Promise((resolve,reject)=>{const child=spawn(options.ffmpeg||'ffmpeg',args,{cwd:output,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',data=>{error=(error+data).slice(-6000);});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}: ${error}`)));});}

try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const health=await (await fetch(origin+'/health')).json();
  browser=await chromium.launch({executablePath:resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1});
  page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.origin===origin&&['/api/foundry-draft','/api/opus-commentary'].includes(url.pathname))optionalRequests.push({method:request.method(),path:url.pathname});});
  page.on('response',response=>{const url=new URL(response.url());if(url.origin===origin&&url.pathname.startsWith('/api/'))trace.push({http:response.request().method(),path:url.pathname,status:response.status()});});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#play:enabled').waitFor();
  cdp=await context.newCDPSession(page);
  cdp.on('Page.screencastFrame',event=>{
    if(!recording){void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId});return;}
    const capturedAt=seconds(),file=`frames/frame-${String(frames.length).padStart(6,'0')}.jpg`;
    frames.push({file,at:capturedAt});
    frameQueue=frameQueue.then(()=>fs.writeFile(join(output,file),Buffer.from(event.data,'base64')));
    void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId});resolveFirst();
  });
  recordStart=performance.now();recording=true;
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:93,maxWidth:1600,maxHeight:900,everyNthFrame:1});
  await Promise.race([firstFrame,wait(5000).then(()=>{throw new Error('Chromium produced no actual screen frames');})]);

  await scene(0,'Counterpress Compass: turn possession losses into clear match moments.',async()=>{});
  await scene(6,'Choose a match situation and seed. Every viewer has an independent session.',async()=>{
    await page.locator('#scenario').selectOption('high-press');
    await page.locator('#seed').fill('2026');await page.locator('#kickoff').click();
    await page.locator('#speed').selectOption('4');
  });
  await scene(13,'Follow the synthetic match live: pressure, ball recovery, and the evolving story.',async()=>{await page.locator('#play').click();});
  await scene(28,'Pause and filter the key moments to the recoveries you want to understand.',async()=>{
    await page.locator('#play').click();
    await page.locator('#reviewFilter').selectOption('success');
    await page.locator('.moment-select').first().click();
  });
  await scene(40,'Inspect the recorded loss, pressure actions, and regain in their original event order.',async()=>{
    await page.locator('#review').scrollIntoViewIfNeeded();
    trace.push({selectedReview:await page.locator('#review').innerText(),buttonWidth:await page.locator('.moment-select').first().evaluate(e=>e.getBoundingClientRect().width)});
    await page.screenshot({path:join(output,'review-viewport.png')});
  });
  await scene(54,'Replay that outcome at its exact event. The explanation and pitch stay connected.',async()=>{
    const before=Number(await page.locator('#scrub').inputValue());
    await page.locator('.review-jump').click();
    await page.waitForFunction(previous=>Number(document.querySelector('#scrub').value)!==previous,before);
    await page.mouse.wheel(0,-1800);await wait(500);
  });
  await scene(66,'Switch from fan summary to analyst view while preserving the selected moment.',async()=>{await page.locator('#audience').selectOption('analyst');await wait(350);});
  await scene(77,'The same match facts and controls are available in English and Spanish.',async()=>{
    await page.locator('#locale').selectOption('es');await page.waitForFunction(()=>document.documentElement.lang==='es');
  });
  let saved;
  await scene(88,'Copy a match link containing the exact event, club, language, and audience view.',async()=>{
    await page.locator('#locale').selectOption('en');await page.waitForFunction(()=>document.documentElement.lang==='en');await wait(350);
    await page.locator('#share').click();
    await page.waitForFunction(()=>document.querySelector('#shareStatus').textContent.length>0);
    saved={clock:await page.locator('#clock').innerText(),progress:await page.locator('#progress').innerText(),url:page.url()};
  });
  await scene(98,'Reopen the link: the same moment returns, paused and ready to explore.',async()=>{
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#state').textContent==='PAUSED');
    const restored={clock:await page.locator('#clock').innerText(),progress:await page.locator('#progress').innerText(),url:page.url()};
    if(JSON.stringify(saved)!==JSON.stringify(restored))throw new Error('The real application did not restore the captured match');
    trace.push({saved,restored});
  });
  await at(110);
  const duration=seconds();recording=false;await cdp.send('Page.stopScreencast');await frameQueue;
  captions.at(-1).end=duration;
  if(pageErrors.length)throw new Error('Application browser error: '+pageErrors.join('; '));
  if(frames.length<20)throw new Error('Insufficient actual browser frames');
  const browserVersion=browser.version();await browser.close();browser=null;
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  // Screen frames retain their observed wall-clock durations; no app state is manufactured.
  let concat='';
  for(let i=0;i<frames.length;i++){
    const start=i===0?0:frames[i].at,end=i+1<frames.length?frames[i+1].at:duration;
    concat+=`file '${frames[i].file}'\nduration ${Math.max(.001,end-start).toFixed(6)}\n`;
  }
  concat+=`file '${frames.at(-1).file}'\n`;
  await fs.writeFile(join(output,'capture.concat'),concat);
  await fs.writeFile(join(output,'captions.srt'),captions.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
  // ASS uses explicit output pixels, preventing SRT's default 384x288 scaling
  // from enlarging the captions into the application viewport.
  const assTime=time=>stamp(time).replace(',','.').slice(0,-1);
  const assHeader='[Script Info]\nScriptType: v4.00+\nPlayResX: 1600\nPlayResY: 1000\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,28,&H00FFFFFF,&H00FFFFFF,&H00202831,&H00202831,0,0,0,0,100,100,0,0,1,0,0,2,32,32,28,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  await fs.writeFile(join(output,'captions.ass'),assHeader+captions.map(c=>`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text}`).join('\n')+'\n');
  await fs.writeFile(join(output,'journey.json'),JSON.stringify(trace,null,2)+'\n');
  console.log(JSON.stringify({capturedFrames:frames.length,duration,encoding:true}));
  await encode(['-hide_banner','-loglevel','error','-f','concat','-safe','0','-i','capture.concat','-vf',`scale=1600:900:flags=lanczos,pad=1600:1000:0:0:color=0x202831,tpad=stop_mode=clone:stop_duration=${Math.ceil(duration)},fps=24,subtitles=captions.ass`,'-t',duration.toFixed(3),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','Counterpress_Compass_Running_Demo.mp4']);
  const encodedDuration=Number(execFileSync(options.ffprobe||'ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',join(output,'Counterpress_Compass_Running_Demo.mp4')],{encoding:'utf8'}).trim());
  if(!Number.isFinite(encodedDuration)||encodedDuration>=120||Math.abs(encodedDuration-duration)>.1)throw new Error('Encoded video does not retain the required captured duration');
  const video=await fs.readFile(join(output,'Counterpress_Compass_Running_Demo.mp4'));
  const manifest={schema:1,startedAt,completedAt:new Date().toISOString(),gitHead,sourceSha256:source,captureScriptSha256:hash(await fs.readFile(fileURLToPath(import.meta.url))),browserVersion,viewport:{width:1600,height:900},video:{file:'Counterpress_Compass_Running_Demo.mp4',bytes:video.length,sha256:hash(video),capturedDurationSeconds:duration,encodedDurationSeconds:encodedDuration,actualBrowserFrames:frames.length,captioned:true,audio:false},application:{originalNodeHttp:true,originalSse:true,scenario:'high-press',seed:2026,synthetic:true,optionalPanels:{foundryConfigured:!!health.foundryConfigured,opusConfigured:!!health.opusConfigured,observedCommentaryRequests:optionalRequests},publicUpload:false,entrySubmission:false},pageErrors};
  await fs.writeFile(join(output,'capture-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({complete:true,output,video:manifest.video}));
}finally{
  recording=false;await browser?.close();
  server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
}
