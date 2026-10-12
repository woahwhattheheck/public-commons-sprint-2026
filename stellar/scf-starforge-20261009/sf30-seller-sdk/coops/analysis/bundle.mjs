// SPDX-License-Identifier: MIT
import {readFile,mkdir,open,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ANALYSIS_VERSION,INPUT_SCHEMA,WORKBOOK_SCHEMA,prepareInput,analyse,saveWorkbook,openWorkbook,residualCsv,episodesCsv,unplacedCsv} from './core.mjs';
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const encodedJson=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const publicFunctions=['ANALYSIS_VERSION','INPUT_SCHEMA','WORKBOOK_SCHEMA','prepareInput','analyse','saveWorkbook','openWorkbook','residualCsv','episodesCsv','unplacedCsv'];
const types={'.json':'application/json; charset=utf-8','.html':'text/html; charset=utf-8','.csv':'text/csv; charset=utf-8','.txt':'text/plain; charset=utf-8'};
export async function renderWorkbookHtml(document){
  if(document.schema===WORKBOOK_SCHEMA)await openWorkbook(document,{digest});else await prepareInput(document,{digest});
  const [template,style,core,app]=await Promise.all(['index.html','style.css','core.mjs','app.mjs'].map(name=>readFile(new URL(name,import.meta.url),'utf8')));
  const inlineCore=core.replace(/\bexport\s+(?=(?:async\s+)?function|class|const)/g,'');
  const inlineApp=app.replace(/^import \{[^\n]+\} from '\.\/core\.mjs';\n/,'');
  if(inlineApp===app)throw new Error('The workbook application import seam has changed; compose its complete current entry.');
  const script='const {'+publicFunctions.join(',')+'}=(()=>{\n'+inlineCore+'\nreturn {'+publicFunctions.join(',')+'};\n})();\n'+inlineApp;
  const scriptHash=createHash('sha256').update(script).digest('base64'),styleHash=createHash('sha256').update(style).digest('base64');
  const policy="default-src 'none'; script-src 'sha256-"+scriptHash+"'; style-src 'sha256-"+styleHash+"'; img-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return template.replace('<!-- COOPS_STYLE -->',()=>'<meta http-equiv="Content-Security-Policy" content="'+policy+'"><style>'+style+'</style>')
    .replace('<!-- COOPS_INPUT -->',()=>'<script id="initial-source" type="application/json">'+encodedJson(document)+'</script>')
    .replace('<!-- COOPS_SCRIPT -->',()=>'<script>'+script+'</script>');
}
export async function buildAnalysisBundle({input,options,analyst,createdAt}={}){
  if(!input||typeof input!=='object')throw new TypeError('Pass the original retained analysis input or saved workbook.');
  let original=input,selectedOptions=options,notes=analyst,created=createdAt;
  if(input.schema===WORKBOOK_SCHEMA){
    const opened=await openWorkbook(input,{digest});original=opened.document.input;
    selectedOptions=options===undefined?opened.document.options:options;notes=analyst===undefined?opened.document.analyst:analyst;created=createdAt===undefined?opened.document.createdAt:createdAt;
  }else if(input.schema!==INPUT_SCHEMA)throw new TypeError('The supplied file is not a CO-OPS analysis input or workbook.');
  const workbook=await saveWorkbook(original,selectedOptions||{},notes||{},{digest,...(created?{createdAt:created}:{})});
  const {prepared,result}=await openWorkbook(workbook,{digest}),html=await renderWorkbookHtml(workbook),files=[];
  const add=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(value,'utf8');files.push({name,type:types[Object.keys(types).find(ext=>name.endsWith(ext))]||'application/octet-stream',bytes,sha256:createHash('sha256').update(bytes).digest('hex')});};
  add('workbook.html',html);add('workbook.json',JSON.stringify(workbook,null,2)+'\n');add('analysis.json',JSON.stringify(result,null,2)+'\n');
  add('paired.csv',residualCsv(result));add('episodes.csv',episodesCsv(result));add('unplaced.csv',unplacedCsv(result));
  for(const role of ['observations','predictions'])for(const[kind,items]of[['response',original[role].pages],['metadata',original[role].metadata||[]],['failed-response',original[role].failedResponses||[]]])items.forEach((file,index)=>add('source/'+role+'-'+kind+'-'+(index+1)+'-'+file.sha256.slice(0,12)+'.json',file.body));
  add('README.txt',[
    'CO-OPS coastal analysis workbook '+ANALYSIS_VERSION,
    '',
    'Open workbook.html in a current browser. It contains its complete original source and needs no server or network request.',
    'Apply the window, quality choices and optional residual thresholds; inspect original rows; write the analyst interpretation; download the portable workbook or save it on this device.',
    'Open a downloaded workbook with the page button to verify original response hashes and recompute the analysis.',
    'Use Print / save PDF for the report. paired.csv and analysis.json contain every selected slot and its original source references; the screen/printed row table is paginated.',
    '',
    'Station: '+prepared.common.station+'; '+prepared.common.datum+'; '+prepared.common.unitLabel+'; GMT.',
    'Selected window, inclusive: '+result.options.begin+' through '+result.options.end+'.',
    'Included pairs: '+result.coverage.included+' of '+result.coverage.expectedSlots+' expected six-minute slots.',
    'Analysis source: '+prepared.sourceId,
    'Analysis result SHA-256: '+workbook.analysisSha256,
    '',
    'Original response bytes, including accepted no-data responses and failed request history, are retained in source/ and in the portable workbook.',
    'An accepted no-data response contributes missing observation slots and never becomes a zero-valued observation.',
    'Residual = observed water level minus tidal prediction at the identical GMT timestamp.',
    'No time, unit or datum conversion and no gap interpolation is performed.',
    'For preliminary q=p rows, f[0] is a count of one-second samples outside the three-sigma band. For verified q=v rows it is the inferred-value flag.',
    'Threshold episodes contain only consecutive included samples; their span is first-to-last sample time.',
    'CSV text cells that could execute as spreadsheet formulas are prefixed with an apostrophe. The original JSON values and retained source JSON remain exact.',
    '',
    'Official source contracts:',
    'https://api.tidesandcurrents.noaa.gov/api/prod/',
    'https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html',
    'https://api.tidesandcurrents.noaa.gov/mdapi/prod/',
    '',
  ].join('\n'));
  const manifest={schema:'stellar-forge.coops-analysis-delivery.v1',version:ANALYSIS_VERSION,sourceId:prepared.sourceId,analysisSha256:workbook.analysisSha256,context:prepared.common,options:result.options,files:files.map(({name,type,bytes,sha256})=>({name,type,bytes:bytes.length,sha256}))};
  add('manifest.json',JSON.stringify(manifest,null,2)+'\n');
  return {workbook,prepared,result,manifest,files};
}
export async function writeAnalysisBundle(directory,bundle){
  const root=resolve(directory);
  try{await stat(root);throw new Error('Choose a new output directory; existing output is preserved.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(root,{mode:0o700});
  for(const file of bundle.files){
    if(!/^(?:source\/)?[a-zA-Z0-9_.-]+$/.test(file.name))throw new Error('Invalid generated analysis member name.');
    const target=join(root,file.name);if(dirname(target)!==root)await mkdir(dirname(target),{recursive:true,mode:0o700});
    const handle=await open(target,'wx',0o600);try{await handle.writeFile(file.bytes);await handle.sync();}finally{await handle.close();}
  }
  return {directory:root,workbook:join(root,'workbook.html'),portable:join(root,'workbook.json'),manifest:join(root,'manifest.json'),sourceId:bundle.prepared.sourceId,analysisSha256:bundle.workbook.analysisSha256,files:bundle.files.map(({name,bytes,sha256})=>({name,bytes:bytes.length,sha256}))};
}
async function readJson(path,maximum=256*1024*1024){
  const handle=await open(resolve(path),'r');try{const s=await handle.stat();if(!s.isFile()||s.size>maximum)throw new Error('Choose an original JSON file within '+maximum+' bytes.');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await handle.readFile()));}finally{await handle.close();}
}
export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')){console.log('node coops/analysis/bundle.mjs --input ORIGINAL_ANALYSIS_INPUT_OR_WORKBOOK.json --output NEW_DIRECTORY [--options ANALYST_SELECTION.json] [--notes ANALYST_NOTES.json]');return;}
  const flags={};for(let index=0;index<argv.length;index+=2){const key=argv[index];if(!['--input','--output','--options','--notes'].includes(key)||flags[key]||!argv[index+1]||argv[index+1].startsWith('--'))throw new TypeError('Use paired supported options; see --help.');flags[key]=argv[index+1];}
  if(!flags['--input']||!flags['--output'])throw new TypeError('--input and --output are required.');
  const input=await readJson(flags['--input']),options=flags['--options']?await readJson(flags['--options'],65536):undefined,analyst=flags['--notes']?await readJson(flags['--notes'],256*1024):undefined;
  const bundle=await buildAnalysisBundle({input,options,analyst}),output=await writeAnalysisBundle(flags['--output'],bundle);
  console.log(JSON.stringify({schema:'stellar-forge.coops-analysis-completion.v1',...output,coverage:bundle.result.coverage,statistics:bundle.result.statistics,episodes:bundle.result.episodes.length},null,2));
  return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({error:error.code||'COOPS_ANALYSIS_FAILED',message:error.message,details:error.details||null}));process.exitCode=1;});
