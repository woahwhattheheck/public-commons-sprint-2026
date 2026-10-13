#!/usr/bin/env node
/** Run one complete source return on an existing actual Measurements workspace. */
import fs from 'node:fs';
import path from 'node:path';
import {MeasurementWorkspace} from './workspace.mjs';
import {hash,stable} from './normalise.mjs';
import {handbackCatalog,previewHandback,publishHandback,handbackBundle,receiveHandbackBytes,readHandbackView} from './source_handback.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||args[i+1]===undefined)throw Error('Use --workspace DIR --output NEW_DIR [--selection FILE]');options[args[i].slice(2)]=args[i+1];}
if(!options.workspace||!options.output)throw Error('An existing actual workspace and a new output directory are required');
const workspace=path.resolve(options.workspace),output=path.resolve(options.output);
if(!fs.existsSync(path.join(workspace,'measurements.sqlite')))throw Error('Select the existing original Measurements database');
if(fs.existsSync(output))throw Error('Choose a new output directory; earlier returns stay intact');
fs.mkdirSync(output,{recursive:true});
const write=(name,v)=>fs.writeFileSync(path.join(output,name),typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v,null,2)+'\n');
const original=new MeasurementWorkspace(workspace);let receiver;
try{
 const catalog=handbackCatalog(original);write('original-catalog.json',catalog);
 let selection;
 if(options.selection)selection=JSON.parse(fs.readFileSync(options.selection,'utf8'));
 else{
  const hashes=['0c9b8e6051b697937d9fcc035b3ce958aea56d082d3188d332570e4ac9961b4b','9b242799e822559b52404f0a0e5a888959b5ea4c537de15f2907eb09fa50a4a4','85e7be4eafff695ce2ae3095d343471fa9d4fd502e32a5644e4a82a497d76f3d','aec400eed27db53d435a0e9b7cfd387eeb828379802358c01bf933965057de92','a7039fb099d4fda958923f986169dabfa17168ac66d57f36d9720c7ccffa3af0'];
  const sourceIds=hashes.map(sha=>{const matches=catalog.sources.filter(x=>x.sha===sha);if(matches.length!==1)throw Error('Choose the intended complete source edition explicitly in --selection: '+sha);return matches[0].id;});
  selection={expectedRevision:catalog.revision,sourceIds,exportIds:catalog.results.filter(r=>['calibration','paired-loads'].includes(r.kind)).map(r=>r.id)};
 }
 write('selection.json',selection);const preview=previewHandback(original,selection);write('preview.json',preview);
 const request={...selection,previewSha256:preview.previewSha256,title:'Eighteenmile original-source results return',note:'Original source columns with retained native reviews and selected saved scientific results.'};
 write('publication-request.json',request);
 const edition=publishHandback(original,request);write('manifest.json',edition);
 const repeated=publishHandback(original,request);if(repeated.id!==edition.id)throw Error('Original publication did not converge');
 const bundle=handbackBundle(original,edition.id),bytes=Buffer.from(bundle.contentBase64,'base64');write(bundle.filename,bytes);
 receiver=new MeasurementWorkspace(path.join(output,'received-original'));
 const received=receiveHandbackBytes(receiver,bytes),view=readHandbackView(receiver,received.id);
 if(received.id!==edition.id||stable(view)!==stable(preview))throw Error('Reopened complete source return differs');
 write('received-manifest.json',received);
 const result={operation:'ECO-WO46-SCIENTIST-SOURCE-RETURN-20261013',nativeNode:process.version,workspace,output,editionId:edition.id,revision:edition.revision,counts:preview.counts,sourceIds:selection.sourceIds,exportIds:selection.exportIds,bundle:{filename:bundle.filename,bytes:bytes.length,sha256:hash(bytes)},reopened:true};
 write('native-result.json',result);process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){write('native-error.json',{message:error.message,stack:error.stack});throw error;}
finally{try{receiver?.close();}finally{original.close();}}
