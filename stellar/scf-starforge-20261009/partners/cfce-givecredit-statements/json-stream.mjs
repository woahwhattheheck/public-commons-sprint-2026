// MIT. Bounded JSON serialization for complete retained source documents.
const unsupported=value=>value===undefined||typeof value==='function'||typeof value==='symbol';
export function* jsonChunks(value,{pretty=false,chunkSize=32768,canonical=false}={}){
  if(!Number.isInteger(chunkSize)||chunkSize<2)throw new TypeError('Use a positive JSON string chunk size.');
  const ancestors=new Set(),indent=pretty?'  ':'';
  function* quote(text){
    yield '"';
    for(let start=0;start<text.length;){
      let end=Math.min(text.length,start+chunkSize);
      if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;
      yield JSON.stringify(text.slice(start,end)).slice(1,-1);start=end;
    }
    yield '"';
  }
  const prepare=(node,key)=>!canonical&&node&&typeof node==='object'&&typeof node.toJSON==='function'?node.toJSON(key):node;
  function* encode(node,depth){
    if(node===null){yield 'null';return;}
    if(typeof node==='string'){yield* quote(node);return;}
    if(typeof node==='number'){yield Number.isFinite(node)?String(Object.is(node,-0)?0:node):'null';return;}
    if(typeof node==='boolean'){yield node?'true':'false';return;}
    if(typeof node==='bigint')throw new TypeError('Exact source integers must remain strings.');
    if(unsupported(node)){yield 'null';return;}
    if(depth>512||ancestors.has(node))throw new TypeError('Receive an acyclic JSON source document.');
    ancestors.add(node);
    const array=Array.isArray(node);
    // canonical() first creates a sorted plain object. Enumeration still places
    // array-index property names first in numeric order; preserve that exact rule.
    const keys=array?null:canonical?Object.keys(Object.fromEntries(Object.keys(node).sort().map(key=>[key,null]))):Object.keys(node);
    let count=0;
    yield array?'[':'{';
    const length=array?node.length:keys.length;
    for(let i=0;i<length;i++){
      const key=array?String(i):keys[i],child=prepare(node[key],key);
      if(!array&&unsupported(child))continue;
      if(count++)yield ',';
      if(pretty)yield '\n'+indent.repeat(depth+1);
      if(!array){yield* quote(key);yield pretty?': ':':';}
      yield* encode(child,depth+1);
    }
    if(pretty&&count)yield '\n'+indent.repeat(depth);
    yield array?']':'}';ancestors.delete(node);
  }
  const root=prepare(value,'');
  if(unsupported(root))throw new TypeError('Supply a complete JSON document.');
  yield* encode(root,0);
}
export function* jsonDocumentChunks(value,options={}){yield* jsonChunks(value,options);yield '\n';}
