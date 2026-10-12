// MIT. Sole-caller entry for the retained managed Pipelines native browser journey.
// Run only through the already selected native resource operation.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { readFile, mkdir, mkdtemp, realpath, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createPipelineJobFixture, PIPELINE_NATIVE_SCENARIO } from './managed-pipelines-fixture.mjs';
import { runManagedPipelineBrowserJourney } from './managed-pipelines-browser.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
function options(argv){
  assert.equal(argv.length%2,0,'Each native option requires its selected value');
  const result={};
  for(let index=0;index<argv.length;index+=2){
    const name=argv[index],value=argv[index+1];
    assert(['--source-root','--source-identity-file','--directory','--output','--playwright','--chromium','--temporary-root','--private-runtime'].includes(name));
    assert(!Object.hasOwn(result,name));assert(isAbsolute(value)&&resolve(value)===value);
    result[name]=value;
  }
  for(const name of ['--source-root','--source-identity-file','--directory','--output','--playwright','--chromium'])assert(result[name],name+' is required');
  return result;
}
function privateJson(path,value){
  const temporary=path+'.'+randomUUID()+'.tmp';
  const fd=openSync(temporary,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,path);const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
}
async function checkedSource(root,path){
  const bytes=await readFile(path),declared=JSON.parse(bytes.toString('utf8'));
  assert.equal(declared.schema,'stellar-forge.native-source-selection.v1');
  assert.equal(declared.repository,'woahwhattheheck/public-commons-sprint-2026');
  assert(declared.files&&typeof declared.files==='object'&&!Array.isArray(declared.files));
  if(declared.commit!==undefined)assert(/^[a-f0-9]{40}$/.test(declared.commit));
  const actual={};
  for(const [name,pin] of Object.entries(declared.files)){
    assert(name&&!isAbsolute(name)&&!name.split('/').some(part=>part==='..'||part===''||part==='.'));
    assert(pin&&/^[a-f0-9]{40}$/.test(pin.gitBlob));
    const selected=resolve(root,name);assert(!relative(root,selected).startsWith('..'));
    const body=await readFile(selected),observed={gitBlob:gitBlob(body),sha256:hash(body),bytes:body.length};
    assert.equal(observed.gitBlob,pin.gitBlob,'Selected native source changed: '+name);
    if(pin.sha256!==undefined)assert.equal(observed.sha256,pin.sha256);
    actual[name]=observed;
  }
  for(const required of [
    'sf88-operator-buyer-cli/research-dossiers/server.mjs',
    'sf88-operator-buyer-cli/research-dossiers/dossier.mjs',
    'sf88-operator-buyer-cli/research-dossiers/unstructured-pipelines-workspace.mjs',
    'sf88-operator-buyer-cli/research-dossiers/unstructured-pipelines/contract.mjs',
    'sf88-operator-buyer-cli/research-dossiers/unstructured-pipelines/client.mjs',
    'sf88-operator-buyer-cli/research-dossiers/unstructured-pipelines/operations.mjs',
    'sf88-operator-buyer-cli/research-dossiers/unstructured-pipelines/edition.mjs',
    'sf88-operator-buyer-cli/research-dossiers/public/app.js',
    'sf88-operator-buyer-cli/research-dossiers/public/index.html',
    'sf88-operator-buyer-cli/research-dossiers/public/unstructured-pipelines.js',
    'sf88-operator-buyer-cli/research-dossiers/public/unstructured-pipelines.css',
  ])assert(Object.hasOwn(actual,required),'The actual joined source selection must include '+required);
  return {schema:declared.schema,repository:declared.repository,...(declared.commit?{commit:declared.commit}:{}),
    selectionFileSha256:hash(bytes),files:actual};
}

/**
 * The outer process creates only process-private TLS/browser material, then starts
 * the same selected command in a child whose native fetch trusts that original CA.
 * Persistent provider/job/receiving state stays in the selected native directory.
 */
