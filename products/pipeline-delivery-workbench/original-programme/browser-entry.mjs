import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const inputPath=process.argv[2];
if(!inputPath)throw new Error('Choose the original browser-input.json');
const input=JSON.parse(await fs.readFile(inputPath,'utf8'));
const require=createRequire(import.meta.url);
const {chromium}=require(input.playwright_module);
await fs.mkdir(input.temporary_root,{recursive:true,mode:0o700});
const browser=await chromium.launch({executablePath:input.chromium,headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage'],downloadsPath:input.temporary_root});
let context;
try{
 context=await browser.newContext({acceptDownloads:true,viewport:{width:1500,height:1050}});
 const page=await context.newPage();
 const module=await import(pathToFileURL(input.workflow).href);
 const result=await module.runSnowpackBrowser({page,browser,context,input});
 if(result?.project_id!==input.project_id||result?.run_id!==input.run_id)
  throw new Error('The returned browser observation names a different original project or native run');
 const actual={...result,finished_at:new Date().toISOString()};
 const bytes=JSON.stringify(actual,null,2)+'\n',next=input.result_path+'.next';
 const file=await fs.open(next,'w',0o600);
 try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 await fs.rename(next,input.result_path);
 console.log(JSON.stringify({state:actual.state,project_id:actual.project_id,run_id:actual.run_id,
                            result_path:input.result_path}));
 if(actual.state!=='completed')process.exitCode=2;
}finally{if(context)await context.close();await browser.close();}
