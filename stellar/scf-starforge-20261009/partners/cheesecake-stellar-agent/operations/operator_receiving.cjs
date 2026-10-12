#!/usr/bin/env node
// MIT. One receiving-host operation using the original saved handoff, HTTP/MCP and a real browser.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createHash,randomBytes}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const wait=ms=>new Promise(done=>setTimeout(done,ms));
function args(values) {
  const out={};
  for(let i=0;i<values.length;i+=2){
    const key=values[i]?.replace(/^--/,'');
    assert(['source','config','output','playwright','chromium','temp'].includes(key)&&values[i+1]&&!out[key],'Invalid receiving option');
    out[key]=values[i+1];
  }
  for(const key of ['source','config','playwright','chromium'])assert(out[key],key+' is required');
  out.source=path.resolve(out.source);out.config=path.resolve(out.config);
  out.output=path.resolve(out.output??path.join(path.dirname(out.config),'browser-operation'));
  out.temp=path.resolve(out.temp??os.tmpdir());return out;
}
async function main(o) {
  await fs.mkdir(o.output,{recursive:true,mode:0o700});
  const file=path.join(o.output,'operator-operation.json');
  try{await fs.access(file);throw new Error('An operation journal already exists; reconcile that operation before another run.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const journal={operation:'cheesecake-original-operator-receiving-20261012',startedAt:new Date().toISOString(),
    source:o.source,configuration:o.config,completed:false,steps:[],servers:[],http:[],pageErrors:[],console:[]};
  const save=()=>fs.writeFile(file,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
  const step=async(name,action)=>{
    const record={name,startedAt:new Date().toISOString()};journal.steps.push(record);await save();
    process.stdout.write(JSON.stringify({step:name,state:'started'})+'\n');
    try{record.result=await action();record.completedAt=new Date().toISOString();await save();
      process.stdout.write(JSON.stringify({step:name,state:'complete'})+'\n');return record.result;}
    catch(error){record.error=error.message;await save();throw error;}
  };
  let opened,browserServer,browser,context,page,temporary;
  const token=randomBytes(32).toString('base64url');
  const request=async(origin,route,{method='GET',payload,authenticated=true,headers={}}={})=>{
    const response=await fetch(origin+route,{method,headers:{
      ...(authenticated?{Authorization:'Bearer '+token}:{}),...(payload===undefined?{}:{'Content-Type':'application/json'}),...headers},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={text};}
    return {status:response.status,data};
  };
  async function startServer(port=0) {
    const processChild=spawn(process.execPath,[path.join(o.source,'server.mjs'),'--config',o.config,'--port',String(port)],
      {env:{...process.env,STELLAR_APP_ACCESS_TOKEN:token},stdio:['ignore','pipe','pipe']});
    const record={pid:processChild.pid,startedAt:new Date().toISOString(),events:[],stderr:''};
    journal.servers.push(record);let stream='',ready,rejectReady;
    const promise=new Promise((done,reject)=>{ready=done;rejectReady=reject;});
    processChild.stdout.setEncoding('utf8');processChild.stderr.setEncoding('utf8');
    processChild.stdout.on('data',chunk=>{
      stream+=chunk;
      while(stream.includes('\n')){
        const i=stream.indexOf('\n'),line=stream.slice(0,i);stream=stream.slice(i+1);
        try{const event=JSON.parse(line);record.events.push(event);if(event.event==='ready'){record.ready=event;ready(event);}}
        catch{record.output=(record.output??'')+line+'\n';}
      }
    });
    processChild.stderr.on('data',chunk=>{record.stderr=(record.stderr+chunk).slice(-10000);});
    const exited=new Promise(done=>processChild.once('exit',(code,signal)=>{
      record.exit={code,signal,at:new Date().toISOString()};done(record.exit);
      if(!record.ready)rejectReady(new Error('Original server exited before ready: '+record.stderr));
    }));
    processChild.once('error',rejectReady);
    const timer=setTimeout(()=>rejectReady(new Error('Original server startup timeout')),20000);
    let event;
    try{event=await promise;}catch(error){processChild.kill('SIGTERM');await exited;throw error;}finally{clearTimeout(timer);}
    await save();return {child:processChild,record,exited,origin:event.origin};
  }
  async function stopServer(server) {
    if(!server)return null;
    if(!server.record.exit)server.child.kill('SIGTERM');
    let timer;
    const result=await Promise.race([server.exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned server drain timeout')),40000);})])
      .finally(()=>clearTimeout(timer));
    assert(result.code===0,'Original server did not drain successfully');await save();return result;
  }
  async function mcp(server,id,method,params={}) {
    const response=await request(server.origin,'/mcp',{method:'POST',payload:{jsonrpc:'2.0',id,method,params},
      headers:{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'}});
    assert(response.status===200,'Original MCP HTTP '+response.status);
    return response.data;
  }
  async function clickAction(intent,action,label) {
    const received=page.waitForResponse(response=>new URL(response.url()).pathname===
      '/api/requests/'+encodeURIComponent(intent)+'/'+action&&response.request().method()==='POST');
    await page.getByRole('button',{name:label,exact:true}).click();
    const response=await received,result=await response.json();
    return {status:response.status(),data:result};
  }
  async function connectBrowser(){
    await page.getByLabel('Operator access token',{exact:true}).fill(token);
    await page.getByRole('button',{name:'Connect',exact:true}).click();
    await page.locator('#application').waitFor({state:'visible'});
    assert(await page.locator('.request-choice').count()===4,'Browser request count changed');
  }
  try {
    await step('retained-source-and-configuration',async()=>{
      const config=JSON.parse(await fs.readFile(o.config,'utf8'));
      const sourcePins=[];
      for(const relative of ['application.mjs','configuration.mjs','server.mjs','ui/index.html','ui/app.js','ui/style.css']){
        const bytes=await fs.readFile(path.join(o.source,relative));sourcePins.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});
      }
      journal.sourcePins=sourcePins;
      return {applicationId:config.applicationId,stateDirectory:config.stateDirectory,sourcePins};
    });
    opened=await startServer();
    const selected=await step('same-state-http-and-native-mcp',async()=>{
      const health=await request(opened.origin,'/healthz',{authenticated:false});assert(health.status===200&&health.data.ready,'Health failed');
      const unauth=await request(opened.origin,'/api/requests',{authenticated:false});assert(unauth.status===401,'Bearer required');
      const identity=await request(opened.origin,'/api/application');assert(identity.status===200,'Identity unavailable');
      const requests=await request(opened.origin,'/api/requests');assert(requests.status===200&&requests.data.requests.length===4,'Original selection changed');
      const rows=requests.data.requests;
      for(const row of rows)assert(row.state.state==='PREPARED'&&hash(Buffer.from(row.bodyText))===row.bodySha256,'Native prepared/body binding changed');
      const init=await mcp(opened,1,'initialize',{protocolVersion:'2025-11-25',clientInfo:{name:'original-receiving-operation',version:'1.0.0'},capabilities:{}});
      assert(init.result.protocolVersion==='2025-11-25','Original MCP protocol mismatch');
      const catalog=await mcp(opened,2,'tools/list');assert(catalog.result.tools.length===6,'Tool catalog mismatch');
      const listed=await mcp(opened,3,'tools/call',{name:'stellar_requests',arguments:{}});
      assert(!listed.result.isError&&listed.result.structuredContent.requests.length===4,'MCP selection mismatch');
      const reviewed=await mcp(opened,4,'tools/call',{name:'stellar_request_review',arguments:{intentId:rows[0].intentId}});
      assert(!reviewed.result.isError&&reviewed.result.structuredContent.binding.bodySha256===rows[0].bodySha256,'MCP original review mismatch');
      journal.applicationIdentity=identity.data;
      return {identity:identity.data,requests:rows.map(row=>({intentId:row.intentId,bodySha256:row.bodySha256,bodyBytes:row.bodyBytes,
        state:row.state.state,method:row.method})),mcpProtocol:init.result.protocolVersion,
        mcpTools:catalog.result.tools.map(tool=>tool.name),mcpReview:reviewed.result.structuredContent.binding};
    });
    await step('actual-chromium-operator-open',async()=>{
      temporary=await fs.mkdtemp(path.join(o.temp,'stellar-operator-'));await fs.chmod(temporary,0o700);
      const {chromium}=require(o.playwright);
      browserServer=await chromium.launchServer({executablePath:o.chromium,headless:true,
        env:{...process.env,TMPDIR:temporary},args:['--no-sandbox','--disable-dev-shm-usage']});
      journal.browserPid=browserServer.process().pid;
      browser=await chromium.connect(browserServer.wsEndpoint());context=await browser.newContext({viewport:{width:1440,height:1000}});
      page=await context.newPage();page.setDefaultTimeout(15000);
      page.on('pageerror',error=>journal.pageErrors.push(error.message));
      page.on('console',message=>{if(message.type()==='error')journal.console.push(message.text());});
      page.on('response',response=>{
        const url=new URL(response.url());if(url.pathname.startsWith('/api/'))
          journal.http.push({method:response.request().method(),path:url.pathname,status:response.status(),at:new Date().toISOString()});
      });
      await page.goto(opened.origin,{waitUntil:'domcontentloaded'});await connectBrowser();
      return {browser:browser.version(),browserPid:journal.browserPid,title:await page.title(),requests:4};
    });
    await step('four-original-browser-reviews',async()=>{
      const reviews=[];
      for(const row of selected.requests){
        await page.getByRole('button',{name:'Open '+row.intentId,exact:true}).click();
        const result=await clickAction(row.intentId,'review','Run original review');
        assert(result.status===200&&result.data.binding.bodySha256===row.bodySha256,'Browser/native review binding changed');
        await page.getByText('Original review complete',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Refresh original review',exact:true}).waitFor();
        const body=await page.locator('#detail pre').first().textContent();
        assert(body,'Exact source body absent from browser');
        reviews.push({intentId:row.intentId,binding:result.data.binding,reviewedAt:result.data.review.reviewedAt});
      }
      return {reviews};
    });
    const finalIntent=selected.requests.at(-1).intentId;
    await step('exact-request-execution-confirmation',async()=>{
      await page.getByRole('button',{name:'Execute or recover',exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'visible'});
      const continued=page.getByRole('button',{name:'Continue original operation',exact:true});
      assert(await continued.isDisabled(),'Exact request acknowledgement absent');
      await page.getByRole('checkbox',{name:'Confirm exact original request',exact:true}).check();
      assert(await continued.isEnabled(),'Execution continuation unavailable');
      const text=await page.getByRole('dialog').innerText();
      assert(text.includes(finalIntent)&&text.includes(selected.requests.at(-1).bodySha256),'Reviewed binding absent from continuation');
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      return {intentId:finalIntent,reviewedBodySha256:selected.requests.at(-1).bodySha256,confirmation:'original request shown; dialog cancelled'};
    });
    await step('desktop-and-mobile-operator',async()=>{
      await page.screenshot({path:path.join(o.output,'operator-desktop.png'),fullPage:true});
      const desktop=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(o.output,'operator-mobile.png'),fullPage:true});
      const mobile=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      assert(desktop.document<=desktop.viewport&&mobile.document<=mobile.viewport,'Operator layout overflows its viewport');
      await page.setViewportSize({width:1440,height:1000});
      return {desktop,mobile,screenshots:['operator-desktop.png','operator-mobile.png']};
    });
    await step('original-status-and-result-availability',async()=>{
      await page.getByRole('tab',{name:'Operation',exact:true}).click();
      const recovered=await clickAction(finalIntent,'recover','Recover original operation');
      assert(recovered.status===200&&recovered.data.operation.state==='PREPARED','Browser original recovery state changed');
      await page.getByRole('tab',{name:'Result',exact:true}).click();
      const artifact=await clickAction(finalIntent,'read','Read retained result');
      assert(artifact.status===409&&artifact.data.error.code==='RESULT_NOT_AVAILABLE','Original availability state changed');
      await page.locator('#detail').getByText('RESULT_NOT_AVAILABLE',{exact:true}).waitFor();
      const nativeRead=await mcp(opened,5,'tools/call',{name:'stellar_request_read',arguments:{intentId:finalIntent,format:'json',limitBytes:1048576}});
      assert(nativeRead.result.isError===true&&JSON.stringify(nativeRead.result).includes('RESULT_NOT_AVAILABLE'),'Original MCP availability changed');
      return {intentId:finalIntent,recovery:recovered.data,result:artifact.data,mcpIsError:nativeRead.result.isError};
    });
    const origin=opened.origin,oldId=opened.record.ready.serverId,port=Number(new URL(origin).port);
    await step('original-server-drain',async()=>{const result=await stopServer(opened);opened=null;return result;});
    await step('restart-same-application-and-browser',async()=>{
      opened=await startServer(port);
      assert(opened.origin===origin&&opened.record.ready.serverId!==oldId,'Restart identity not fresh');
      const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/requests');
      await page.getByRole('button',{name:'Refresh',exact:true}).click();
      assert((await refreshed).status()===200,'Connected browser did not recover after restart');
      await page.reload({waitUntil:'domcontentloaded'});await connectBrowser();
      const current=await request(opened.origin,'/api/requests');
      assert(current.status===200&&current.data.requests.length===4,'Receiving selection was not reopened');
      for(const row of current.data.requests){
        const previous=selected.requests.find(old=>old.intentId===row.intentId);
        assert(previous&&row.bodySha256===previous.bodySha256&&row.state.state==='PREPARED','Original state changed across restart');
      }
      const recovered=await mcp(opened,6,'tools/call',{name:'stellar_request_recover',arguments:{intentId:finalIntent}});
      assert(!recovered.result.isError&&recovered.result.structuredContent.operation.state==='PREPARED','MCP restart recovery failed');
      assert(journal.pageErrors.length===0,'Browser application reported a runtime error');
      return {oldServerId:oldId,serverId:opened.record.ready.serverId,origin,requests:current.data.requests.map(row=>({
        intentId:row.intentId,state:row.state.state,bodySha256:row.bodySha256})),mcpRecovery:recovered.result.structuredContent};
    });
    journal.completed=true;journal.finishedAt=new Date().toISOString();
  } catch(error) {
    journal.error={message:error.message,stack:error.stack};
    if(page)try{await page.screenshot({path:path.join(o.output,'operator-failure.png'),fullPage:true});}catch{}
    process.exitCode=1;
  } finally {
    try{await context?.close();await browser?.close();await browserServer?.close();journal.browserClosed=true;}catch(error){journal.browserCloseError=error.message;}
    try{if(opened)await stopServer(opened);}catch(error){journal.serverCloseError=error.message;process.exitCode=1;}
    if(temporary)try{await fs.rm(temporary,{recursive:true,force:true});}catch(error){journal.temporaryCleanupError=error.message;}
    if(journal.serverCloseError||journal.browserCloseError)journal.completed=false;
    await save();
    process.stdout.write(JSON.stringify({operation:journal.operation,completed:journal.completed,journal:file,
      steps:journal.steps.length,browserClosed:journal.browserClosed,error:journal.error?.message??null})+'\n');
  }
}
main(args(process.argv.slice(2))).catch(error=>{process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;});
