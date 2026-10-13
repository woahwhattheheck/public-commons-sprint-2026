#!/usr/bin/env node
/** Rebuild a complete comparison from both retained load results and source parents. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {reopenFlowLoadComparison,flowLoadComparisonFiles} from '../measurement_workspace/engine/flow_load_comparison.mjs';
import {publishExactFile} from '../measurement_workspace/engine/file_product.mjs';
import {hash} from '../measurement_workspace/engine/normalise.mjs';
const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i++){if(!['--before','--before-study','--after','--after-study','--selection','--output'].includes(args[i])||args[i+1]===undefined||Object.hasOwn(options,args[i].slice(2)))throw Error('Choose the original before/after result and study files, optional selection, and output once each.');options[args[i].slice(2)]=args[++i];}
if(!options.before||!options['before-study']||!options.after||!options['after-study']||!options.output)throw Error('Use --before EARLIER/flow-loads.json --before-study EARLIER/flow-study.json --after LATER/flow-loads.json --after-study LATER/flow-study.json --selection load-comparison-selection.json --output A_NEW_DIRECTORY');
const read=async file=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file)));
const [before,beforeStudy,after,afterStudy,selection]=await Promise.all([read(options.before),read(options['before-study']),read(options.after),read(options['after-study']),options.selection?read(options.selection):null]);
if(selection&&(selection.before_id!==before.id||selection.after_id!==after.id))throw Error('The original selection names different saved load results.');
const product=reopenFlowLoadComparison(before,beforeStudy,after,afterStudy,selection?.expected_comparison_id),files=flowLoadComparisonFiles(product);
const root=path.resolve(options.output),sources=await Promise.all([options.before,options['before-study'],options.after,options['after-study'],...(options.selection?[options.selection]:[])].map(file=>fs.realpath(file)));
for(const source of sources)if(source===root||source.startsWith(root+path.sep))throw Error('Keep the new comparison output separate from every complete original input.');
const manifest={schema:'upstate.complete-flow-load-comparison-files/v1',id:product.id,selection:product.selection,files:Object.entries(files).map(([name,text])=>{const bytes=Buffer.from(text);return {path:name,bytes:bytes.length,sha256:hash(bytes)};})};
files['manifest.json']=JSON.stringify(manifest,null,2)+'\n';
for(const [name,text] of Object.entries(files)){
 const target=path.resolve(root,name);if(!target.startsWith(root+path.sep))throw Error('Keep comparison members inside the new output directory.');
 try{const bytes=await fs.readFile(target);if(!bytes.equals(Buffer.from(text)))throw Error('Retain the different existing comparison member: '+target);}catch(error){if(error.code!=='ENOENT')throw error;}
}
for(const name of Object.keys(files))await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});
for(const [name,text] of Object.entries(files))await publishExactFile(path.join(root,name),Buffer.from(text));
process.stdout.write(JSON.stringify({output:root,...manifest},null,2)+'\n');
