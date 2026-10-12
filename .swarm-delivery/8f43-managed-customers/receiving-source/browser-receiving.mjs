// MIT. Open the original managed wallet through its real browser surface.
import {readFile,writeFile,mkdtemp,rm,realpath,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {receiveWalletManagedApplication} from './applications-receiving.mjs';

export async function receiveWalletInBrowser(config,{onProgress=()=>{}}={}) {
  const require=createRequire(import.meta.url);
  const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]}));
  const executablePath=await realpath(config.browserExecutable);
  const path=join(config.receptionDirectory,'wallet-browser-reception.json');
  const readVisits=async()=>{
    try {
      const value=JSON.parse(await readFile(path,'utf8'));
      if(value.schema!=='stellar-forge.browser-wallet-browser-receiving.v1' ||
        value.walletId!==config.expectedWalletId || !Array.isArray(value.visits))
        throw new Error('WALLET_BROWSER_RECEIVING_SELECTION_CHANGED');
      return value;
    } catch(error) {
      if(error.code!=='ENOENT')throw error;
      return {schema:'stellar-forge.browser-wallet-browser-receiving.v1',
        walletId:config.expectedWalletId,visits:[]};
    }
  };
  const save=async value=>{
    const temporary=path+'.'+process.pid+'.tmp';
    try {await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
      await rename(temporary,path);}
    finally {await rm(temporary,{force:true});}
  };
  const redact=value=>String(value).replace(/([#?&]session=)[a-f0-9]{64}/gi,'$1[private]');
  const result=await receiveWalletManagedApplication(config,{
    onProgress,
    onOpen:async ({url,applicationId,operationId,walletId,instanceId})=>{
      const receiving=await readVisits();
      if(receiving.visits.some(visit=>visit.operationId===operationId && visit.instanceId===instanceId))return;
      const temporary=await mkdtemp('/dev/commons-8f43-wallet-browser-');
      let browser;
      try {
        browser=await chromium.launch({executablePath,headless:true,
          env:{...process.env,TMPDIR:temporary},
          args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote']});
        const page=await browser.newPage({viewport:{width:1280,height:900}});
        const pageErrors=[];
        page.on('pageerror',error=>pageErrors.push(redact(error.message).slice(0,300)));
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
        await page.locator('#operation dd').first().waitFor({timeout:15000});
        await page.locator('#runtime').filter({hasText:'Freighter API 6.0.1'}).waitFor({timeout:10000});
        const visible=await page.locator('main').innerText();
        const workspace=await page.locator('#workspace-id').innerText();
        if(workspace!=='Workspace '+walletId)throw new Error('WALLET_BROWSER_WORKSPACE_CHANGED');
        if(pageErrors.length)throw new Error('WALLET_BROWSER_SCRIPT_ERROR: '+pageErrors.join('; '));
        const screenshot=join(config.receptionDirectory,'wallet-'+instanceId+'.png');
        await page.screenshot({path:screenshot,fullPage:true});
        const visit={applicationId,operationId,walletId,instanceId,openedAt:new Date().toISOString(),
          title:await page.title(),connection:await page.locator('#connection-status').innerText(),
          network:await page.locator('#network').innerText(),notice:await page.locator('#notice').innerText(),
          connectEnabled:await page.locator('#connect').isEnabled(),
          history:await page.locator('#history-count').innerText(),visible,screenshot,pageErrors};
        receiving.visits.push(visit);await save(receiving);
        onProgress({phase:'BROWSER_OPENED',walletId,instanceId,title:visit.title,connection:visit.connection});
      } catch(error) {throw new Error('WALLET_BROWSER_OPEN_FAILED: '+redact(error.message));}
      finally {
        try {await browser?.close();} finally {await rm(temporary,{recursive:true,force:true});}
      }
    }
  });
  const receiving=await readVisits();
  const output={schema:'stellar-forge.browser-wallet-browser-receiving.v1',
    completedAt:new Date().toISOString(),operationId:result.operationId,
    applicationId:result.applicationId,walletId:result.selection.walletId,
    sourceCommit:result.selection.sourceCommit,visits:receiving.visits};
  await save(output);
  return {result,browser:output,path};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const config=JSON.parse(await readFile(process.argv[2],'utf8'));
  const {result,browser,path}=await receiveWalletInBrowser(config,
    {onProgress:value=>process.stdout.write(JSON.stringify(value)+'\n')});
  process.stdout.write(JSON.stringify({status:'COMPLETED',operationId:result.operationId,
    walletId:result.selection.walletId,managedPasses:result.passes.length,browserVisits:browser.visits.length,path})+'\n');
}
