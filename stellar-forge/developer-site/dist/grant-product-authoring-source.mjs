// MIT. Original reviewer source receiving and complete composer-file downloads.
import {productAuthoringContext,previewProductSources,productDeclarationFiles,
  verifyProductSourceImports,MAX_PRODUCT_FILE_BYTES} from './grant-product-authoring-core.mjs';
import {fileBytes,contentHash,reviewerSourceFromDraft} from './grant-handover-source.mjs';
const encoder=new TextEncoder();
const decode=value=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value);
const need=(value,message)=>{if(!value)throw new Error(message);};

export async function readProductAuthoringContext(draft,bundleId){
  const received=await reviewerSourceFromDraft(draft,bundleId);
  const descriptor=role=>received.bundle.body.files.find(file=>file.role===role);
  const indexFile=descriptor('source-index'),companionFile=descriptor('product-and-finance');
  const indexText=decode(fileBytes(draft,indexFile.sha256));
  const markdown=decode(fileBytes(draft,companionFile.sha256));
  const context=productAuthoringContext(JSON.parse(indexText.replace(/^\uFEFF/,'')),markdown);
  return {...context,bundleId,receivedAt:received.bundle.body.receivedAt,
    applicationSha256:received.bundle.body.applicationSha256,
    sourceIndex:{...indexFile},companion:{...companionFile}};
}
export async function readProductRegistrationFile(file,{receivedAt=new Date().toISOString()}={}){
  need(file&&Number.isSafeInteger(file.size)&&file.size<=MAX_PRODUCT_FILE_BYTES,
    'Choose a complete JSON registration within the existing 16 MiB draft allowance.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  need(bytes.length===file.size,'The selected registration did not finish reading.');
  return {name:file.name,text:decode(bytes),sha256:await contentHash(bytes),bytes:bytes.length,receivedAt};
}

// Store-only ZIP: declaration JSON remains exact UTF-8 and uses the standard
// directory format understood by ordinary unzip tools and the existing composer.
const CRC_TABLE=Uint32Array.from({length:256},(_,index)=>{
  let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=CRC_TABLE[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
export function productFilesZip(files){
  need(Array.isArray(files)&&files.length>0&&files.length<=65535,'Select complete declaration files.');
  const seen=new Set(),rows=[];
  let offset=0,directoryBytes=0;
  for(const file of files){
    need(typeof file.path==='string'&&file.path&&!file.path.startsWith('/')&&!/[\\\u0000-\u001f]/.test(file.path)&&
      !file.path.split('/').some(part=>!part||part==='.'||part==='..')&&!seen.has(file.path),
      'Keep distinct relative filenames in the declaration download.');
    seen.add(file.path);
    const name=encoder.encode(file.path),body=typeof file.content==='string'?encoder.encode(file.content):file.content;
    need(body instanceof Uint8Array&&name.length<=65535,'Retain complete file bytes and a supported filename.');
    const size=body.length;
    need(size<0xffffffff&&offset+30+name.length+size<0xffffffff,'This download exceeds the standard ZIP size.');
    rows.push({name,body,size,crc:crc32(body),offset});
    offset+=30+name.length+size;directoryBytes+=46+name.length;
  }
  need(offset+directoryBytes+22<0xffffffff,'This download exceeds the standard ZIP size.');
  const result=new Uint8Array(offset+directoryBytes+22),view=new DataView(result.buffer);
  const word=(at,value)=>view.setUint16(at,value,true),long=(at,value)=>view.setUint32(at,value>>>0,true);
  for(const row of rows){
    const at=row.offset;long(at,0x04034b50);word(at+4,20);word(at+6,0x0800);
    word(at+8,0);word(at+10,0);word(at+12,33);long(at+14,row.crc);
    long(at+18,row.size);long(at+22,row.size);word(at+26,row.name.length);word(at+28,0);
    result.set(row.name,at+30);result.set(row.body,at+30+row.name.length);
  }
  let at=offset;
  for(const row of rows){
    long(at,0x02014b50);word(at+4,20);word(at+6,20);word(at+8,0x0800);
    word(at+10,0);word(at+12,0);word(at+14,33);long(at+16,row.crc);
    long(at+20,row.size);long(at+24,row.size);word(at+28,row.name.length);
    word(at+30,0);word(at+32,0);word(at+34,0);word(at+36,0);long(at+38,0);long(at+42,row.offset);
    result.set(row.name,at+46);at+=46+row.name.length;
  }
  long(at,0x06054b50);word(at+4,0);word(at+6,0);word(at+8,rows.length);word(at+10,rows.length);
  long(at+12,directoryBytes);long(at+16,offset);word(at+20,0);
  return result;
}
export async function exportProductDeclarations(draft){
  const selection=draft.productSourceAuthoring?.selection;
  need(selection?.bundleId,'Select the original reviewer source edition for this author project.');
  await verifyProductSourceImports(draft,contentHash);
  const selected=await readProductAuthoringContext(draft,selection.bundleId);
  const preview=previewProductSources(selected,selection.registrations);
  const declarations=productDeclarationFiles(selection.registrations);
  const guide=[
    '# Product source declarations',
    '',
    'These complete JSON files are read by the maintained Stellar Forge grant composer.',
    '',
    '## Use the declarations',
    '',
    'Extract this ZIP and select its grant-products directory alongside the complete current',
    'reviewer distribution and canonical manuscript:',
    '',
    '~~~sh',
    'node stellar-forge/developer-site/grant-compose.mjs \\',
    '  --directory stellar-forge/developer-site/dist \\',
    '  --manuscript /absolute/path/to/current-canonical.md \\',
    '  --product-registrations-directory /absolute/path/to/extracted/grant-products',
    '~~~',
    '',
    'The directory option selects the complete declaration set. Include the installed',
    'product declarations that should remain active in this set. For an additional product',
    'with a new ID, --product-registration appends its file to the installed defaults.',
    'For an edited existing product, use the selected directory with one file per product.',
    '',
    'The composer selects original immutable source links from that manuscript, binds each',
    'received declaration file, and produces the existing four reviewer outputs.',
    '',
    '## Selected authoring source',
    '',
    'Reviewer bundle: '+selected.bundleId,
    'Application SHA-256: '+selected.applicationSha256,
    'Companion SHA-256: '+selected.companion.sha256,
    'Source-index SHA-256: '+selected.sourceIndex.sha256,
    '',
    'source-index-preview.json is the complete source index computed against this retained',
    'companion. The current canonical manuscript controls the final composed edition.',
    '',
    '## Included products',
    '',
    ...preview.products.map(product=>'- '+product.id+' — '+product.heading.replace(/^## /,'')+
      (product.chapterPresent?'':' (chapter absent from the selected source edition)')),
    '',
    'Keep the full author-project JSON from the submission workspace to reopen all original',
    'reviewer files, imported registrations, working declarations and saved draft versions.',
    '',
  ].join('\n');
  const files=[...declarations.map(({path,content})=>({path,content})),
    {path:'source-index-preview.json',content:JSON.stringify(preview.index,null,2)+'\n'},
    {path:'README.md',content:guide}];
  return {files,preview,bytes:productFilesZip(files),name:'scf-product-source-declarations.zip'};
}
