/** Original Datasette source IO for the supplier CLI and local browser host. */
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createEdition,canonicalJSON,ReportError} from './supplier-report.mjs';
import {createDatasetteBridge} from './datasette-bridge.mjs';
import {reopenSourceEdition,serializeSourceEdition,nativeSourceIdentity,assertNativeSourceMatches} from './source-editions.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const ARCHIVE_LIMIT=536870912;
const HASH=/^[a-f0-9]{64}$/;
const RUNTIME_PATHS=['datasette/editions.mjs','datasette/capture.mjs','datasette/json.mjs','postgres/publisher/files.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const fail=(code,message,details={})=>{throw new ReportError(code,message,details);};
const check=(condition,code,message,details)=>{if(!condition)fail(code,message,details);};
const json=value=>JSON.stringify(value,null,2)+'\n';
function text(bytes,label){
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{fail('INVALID_UTF8',label+' must contain complete UTF-8.');}
}
async function exists(filename){try{return await fs.lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

export async function readSourceBytes(filename,maximum=ARCHIVE_LIMIT){
  const location=path.resolve(filename);
  const handle=await fs.open(location,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try{
    const before=await handle.stat();
    check(before.isFile(),'SOURCE_FILE_REQUIRED','Select an original regular source file.',{path:location});
    check(before.size<=maximum,'SOURCE_FILE_SIZE','The complete source exceeds its native supported size.',{path:location,bytes:before.size,maximum});
    const data=await handle.readFile(),after=await handle.stat();
    check(data.length===before.size && before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs,
      'SOURCE_FILE_CHANGED','The source file changed while it was read.',{path:location});
    return {path:location,content:data,bytes:data.length,sha256:sha(data)};
  }finally{await handle.close();}
}

async function writeRetained(filename,content){
  await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const old=await exists(filename);
  if(old){
    const retained=await readSourceBytes(filename,Math.max(content.length,ARCHIVE_LIMIT));
    check(retained.content.equals(content),'SOURCE_CACHE_CONFLICT','The retained file differs from its original content.',{path:filename});
    return;
  }
  const temporary=path.join(path.dirname(filename),'.native-'+randomUUID()+'.tmp');
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
  try{
    try{await fs.link(temporary,filename);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const retained=await readSourceBytes(filename,Math.max(content.length,ARCHIVE_LIMIT));
      check(retained.content.equals(content),'SOURCE_CACHE_CONFLICT','A concurrent source receive differs from the retained file.',{path:filename});
    }
  }finally{await fs.unlink(temporary);}
}

function cacheDirectory(value){
  return path.resolve(value || path.join(process.cwd(),'.supplier-native-sources'));
}
async function cacheArchive(original,cache){
  const filename=path.join(cache,'archives',original.sha256+'.datasette.json.gz');
  await writeRetained(filename,original.content);
  return {...original,path:filename};
}

/** The installed source capsule contains unchanged original modules, never source-data execution hooks. */
export async function nativeRuntimeDocument({nativeDirectory}={}){
  if(!nativeDirectory){
    const original=await readSourceBytes(path.join(ROOT,'native-runtime.json'),4*1024*1024);
    return text(original.content,'The installed native runtime');
  }
  const root=path.dirname(path.resolve(nativeDirectory));
  const files=[];
  for(const relative of RUNTIME_PATHS){
    const original=await readSourceBytes(path.join(root,relative),4*1024*1024);
    files.push({path:relative,content:text(original.content,relative),gitBlob:gitBlob(original.content)});
  }
  return json({format:'conapi-datasette-runtime',version:1,source:'caller-selected original Datasette module directory',files});
}

export async function loadNativeRuntime({nativeDirectory}={}){
  let directory;
  if(nativeDirectory)directory=path.resolve(nativeDirectory);
  else{
    const source=await nativeRuntimeDocument();
    let capsule;
    try{capsule=JSON.parse(source);}catch{fail('NATIVE_RUNTIME_INVALID','The installed original native runtime capsule is invalid.');}
    check(capsule?.format==='conapi-datasette-runtime' && capsule.version===1 && Array.isArray(capsule.files) &&
      capsule.files.length===RUNTIME_PATHS.length && new Set(capsule.files.map(file=>file.path)).size===RUNTIME_PATHS.length &&
      RUNTIME_PATHS.every(name=>capsule.files.some(file=>file.path===name)),
      'NATIVE_RUNTIME_INVALID','The complete installed native runtime must retain its four original modules.');
    const root=path.join(os.tmpdir(),'conapi-datasette-runtime-'+sha(Buffer.from(source,'utf8')));
    for(const file of capsule.files){
      check(typeof file.content==='string' && /^[a-f0-9]{40}$/.test(file.gitBlob),
        'NATIVE_RUNTIME_INVALID','Each original native module must retain its complete source and Git blob identity.');
      const content=Buffer.from(file.content,'utf8');
      check(gitBlob(content)===file.gitBlob,'NATIVE_RUNTIME_CHANGED','An original native runtime module differs from its source identity.',{path:file.path});
      await writeRetained(path.join(root,file.path),content);
    }
    directory=path.join(root,'datasette');
  }
  const [editions,values]=await Promise.all([
    import(pathToFileURL(path.join(directory,'editions.mjs')).href),
    import(pathToFileURL(path.join(directory,'json.mjs')).href)
  ]);
  for(const name of ['readDatasetteEdition','projectDatasetteRow','exportDatasetteEdition','receiveDatasettePackage']){
    check(typeof editions[name]==='function','NATIVE_RUNTIME_INCOMPLETE','The original Datasette runtime is missing '+name+'.');
  }
  check(typeof values.exactJson==='function','NATIVE_RUNTIME_INCOMPLETE','The original exact JSON serializer is required.');
  return {directory,editions,bridge:createDatasetteBridge({
    readDatasetteEdition:editions.readDatasetteEdition,
    projectDatasetteRow:editions.projectDatasetteRow,
    exactJson:values.exactJson
  })};
}

async function receivedArchive(original,{cacheDirectory:cache,nativeDirectory}={}){
  const runtime=await loadNativeRuntime({nativeDirectory});
  const root=cacheDirectory(cache),retained=await cacheArchive(original,root);
  const destination=path.join(root,'received',retained.sha256);
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  const selected=await runtime.editions.receiveDatasettePackage({
    archiveFile:retained.path,directory:destination,sha256:retained.sha256
  });
  return {runtime,retained,selected};
}

export async function readNativeSource({
  filename,format='native-edition',expectedSha256,archiveSha256,
  id,sourceId,capturedAt,numericFormat='source',cacheDirectory:cache,nativeDirectory
}={}){
  check(['native-edition','native-archive'].includes(format),'NATIVE_INPUT_FORMAT','Select native-edition or native-archive.');
  if(expectedSha256!==undefined)check(HASH.test(expectedSha256),'NATIVE_EDITION_HASH','Use the original native edition SHA-256.');
  if(archiveSha256!==undefined)check(HASH.test(archiveSha256),'NATIVE_ARCHIVE_HASH','Use the original archive SHA-256.');
  let runtime,selected,retained;
  if(format==='native-archive'){
    const original=await readSourceBytes(filename);
    check(archiveSha256===undefined || original.sha256===archiveSha256,
      'NATIVE_ARCHIVE_CHANGED','The archive differs from its selected original hash.');
    ({runtime,selected,retained}=await receivedArchive(original,{cacheDirectory:cache,nativeDirectory}));
  }else{
    runtime=await loadNativeRuntime({nativeDirectory});
    selected=await runtime.editions.readDatasetteEdition(path.resolve(filename),
      expectedSha256===undefined?{}:{expectedSha256});
    const root=cacheDirectory(cache);
    const exportDirectory=path.join(root,'edition-exports');
    await fs.mkdir(exportDirectory,{recursive:true,mode:0o700});
    const result=await runtime.editions.exportDatasetteEdition({
      editionFile:selected.editionFile,outputFile:path.join(exportDirectory,selected.editionSha256+'.datasette.json.gz')
    });
    check(result.editionSha256===selected.editionSha256 && result.captureSha256===selected.captureSha256,
      'NATIVE_SOURCE_CHANGED','The source changed while its complete archive was retained.');
    const original=await readSourceBytes(result.archiveFile);
    check(original.sha256===result.sha256 && original.bytes===result.bytes,'NATIVE_ARCHIVE_CHANGED','The retained archive differs from its export receipt.');
    retained=await cacheArchive(original,root);
  }
  check(archiveSha256===undefined || retained.sha256===archiveSha256,
    'NATIVE_ARCHIVE_CHANGED','The archive differs from its selected original hash.');
  check(expectedSha256===undefined || selected.editionSha256===expectedSha256,
    'NATIVE_EDITION_CHANGED','The archive contains another native edition.');
  const source=await runtime.bridge.readEdition({
    editionFile:selected.editionFile,expectedSha256:selected.editionSha256,
    ...(id===undefined?{}:{id}),...(sourceId===undefined?{}:{sourceId}),
    ...(capturedAt===undefined?{}:{capturedAt}),numericFormat
  });
  const metadata=JSON.parse(canonicalJSON(source.source));
  metadata.native.archive={
    filename:path.basename(retained.path),path:retained.path,bytes:retained.bytes,sha256:retained.sha256,
    editionSha256:selected.editionSha256,captureSha256:selected.captureSha256
  };
  return createEdition({
    id:source.id,sourceId:source.sourceId,capturedAt:source.capturedAt,
    columns:source.columns,rows:source.rows,source:metadata
  });
}

export async function verifyNativeArchive(edition,filename,{cacheDirectory:cache,nativeDirectory}={}){
  const source=reopenSourceEdition(edition),identity=nativeSourceIdentity(source);
  check(identity!==null,'NATIVE_SOURCE_REQUIRED','Choose a native supplier edition.');
  const original=await readSourceBytes(filename);
  const receipt=source.source.native.archive;
  if(receipt){
    check(receipt.sha256===original.sha256 && receipt.bytes===original.bytes,
      'NATIVE_ARCHIVE_CHANGED','The archive differs from the complete original retained with this source edition.');
  }
  const {runtime,retained,selected}=await receivedArchive(original,{cacheDirectory:cache,nativeDirectory});
  const reopened=await runtime.bridge.readEdition({
    editionFile:selected.editionFile,expectedSha256:identity.editionSha256,
    id:source.id,sourceId:source.sourceId,capturedAt:source.capturedAt,numericFormat:identity.numericFormat
  });
  assertNativeSourceMatches(source,reopened);
  return {filename:path.basename(filename),path:retained.path,bytes:retained.bytes,sha256:retained.sha256,
    editionSha256:identity.editionSha256,captureSha256:identity.captureSha256,content:original.content};
}

export async function nativeDeliveryMembers(report,{directory,archives={},cacheDirectory:cache,nativeDirectory}={}){
  const files=[],sources={};
  for(const role of ['baseline','candidate']){
    const edition=report[role],identity=nativeSourceIdentity(edition);
    if(!identity)continue;
    const filename=role+'-native-source.datasette.json.gz';
    if(archives[role])check(await exists(path.resolve(archives[role])),'NATIVE_ARCHIVE_REQUIRED','The explicitly selected '+role+' source archive is missing.');
    const choices=[archives[role],directory && path.join(directory,filename),edition.source.native.archive?.path].filter(Boolean);
    let selected;
    for(const choice of choices){if(await exists(path.resolve(choice))){selected=path.resolve(choice);break;}}
    if(!selected){
      const native=edition.source.native;
      check(typeof native.editionFile==='string' && await exists(native.editionFile),
        'NATIVE_ARCHIVE_REQUIRED','Keep the original native source archive with this workspace, or provide --'+role+'-native-archive.');
      const recovered=await readNativeSource({
        filename:native.editionFile,format:'native-edition',expectedSha256:identity.editionSha256,
        id:edition.id,sourceId:edition.sourceId,capturedAt:edition.capturedAt,numericFormat:identity.numericFormat,
        cacheDirectory:cache,nativeDirectory
      });
      assertNativeSourceMatches(edition,recovered);
      selected=recovered.source.native.archive.path;
    }
    const archive=await verifyNativeArchive(edition,selected,{cacheDirectory:cache,nativeDirectory});
    files.push({filename,content:archive.content});
    sources[role]={archive:filename,bytes:archive.bytes,sha256:archive.sha256,
      editionSha256:archive.editionSha256,captureSha256:archive.captureSha256};
  }
  return {files,sources};
}

async function deliveredNativeSources(directory){
  const filename=path.join(directory,'manifest.json');
  if(!await exists(filename))return {};
  const original=await readSourceBytes(filename,4*1024*1024);
  let manifest;
  try{manifest=JSON.parse(text(original.content,'The delivery manifest').replace(/^\uFEFF/,''));}
  catch{fail('DELIVERY_MANIFEST','The adjacent delivery manifest must contain complete JSON.');}
  check(manifest?.format==='conapi-supplier-delivery' && manifest.version===1 && Array.isArray(manifest.files),
    'DELIVERY_MANIFEST','Use the completed supplier delivery manifest.');
  const selected=manifest.nativeSources || {},sources={};
  check(selected && typeof selected==='object' && !Array.isArray(selected),
    'DELIVERY_NATIVE_BINDING','The completed delivery must retain its original native source bindings.');
  for(const role of ['baseline','candidate']){
    const binding=selected[role];if(binding===undefined)continue;
    const name=role+'-native-source.datasette.json.gz';
    const members=manifest.files.filter(file=>file?.filename===name);
    check(binding && binding.archive===name && Number.isSafeInteger(binding.bytes) && binding.bytes>=0 &&
      HASH.test(binding.sha256) && HASH.test(binding.editionSha256) && HASH.test(binding.captureSha256) &&
      members.length===1 && members[0].bytes===binding.bytes && members[0].sha256===binding.sha256,
      'DELIVERY_NATIVE_BINDING','The completed '+role+' archive must retain its original byte and native identities.');
    sources[role]={archive:name,bytes:binding.bytes,sha256:binding.sha256,
      editionSha256:binding.editionSha256,captureSha256:binding.captureSha256};
  }
  return sources;
}

function response(res,status,value){
  const content=Buffer.from(json(value),'utf8');
  res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Content-Length':content.length,'Cache-Control':'no-store'});
  res.end(content);
}
function localRequest(req){
  let origin;
  try{origin=new URL('http://'+req.headers.host);}catch{fail('NATIVE_SOURCE_ORIGIN','Use the original local supplier workspace address.');}
  check(['127.0.0.1','localhost','[::1]'].includes(origin.hostname) &&
    Number(origin.port || 80)===req.socket.localPort && origin.pathname==='/' && !origin.username && !origin.password &&
    (!req.headers.origin || req.headers.origin===origin.origin) &&
    (!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site'])),
    'NATIVE_SOURCE_ORIGIN','Use the same original local supplier workspace origin.');
}
async function upload(req){
  const chunks=[];let count=0;
  for await(const chunk of req){count+=chunk.length;check(count<=ARCHIVE_LIMIT,'SOURCE_FILE_SIZE','The complete native archive exceeds 512 MiB.');chunks.push(chunk);}
  check(count>0,'NATIVE_ARCHIVE_REQUIRED','Select the complete original native archive.');
  const content=Buffer.concat(chunks);
  return {content,bytes:content.length,sha256:sha(content)};
}

export function createNativeSourceHost({cacheDirectory:cache,nativeDirectory,directory=ROOT}={}){
  const root=cacheDirectory(cache);let active=null,closing=false;
  return {
    async handle(req,res){
      let url;
      try{url=new URL(req.url,'http://127.0.0.1');}catch{return false;}
      if(!url.pathname.startsWith('/api/native-source/'))return false;
      try{
        localRequest(req);
        if(req.method==='GET' && url.pathname==='/api/native-source/status'){
          response(res,200,{status:closing?'closing':active?'reading':'ready',maximumArchiveBytes:ARCHIVE_LIMIT,
            nativeSources:await deliveredNativeSources(directory)});return true;
        }
        if(req.method==='GET' && url.pathname.startsWith('/api/native-source/archive/')){
          const expected=url.pathname.slice('/api/native-source/archive/'.length);
          check(HASH.test(expected),'NATIVE_ARCHIVE_HASH','Choose the retained original archive identity.');
          const choices=[path.join(root,'archives',expected+'.datasette.json.gz'),
            path.join(directory,'baseline-native-source.datasette.json.gz'),path.join(directory,'candidate-native-source.datasette.json.gz')];
          let found;
          for(const filename of choices){
            if(!await exists(filename))continue;
            const original=await readSourceBytes(filename);
            if(original.sha256===expected){found=original;break;}
          }
          check(found,'NATIVE_ARCHIVE_REQUIRED','The original archive is not beside this received workspace. Select its saved native source package to continue.');
          const editionHash=url.searchParams.get('edition'),captureHash=url.searchParams.get('capture');
          if(editionHash!==null || captureHash!==null){
            check(HASH.test(editionHash || '') && HASH.test(captureHash || ''),
              'NATIVE_SOURCE_METADATA','Use the original edition and capture identities for this archive.');
            const received=await receivedArchive(found,{cacheDirectory:root,nativeDirectory});
            check(received.selected.editionSha256===editionHash && received.selected.captureSha256===captureHash,
              'NATIVE_SOURCE_CHANGED','The downloaded archive belongs to another original native source.');
          }
          res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':found.bytes,
            'Content-Disposition':'attachment; filename="native-source-'+expected.slice(0,12)+'.datasette.json.gz"','Cache-Control':'no-store'});
          res.end(found.content);return true;
        }
        check(req.method==='POST' && url.pathname==='/api/native-source/read',
          'NATIVE_SOURCE_METHOD','Use the native source read operation.');
        check(req.headers['x-conapi-native-source']==='1','NATIVE_SOURCE_ORIGIN','Use the original native source upload.');
        check(!closing && !active,'NATIVE_SOURCE_BUSY','The original source reader is completing another file. Continue this same input after it finishes.');
        let complete;active=new Promise(resolve=>{complete=resolve;});
        try{
          let options;
          try{options=JSON.parse(url.searchParams.get('options') || '{}');}
          catch{fail('NATIVE_SOURCE_INPUT','The original source options must be valid JSON.');}
          check(options && typeof options==='object' && !Array.isArray(options) &&
            Object.keys(options).every(key=>['id','sourceId','capturedAt','numericFormat','expectedSha256'].includes(key)),
            'NATIVE_SOURCE_INPUT','Use the source identity, time and numeric format fields.');
          const original=await upload(req),retained=await cacheArchive(original,root);
          const edition=await readNativeSource({...options,filename:retained.path,format:'native-archive',
            archiveSha256:retained.sha256,cacheDirectory:root,nativeDirectory});
          response(res,200,{source:serializeSourceEdition(edition),archive:edition.source.native.archive});
        }finally{const done=complete;active=null;done();}
      }catch(error){
        const status=error.code==='NATIVE_SOURCE_ORIGIN'?403:error.code==='NATIVE_SOURCE_BUSY'?409:
          error.code==='NATIVE_SOURCE_METHOD'?405:error.code==='SOURCE_FILE_SIZE'?413:422;
        if(!res.headersSent)response(res,status,{error:{code:error.code || 'NATIVE_SOURCE_IO',message:error.message,details:error.details || {}}});
        else res.destroy(error);
      }
      return true;
    },
    async close(){closing=true;if(active)await active;}
  };
}
