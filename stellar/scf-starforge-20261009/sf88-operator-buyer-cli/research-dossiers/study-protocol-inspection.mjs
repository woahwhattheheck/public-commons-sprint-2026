// MIT. Inspect the original registered capture through its native SourceBundle.
import {isDeepStrictEqual} from 'node:util';
import {digest,jsonBytes,need,object} from '../node/store.mjs';
import {inspectSourceBundle,sourceBundleFileBytes,SOURCE_MANIFEST_SCHEMA} from './source-bundles.mjs';
import {STUDY_PROTOCOL_SCHEMA,STUDY_PROTOCOL_REGISTRY,selectRegisteredStudyProtocol} from './study-protocol-source.mjs';
import {STUDY_PROTOCOL_METHODS} from './study-protocol-methods.mjs';

export const STUDY_PROTOCOL_INSPECTION='sf88-study-protocol-inspection/v1';
const normalized=value=>value.normalize('NFKC').replace(/[\s\u00ad]+/g,' ').trim();
const same=(actual,expected,code)=>need(isDeepStrictEqual(actual,expected),code);
const parse=bytes=>{
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
  catch{need(false,'PROTOCOL_ORIGINAL_JSON_INVALID');}
};
const descriptor=file=>({name:file.name,bytes:file.bytes,sha256:file.sha256});
const expectedNames=()=>[STUDY_PROTOCOL_REGISTRY.filename,STUDY_PROTOCOL_METHODS.document.registeredFilename,
  'registered-document.json','protocol-source.json','protocol-pages.txt','protocol-pages.json','protocol-methods.json','index.html'];

/**
 * This is a read-only inspection of a supplied, retained capture. It does not
 * make a provider request, extract a new PDF, or create another dossier store.
 */
