#!/usr/bin/env node
/** Rebuild a complete comparison from its two complete original Flow files. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {reopenFlowComparison,flowComparisonFiles,FLOW_COMPARISON_PRODUCT} from '../measurement_workspace/engine/flow_comparison.mjs';
import {publishExactFile} from '../measurement_workspace/engine/file_product.mjs';
import {hash} from '../measurement_workspace/engine/normalise.mjs';
const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i++){if(!['--before','--after','--selection','--output'].includes(args[i])||args[i+1]===undefined||Object.hasOwn(options,args[i].slice(2)))throw Error('Choose --before, --after, optional --selection and --output once each.');options[args[i].slice(2)]=args[++i];}
if(!options.before||!options.after||!options.output)throw Error('Use --before EARLIER/flow-study.json --after LATER/flow-study.json --selection comparison-selection.json --output A_NEW_DIRECTORY');
const read=async file=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file)));
const before=await read(options.before),after=await read(options.after),selection=options.selection?await read(options.selection):null;
if(selection&&(selection.before_id!==before.id||selection.after_id!==after.id))throw Error('The original selection names different Flow parents.');
const product=reopenFlowComparison(before,after,selection?.expected_comparison_id),files=flowComparisonFiles(product);
const root=path.resolve(options.output),sources=await Promise.all([options.before,options.after,...(options.selection?[options.selection]:[])].map(file=>fs.realpath(file)));
for(const source of sources)if(source===root||source.startsWith(root+path.sep))throw Error('Keep the new comparison output separate from the complete original input files.');
const manifest={schema:FLOW_COMPARISON_PRODUCT,id:product.id,selection:product.selection,files:Object.entries(files).map(([name,text])=>{const bytes=Buffer.from(text);return {path:name,bytes:bytes.length,sha256:hash(bytes)};})};
files['manifest.json']=JSON.stringify(manifest,null,2)+'\n';
// Preflight all outputs before the first publish. The maintained publisher also
// keeps its atomic no-replace behavior for races and exact-original retries.
for(const [name,text] of Object.entries(files)){
 const target=path.resolve(root,name);if(!target.startsWith(root+path.sep))throw Error('Keep comparison members inside the new output directory.');
 try{const bytes=await fs.readFile(target);if(!bytes.equals(Buffer.from(text)))throw Error('Retain the different existing comparison member: '+target);}catch(error){if(error.code!=='ENOENT')throw error;}
}
for(const name of Object.keys(files))await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});
for(const [name,text] of Object.entries(files))await publishExactFile(path.join(root,name),Buffer.from(text));
process.stdout.write(JSON.stringify({output:root,...manifest},null,2)+'\n');
