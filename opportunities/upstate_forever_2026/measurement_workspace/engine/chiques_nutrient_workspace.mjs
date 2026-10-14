/** Adapter routes over the existing source collection and MeasurementWorkspace. */
import fs from 'node:fs';
import path from 'node:path';
import {InputError} from './parse.mjs';
import {hash,stable} from './normalise.mjs';
import {prepareChiquesNutrients,verifyChiquesPreparation,readChiquesImportedSources,CHIQUES_ADAPTER} from './chiques_nutrients.mjs';
import {previewCollection,receiveCollection,listCollections} from './collections.mjs';
const need=(v,m,status=400)=>{if(!v)throw new InputError(m,status);};
const identifier=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function collectionRoot(workspace,id){need(identifier(id),'Choose an original collection ID');return path.join(workspace.directory,'collections',id);}
function readDocument(workspace,id){
 const root=collectionRoot(workspace,id),document=JSON.parse(fs.readFileSync(path.join(root,'collection.json'),'utf8'));
 need(hash(stable(document))===id,'Retained collection identity differs',409);
 need(Array.isArray(document.files),'Retained collection is incomplete',409);
 return {root,document};
}
function sourceMember(root,file){
 need(typeof file.path==='string'&&!file.path.startsWith('/')&&!file.path.includes('\\')&&!file.path.split('/').some(x=>!x||x==='.'||x==='..'||x.includes(':')),'Invalid retained source member');
 const filePath=path.join(root,'sources',file.path),actual=fs.realpathSync(filePath),selected=fs.realpathSync(path.join(root,'sources'));
 need(actual.startsWith(selected+path.sep)&&fs.statSync(actual).isFile(),'Retained source member escaped its original collection',409);
 const bytes=fs.readFileSync(actual);need(bytes.length===file.bytes&&hash(bytes)===file.sha256,'Retained source member changed: '+file.path,409);
 return bytes;
}
export function chiquesCatalogue(workspace){
 const rows=[];
 for(const row of listCollections(workspace)){
  const {document}=readDocument(workspace,row.id);
  if(document.files.some(f=>f.kind==='wqp'&&f.origin?.adapter===CHIQUES_ADAPTER))rows.push(row);
 }
 return {collections:rows,workspaceRevision:workspace.revision()};
}
export function readChiquesCollection(workspace,id){
 const {root,document}=readDocument(workspace,id);
 need(document.files.some(f=>f.origin?.adapter===CHIQUES_ADAPTER),'This is not a Chiques nutrient collection');
 const files=document.files.map(f=>{const bytes=sourceMember(root,f);return {...f,...(f.path.endsWith('.xlsx')?{base64:bytes.toString('base64')}:{text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)})};});
 const originals=files.filter(f=>f.path.startsWith('originals/'));
 const sourcePacket={schema:'commons.eco.original-source-transfer.v1',sourceItem:'65b170a2d34e36a39044c04d',
  files:originals.filter(f=>f.text!==undefined).map(f=>({path:f.path.slice(10),content:f.text,bytes:f.bytes,sha256:f.sha256}))};
 const attachments=originals.filter(f=>f.base64!==undefined).map(f=>({name:f.path.slice(10),base64:f.base64,bytes:f.bytes,sha256:f.sha256}));
 const preparation=prepareChiquesNutrients({sourcePacket,attachments}),expected=previewCollection(workspace,preparation.collection,{lineEndings:'legacy'});
 need(expected.id===id,'Retained collection differs from its full original projection',409);
 need(stable(expected.files)===stable(document.files),'Retained collection manifest differs',409);
 for(const f of preparation.collection.files){
  const actual=files.find(x=>x.path===f.path);need(actual&&actual.sha256===f.sha256&&(f.text===undefined?actual.base64===f.base64:actual.text===f.text),'Retained complete source/report bytes differ',409);
 }
 const completePath=path.join(root,'complete.json'),complete=fs.existsSync(completePath);
 if(complete){const mark=JSON.parse(fs.readFileSync(completePath,'utf8'));need(mark.id===id&&stable(mark.files)===stable(document.files),'Original complete collection checkpoint differs',409);}
 return {id,complete,preparation,...(complete?{received:readChiquesImportedSources(workspace,preparation)}:{})};
}
export function chiquesOperation(workspace,method,parts,input={}){
 if(method==='GET'&&parts.length===1&&parts[0]==='catalogue')return chiquesCatalogue(workspace);
 if(method==='GET'&&parts.length===2&&parts[0]==='collections')return readChiquesCollection(workspace,parts[1]);
 if(method==='POST'&&parts.length===1&&parts[0]==='preview'){
  const preparation=input.preparation?verifyChiquesPreparation(input.preparation):prepareChiquesNutrients(input);
  const preview=previewCollection(workspace,preparation.collection,{lineEndings:'legacy'});
  return {preparation,preview};
 }
 if(method==='POST'&&parts.length===1&&parts[0]==='receive'){
  const preparation=verifyChiquesPreparation(input.preparation);
  need(identifier(input.expectedId),'Keep the original reviewed collection ID');
  const received=receiveCollection(workspace,{...preparation.collection,expectedId:input.expectedId},{lineEndings:'legacy'});
  return {result:received,...readChiquesCollection(workspace,received.id)};
 }
 throw new InputError('Chiques nutrient source operation not found',404);
}
