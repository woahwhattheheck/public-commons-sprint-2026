// MIT. Complete tariff receiving through the original saved-case controller.
import {parseArgs} from 'node:util';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {canonical,jsonBytes,sha256,commercialError} from '../commercial-pricing.mjs';
import {openCommercialTariffController,COMMERCIAL_TARIFF_ACTION_FIELDS} from './tariff-controller.mjs';

const SCHEMA='stellar-forge.merchant-commercial-tariff-command.v1';
const absolute=value=>{
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/'||value.includes('\0'))
    throw commercialError('COMMERCIAL_TARIFF_PATH','Use an absolute private file or case directory.',422);
  return value;
};
export function commercialTariffHelp(){
  return {command:'merchant-commercial tariffs',
    usage:'starforge merchant-commercial tariffs ACTION --cases-dir DIR --input FILE [--report FILE]',
    actions:Object.keys(COMMERCIAL_TARIFF_ACTION_FIELDS),
    input:'Private JSON with id, scope and the exact selected action fields. An attachment retains three distinct original case request UUIDs.',
    actionsFields:COMMERCIAL_TARIFF_ACTION_FIELDS,
    download:'download also requires --output FILE; the original descriptor and exact bytes are verified before writing.',
    report:'Optional create-only command report binds the complete input and output path. The same command reopens the original native requests.',
    receiving:'Capture a completed original tariff selection and backup, inspect, attach, quote, export the complete case, then restore the original pricing workspace and portfolio.',
    guide:'sf74-merchant-support-console/commercial/TARIFFS.md'};
}
async function optional(file,max){
  try{return await readPrivateFile(file,max);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function commercialTariffCli(argv=process.argv.slice(2)){
  const {values,positionals,tokens}=parseArgs({args:argv,strict:true,allowPositionals:true,tokens:true,
    options:{'cases-dir':{type:'string'},input:{type:'string'},report:{type:'string'},output:{type:'string'},help:{type:'boolean'}}});
  const names=tokens.filter(token=>token.kind==='option').map(token=>token.name);
  if(new Set(names).size!==names.length)throw new Error('Specify each tariff command option once.');
  if(values.help){if(positionals.length||names.length!==1)throw new Error('Use --help on its own.');return commercialTariffHelp();}
  if(positionals.length!==1||!Object.hasOwn(COMMERCIAL_TARIFF_ACTION_FIELDS,positionals[0]))
    throw new Error('Choose one original tariff receiving action.');
  const action=positionals[0],casesDirectory=absolute(values['cases-dir']),inputFile=absolute(values.input);
  if(Boolean(values.output)!==(action==='download'))throw new Error('Only download requires --output FILE.');
  const outputPath=values.output?absolute(values.output):null,reportPath=values.report?absolute(values.report):null;
  if(outputPath&&[inputFile,reportPath].includes(outputPath))throw new Error('Keep the original input, output and report in separate files.');
  if(reportPath===inputFile)throw new Error('Keep the original input and command report in separate files.');
  const inputBytes=await readPrivateFile(inputFile,1024*1024);
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inputBytes));
  const request={action,casesDirectory,inputSha256:sha256(inputBytes),input,...(outputPath?{outputPath}:{})};
  let retained;
  if(reportPath){
    const bytes=await optional(reportPath,16*1024*1024);
    if(bytes){
      retained=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(retained.schema!==SCHEMA||canonical(retained.request)!==canonical(request))
        throw commercialError('COMMERCIAL_TARIFF_COMMAND_CHANGED','The retained command report belongs to different original inputs.',409);
    }
  }
  const store=await openCaseStore(casesDirectory),controller=openCommercialTariffController({store,casesDirectory});
  let result;
  try{
    result=await controller.call(action,input);
    if(action==='download'){
      const file=result.result,body=file?.body,descriptor=file?.descriptor;
      if(!Buffer.isBuffer(body)||!descriptor||body.length!==descriptor.bytes||sha256(body)!==descriptor.sha256)
        throw commercialError('COMMERCIAL_TARIFF_DOWNLOAD_CHANGED','The original tariff file differs from its retained descriptor.',409);
      await retainCaseArtifact(outputPath,body);
      result={...result,result:{...file,body:undefined,file:{path:outputPath,...descriptor}}};
    }
  }finally{await controller.close();}
  const current={schema:SCHEMA,request,result};
  if(reportPath&&!retained)await retainCaseArtifact(reportPath,jsonBytes(current));
  return {...current,...(reportPath?{report:{path:reportPath,reopened:Boolean(retained),originalResult:retained?.result??result}}:{})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(jsonBytes(await commercialTariffCli()));}
  catch(error){process.stderr.write(JSON.stringify({error:error.code??'COMMERCIAL_TARIFF_COMMAND_FAILED',detail:error.message})+'\n');process.exitCode=1;}
}
