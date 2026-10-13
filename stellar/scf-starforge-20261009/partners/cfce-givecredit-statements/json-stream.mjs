// MIT. Bounded JSON serialization for complete retained source documents.
const unsupported=value=>value===undefined||typeof value==='function'||typeof value==='symbol';
export function* jsonChunks(value,{pretty=false,chunkSize=32768}={}){
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
  function* encode(input,depth,key=''){
    let node=input;
    if(node&&typeof node==='object'&&typeof node.toJSON==='function')node=node.toJSON(key);
    if(node===null){yield 'null';return;}
    if(typeof node==='string'){yield* quote(node);return;}
    if(typeof node==='number'){yield Number.isFinite(node)?String(Object.is(node,-0)?0:node):'null';return;}
    if(typeof node==='boolean'){yield node?'true':'false';return;}
    if(typeof node==='bigint')throw new TypeError('Exact source integers must remain strings.');
    if(unsupported(node)){yield 'null';return;}
    if(depth>512||ancestors.has(node))throw new TypeError('Receive an acyclic JSON source document.');
    ancestors.add(node);
    const array=Array.isArray(node),keys=array?Array.from({length:node.length},(_,i)=>String(i)):
      Object.keys(node).filter(k=>!unsupported(node[k]));
    yield array?'[':'{';
    for(let i=0;i<keys.length;i++){
      if(i)yield ',';
      if(pretty)yield '\n'+indent.repeat(depth+1);
      const k=keys[i];
      if(!array){yield* quote(k);yield pretty?': ':':';}
      yield* encode(node[k],depth+1,k);
    }
    if(pretty&&keys.length)yield '\n'+indent.repeat(depth);
    yield array?']':'}';ancestors.delete(node);
  }
  if(unsupported(value))throw new TypeError('Supply a complete JSON document.');
  yield* encode(value,0);
}
export function* jsonDocumentChunks(value,options={}){yield* jsonChunks(value,options);yield '\n';}
