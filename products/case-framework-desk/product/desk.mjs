import * as engine from './case-source.mjs';
import * as model from './programme.mjs';
import * as host from './programme-host.mjs';
import * as app from './programme-app.mjs';
import * as builder from './programme-build.mjs';
import {bootCASEProgramme} from './programme-boot.mjs';
import {renderCASEReport} from './case-report.mjs';
const paths=['source-json.mjs','case-source.mjs','case-report.mjs','programme.mjs','programme-host.mjs','programme-app.mjs','programme-boot.mjs','programme-build.mjs','desk.css'];
try {
 const assets={};await Promise.all([...paths.map(p=>['product/'+p,'/'+p]),...['framework-v1.json','framework-v2.json'].map(p=>['examples/'+p,'/examples/'+p])].map(async([key,url])=>{const r=await fetch(url);if(!r.ok)throw Error('Missing complete local application source '+key);assets[key]=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await r.arrayBuffer());}));
 await bootCASEProgramme({engine,model,host,app,builder,reportHTML:renderCASEReport,assets});
} catch(e) {document.querySelector('main').textContent='Could not open the complete programme: '+e.message;}
