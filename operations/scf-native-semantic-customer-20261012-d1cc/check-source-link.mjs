import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {join,resolve,dirname,relative,isAbsolute} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';import {builtinModules} from 'node:module';
const closurePath=process.argv[2],expected=process.argv[3];if(!closurePath||!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Supply the actual retained complete source closure and SHA256.');
const raw=await readFile(closurePath),sha=b=>createHash('sha256').update(b).digest('hex');if(sha(raw)!==expected)throw Error('The selected complete source changed.');
const closure=JSON.parse(raw),root=resolve(closure.sourceRoot),files=new Map(closure.files.map(x=>[x.path,x])),modules=new Map(),context=createContext(),builtins=new Set(builtinModules.map(x=>x.startsWith('node:')?x:'node:'+x));
function moduleAt(url){
 if(modules.has(url))return modules.get(url);
 const pending=(async()=>{
  if(url.startsWith('node:')){if(!builtins.has(url))throw Error('Unknown original builtin '+url);const namespace=await import(url),names=Object.keys(namespace);return new SyntheticModule(names,function(){for(const key of names)this.setExport(key,namespace[key])},{context,identifier:url});}
  const path=fileURLToPath(url),key=relative(root,path).split('\\\\').join('/');if(isAbsolute(key)||key==='..'||key.startsWith('../'))throw Error('Original relative import leaves the retained component.');
  const entry=files.get(key);if(!entry)throw Error('Unretained original native import: '+key);const bytes=await readFile(path);if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error('Original imported source differs: '+key);
  return new SourceTextModule(bytes.toString('utf8'),{context,identifier:url});
 })();modules.set(url,pending);return pending;
}
const start=await moduleAt(pathToFileURL(join(root,'stellar-forge/mcp-paid-agent/native-workspace-cli.mjs')).href);
await start.link((specifier,parent)=>{
 if(specifier.startsWith('node:'))return moduleAt(specifier);
 if(specifier.startsWith('.'))return moduleAt(new URL(specifier,parent.identifier).href);
 throw Error('The original static native closure requests an undeclared external import: '+specifier);
});
console.log(JSON.stringify({status:'STATIC_COMPONENT_LINKED',closureSha256:expected,entry:'stellar-forge/mcp-paid-agent/native-workspace-cli.mjs',modules:modules.size,applicationEvaluated:false}));
