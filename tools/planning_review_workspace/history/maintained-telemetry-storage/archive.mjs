// Exact, dependency-free shared-node archive for the maintained telemetry workspace.
// Every original byte, report value and operation remains in the reconstructed
// original JSON. The original API independently validates the complete history.
export const ARCHIVE_SCHEMA="tjlabs.telemetry-shared-archive.v1";
export function createArchiveAPI(api,runtime){
 const {encode,sha256}=runtime,MAX=128*1024*1024,MAX_NODES=4000000,MAX_DEPTH=256;
 const need=(ok,message)=>{if(!ok)throw Error(message);};
 const plain=x=>!!x&&typeof x==="object"&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
 const digest=x=>sha256(typeof x==="string"?encode(x):x);
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 function serialize(w){
  const original=api.exportWorkspace(w),nodes=[],intern=new Map(),objects=new WeakMap();
  function visit(value,depth=0){
   need(depth<=MAX_DEPTH,"Archive exceeds maximum nesting");
   if(value&&typeof value==="object"&&objects.has(value))return objects.get(value);
   let node;
   if(value===null)node=["z"];
   else if(typeof value==="string")node=["s",value];
   else if(typeof value==="boolean")node=["b",value];
   else if(typeof value==="number"){need(Number.isFinite(value),"Finite JSON number required");node=["n",value];}
   else if(Array.isArray(value))node=["a",value.map(v=>visit(v,depth+1))];
   else{need(plain(value),"Plain JSON objects required");node=["o",Object.keys(value).map(k=>[visit(k,depth+1),visit(value[k],depth+1)])];}
   const key=JSON.stringify(node);let id=intern.get(key);
   if(id===undefined){need(nodes.length<MAX_NODES,"Too many shared archive nodes");id=nodes.length;nodes.push(node);intern.set(key,id);}
   if(value&&typeof value==="object")objects.set(value,id);
   return id;
  }
  const root=visit(w),body={schema:ARCHIVE_SCHEMA,engine:api.engine,workspace:{bytes:encode(original.content).length,sha256:original.sha256,rootSha256:w.rootSha256},root,nodes};
  const content=JSON.stringify(body)+"\n",bytes=encode(content).length;
  need(bytes<=MAX,"Shared archive exceeds 128 MiB");
  return {filename:"Telemetry_Shared_Workspace.json",content,bytes,sha256:digest(content),workspace:body.workspace,nodeCount:nodes.length};
 }
 function inspect(content,parsed){
  need(typeof content==="string"&&encode(content).length<=MAX,"Archive input exceeds 128 MiB");
  const a=parsed===undefined?api.parseJSON(content):parsed;
  need(plain(a)&&a.schema===ARCHIVE_SCHEMA&&a.engine===api.engine,"Unsupported shared archive");
  need(plain(a.workspace)&&Number.isSafeInteger(a.workspace.bytes)&&a.workspace.bytes>=1&&a.workspace.bytes<=MAX,"Invalid expanded workspace size");
  for(const k of ["sha256","rootSha256"])need(typeof a.workspace[k]==="string"&&/^[0-9a-f]{64}$/.test(a.workspace[k]),"Invalid workspace digest");
  need(Array.isArray(a.nodes)&&a.nodes.length>0&&a.nodes.length<=MAX_NODES,"Invalid shared node table");
  need(Number.isSafeInteger(a.root)&&a.root>=0&&a.root<a.nodes.length,"Invalid root node");
  const sizes=[],depths=[],strings=[];
  const ref=(v,i)=>{need(Number.isSafeInteger(v)&&v>=0&&v<i,"Shared reference must name an earlier node");return v;};
  for(let i=0;i<a.nodes.length;i++){
   const n=a.nodes[i];need(Array.isArray(n)&&typeof n[0]==="string","Invalid shared node");
   let size,depth=0;
   if(n[0]==="z"){need(n.length===1,"Invalid null node");size=4;}
   else if(["s","n","b"].includes(n[0])){
    need(n.length===2&&typeof n[1]===({s:"string",n:"number",b:"boolean"})[n[0]],"Invalid scalar node");
    if(n[0]==="n")need(Number.isFinite(n[1]),"Nonfinite archive number");
    size=encode(JSON.stringify(n[1])).length;if(n[0]==="s")strings[i]=n[1];
   }else if(n[0]==="a"){
    need(n.length===2&&Array.isArray(n[1]),"Invalid array node");
    size=2+Math.max(0,n[1].length-1);
    for(const id of n[1]){ref(id,i);size+=sizes[id];depth=Math.max(depth,depths[id]+1);need(size<=MAX,"Expanded array exceeds 128 MiB");}
   }else if(n[0]==="o"){
    need(n.length===2&&Array.isArray(n[1]),"Invalid object node");
    size=2+Math.max(0,n[1].length-1);const keys=new Set();
    for(const pair of n[1]){
     need(Array.isArray(pair)&&pair.length===2,"Invalid object member");const k=ref(pair[0],i),v=ref(pair[1],i);
     need(a.nodes[k][0]==="s"&&!keys.has(strings[k]),"Object keys must be unique strings");keys.add(strings[k]);
     size+=sizes[k]+1+sizes[v];depth=Math.max(depth,depths[v]+1);need(size<=MAX,"Expanded object exceeds 128 MiB");
    }
   }else throw Error("Unknown shared node type");
   need(size<=MAX&&depth<=MAX_DEPTH,"Expanded node exceeds limits");sizes.push(size);depths.push(depth);
  }
  need(a.nodes[a.root][0]==="o"&&sizes[a.root]+1===a.workspace.bytes,"Expanded workspace byte count differs");
  return {archive:a,sizes,summary:{schema:ARCHIVE_SCHEMA,engine:a.engine,nodeCount:a.nodes.length,archiveBytes:encode(content).length,workspaceBytes:a.workspace.bytes,workspaceSha256:a.workspace.sha256,rootSha256:a.workspace.rootSha256}};
 }
 function open(content,parsed){
  const inspected=inspect(content,parsed),a=inspected.archive,values=[];
  for(const n of a.nodes){
   let value;
   if(n[0]==="z")value=null;
   else if(["s","n","b"].includes(n[0]))value=n[1];
   else if(n[0]==="a")value=n[1].map(id=>values[id]);
   else{value={};for(const [k,v]of n[1])Object.defineProperty(value,values[k],{value:values[v],enumerable:true,writable:true,configurable:true});}
   values.push(value);
  }
  const text=JSON.stringify(values[a.root])+"\n";
  need(encode(text).length===a.workspace.bytes&&digest(text)===a.workspace.sha256,"Reconstructed complete workspace digest differs");
  const workspace=api.importWorkspace(text);
  need(workspace.rootSha256===a.workspace.rootSha256,"Reopened workspace root differs");
  return {workspace,summary:inspected.summary};
 }
 function receive(content){
  need(typeof content==="string"&&encode(content).length<=MAX,"Working input exceeds 128 MiB");
  const parsed=api.parseJSON(content);
  if(parsed?.schema===ARCHIVE_SCHEMA)return open(content,parsed).workspace;
  return api.importWorkspace(content);
 }
 return {schema:ARCHIVE_SCHEMA,serialize,inspect:content=>inspect(content).summary,open:content=>open(content),receive};
}