export async function runManagedPipelineNative(argv){
  const selected=options(argv);
  const temporaryRoot=await realpath(selected['--temporary-root']??(process.platform==='linux'?'/dev':tmpdir()));
  assert((await stat(temporaryRoot)).isDirectory(),'The selected temporary root must be an existing directory');
  if(!selected['--private-runtime']){
    const privateRuntime=await mkdtemp(join(temporaryRoot,'b9d2-managed-pipelines-'));
    try{
      const key=join(privateRuntime,'provider-key.pem'),certificate=join(privateRuntime,'provider-cert.pem');
      execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
        '-keyout',key,'-out',certificate,'-subj','/CN=localhost',
        '-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:['ignore','ignore','pipe']});
      const code=await new Promise((accept,reject)=>{
        // Pin the outer temporary root: the child's TMPDIR points at its private runtime.
        const temporaryArguments=selected['--temporary-root']?[]:['--temporary-root',temporaryRoot];
        const child=spawn(process.execPath,[fileURLToPath(import.meta.url),...argv,...temporaryArguments,'--private-runtime',privateRuntime],{
          stdio:'inherit',env:{...process.env,NODE_EXTRA_CA_CERTS:certificate,TMPDIR:privateRuntime},
        });
        child.once('error',reject);child.once('exit',(code,signal)=>accept(code??(signal?1:0)));
      });
      return code;
    }finally{await rm(privateRuntime,{recursive:true,force:true});}
  }
  const privateRuntime=selected['--private-runtime'];
  assert(dirname(privateRuntime)===temporaryRoot&&privateRuntime.startsWith(join(temporaryRoot,'b9d2-managed-pipelines-')));
  assert.equal(await realpath(privateRuntime),privateRuntime);
  const sourceRoot=selected['--source-root'],directory=selected['--directory'],output=selected['--output'];
  assert(directory!==sourceRoot&&!directory.startsWith(sourceRoot+'/'));
  assert(output!==sourceRoot&&!output.startsWith(sourceRoot+'/'));
  await mkdir(directory,{recursive:true,mode:0o700});await mkdir(output,{recursive:true,mode:0o700});
  const identity=await checkedSource(sourceRoot,selected['--source-identity-file']);
  const hostPath=join(directory,'host-state.json');
  const previous=existsSync(hostPath)?JSON.parse(readFileSync(hostPath)):null;
  if(previous){
    assert.equal(previous.schema,'stellar-forge.managed-pipelines-native-host.v1');
    assert.equal(previous.sourceSelectionSha256,identity.selectionFileSha256);
  }
  const workspaceId=previous?.workspaceId??'managed-pipelines-native-'+randomUUID();
  // A new private token can serve the same configured API-key variable. Its value is never retained.
  const apiKey=randomBytes(32).toString('hex');
  const fixture=createPipelineJobFixture({apiKey,pathPrefix:'/enterprise/',
    stateFile:join(output,'provider-state.json')});
  const server=createServer({key:await readFile(join(privateRuntime,'provider-key.pem')),
    cert:await readFile(join(privateRuntime,'provider-cert.pem'))},fixture.handler);
  let app,context,operations;
  try{
    await new Promise((accept,reject)=>{server.once('error',reject);server.listen(previous?.providerPort??0,'127.0.0.1',accept);});
    const providerPort=server.address().port;
    const configuration={
      schema:'stellar-forge.unstructured-pipelines-config.v1',
      account:'retained-native-local-provider',apiUrl:'https://127.0.0.1:'+providerPort+'/enterprise/',
      apiKeyEnv:'B9D2_NATIVE_PIPELINE_API_KEY',profiles:[PIPELINE_NATIVE_SCENARIO.profile],
      limits:{maxInputs:10,maxInputBytes:50000000,maxTotalInputBytes:33554432,
        maxRequestDataBytes:1048576,maxResponseBytes:1048576,maxOutputBytes:1048576,requestTimeoutMs:15000},
    };
    privateJson(hostPath,{schema:'stellar-forge.managed-pipelines-native-host.v1',
      providerPort,workspaceId,sourceSelectionSha256:identity.selectionFileSha256});
    const module=path=>import(pathToFileURL(join(sourceRoot,path)).href);
    const [{openPipelineOperations},{startDossierWorkspace},playwright]=await Promise.all([
      module('sf88-operator-buyer-cli/research-dossiers/unstructured-pipelines/operations.mjs'),
      module('sf88-operator-buyer-cli/research-dossiers/server.mjs'),
      import(pathToFileURL(selected['--playwright']).href),
    ]);
    const providerDirectory=join(directory,'provider-operations');
    operations=await openPipelineOperations({directory:providerDirectory,configuration,
      env:{B9D2_NATIVE_PIPELINE_API_KEY:apiKey}});
    app=await startDossierWorkspace({directory:join(directory,'dossiers'),pipelineSource:{
      operations,workspaceId,directory:providerDirectory,
    }});
    context=await playwright.chromium.launchPersistentContext(join(privateRuntime,'browser'),{
      executablePath:selected['--chromium'],headless:true,acceptDownloads:true,
      viewport:{width:1440,height:1000},args:['--no-sandbox','--disable-dev-shm-usage'],
      env:{...process.env,TMPDIR:privateRuntime},
    });
    const page=context.pages()[0]??await context.newPage();
    const result=await runManagedPipelineBrowserJourney({
      page,app,fixture,outputDirectory:output,sourceIdentity:identity,
      openRestoredWorkspace:()=>startDossierWorkspace({directory:join(directory,'restored-dossiers'),pipelineSource:null}),
    });
    assert.deepEqual(await checkedSource(sourceRoot,selected['--source-identity-file']),identity);
    privateJson(join(output,'native-host-result.json'),{
      schema:'stellar-forge.managed-pipelines-native-host-result.v1',status:result.status,
      sourceIdentity:identity,nodeVersion:process.version,opensslVersion:process.versions.openssl,
      providerMode:PIPELINE_NATIVE_SCENARIO.providerMode,
      outputDirectory:output,originalOperation:result.operationId,
      providerJobId:result.providerJobId,editionIds:result.editionIds,
    });
    process.stdout.write(JSON.stringify({status:result.status,outputDirectory:output,
      resultFile:join(output,'managed-pipelines-result.json'),originalOperation:result.operationId,
      providerJobId:result.providerJobId,providerCounters:result.providerCounters})+'\n');
    return 0;
  }finally{
    await context?.close().catch(()=>{});
    await app?.close().catch(()=>{});
    await operations?.close().catch(()=>{});
    fixture.close();
    await new Promise(accept=>{server.close(accept);server.closeAllConnections();});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=await runManagedPipelineNative(process.argv.slice(2));}
  catch(error){process.stderr.write(JSON.stringify({code:error.code??'MANAGED_PIPELINES_NATIVE_FAILED',message:error.message})+'\n');process.exitCode=1;}
}