export function inspectStudyProtocolBundle(input){
  const inspected=inspectSourceBundle(input),{manifest,value,preview}=inspected;
  const files=new Map(value.files.map(file=>[file.name,{file,bytes:sourceBundleFileBytes(file)}]));
  const names=expectedNames();
  need(files.size===names.length&&names.every(name=>files.has(name)),'PROTOCOL_ORIGINAL_BUNDLE_FILES_REQUIRED');
  const bytes=name=>files.get(name).bytes;
  const document=name=>parse(bytes(name));
  const selected=selectRegisteredStudyProtocol(bytes(STUDY_PROTOCOL_REGISTRY.filename));
  const pdfFile=files.get(STUDY_PROTOCOL_METHODS.document.registeredFilename).file;
  const pdf=bytes(pdfFile.name),pdfIdentity=descriptor(pdfFile);
  need(pdf.length===STUDY_PROTOCOL_METHODS.document.registeredBytes&&pdf.subarray(0,5).toString()==='%PDF-',
    'PROTOCOL_ORIGINAL_PDF_REQUIRED');
  const registered=document('registered-document.json');
  same(registered,{documentPointer:selected.documentPointer,document:selected.document},'PROTOCOL_REGISTERED_DOCUMENT_CHANGED');
  const provenance=document('protocol-source.json');
  need(object(provenance)&&provenance.schema===STUDY_PROTOCOL_SCHEMA&&
    typeof provenance.operation==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(provenance.operation)&&
    provenance.sourceUrl===selected.url&&provenance.documentPointer===selected.documentPointer,
    'PROTOCOL_SOURCE_PROVENANCE_CHANGED');
  same(provenance.registry,selected.registry,'PROTOCOL_ORIGINAL_REGISTRY_CHANGED');
  same(provenance.registeredDocument,selected.document,'PROTOCOL_REGISTERED_DOCUMENT_CHANGED');
  same(provenance.pdf,pdfIdentity,'PROTOCOL_ORIGINAL_PDF_CHANGED');
  const http=provenance.http;
  need(object(http)&&http.status===200&&object(http.headers)&&
    typeof http.startedAt==='string'&&Number.isFinite(Date.parse(http.startedAt))&&
    typeof http.completedAt==='string'&&Number.isFinite(Date.parse(http.completedAt))&&
    Date.parse(http.completedAt)>=Date.parse(http.startedAt),'PROTOCOL_RETAINED_HTTP_PROVENANCE_REQUIRED');
  const pages=document('protocol-pages.json');
  need(object(pages)&&pages.schema==='sf88-study-protocol-pages/v1'&&pages.sourceUrl===selected.url&&
    Array.isArray(pages.pages)&&pages.pages.length===STUDY_PROTOCOL_METHODS.document.pdfPages,
    'PROTOCOL_COMPLETE_PAGE_TEXT_REQUIRED');
  same(pages.pdf,pdfIdentity,'PROTOCOL_PAGE_PDF_CHANGED');
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes('protocol-pages.txt'));
  const parts=text.split('\f');
  if(parts.length&&parts.at(-1).trim()==='')parts.pop();
  need(parts.length===pages.pages.length&&pages.pages.every((page,index)=>object(page)&&
    page.index===index&&page.pdfPage===index+1&&page.text===parts[index]&&
    page.bytes===Buffer.byteLength(page.text)&&page.sha256===digest(Buffer.from(page.text))),
    'PROTOCOL_RETAINED_PAGE_TEXT_CHANGED');
  need(object(provenance.text)&&provenance.text.pdfPages===pages.pages.length&&
    provenance.text.fullTextSha256===digest(bytes('protocol-pages.txt'))&&
    object(provenance.text.tool)&&typeof provenance.text.tool.binary==='string'&&
    typeof provenance.text.tool.version==='string'&&provenance.text.tool.version.trim(),
    'PROTOCOL_TEXT_PROVENANCE_CHANGED');
  same(provenance.text.tool.argv,['-layout','-enc','UTF-8','-','-'],'PROTOCOL_TEXT_TOOL_CHANGED');
  const whole=normalized(text),original=STUDY_PROTOCOL_METHODS.document;
  need(whole.includes(original.protocolId)&&whole.includes('Version '+original.version+', '+original.versionText),
    'PROTOCOL_DOCUMENT_VERSION_CHANGED');
  for(const note of STUDY_PROTOCOL_METHODS.observations){
    need(note.anchors.every(anchor=>normalized(pages.pages[note.pdfPage-1].text).toLowerCase()
      .includes(normalized(anchor).toLowerCase())),'PROTOCOL_NOTE_PAGE_ANCHOR_CHANGED');
  }
  // Match the original capture's complete authored methods projection. The
  // selected PDF, page text and registry provide its only variable identities.
  const expected=structuredClone(STUDY_PROTOCOL_METHODS);
  expected.sourceFile=pdfIdentity;
  expected.registrySha256=selected.registry.sha256;
  expected.pageText={filename:'protocol-pages.json',pdfPages:pages.pages.length};
  expected.observations=expected.observations.map((note,index)=>({...note,
    pdfUrl:expected.sourceUrl+'#page='+note.pdfPage,
    pageTextPointer:'/pages/'+(note.pdfPage-1)+'/text',notePointer:'/observations/'+index}));
  expected.plannedBoundaries.pdfUrl=expected.sourceUrl+'#page='+expected.plannedBoundaries.pdfPage;
  expected.plannedBoundaries.pageTextPointer='/pages/'+(expected.plannedBoundaries.pdfPage-1)+'/text';
  const methods=document('protocol-methods.json');
  same(methods,expected,'PROTOCOL_METHODS_SOURCE_CHANGED');
  const key=STUDY_PROTOCOL_REGISTRY.nctId+'-protocol-methods',methodsSha256=digest(jsonBytes(STUDY_PROTOCOL_METHODS));
  need(manifest.sources.length===1&&manifest.sources[0].key===key,'PROTOCOL_SOURCE_SELECTION_CHANGED');
  const source=manifest.sources[0];
  same(source.files,names,'PROTOCOL_SOURCE_FILE_SELECTION_CHANGED');
  need(source.selected===true&&source.classification==='unreviewed','PROTOCOL_SOURCE_REVIEW_STATE_CHANGED');
  const expectedMetadata={nctId:STUDY_PROTOCOL_REGISTRY.nctId,registrySha256:selected.registry.sha256,
    protocolSha256:pdfIdentity.sha256,protocolId:original.protocolId,protocolVersion:original.version,
    protocolVersionDate:original.versionDate,protocolUrl:selected.url,methodsSha256,pdfPages:pages.pages.length};
  same(source.metadata,expectedMetadata,'PROTOCOL_SOURCE_METADATA_CHANGED');
  same(manifest.findings,methods.observations.map(note=>({key:note.id,title:note.title,text:note.fact+
    '\nSource: '+selected.url+'#page='+note.pdfPage+'; section '+note.section+
    '; protocol-pages.json#'+note.pageTextPointer,sourceKeys:[key]})),'PROTOCOL_SOURCE_FINDINGS_CHANGED');
  // The complete native manifest also carries the displayed source label,
  // rights statement and projection fields. Keep them bound to this capture.
  const expectedManifest={schema:SOURCE_MANIFEST_SCHEMA,
    label:'NCT03529110 protocol and methods source',sourceReference:selected.url,
    sourceTerms:'Publicly hosted sponsor protocol. Original sponsor notices are retained; the methods index is authored by Commons.',
    description:'Original registered protocol with complete page text and a methods index for the existing research question.',
    sources:[{key,title:'NCT03529110 protocol and methods source',
      url:'https://clinicaltrials.gov/study/'+STUDY_PROTOCOL_REGISTRY.nctId,
      summary:'Original registry, registered PDF, complete page text and methods index.',
      selected:true,classification:'unreviewed',metadata:expectedMetadata,files:names}],
    findings:methods.observations.map(note=>({key:note.id,title:note.title,text:note.fact+
      '\nSource: '+selected.url+'#page='+note.pdfPage+'; section '+note.section+
      '; protocol-pages.json#'+note.pageTextPointer,sourceKeys:[key]}))};
  same(manifest,expectedManifest,'PROTOCOL_SOURCE_MANIFEST_CHANGED');
  return {schema:STUDY_PROTOCOL_INSPECTION,nctId:STUDY_PROTOCOL_REGISTRY.nctId,
    bundleSha256:preview.bundleSha256,bundleBytes:preview.bundleBytes,operation:provenance.operation,
    registry:selected.registry,protocol:pdfIdentity,sourceUrl:selected.url,methodsSha256,
    methods,fileCount:files.size,pdfPages:pages.pages.length,
    files:value.files.map(file=>({...descriptor(file),mediaType:file.mediaType??'application/octet-stream'})),
    provenance:{kind:'retained-original-capture',http:structuredClone(http),text:structuredClone(provenance.text)},
    sourceBundle:preview};
}
