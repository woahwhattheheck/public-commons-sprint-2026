#!/usr/bin/env node
/** Capture the working Counterpress application and its editable review delivery. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {dirname, resolve, join, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {legacyJourney} from './legacy-journey.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)), ROOT=resolve(HERE,'..');
const options={};
const allowed=new Set(['out','chromium','playwright','ffmpeg','ffprobe','match','review','recap-match','journey','browser-process-mode','resume','receive-video','receive-proof','captured-output','receive-portable']);
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i]?.replace(/^--/,''),value=process.argv[i+1];
  if(!allowed.has(key)||!process.argv[i].startsWith('--')||!value||Object.hasOwn(options,key))
    throw new Error('Use --out NEW_DIRECTORY --chromium EXECUTABLE [--journey core|integrated] [--match ORIGINAL_MATCH.json --review ORIGINAL_COACH_REVIEW.json] [--recap-match MATCH.json] [--playwright MODULE] [--ffmpeg EXECUTABLE] [--ffprobe EXECUTABLE]');
  options[key]=value;
}
if(!options.out||!options.chromium)throw new Error('--out and --chromium are required');
const mode=options.journey||(options.match?'integrated':'core');
if(!['core','integrated'].includes(mode))throw new Error('Choose core or integrated');
if(mode==='integrated'&&(!options.match||!options.review))throw new Error('The integrated journey uses the original completed match and coach review');
if(options['browser-process-mode']&&!['single','multiple'].includes(options['browser-process-mode']))throw new Error('Choose single or multiple browser process mode');
if(options.resume&&options.resume!=='true')throw new Error('Use --resume true to finish an interrupted capture');
const receivingOnly=Boolean(options['receive-video']);
const portableReceiving=options['receive-portable']==='true';
if(options['receive-portable']&&(!portableReceiving||!receivingOnly))
  throw new Error('Use --receive-portable true only with the selected existing video');
if(receivingOnly&&(!options.resume||!options['receive-proof']||!options['captured-output']))
  throw new Error('Receiving an existing video requires --resume true --receive-proof H264_RESULT.json --captured-output ORIGINAL_CAPTURE');
if(!receivingOnly&&(options['receive-proof']||options['captured-output']))
  throw new Error('The receiving proof and original capture are selected with --receive-video');
const output=resolve(options.out),recoveryPath=join(output,'capture-recovery.private.json'),require=createRequire(import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let selectedVideoProof=null,originalCapturedBytes=null,originalCapturedPath=null,selectedCapture=null;
let historicalCheckpointSha256=null;
async function openPortableCapture(captured){
  const bytes=await fs.readFile(join(captured,'capture-portable.json'));
  const value=JSON.parse(bytes);
  if(value.schema!=='counterpress.portable-capture.v1'||value.mode!=='integrated'||
    !/^[a-f0-9]{64}$/.test(value.archive?.sha256)||!Number.isSafeInteger(value.archive?.bytes)||
    value.archive.bytes<1||value.archive.members!==300||
    !/^[a-f0-9]{64}$/.test(value.historicalCheckpointSha256)||
    !(value.duration>0&&value.duration<118)||!Array.isArray(value.frames)||value.frames.length!==154||
    !Array.isArray(value.captions)||value.captions.length!==11||
    !value.source||Object.keys(value.source).length!==58)
    throw new Error('The complete preserved recording descriptor is required');
  const files=value.files;
  const expected=['captions.srt','captions.vtt','Counterpress_Automatic_Story.json',
    'prepared/captured-review-for-recovery.json'];
  if(!files||Object.keys(files).sort().join('|')!==expected.sort().join('|'))
    throw new Error('The preserved recording needs all original public receiving inputs');
  for(const name of expected){
    const row=files[name],raw=await fs.readFile(join(captured,name));
    if(!Number.isSafeInteger(row.bytes)||raw.length!==row.bytes||hash(raw)!==row.sha256)
      throw new Error('Preserved receiving source changed: '+name);
  }
  let previous=-1;
  for(const frame of value.frames){
    if(!Number.isFinite(frame.at)||frame.at<0||frame.at<previous||frame.at>value.duration||
      !/^[a-f0-9]{64}$/.test(frame.sha256)||!Number.isSafeInteger(frame.bytes)||frame.bytes<1)
      throw new Error('The preserved frame identities or timing differ');
    previous=frame.at;
  }
  for(const [path,sha] of Object.entries(value.source))
    if(!path||path.startsWith('/')||path.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(sha))
      throw new Error('The original captured source map differs');
  return {bytes,value,recovery:{
    schema:'counterpress.capture-recovery.v1',phase:'captured',mode:'integrated',
    startedAt:null,source:value.source,gitHead:null,browserVersion:null,health:null,
    duration:value.duration,frameBytes:value.frames.reduce((sum,frame)=>sum+frame.bytes,0),
    frames:value.frames,captions:value.captions,
    trace:[{operation:'receive-preserved-recording',archive:value.archive,
      historicalCheckpointSha256:value.historicalCheckpointSha256,
      originalPrivateCheckpointAvailable:false}],
    requests:[],pageErrors:[],requestsComplete:false,originalPort:null,receivingStorage:null,journey:null,
    provenance:{sourceMode:'saved-portable',archive:value.archive,
      originalPrivateCheckpointAvailable:false,historicalCheckpointSha256:value.historicalCheckpointSha256}
  }};
}
async function retainSelected(path,bytes){
  try{const old=await fs.readFile(path);if(!old.equals(bytes))throw new Error('Selected receiving bytes differ: '+path);return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const part=path+'.part';let previous=Buffer.alloc(0);
  try{previous=await fs.readFile(part);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bytes.subarray(0,previous.length).equals(previous))throw new Error('Selected receiving prefix differs: '+path);
  const file=await fs.open(part,'a',0o600);
  try{await file.writeFile(bytes.subarray(previous.length));await file.sync();}finally{await file.close();}
  await fs.rename(part,path);
}
if(receivingOnly){
  const captured=resolve(options['captured-output']);
  if(output===captured||output.startsWith(captured+'/'))throw new Error('Use a separate receiving output; the original capture stays unchanged');
  originalCapturedPath=join(captured,portableReceiving?'capture-portable.json':'capture-recovery.private.json');
  let original;
  if(portableReceiving){
    const selected=await openPortableCapture(captured);
    originalCapturedBytes=selected.bytes;selectedCapture=selected.value;original=selected.recovery;
    historicalCheckpointSha256=selected.value.historicalCheckpointSha256;
  }else{
    originalCapturedBytes=await fs.readFile(originalCapturedPath);
    original=JSON.parse(originalCapturedBytes);historicalCheckpointSha256=hash(originalCapturedBytes);
  }
  const proofBytes=await fs.readFile(resolve(options['receive-proof']));
  selectedVideoProof=JSON.parse(proofBytes);
  const chosen=await fs.readFile(resolve(options['receive-video']));
  if(selectedVideoProof.schema!=='counterpress.recording-h264.v1'||selectedVideoProof.complete!==true||
    selectedVideoProof.capturedCheckpointSha256!==historicalCheckpointSha256||
    selectedVideoProof.video?.sha256!==hash(chosen)||selectedVideoProof.video?.bytes!==chosen.length||
    selectedVideoProof.video.codec!=='h264'||selectedVideoProof.video.actualBrowserFrames!==original.frames?.length||
    !Number.isFinite(selectedVideoProof.video.maximumPacketTimestampErrorSeconds)||selectedVideoProof.video.maximumPacketTimestampErrorSeconds>0.002||
    !Number.isFinite(selectedVideoProof.video.encodedDurationSeconds)||selectedVideoProof.video.packetCount!==original.frames.length+1||
    Math.abs(selectedVideoProof.video.encodedDurationSeconds-original.duration)>0.1)
    throw new Error('The selected MP4 is not the verified original capture');
  if(original.schema!=='counterpress.capture-recovery.v1'||original.mode!==mode||original.phase!=='captured')
    throw new Error('The original completed capture is required');
  await fs.mkdir(output,{recursive:true,mode:0o700});
  const selection=Buffer.from(JSON.stringify({schema:'counterpress.existing-video-receiving.v1',
    originalCapture:captured,checkpointSha256:historicalCheckpointSha256,
    sourceMode:portableReceiving?'saved-portable':'original-private-checkpoint',
    sourceDescriptorSha256:hash(originalCapturedBytes),proofSha256:hash(proofBytes),
    videoSha256:hash(chosen)},null,2)+'\n');
  await retainSelected(join(output,'receiving-selection.private.json'),selection);
  await retainSelected(join(output,portableReceiving?'original-capture-portable.json':'original-capture-recovery.private.json'),originalCapturedBytes);
  await fs.mkdir(join(output,'archives'),{recursive:true,mode:0o700});
  await fs.mkdir(join(output,'prepared'),{recursive:true,mode:0o700});
  for(const name of ['captions.srt','captions.vtt','Counterpress_Automatic_Story.json'])
    await retainSelected(join(output,name),await fs.readFile(join(captured,name)));
  await retainSelected(join(output,'prepared/captured-review-for-recovery.json'),
    await fs.readFile(join(captured,'prepared/captured-review-for-recovery.json')));
  await retainSelected(join(output,'Counterpress_Compass_Running_Demo.mp4'),chosen);
  await retainSelected(join(output,'H264_RESULT.json'),proofBytes);
  try{await fs.access(recoveryPath);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    const resumed=structuredClone(original);
    resumed.phase='encoded';resumed.video={file:'Counterpress_Compass_Running_Demo.mp4',bytes:chosen.length,
      sha256:hash(chosen),capturedDurationSeconds:original.duration,
      encodedDurationSeconds:selectedVideoProof.video.encodedDurationSeconds,
      actualBrowserFrames:original.frames.length,captioned:true,audio:false,
      captionDelivery:selectedVideoProof.video.captionDelivery};
    resumed.receivingStorage=null;
    resumed.importCapturedCoach=join(output,'prepared/captured-review-for-recovery.json');
    resumed.provenance={...(original.provenance||{}),selectedExistingVideo:true,
      originalCaptureCheckpointSha256:historicalCheckpointSha256,
      receivingSourceDescriptorSha256:hash(originalCapturedBytes),videoProofSha256:hash(proofBytes),
      originalCapturePreserved:true};
    await retainSelected(recoveryPath,Buffer.from(JSON.stringify(resumed,null,2)+'\n'));
  }
}
const {chromium}=require(options.playwright||'playwright');
if(!options.resume){
  await fs.mkdir(output,{recursive:false,mode:0o700});
  await fs.mkdir(join(output,'frames'),{mode:0o700});
  await fs.mkdir(join(output,'archives'),{mode:0o700});
}else if(!(await fs.stat(output)).isDirectory())throw new Error('The captured output directory is missing');
const source={};
async function inventory(dir){
  for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=join(dir,entry.name);
    if(path===output||['node_modules','test','tests','.git','__pycache__'].includes(entry.name))continue;
    if(entry.isDirectory())await inventory(path);
    else if(entry.isFile())source[relative(ROOT,path)]=hash(await fs.readFile(path));
  }
}
await inventory(ROOT);
let gitHead=null;
try{gitHead=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
let startedAt=new Date().toISOString();
const trace=[],captions=[],frames=[],pageErrors=[],requests=[],hosts=[];
const temporary=process.env.TMPDIR||join(output,'temporary');
await fs.mkdir(temporary,{recursive:true,mode:0o700});
let host,browser,context,cdp,page,recordStart=0,frameQueue=Promise.resolve(),recording=false,captureError=null;
let frameBytes=0,resolveFirst;
const firstFrame=new Promise(resolve=>{resolveFirst=resolve;});
const seconds=()=>Math.max(0,(performance.now()-recordStart)/1000);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function at(time){while(seconds()<time)await wait(Math.min(200,time*1000-seconds()*1000));}
function announce(value){process.stdout.write(JSON.stringify(value)+'\n');}
function stamp(time,separator=','){
  const ms=Math.max(0,Math.round(time*1000));
  return String(Math.floor(ms/3600000)).padStart(2,'0')+':'+String(Math.floor(ms/60000)%60).padStart(2,'0')+':'+
    String(Math.floor(ms/1000)%60).padStart(2,'0')+separator+String(ms%1000).padStart(3,'0');
}
async function observe(){
  return page.evaluate(()=>({
    url:location.href,title:document.title,
    clock:document.querySelector('#clock')?.textContent??null,
    progress:document.querySelector('#progress')?.textContent??null,
    state:document.querySelector('#state')?.textContent??null,
    heading:document.querySelector('main h1,main h2')?.textContent??null,
  }));
}
async function scene(target,label,action){
  await at(target);
  const start=seconds();
  if(start>115)throw new Error('The complete workflow exceeded its recording window');
  if(captions.length)captions.at(-1).end=start;
  captions.push({start,end:118,text:label});
  announce({scene:captions.length,second:Number(start.toFixed(3)),label});
  await action();
  if(captureError)throw captureError;
  trace.push({scene:captions.length,start:Number(start.toFixed(3)),end:Number(seconds().toFixed(3)),label,...await observe()});
}
async function startApplication(port=0){
  const env={...process.env,COUNTERPRESS_ARCHIVE_DIR:join(output,'archives'),NODE_ENV:'production',TMPDIR:temporary};
  // Capturing a saved result does not need the operator's model execution environment.
  for(const key of Object.keys(env))if(/^CP_OPUS_|^ANTHROPIC_|^AZURE_|^FOUNDRY_/.test(key))delete env[key];
  const entry=pathToFileURL(join(ROOT,'src/server.mjs')).href;
  const code='const {server}=await import('+JSON.stringify(entry)+');server.listen('+port+',"127.0.0.1",()=>process.stdout.write(JSON.stringify({port:server.address().port})+"\\n"));process.on("SIGTERM",()=>{server.closeAllConnections();server.close(()=>process.exit(0));});';
  const child=spawn(process.execPath,['--max-old-space-size=128','--input-type=module','-e',code],{env,stdio:['ignore','pipe','pipe']});
  const owned={child,startedAt:new Date().toISOString(),stderr:'',port:null,closed:false};hosts.push(owned);
  child.stderr.on('data',data=>{owned.stderr=(owned.stderr+data).slice(-6000);});
  let lines='';
  try{
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Application did not start: '+owned.stderr)),20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error('Application exited before listening: '+code+'/'+signal+' '+owned.stderr));});
      child.stdout.on('data',data=>{
        lines+=data;
        for(const line of lines.split('\n'))if(line.startsWith('{"port":')){
          clearTimeout(timer);resolve(JSON.parse(line));return;
        }
      });
    });
    owned.port=ready.port;owned.origin='http://127.0.0.1:'+ready.port;
    host=owned;return owned;
  }catch(error){await closeHost(owned);throw error;}
}
async function closeHost(owned){
  if(!owned||owned.closed)return;
  const child=owned.child;
  if(child.exitCode===null&&child.signalCode===null){
    const ended=once(child,'exit');
    child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
    try{await ended;}finally{clearTimeout(timer);}
  }
  owned.closed=child.exitCode!==null||child.signalCode!==null;
  owned.closedAt=new Date().toISOString();
  if(!owned.closed)throw new Error('The owned application process has not closed');
}
async function restartApplication(){
  const port=host.port;await closeHost(host);
  const next=await startApplication(port);
  trace.push({operation:'application-restart',originalPort:port,port:next.port});
  return next.origin;
}
async function closeApplication(){for(const owned of hosts)await closeHost(owned);}
function encode(args){
  return new Promise((resolve,reject)=>{
    const child=spawn(options.ffmpeg||'ffmpeg',args,{cwd:output,stdio:['ignore','ignore','pipe']});
    let stderr='';
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-6000);});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(new Error('ffmpeg exited '+code+'/'+signal+': '+stderr)));
  });
}
async function openBrowser(origin,storageState){
  browser=await chromium.launch({executablePath:resolve(options.chromium),headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',...(options['browser-process-mode']==='single'?['--single-process','--no-zygote']:[])],env:{...process.env,TMPDIR:temporary}});
  browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1,
    acceptDownloads:true,...(storageState?{storageState}:{})});
  page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('response',response=>{
    const url=new URL(response.url());
    if(url.origin===origin&&url.pathname.startsWith('/api/'))
      requests.push({method:response.request().method(),path:url.pathname,status:response.status()});
  });
}
const journey=mode==='integrated'
  ? await (await import('./integrated-journey.mjs')).createIntegratedJourney({root:ROOT,output,options})
  : legacyJourney();
let videoResult=null,health=null,journeyResult=null,browserVersion=null,duration=null;
const runtime={get page(){return page;},get context(){return context;},get origin(){return host.origin;},
  output,trace,wait,scene,at,seconds,restartApplication,get browser(){return browser;},
  get video(){return videoResult;},hash,stamp};
let recovery=null,capturedSource=source,receivingStorage=null,originalPort=null;
async function saveRecovery(){
  await fs.writeFile(recoveryPath,JSON.stringify(recovery,null,2)+'\n',{mode:0o600});
}
try{
  if(options.resume){
    recovery=JSON.parse(await fs.readFile(recoveryPath,'utf8'));
    if(recovery.schema!=='counterpress.capture-recovery.v1'||recovery.mode!==mode||
      !['captured','encoded'].includes(recovery.phase))throw new Error('The capture recovery record is not usable');
    if(!(recovery.duration>0&&recovery.duration<118)||recovery.frames.length<20)
      throw new Error('The original complete capture is required');
    startedAt=recovery.startedAt;duration=recovery.duration;frameBytes=recovery.frameBytes;
    capturedSource=recovery.source;gitHead=recovery.gitHead;health=recovery.health;browserVersion=recovery.browserVersion;
    frames.push(...recovery.frames);captions.push(...recovery.captions);trace.push(...recovery.trace);
    requests.push(...recovery.requests);pageErrors.push(...recovery.pageErrors);
    originalPort=recovery.originalPort;receivingStorage=recovery.receivingStorage;
    await journey.restore?.(recovery.journey);
    announce({resuming:true,phase:recovery.phase,duration,frames:frames.length});
  }else{
    const app=await startApplication();const origin=app.origin;
    health=await (await fetch(origin+'/health')).json();
    await openBrowser(origin);
    await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('#play:enabled').waitFor();
    await journey.prepare?.(runtime);
    if(pageErrors.length)throw new Error('Application browser error: '+pageErrors.join('; '));
    cdp=await context.newCDPSession(page);
    cdp.on('Page.screencastFrame',event=>{
      void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
      if(!recording||captureError)return;
      const capturedAt=seconds(),file='frames/frame-'+String(frames.length).padStart(6,'0')+'.jpg';
      const bytes=Buffer.from(event.data,'base64');
      frameBytes+=bytes.length;
      if(frameBytes>192*1024*1024){captureError=new Error('The current capture exceeded its frame allocation');return;}
      frames.push({file,at:capturedAt});
      frameQueue=frameQueue.then(()=>fs.writeFile(join(output,file),bytes)).catch(error=>{captureError=error;});
      resolveFirst();
    });
    recordStart=performance.now();recording=true;
    await cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1600,maxHeight:900,everyNthFrame:1});
    await Promise.race([firstFrame,wait(5000).then(()=>{throw new Error('Chromium produced no screen frames');})]);
    await journey.run(runtime);
    await at(journey.duration);
    duration=seconds();
    recording=false;await cdp.send('Page.stopScreencast');await frameQueue;
    if(captureError)throw captureError;
    if(!captions.length||frames.length<20||duration>=118)throw new Error('The complete recording is outside its capture contract');
    captions.at(-1).end=duration;
    if(pageErrors.length)throw new Error('Application browser error: '+pageErrors.join('; '));
    // Original frame intervals are retained in the encoded clip.
    let concat='';
    for(let i=0;i<frames.length;i++){
      const start=i===0?0:frames[i].at,end=i+1<frames.length?frames[i+1].at:duration;
      concat+="file '"+frames[i].file+"'\nduration "+Math.max(.001,end-start).toFixed(6)+'\n';
    }
    concat+="file '"+frames.at(-1).file+"'\n";
    await fs.writeFile(join(output,'capture.concat'),concat);
    await fs.writeFile(join(output,'captions.srt'),captions.map((c,i)=>(i+1)+'\n'+stamp(c.start)+' --> '+stamp(c.end)+'\n'+c.text+'\n').join('\n'));
    await fs.writeFile(join(output,'captions.vtt'),'WEBVTT\n\n'+captions.map((c,i)=>(i+1)+'\n'+stamp(c.start,'.')+' --> '+stamp(c.end,'.')+'\n'+c.text+'\n').join('\n'));
    const assTime=time=>stamp(time,'.').slice(0,-1);
    const assHeader='[Script Info]\nScriptType: v4.00+\nPlayResX: 1600\nPlayResY: 1000\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,28,&H00FFFFFF,&H00FFFFFF,&H00202020,&H00202020,0,0,0,0,100,100,0,0,1,0,0,2,32,32,28,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
    const assText=text=>text.replace(/\\/g,'\\\\').replace(/{/g,'\\{').replace(/}/g,'\\}').replace(/\r?\n/g,'\\N');
    await fs.writeFile(join(output,'captions.ass'),assHeader+captions.map(c=>'Dialogue: 0,'+assTime(c.start)+','+assTime(c.end)+',Default,,0,0,0,,'+assText(c.text)).join('\n')+'\n');
    announce({capturedFrames:frames.length,frameBytes,duration});
  
    receivingStorage=journey.receive?await context.storageState():null;originalPort=host.port;
    recovery={schema:'counterpress.capture-recovery.v1',phase:'captured',mode,startedAt,source,gitHead,
      browserVersion,health,duration,frameBytes,frames,captions,trace,requests,pageErrors,requestsComplete:true,
      originalPort,receivingStorage,journey:journey.checkpoint?.()??null};
    await saveRecovery();
    await context.close();context=null;await browser.close();browser=null;await closeApplication();
  }
  const videoPath=join(output,'Counterpress_Compass_Running_Demo.mp4');
  if(receivingOnly&&recovery.phase!=='encoded')throw new Error('The selected-video receiving record must remain encoded');
  if(portableReceiving&&(recovery.provenance?.sourceMode!=='saved-portable'||
    recovery.provenance.receivingSourceDescriptorSha256!==hash(originalCapturedBytes)))
    throw new Error('The retained recipient state belongs to another captured edition');
  if(recovery.phase!=='encoded'){
    announce({encoding:true,duration,frames:frames.length});
    await encode(['-hide_banner','-loglevel','error','-y','-filter_threads','1','-filter_complex_threads','1',
      '-threads','1','-f','concat','-safe','0','-i','capture.concat',
      '-vf','scale=1600:900:flags=lanczos,pad=1600:1000:0:0:color=0x202020,tpad=stop_mode=clone:stop_duration='+Math.ceil(duration)+',fps=24,subtitles=captions.ass',
      '-t',duration.toFixed(3),'-c:v','libx264','-threads','1','-preset','veryfast','-crf','20',
      '-pix_fmt','yuv420p','-movflags','+faststart','Counterpress_Compass_Running_Demo.mp4']);
  }
  const encodedDuration=Number(execFileSync(options.ffprobe||'ffprobe',['-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1',videoPath],{encoding:'utf8'}).trim());
  if(!Number.isFinite(encodedDuration)||encodedDuration>=120||Math.abs(encodedDuration-duration)>.1)
    throw new Error('Encoded video does not retain the captured duration');
  const video=await fs.readFile(videoPath);
  videoResult={file:'Counterpress_Compass_Running_Demo.mp4',bytes:video.length,sha256:hash(video),
    capturedDurationSeconds:duration,encodedDurationSeconds:encodedDuration,actualBrowserFrames:frames.length,captioned:true,audio:false,
    captionDelivery:receivingOnly?selectedVideoProof.video.captionDelivery:'burned-in-and-sidecars'};
  if(recovery.phase==='encoded'&&recovery.video.sha256!==videoResult.sha256)
    throw new Error('The completed recording changed after encoding');
  recovery.phase='encoded';recovery.video=videoResult;await saveRecovery();
  // Reopen the saved collection, then attach the actual delivered recording.
  // This private recovery state is excluded from all exported handovers.
  if(journey.receive){
    const reopened=await startApplication(originalPort||0);
    trace.push({operation:'application-restart',originalPort,port:reopened.port,afterEncoding:true,
      recoveredFromCapturedPackages:Boolean(recovery.importCapturedCoach)});
    await openBrowser(reopened.origin,receivingStorage);
    if(recovery.importCapturedCoach){
      if(!journey.restoreCaptured)throw new Error('This journey cannot receive captured packages');
      await journey.restoreCaptured(runtime,recovery.importCapturedCoach);
      recovery.importCapturedCoach=null;recovery.originalPort=host.port;
      recovery.receivingStorage=await context.storageState();recovery.journey=journey.checkpoint();
      await saveRecovery();
    }
    announce({receiving:true,encodedDurationSeconds:encodedDuration});
    journeyResult=await journey.receive(runtime);
    if(pageErrors.length)throw new Error('Application browser error: '+pageErrors.join('; '));
    await context.close();context=null;await browser.close();browser=null;await closeApplication();
  }
  const manifest={schema:'counterpress.running-demo.v2',startedAt,completedAt:new Date().toISOString(),mode,gitHead,
    sourceSha256:capturedSource,receivingSourceSha256:source,browserVersion,viewport:{width:1600,height:900},
    video:videoResult,journey:journeyResult,recovery:recovery.provenance??null,
    application:{nodeHttp:true,sseRequests:recovery.requestsComplete?requests.filter(r=>r.path.endsWith('/stream')).length:null,
      requestLogIncludesCapture:recovery.requestsComplete,synthetic:true,configuration:health,
      providerRequests:requests.filter(r=>['/api/foundry-draft','/api/opus-commentary','/api/opus-agent-insight'].includes(r.path)),
      publicUpload:false,entrySubmission:false},
    existingVideoReceiving:receivingOnly?{originalCheckpointSha256:historicalCheckpointSha256,
      originalCapturePreserved:true,sourceMode:portableReceiving?'saved-portable':'original-private-checkpoint',
      originalPrivateCheckpointAvailable:!portableReceiving,
      portableArchive:portableReceiving?selectedCapture.archive:null,
      sourceDescriptorSha256:hash(originalCapturedBytes),
      videoProofSha256:hash(await fs.readFile(resolve(options['receive-proof'])))}:null,
    closure:{browserClosed:true,servers:hosts.map(h=>({pid:h.child.pid,port:h.port,closed:h.closed,exitCode:h.child.exitCode,signal:h.child.signalCode}))},pageErrors};
  await fs.writeFile(join(output,'journey.json'),JSON.stringify({chapters:trace,http:requests},null,2)+'\n');
  await fs.writeFile(join(output,'capture-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  if(!receivingOnly){
    await fs.rm(join(output,'frames'),{recursive:true});await fs.rm(join(output,'capture.concat'));
    await fs.rm(recoveryPath);
  }
  announce({complete:true,output,video:videoResult,journey:journeyResult});

}finally{
  recording=false;
  const errors=[];
  try{await frameQueue;}catch(error){errors.push(error);}
  try{await context?.close();}catch(error){errors.push(error);}
  try{await browser?.close();}catch(error){errors.push(error);}
  try{await closeApplication();}catch(error){errors.push(error);}
  if(receivingOnly&&hash(await fs.readFile(originalCapturedPath))!==hash(originalCapturedBytes))
    errors.push(new Error('The original captured checkpoint changed during receiving'));
  if(errors.length)throw new AggregateError(errors,'Capture process closure failed');
}
