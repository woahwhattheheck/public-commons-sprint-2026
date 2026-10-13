#!/usr/bin/env node
// MIT. Connected Human Services Directory operation through the running native operator or normal merchant host.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readSourceFile} from './files.mjs';
import {openHumanServicesDirectoryMerchantClient,openHumanServicesDirectoryLocalClient,downloadHumanServicesDirectoryExport,inspectHumanServicesDirectoryExport,reopenHumanServicesDirectoryExport,
  readHumanServicesDirectoryValue,humanServicesDirectoryActions} from './client.mjs';
import {initializeHumanServicesDirectoryMerchant} from './setup.mjs';
import {decode,need} from './contracts.mjs';
const help=[
  'starforge merchant-human-services-directory tools',
  'starforge merchant-human-services-directory init --directory ABS --connection ABS [--name NAME]',
  'starforge merchant-human-services-directory call --connection ABS --exports ABS --action ACTION --args ABS_JSON',
  'starforge merchant-human-services-directory call --url MCP_URL --token-env ENV --action ACTION --args ABS_JSON',
  'starforge merchant-human-services-directory value CONNECTION_OPTIONS --workspace ALIAS --export-id SHA --manifest-sha256 SHA [--file NAME]',
  'starforge merchant-human-services-directory inspect CONNECTION_OPTIONS --workspace ALIAS --export-id SHA',
  'starforge merchant-human-services-directory download CONNECTION_OPTIONS --workspace ALIAS --export-id SHA --directory ABS [--manifest-sha256 SHA] [--chunk-size BYTES]',
  'starforge merchant-human-services-directory reopen --workspace ALIAS --export-id SHA --directory ABS [--manifest-sha256 SHA]',
  '',
  'CONNECTION_OPTIONS selects --connection ABS --exports ABS for local native access, or --url MCP_URL [--token-env ENV] for the normal merchant host.',
  'The local path borrows an operator already opened in Applications or by human-services-directory serve.',
  'Persistent SDK/MCP clients may use operator_open with allowStart to own the native serve process.',
  'Use the same saved acquisition operation ID after an interrupted reply. The native operator owns polling and provider Retry-After.',
  'Conformance actions use the same call/value/download flow: directory_conformance_plan, assess, review, compare, findings, finding, rows and file.',
  'Declared relationships add directory_conformance_foreign_keys, foreign_key_candidates and foreign_key_matches with exact native pages.',
  'Use directory_conformance_file for complete foreignKeys, foreignKeyCandidates, foreignKeyMatches and foreignKeyCoverage files.',
  'Three-way review uses directory_correction_worksheet_reconciliation_prepare/review/export plus catalogue/rows/file reads.',
  'Bindings select every exact original/current row; decisions prepare a current-edition correction plan for separate preview/accept.',
  'For complete actions near32MiB use declared host input_apply; complete comparison/decisions files remain available up to256MiB.',
  'Source corrections use directory_correction_prepare/preview/apply/export with exact original row hashes and separate candidate acceptance.',
  'directory_correction_rows follows all original changes; directory_correction_file retains input, changes or review with full bytes.',
  'Use native human-services-directory correction-* --input for complete correction inputs above the connected inline limit.',
  'Returned procedures use directory_operating_return_prepare/revise/complete/apply/receive/export and exact review/comparison/input/rows/file reads.',
  'Complete retains original review intent; apply uses the existing native plan receiver and retains its separately recoverable receipt.',
  'Operating Plans use directory_operating_plan_preview/create/save/receive/copy/compare/export plus directory_operating_document/draft/input/basis/catalog.',
  'Save the exact reviewed previewRecordId; full value responses and exported JSON/Markdown/HTML retain the original model history.',
  'Use the native Directory CLI for complete inputs above the connected inline limit. Existing input_apply retains its separately declared host-input limit.',
  'download receives every complete original file and resumes its existing directory; reopen verifies local completion.',
].join('\n');
export async function main(argv=process.argv.slice(2),{environment=process.env,signal,write=value=>process.stdout.write(value)}={}){
  const [command,...rest]=argv;
  if(!command || command==='help' || command==='--help'){write(help+'\n');return;}
  const flags=Object.create(null);
  for(let i=0;i<rest.length;i+=2){
    need(/^--[a-z][a-z-]*$/.test(rest[i]??'') && typeof rest[i+1]==='string' &&
      !rest[i+1].startsWith('--') && !Object.hasOwn(flags,rest[i]),'HUMAN_SERVICES_DIRECTORY_CLI_INPUT',
      'Use one value after each declared option.');
    flags[rest[i]]=rest[i+1];
  }
  const connectionOptions=['connection','exports','url','token-env'];
  const allowed={tools:[],init:['directory','connection','name'],
    call:[...connectionOptions,'action','args','timeout-ms'],
    value:[...connectionOptions,'workspace','export-id','manifest-sha256','file'],
    inspect:[...connectionOptions,'workspace','export-id'],
    download:[...connectionOptions,'workspace','export-id','directory','manifest-sha256','chunk-size'],
    reopen:['workspace','export-id','directory','manifest-sha256']}[command];
  need(allowed && Object.keys(flags).every(key=>allowed.includes(key.slice(2))),'HUMAN_SERVICES_DIRECTORY_CLI_INPUT',
    'Choose a declared connected Human Services Directory command and options.');
  const required=key=>{need(typeof flags['--'+key]==='string' && flags['--'+key],'HUMAN_SERVICES_DIRECTORY_CLI_INPUT','Missing --'+key);
    return flags['--'+key];};
  const selected=()=>({workspace:required('workspace'),exportId:required('export-id')});
  let result,client;
  try{
    if(command==='tools')result={tools:Object.values(humanServicesDirectoryActions)};
    else if(command==='init')result=await initializeHumanServicesDirectoryMerchant({directory:resolve(required('directory')),
      connection:resolve(required('connection')),...(flags['--name']?{name:flags['--name']}:{})});
    else if(command==='reopen')result=await reopenHumanServicesDirectoryExport({...selected(),directory:resolve(required('directory')),
      expectedManifestSha256:flags['--manifest-sha256']});
    else{
      if(flags['--connection']){
        need(!flags['--url'] && !flags['--token-env'],'HUMAN_SERVICES_DIRECTORY_CLI_INPUT','Select one local connection or one MCP endpoint.');
        client=await openHumanServicesDirectoryLocalClient({connection:resolve(required('connection')),exportsDirectory:resolve(required('exports'))});
      }else{
        need(!flags['--exports'],'HUMAN_SERVICES_DIRECTORY_CLI_INPUT');
        client=await openHumanServicesDirectoryMerchantClient({url:required('url'),tokenEnv:flags['--token-env']??'MCP_ACCESS_TOKEN',environment,signal});
      }
      if(command==='call'){
        const action=required('action'),nativeAction=action.replace(/^merchant_human_services_directory_/,''),
          maximum=nativeAction.startsWith('directory_correction_')?32*1024*1024+65536:4*1024*1024+65536,
          args=decode(await readSourceFile(resolve(required('args')),{maxBytes:maximum})),timeout=flags['--timeout-ms'];
        need(timeout===undefined || /^[1-9]\d*$/.test(timeout) && Number(timeout)<=600000,'HUMAN_SERVICES_DIRECTORY_CLI_INPUT');
        result=await client.call(action,args,timeout?{timeoutMs:Number(timeout)}:undefined);
      }else if(command==='value')result=await readHumanServicesDirectoryValue({...selected(),client,file:flags['--file']??'original-response.json',
        expectedManifestSha256:required('manifest-sha256')});
      else if(command==='inspect')result=await inspectHumanServicesDirectoryExport({...selected(),client});
      else{
        const chunk=flags['--chunk-size'];
        need(chunk===undefined || /^[1-9]\d*$/.test(chunk),'HUMAN_SERVICES_DIRECTORY_CLI_INPUT');
        result=await downloadHumanServicesDirectoryExport({...selected(),client,signal,directory:resolve(required('directory')),
          expectedManifestSha256:flags['--manifest-sha256'],...(chunk?{chunkSize:Number(chunk)}:{})});
      }
    }
    write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await client?.close();}
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Connected Human Services Directory command interrupted.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await main(undefined,{signal:controller.signal});}
  catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??error.name,message:error.message,
    ...(error.details?{details:error.details}:{})}})+'\n');process.exitCode=1;}
  finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
