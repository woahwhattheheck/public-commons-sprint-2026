'use strict';
function runContactProductLoaderChecks(source,sha256){
 const assert=(ok,n)=>{if(!ok)throw Error(n);},clone=x=>JSON.parse(JSON.stringify(x));
 const custodyKey=Symbol.for('commons.connected-contact-source-custody/v1');
 const old=globalThis[custodyKey];globalThis[custodyKey]=new Map();
 const cases=[];let initializations=0,constructions=0;
 const crypto={createHash(){let text='';return {update(v){text+=typeof v==='string'?v:v.text;return this;},digest(){return sha256(text);}};}};
 const path={resolve:p=>p,join:(...xs)=>xs.join('/')};
 const decoder=class{decode(bytes){return bytes.text;}};
 const config=()=>({schema:'commons.connected-contact-private-configuration/v1',directory:'/private/state',coordinatorId:'00000000-0000-4000-8000-000000000001',
   mailboxes:[{name:'business',link_id:'original-business',id:'111',email:'business@example.test'},{name:'secondary',link_id:'original-secondary',id:'222',email:'secondary@example.test'}],
   authority:{scope_id:'original-scope',accounts:[{profile_id:'111',account_key:sha256(JSON.stringify({provider:'gmail',profile_id:'111',activity:'Mail sending'}))}]}
 });
 const dependencies=['host/connected_first_contact.cjs','host/connected_first_contact_checkpoint.cjs','host/connected_contact_local_state.py','host/connected_contact_file_state.cjs','host/connected_contact_local_adoption.cjs','host/connected_first_contact_queue_drain.cjs','host/connected_first_contact_draft.cjs'];
 const files={},fs={lstatSync(p){if(p==='/fixture')return {isDirectory:()=>true,isSymbolicLink:()=>false};if(!files[p])throw Error('Missing source');return {isFile:()=>true,isSymbolicLink:()=>false};},realpathSync:p=>p,readFileSync:p=>files[p]};
 const bytes=s=>({text:s,length:s.length});
 const manifest={schema:'commons.connected-contact-source-manifest/v1',files:dependencies.map(name=>{files['/fixture/'+name]=bytes('// '+name);return {path:name,bytes:files['/fixture/'+name].length,sha256:sha256(files['/fixture/'+name].text)};})};
 files['/fixture/SOURCE_MANIFEST.json']=bytes(JSON.stringify(manifest));
 const outputs={
  'host/connected_first_contact.cjs':{loadOriginalContactModules:()=>({sha256Utf8:sha256}),createConnectedFirstContact:options=>({ordinary:true,options})},
  'host/connected_first_contact_draft.cjs':{createConnectedExistingFirstContactDraft:options=>({draft:true,options})},
  'host/connected_contact_file_state.cjs':{createContactFileState:settings=>{constructions++;return {settings};},initializeContactCoordinator:settings=>{initializations++;return {settings};}},
  'host/connected_first_contact_checkpoint.cjs':{},
  'host/connected_contact_local_adoption.cjs':{},
  'host/connected_first_contact_queue_drain.cjs':{}
 };
 const req=name=>{if(name==='node:fs')return fs;if(name==='node:path')return path;if(name==='node:crypto')return crypto;
  if(req.cache[name])return req.cache[name].exports;const value=outputs[name.slice('/fixture/'.length)];if(!value)throw Error('Unselected module');req.cache[name]={exports:value};return value;};
 req.resolve=p=>p;req.cache={};
 const module={exports:{}};new Function('require','module','exports','__dirname','TextDecoder',source)(req,module,module.exports,'/fixture',decoder);
 const load=cfg=>module.exports.loadConnectedContactProduct({configuration:cfg,sourceDirectory:'/fixture',tools:{}});
 function reject(name,mutate){const count=constructions;let error=null;try{load(mutate(config()));}catch(e){error=e;}assert(error&&count===constructions,name);cases.push(name);}
 try{
  const product=load(config());assert(product.storage.settings.authority.accounts.length===1,'selected subset');cases.push('single-account authority is retained without adding the second mailbox');
  const same=load(config());assert(same.factory===product.factory,'cache reuse');cases.push('unchanged verified cached module reopens');
  const ordinaryInput={subject:'Original ordinary input'},ordinary=product.factory.createConnectedFirstContact({input:ordinaryInput});
  assert(ordinary.ordinary&&ordinary.options.input===ordinaryInput,'ordinary constructor');cases.push('ordinary inputs retain the original carrier constructor');
  const draftInput={native_draft:{draft_id:'original-draft'}},received=product.factory.createConnectedFirstContact({input:draftInput,modules:{original:true}});
  assert(received.draft&&received.options.input===draftInput&&received.options.createConnectedFirstContact===outputs['host/connected_first_contact.cjs'].createConnectedFirstContact,'draft constructor');cases.push('saved drafts use the unchanged original helper and same carrier');
  assert(product.drafts===outputs['host/connected_first_contact_draft.cjs'],'original draft module');cases.push('complete original draft helper remains available to the same operator');
  reject('mailbox order is rejected before state construction',c=>({...c,mailboxes:[...c.mailboxes].reverse()}));
  reject('wrong selected Gmail account key is rejected before state construction',c=>{c.authority.accounts[0].account_key='0'.repeat(64);return c;});
  reject('unconfigured authority profile is rejected before state construction',c=>{c.authority.accounts[0].profile_id='333';return c;});
  const filename='/fixture/host/connected_first_contact.cjs',retained=req.cache[filename];req.cache[filename]={exports:retained.exports};
  reject('replacement live cache entry is rejected',c=>c);req.cache[filename]=retained;
  const originalManifest=files['/fixture/SOURCE_MANIFEST.json'];files['/fixture/SOURCE_MANIFEST.json']=bytes(JSON.stringify(manifest)+' ');
  reject('changed manifest in a loaded directory is rejected',c=>c);files['/fixture/SOURCE_MANIFEST.json']=originalManifest;
  const priorRegistry=globalThis[custodyKey];globalThis[custodyKey]=new Map();
  reject('unverified prior cache entry is rejected',c=>c);globalThis[custodyKey]=priorRegistry;
  const empty=config();empty.authority.accounts=[];reject('empty authority is rejected',()=>empty);
  assert(initializations===0,'No coordinator initialization');return {cases,initializations,providerCalls:0,filesystemWrites:0};
 }finally{if(old===undefined)delete globalThis[custodyKey];else globalThis[custodyKey]=old;}
}
module.exports={runContactProductLoaderChecks};
