// MIT. Original registered protocol capture and native Research SourceBundle.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve,isAbsolute} from 'node:path';
import {readResearchHostFile} from './workspace-files.mjs';
import {createSourceBundle,inspectSourceBundle,SOURCE_MANIFEST_SCHEMA,sourceBundleFileBytes} from './source-bundles.mjs';
import {digest,jsonBytes,need,privateDirectory,writeBytes} from '../node/store.mjs';
import {STUDY_PROTOCOL_METHODS} from './study-protocol-methods.mjs';

const runFile=promisify(execFile);
export const STUDY_PROTOCOL_SCHEMA='sf88-study-protocol-source/v1';
export const STUDY_PROTOCOL_REGISTRY=Object.freeze({
  nctId:'NCT03529110',bytes:99951,
  sha256:'1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1',
  filename:'NCT03529110_Original_Registry_Study.json'
});
const MAX=256*1024*1024;
const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized=value=>value.normalize('NFKC').replace(/[\s\u00ad]+/g,' ').trim();
export async function protocolOptional(file,limit=MAX){
  try{return await readResearchHostFile(resolve(file),limit);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function protocolImmutable(file,bytes){
  need(bytes instanceof Uint8Array&&bytes.length<=MAX,'PROTOCOL_FILE_SIZE_INVALID');
  const existing=await protocolOptional(file);
  if(existing){need(existing.length===bytes.length&&digest(existing)===digest(bytes),'PROTOCOL_RETAINED_FILE_CHANGED');return;}
  try{await writeBytes(resolve(file),bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const actual=await readResearchHostFile(resolve(file),bytes.length,{sha256:digest(bytes)});
  need(actual.length===bytes.length,'PROTOCOL_RETAINED_FILE_CHANGED');
}
export const protocolImmutableJson=(file,value)=>protocolImmutable(file,jsonBytes(value));
export function selectRegisteredStudyProtocol(raw){
  const pin=STUDY_PROTOCOL_REGISTRY;
  need(raw instanceof Uint8Array&&raw.length===pin.bytes&&digest(raw)===pin.sha256,'PROTOCOL_ORIGINAL_REGISTRY_CHANGED');
  const study=JSON.parse(Buffer.from(raw).toString('utf8'));
  need(study?.protocolSection?.identificationModule?.nctId===pin.nctId,'PROTOCOL_STUDY_CHANGED');
  const docs=study?.documentSection?.largeDocumentModule?.largeDocs;
  need(Array.isArray(docs),'PROTOCOL_REGISTERED_DOCUMENTS_REQUIRED');
  const found=docs.map((document,index)=>({document,index}))
    .filter(value=>value.document.filename===STUDY_PROTOCOL_METHODS.document.registeredFilename);
  need(found.length===1,'PROTOCOL_REGISTERED_DOCUMENT_AMBIGUOUS');
  const {document,index}=found[0];
  need(Number.isSafeInteger(Number(document.size))&&Number(document.size)===STUDY_PROTOCOL_METHODS.document.registeredBytes,
    'PROTOCOL_REGISTERED_SIZE_CHANGED');
  need(/^[A-Za-z0-9][A-Za-z0-9_.-]*\.pdf$/.test(document.filename),'PROTOCOL_REGISTERED_FILENAME_INVALID');
  const url='https://cdn.clinicaltrials.gov/large-docs/'+pin.nctId.slice(-2)+'/'+pin.nctId+'/'+document.filename;
  need(url===STUDY_PROTOCOL_METHODS.sourceUrl,'PROTOCOL_SOURCE_URL_CHANGED');
  return {study,document,index,url,documentPointer:'/documentSection/largeDocumentModule/largeDocs/'+index,
    registry:{filename:pin.filename,bytes:raw.length,sha256:digest(raw)}};
}
async function fetchProtocol(selected,{fetch=globalThis.fetch,timeoutMs=180000}={}){
  need(typeof fetch==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=900000,
    'PROTOCOL_FETCH_OPTIONS_INVALID');
  const startedAt=new Date().toISOString();
  const response=await fetch(selected.url,{method:'GET',redirect:'error',
    signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/pdf'}});
  need(response.status===200,'PROTOCOL_HTTP_STATUS_'+response.status);
  need(response.url===selected.url,'PROTOCOL_RESPONSE_URL_CHANGED');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body??[]){
    bytes+=chunk.length;need(bytes<=STUDY_PROTOCOL_METHODS.document.registeredBytes,'PROTOCOL_RESPONSE_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  const raw=Buffer.concat(chunks,bytes);
  need(raw.length===STUDY_PROTOCOL_METHODS.document.registeredBytes&&raw.subarray(0,5).toString()==='%PDF-',
    'PROTOCOL_PDF_BYTES_INVALID');
  const headers=Object.fromEntries(['content-type','content-length','content-encoding','etag','last-modified']
    .filter(key=>response.headers.has(key)).map(key=>[key,response.headers.get(key)]));
  return {schema:STUDY_PROTOCOL_SCHEMA,kind:'original-http-capture',sourceUrl:selected.url,
    registrySha256:selected.registry.sha256,documentPointer:selected.documentPointer,
    startedAt,completedAt:new Date().toISOString(),status:response.status,headers,
    file:{name:selected.document.filename,bytes:raw.length,sha256:digest(raw),encoding:'base64',content:raw.toString('base64')}};
}
async function pageText(pdf,{pdftotext='pdftotext',pdfinfo='pdfinfo'}={}){
  const options={encoding:'buffer',maxBuffer:MAX,timeout:180000,input:undefined};
  async function command(binary,args,input){
    const child=execFile(binary,args,options);
    const chunks=[],errors=[];let size=0,errorSize=0;
    const result=new Promise((resolveResult,reject)=>{
      child.on('error',reject);
      child.stdout.on('data',part=>{size+=part.length;if(size>MAX){child.kill();reject(new Error('PROTOCOL_TEXT_TOO_LARGE'));}else chunks.push(part);});
      child.stderr.on('data',part=>{errorSize+=part.length;if(errorSize>MAX){child.kill();reject(new Error('PROTOCOL_TOOL_ERROR_TOO_LARGE'));}else errors.push(part);});
      child.on('close',(code,signal)=>{
        if(code!==0)reject(Object.assign(new Error('PROTOCOL_TEXT_COMMAND_FAILED'),{details:{binary,args,code,signal,stderr:Buffer.concat(errors).toString('utf8')}}));
        else resolveResult({stdout:Buffer.concat(chunks).toString('utf8'),stderr:Buffer.concat(errors).toString('utf8')});
      });
    });
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.emit('error',error);});
    child.stdin.end(input);return result;
  }
  const version=await runFile(pdftotext,['-v'],{encoding:'utf8',maxBuffer:65536,timeout:15000});
  const info=await command(pdfinfo,['-'],pdf);
  const extracted=await command(pdftotext,['-layout','-enc','UTF-8','-','-'],pdf);
  const count=Number(/^Pages:\s+(\d+)\s*$/m.exec(info.stdout)?.[1]);
  need(count===STUDY_PROTOCOL_METHODS.document.pdfPages,'PROTOCOL_PAGE_COUNT_CHANGED');
  const parts=extracted.stdout.split('\f');
  if(parts.length&&parts.at(-1).trim()==='')parts.pop();
  need(parts.length===count,'PROTOCOL_PAGE_TEXT_INCOMPLETE');
  const full=normalized(extracted.stdout),document=STUDY_PROTOCOL_METHODS.document;
  need(full.includes(document.protocolId)&&full.includes('Version '+document.version+', '+document.versionText),
    'PROTOCOL_DOCUMENT_VERSION_CHANGED');
  for(const note of STUDY_PROTOCOL_METHODS.observations){
    need(Number.isSafeInteger(note.pdfPage)&&note.pdfPage>=1&&note.pdfPage<=count,'PROTOCOL_NOTE_PAGE_INVALID');
    const page=normalized(parts[note.pdfPage-1]);
    need(note.anchors.every(anchor=>page.toLowerCase().includes(normalized(anchor).toLowerCase())),
      'PROTOCOL_NOTE_PAGE_ANCHOR_CHANGED');
  }
  return {schema:STUDY_PROTOCOL_SCHEMA,kind:'complete-page-text',pdfSha256:digest(pdf),
    tool:{binary:pdftotext,version:(version.stdout+version.stderr).trim(),
      argv:['-layout','-enc','UTF-8','-','-']},pdfInfo:info.stdout,
    text:extracted.stdout,pages:parts.map((text,index)=>({index,pdfPage:index+1,text,
      bytes:Buffer.byteLength(text),sha256:digest(Buffer.from(text))}))};
}
function methodsForCapture(capture,text){
  const value=structuredClone(STUDY_PROTOCOL_METHODS);
  value.sourceFile={name:capture.file.name,bytes:capture.file.bytes,sha256:capture.file.sha256};
  value.registrySha256=capture.registrySha256;
  value.pageText={filename:'protocol-pages.json',pdfPages:text.pages.length};
  value.observations=value.observations.map((note,index)=>({...note,
    pdfUrl:value.sourceUrl+'#page='+note.pdfPage,
    pageTextPointer:'/pages/'+(note.pdfPage-1)+'/text',
    notePointer:'/observations/'+index}));
  value.plannedBoundaries.pdfUrl=value.sourceUrl+'#page='+value.plannedBoundaries.pdfPage;
  value.plannedBoundaries.pageTextPointer='/pages/'+(value.plannedBoundaries.pdfPage-1)+'/text';
  return value;
}
function sourceIndex(methods){
  const rows=methods.observations.map(note=>'<tr><th scope="row">'+html(note.title)+'</th><td>'+html(note.fact)+
    '</td><td><a href="'+html(methods.document.registeredFilename)+'#page='+note.pdfPage+'">Page '+note.pdfPage+
    '</a><br>§ '+html(note.section)+'</td></tr>').join('\n');
  const boundaryRows=methods.plannedBoundaries.rows.map(row=>'<tr><td>'+html(row.endpoint)+'</td><td>'+
    html(row.look)+'</td><td>'+row.events+'</td><td>'+html(row.pValue)+'</td><td>'+html(row.hazardRatio)+'</td></tr>').join('\n');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>NCT03529110 protocol source</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#202020;background:#fff;margin:0}'+
    'main{max-width:1100px;margin:auto;padding:32px 24px}h1{font-size:28px;margin:0 0 8px}h2{font-size:21px;margin-top:32px}'+
    'a{color:#202020;text-underline-offset:3px}nav{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}'+
    'table{border-collapse:collapse;width:100%;font-size:15px}th,td{border:1px solid #ccc;padding:10px;text-align:left;vertical-align:top}'+
    'thead{background:#f2f2f2}th{font-weight:600}.scroll{overflow:auto}.meta{color:#505050}code{overflow-wrap:anywhere}'+
    '@media(max-width:500px){main{padding:20px 14px}th,td{padding:8px}table{font-size:14px}}</style><main>'+
    '<h1>NCT03529110 protocol source</h1><p class="meta">'+html(methods.document.protocolId)+' · Version '+
    html(methods.document.version)+' · '+html(methods.document.versionDate)+' · '+methods.document.pdfPages+' pages</p>'+
    '<nav><a href="'+html(methods.document.registeredFilename)+'">Open protocol PDF</a>'+
    '<a href="'+STUDY_PROTOCOL_REGISTRY.filename+'">Original registry</a><a href="protocol-pages.txt">Full page text</a>'+
    '<a href="protocol-pages.json">Page data</a><a href="protocol-methods.json">Methods index</a></nav>'+
    '<p>'+html(methods.use)+'</p><div class="scroll"><table><thead><tr><th>Method</th><th>Source note</th><th>Location</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div><h2>Planned analysis boundaries</h2><p>'+
    '<a href="'+html(methods.document.registeredFilename)+'#page=103">Table 11.1, page 103</a> · Two-sided values</p>'+
    '<div class="scroll"><table><thead><tr><th>Endpoint</th><th>Look</th><th>Events</th><th>p</th><th>HR</th></tr></thead><tbody>'+
    boundaryRows+'</tbody></table></div><h2>Original source</h2><p><a href="'+html(methods.sourceUrl)+'">'+
    html(methods.sourceUrl)+'</a></p><p>'+methods.sourceFile.bytes+' bytes · SHA-256 <code>'+methods.sourceFile.sha256+
    '</code></p><p>Original sponsor notices remain in the complete PDF.</p></main></html>\n';
}
export async function inspectStudyProtocolCapture(directory){
  directory=resolve(directory);
  const completeBytes=await readResearchHostFile(join(directory,'CAPTURE_COMPLETE.json'),1024*1024);
  const complete=JSON.parse(completeBytes.toString('utf8'));
  need(complete.schema===STUDY_PROTOCOL_SCHEMA&&complete.state==='CAPTURED'&&Array.isArray(complete.files),
    'PROTOCOL_CAPTURE_REQUIRED');
  for(const file of complete.files){
    need(typeof file.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(file.name),'PROTOCOL_CAPTURE_MEMBER_INVALID');
    const bytes=await readResearchHostFile(join(directory,file.name),MAX,{sha256:file.sha256});
    need(bytes.length===file.bytes,'PROTOCOL_CAPTURE_MEMBER_CHANGED');
  }
  const bundle=await readResearchHostFile(join(directory,'source-bundle.json'),MAX,{sha256:complete.bundleSha256});
  const inspected=inspectSourceBundle(bundle);
  need(inspected.preview.bundleSha256===complete.bundleSha256&&inspected.preview.bundleBytes===complete.bundleBytes,
    'PROTOCOL_CAPTURE_BUNDLE_CHANGED');
  const registry=inspected.value.files.find(file=>file.name===STUDY_PROTOCOL_REGISTRY.filename);
  const protocol=inspected.value.files.find(file=>file.name===STUDY_PROTOCOL_METHODS.document.registeredFilename);
  need(registry?.bytes===STUDY_PROTOCOL_REGISTRY.bytes&&registry?.sha256===STUDY_PROTOCOL_REGISTRY.sha256&&
    protocol?.bytes===STUDY_PROTOCOL_METHODS.document.registeredBytes&&protocol?.sha256===complete.protocol?.sha256,
    'PROTOCOL_CAPTURE_ORIGINAL_FILES_CHANGED');
  const expected=new Set([...inspected.value.files.map(file=>file.name),'source-manifest.json','source-bundle.json']);
  need(complete.files.length===expected.size&&new Set(complete.files.map(file=>file.name)).size===expected.size&&
    complete.files.every(file=>expected.has(file.name)),'PROTOCOL_CAPTURE_MEMBERS_INCOMPLETE');
  return {complete,bundle,inspected};
}
export async function captureStudyProtocol({studyFile,directory,operation='DBC61-SCF-STUDY-EXTRACTION-20261012-PROTOCOL',...options}){
  need(typeof directory==='string'&&isAbsolute(directory)&&resolve(directory)===directory,'PROTOCOL_ABSOLUTE_DIRECTORY_REQUIRED');
  need(typeof operation==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(operation),'PROTOCOL_OPERATION_REQUIRED');
  const root=await privateDirectory(directory);
  const registry=await readResearchHostFile(resolve(studyFile),STUDY_PROTOCOL_REGISTRY.bytes,{sha256:STUDY_PROTOCOL_REGISTRY.sha256});
  const selected=selectRegisteredStudyProtocol(registry),methodsSha256=digest(jsonBytes(STUDY_PROTOCOL_METHODS));
  const intent={schema:STUDY_PROTOCOL_SCHEMA,operation,registry:selected.registry,
    registeredDocument:selected.document,documentPointer:selected.documentPointer,sourceUrl:selected.url,methodsSha256};
  await protocolImmutableJson(join(root,'source-selection.json'),intent);
  if(await protocolOptional(join(root,'CAPTURE_COMPLETE.json'),1024*1024)){
    const previous=await inspectStudyProtocolCapture(root);
    need(previous.complete.operation===operation&&previous.complete.methodsSha256===methodsSha256,'PROTOCOL_CAPTURE_SELECTION_CHANGED');
    return previous.complete;
  }
  const captureFile=join(root,'capture-envelope.json');
  const savedCapture=await protocolOptional(captureFile);
  const capture=savedCapture?JSON.parse(savedCapture.toString('utf8')):await fetchProtocol(selected,options);
  const pdf=sourceBundleFileBytes(capture.file);
  need(capture.schema===STUDY_PROTOCOL_SCHEMA&&capture.registrySha256===selected.registry.sha256&&
    capture.sourceUrl===selected.url&&capture.file.name===selected.document.filename&&capture.status===200&&pdf.length===Number(selected.document.size)&&
    pdf.subarray(0,5).toString()==='%PDF-','PROTOCOL_CAPTURE_CHANGED');
  await protocolImmutableJson(captureFile,capture);
  const textFile=join(root,'text-capture.json'),savedText=await protocolOptional(textFile);
  const text=savedText?JSON.parse(savedText.toString('utf8')):await pageText(pdf,options);
  need(text.schema===STUDY_PROTOCOL_SCHEMA&&text.pdfSha256===digest(pdf)&&
    text.pages.length===STUDY_PROTOCOL_METHODS.document.pdfPages,'PROTOCOL_TEXT_CAPTURE_CHANGED');
  need(typeof text.text==='string'&&Array.isArray(text.pages)&&typeof text.pdfInfo==='string'&&
    typeof text.tool?.version==='string','PROTOCOL_TEXT_CAPTURE_INVALID');
  const retainedParts=text.text.split('\f');
  if(retainedParts.length&&retainedParts.at(-1).trim()==='')retainedParts.pop();
  need(retainedParts.length===text.pages.length&&text.pages.every((page,index)=>
    page.index===index&&page.pdfPage===index+1&&page.text===retainedParts[index]&&
    page.bytes===Buffer.byteLength(page.text)&&page.sha256===digest(Buffer.from(page.text))),
    'PROTOCOL_RETAINED_PAGE_TEXT_CHANGED');
  const retainedText=normalized(text.text),document=STUDY_PROTOCOL_METHODS.document;
  need(retainedText.includes(document.protocolId)&&
    retainedText.includes('Version '+document.version+', '+document.versionText),'PROTOCOL_DOCUMENT_VERSION_CHANGED');
  for(const note of STUDY_PROTOCOL_METHODS.observations)
    need(note.anchors.every(anchor=>normalized(text.pages[note.pdfPage-1].text).toLowerCase()
      .includes(normalized(anchor).toLowerCase())),'PROTOCOL_NOTE_PAGE_ANCHOR_CHANGED');
  await protocolImmutableJson(textFile,text);
  const methods=methodsForCapture(capture,text);
  const sourceMetadata={schema:STUDY_PROTOCOL_SCHEMA,operation,sourceUrl:selected.url,
    documentPointer:selected.documentPointer,registeredDocument:selected.document,
    registry:selected.registry,pdf:{name:capture.file.name,bytes:pdf.length,sha256:digest(pdf)},
    http:{startedAt:capture.startedAt,completedAt:capture.completedAt,status:capture.status,headers:capture.headers},
    text:{tool:text.tool,pdfPages:text.pages.length,fullTextSha256:digest(Buffer.from(text.text))}};
  const files=new Map([
    [STUDY_PROTOCOL_REGISTRY.filename,registry],[capture.file.name,pdf],
    ['registered-document.json',jsonBytes({documentPointer:selected.documentPointer,document:selected.document})],
    ['protocol-source.json',jsonBytes(sourceMetadata)],
    ['protocol-pages.txt',Buffer.from(text.text)],
    ['protocol-pages.json',jsonBytes({schema:'sf88-study-protocol-pages/v1',pdf:sourceMetadata.pdf,
      sourceUrl:selected.url,pages:text.pages})],
    ['protocol-methods.json',jsonBytes(methods)],['index.html',Buffer.from(sourceIndex(methods))]
  ]);
  const key=STUDY_PROTOCOL_REGISTRY.nctId+'-protocol-methods';
  const manifest={schema:SOURCE_MANIFEST_SCHEMA,label:'NCT03529110 protocol and methods source',
    sourceReference:selected.url,sourceTerms:'Publicly hosted sponsor protocol. Original sponsor notices are retained; the methods index is authored by Commons.',
    description:'Original registered protocol with complete page text and a methods index for the existing research question.',
    sources:[{key,title:'NCT03529110 protocol and methods source',url:'https://clinicaltrials.gov/study/'+STUDY_PROTOCOL_REGISTRY.nctId,
      summary:'Original registry, registered PDF, complete page text and methods index.',selected:true,classification:'unreviewed',
      metadata:{nctId:STUDY_PROTOCOL_REGISTRY.nctId,registrySha256:selected.registry.sha256,protocolSha256:digest(pdf),
        protocolId:methods.document.protocolId,protocolVersion:methods.document.version,protocolVersionDate:methods.document.versionDate,
        protocolUrl:selected.url,methodsSha256,pdfPages:text.pages.length},files:[...files.keys()]}],
    findings:methods.observations.map(note=>({key:note.id,title:note.title,text:note.fact+
      '\nSource: '+selected.url+'#page='+note.pdfPage+'; section '+note.section+
      '; protocol-pages.json#'+note.pageTextPointer,sourceKeys:[key]}))};
  const manifestBytes=jsonBytes(manifest),bundle=createSourceBundle({manifestBytes,files});
  files.set('source-manifest.json',manifestBytes);files.set('source-bundle.json',bundle.bytes);
  for(const [name,bytes]of files)await protocolImmutable(join(root,name),bytes);
  const complete={schema:STUDY_PROTOCOL_SCHEMA,state:'CAPTURED',operation,registry:selected.registry,
    protocol:sourceMetadata.pdf,sourceUrl:selected.url,methodsSha256,pdfPages:text.pages.length,
    bundleSha256:bundle.preview.bundleSha256,bundleBytes:bundle.preview.bundleBytes,
    files:[...files].map(([name,bytes])=>({name,bytes:bytes.length,sha256:digest(bytes)}))};
  await protocolImmutableJson(join(root,'CAPTURE_COMPLETE.json'),complete);
  await inspectStudyProtocolCapture(root);return complete;
}
