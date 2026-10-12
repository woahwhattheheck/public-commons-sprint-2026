// MIT. One original native acquisition; B710 receives the same retained session.
export const receivePublishedWorkbook = async function receivePublishedWorkbook({versions,project,run,reviewFile,configFile,snapshot,expectedRows,sourceHash,candidateId}){
  const assert=(await import('node:assert/strict')).default;
  const fs=await import('node:fs/promises'),{join,resolve}=await import('node:path'),{pathToFileURL}=await import('node:url');
  const {createServer}=await import('node:http'),{once}=await import('node:events'),{createHash}=await import('node:crypto');
  if(!process.env.SCF_MERCHANT_PACKAGE)throw new TypeError('SCF_MERCHANT_PACKAGE is required');
  const packageRoot=resolve(process.env.SCF_MERCHANT_PACKAGE);
  const python=process.env.SCF_PYTHON||'python3';
  const root=join(packageRoot,'source/stellar/scf-starforge-20261009');
  const receivingSource=join(packageRoot,'source');
  const receivingRoot=join(receivingSource,'stellar/scf-starforge-20261009'),native=p=>import(pathToFileURL(join(receivingRoot,p)));
  const {initializeWorkspace}=await native('sf88-operator-buyer-cli/workspace.mjs');
  const {createDatasetSession,inspectDatasetSession,runDatasetSession}=await native('sf88-operator-buyer-cli/dataset-session.mjs');
  const {X402BuyerClient}=await native('sf31-buyer-client/buyer.mjs');
  const {prepareBuyerResponseFile}=await native('sf31-buyer-client/response-file.mjs');
  const {executeWithEvidence}=await native('sf82-checkout-evidence/evidence.mjs');
  const session=join(run,'acquisition'),operator=join(run,'buyer-operator');
  const exists=async p=>{try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
  // Reopen the original completed/partial session before any initialization.
  // A receiving retry does not replace its private workspace or repeat pages.
  if(!await exists(join(session,'session.json'))){
    const initialization=await initializeWorkspace(['--config',configFile,'--dir',operator,
      '--actor','census-workbook-82e4','--service','dataset','--payer','G'+'B'.repeat(55),
      '--python',python,'--total-atomic','400'],
      {environment:{},resume:await exists(operator)});
    assert.equal(initialization.directory,operator);
    await createDatasetSession({directory:session,workspaceDirectory:operator,
      maxPages:4,maxTotalAtomic:'400',maxRows:1000,maxPageBytes:1048576,expectedSnapshot:snapshot});
  }
  const before=await inspectDatasetSession(session);assert.equal(before.expectedSnapshot??before.snapshot,snapshot);
  let requests=0;
  const server=createServer(versions.wrapRequest(async(req,res)=>{
    try{
      requests++;const url=new URL(req.url,'http://127.0.0.1'),context={url,query:url.searchParams};
      const admitted=await versions.admit(context),result=admitted===true?await versions.handle(context):admitted;
      res.writeHead(result.status,result.headers);res.end(JSON.stringify(result.body));
    }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.code??error.message}));}
  }));
  server.listen(0,'127.0.0.1');await once(server,'listening');const local='http://127.0.0.1:'+server.address().port;
  const buyer=new X402BuyerClient({fetchImpl:(url,options)=>{const u=new URL(url);return fetch(local+u.pathname+u.search,options);}});
  async function executeFreePage(cfg,{signal}={}){
    const writer=await prepareBuyerResponseFile(cfg.responseFile);let saved,evidence;
    const executor={async call(options){
      const result=await buyer.call({...options,approve:async()=>{throw Error('Unexpected payment in original free HTTP path');},
        sign:async()=>{throw Error('No wallet signing in original free HTTP path');}});
      saved=await writer.save(result,{signal});return result;
    }};
    try{evidence=await executeWithEvidence({buyer:executor,call:{...cfg.operation,signal},outputDir:cfg.evidenceDir,captureBody:false});}
    finally{await writer.abort();}
    assert.equal(evidence.error,null);
    return{mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId:cfg.operation.intentId,status:evidence.result.status,
      httpStatus:evidence.result.httpStatus,sellerReportedSettlement:evidence.result.settlement,evidencePath:evidence.evidencePath,
      originalOutcomeReport:evidence.report,operatorReservation:null,responseFile:{status:'SAVED',...saved},
      interrupted:false,retry:'NO_AUTOMATIC_RETRY'};
  }
  let finished;
  try{finished=before.status==='COMPLETE'?before:await runDatasetSession(session,{executePage:executeFreePage,
    onPage:()=>console.log(JSON.stringify({phase:'original-customer-page'}))});}
  finally{await new Promise(resolve=>server.close(resolve));}
  assert.equal(finished.status,'COMPLETE');assert.equal(finished.snapshot,snapshot);assert.equal(finished.acquiredRows,expectedRows);
  const acquisitionFile=join(run,'original-acquisition.json');
  let acquisition;
  if(await exists(acquisitionFile)){
    acquisition=JSON.parse(await fs.readFile(acquisitionFile,'utf8'));
    assert.equal(acquisition.schema,'stellar-forge.workbook-native-acquisition.v1');
    for(const [key,value] of Object.entries({sessionDirectory:session,snapshot,expectedRows,sourceHash,candidateId}))
      assert.equal(acquisition[key],value,'Retained native acquisition '+key);
    assert.equal(acquisition.completedPages,finished.completedPages);
  }else{
    acquisition={schema:'stellar-forge.workbook-native-acquisition.v1',sessionDirectory:session,snapshot,expectedRows,
      completedPages:finished.completedPages,requests,sourceHash,candidateId,
      method:'Original SF30/SF31/SF82/SF88 free HTTP path; no new paid transfer'};
    await fs.writeFile(acquisitionFile,JSON.stringify(acquisition,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  const ready={schema:'stellar-forge.workbook-customer-ready.v1',
    customerDirectory:join(root,'sf30-seller-sdk/dataset-refresh/workbook-customer'),
    runtimeDirectory:join(receivingRoot,'sf88-operator-buyer-cli'),buyerStateDirectory:join(run,'customer-app'),
    packetDirectory:join(run,'customer-packet'),reviewFile,configFile,datasetId:'census-jam-2023-b710',sessionDirectory:session,
    deliveryDirectory:join(run,'customer-native-room'),portableDirectory:join(run,'customer-portable-room'),
    resultFile:join(run,'customer-result.json'),sourceRoot:receivingSource,
    pythonPath:join(receivingRoot,'sf88-operator-buyer-cli/python'),pythonExecutable:python,nodeExecutable:process.execPath,
    analysis:{database:join(run,'customer-analysis'),alias:'census_analysis',source:'census_2023',view:'census_2023',
      exportDirectory:join(run,'customer-query-export'),portableExportDirectory:join(run,'customer-query-portable')}};
  await fs.writeFile(join(run,'customer-ready.json'),JSON.stringify(ready,null,2)+'\n',{mode:0o600});
  const helper=join(root,'sf30-seller-sdk/dataset-refresh/workbook-customer/examples/run-workbook-receiver.mjs'),bytes=await fs.readFile(helper);
  assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex'),'b4514f7340185a8cf382a0a39c570d8a6210e468');
  const {runWorkbookReceiver}=await import(pathToFileURL(helper));await runWorkbookReceiver(ready,{progress:info=>console.log(JSON.stringify({phase:'customer-receiving',info}))});
  return{acquisition,receiver:JSON.parse(await fs.readFile(ready.resultFile,'utf8')),receiverResultFile:ready.resultFile,
    readyFile:join(run,'customer-ready.json')};
};
