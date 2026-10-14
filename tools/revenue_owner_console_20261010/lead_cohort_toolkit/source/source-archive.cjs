'use strict';
// Lossless content-addressed source storage. JSON string spelling is preserved:
// only exact JSON.stringify spellings become references to decoded originals.
const {sha256Utf8,utf8ByteLength}=require('../runtime/host/connected_sha256.cjs');
const SCHEMA='commons.source-archive.v1';
const HEX=/^[a-f0-9]{64}$/;
function fail(message){throw Error(message);}
function identity(text){return sha256Utf8(text);}
function checkIdentity(actual,expected,label){
 if(!expected||!Number.isSafeInteger(expected.bytes)||expected.bytes<0||!HEX.test(expected.sha256||'')||
    actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)fail('Source archive identity differs: '+label);
}
function exactKeys(value,names,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join('\0')!==names.slice().sort().join('\0'))fail('Invalid source archive '+label);
}
function packSource(text,options={}){
 if(typeof text!=='string')fail('Source must be complete UTF-8 text');
 const rootIdentity=identity(text);
 // Parse before decomposing, but retain original bytes, whitespace and order.
 JSON.parse(text);
 const minimum=options.minimumStringLength??256,maxDepth=options.decompositionDepth??32;
 if(!Number.isSafeInteger(minimum)||minimum<32||!Number.isSafeInteger(maxDepth)||maxDepth<0||maxDepth>256)fail('Invalid archive decomposition options');
 const nodes=[],known=new Map();
 function intern(value,depth,knownIdentity){
  const id=knownIdentity||identity(value),prior=known.get(id.sha256);
  if(prior){if(prior.bytes!==id.bytes)fail('Source archive hash collision');return id.sha256;}
  let parts=null;
  if(depth<maxDepth&&value.length>=minimum&&/^[\s]*[\[{]/.test(value)){
   let valid=false;try{JSON.parse(value);valid=true;}catch{}
   if(valid){
    const candidate=[];let literalStart=0;
    for(let i=0;i<value.length;i++){
     if(value.charCodeAt(i)!==34)continue;
     const start=i++;let end=i;
     for(;end<value.length;end++){
      const code=value.charCodeAt(end);
      if(code===92){end++;continue;}
      if(code===34)break;
     }
     i=end;
     const raw=value.slice(start,end+1);
     if(raw.length<minimum)continue;
     const decoded=JSON.parse(raw);
     if(typeof decoded!=='string'||JSON.stringify(decoded)!==raw)continue;
     // Lone UTF-16 surrogates are valid JSON tokens but have no exact UTF-8
     // string body. Keep their original escaped spelling in the literal span.
     let decodedIdentity;try{decodedIdentity=identity(decoded);}catch{continue;}
     const child=intern(decoded,depth+1,decodedIdentity);
     if(start>literalStart)candidate.push({text:value.slice(literalStart,start)});
     candidate.push({quote:child});literalStart=end+1;
    }
    if(candidate.length){
     if(literalStart<value.length)candidate.push({text:value.slice(literalStart)});
     parts=candidate;
    }
   }
  }
  const node=parts?{sha256:id.sha256,bytes:id.bytes,kind:'json-template',parts}:
    {sha256:id.sha256,bytes:id.bytes,kind:'text',text:value};
  nodes.push(node);known.set(id.sha256,node);return id.sha256;
 }
 const root=intern(text,0,rootIdentity);
 const archive={schema:SCHEMA,root:{sha256:root,bytes:rootIdentity.bytes},nodes};
 // The same receiving implementation independently resolves every node.
 if(unpackSource(archive,{maxExpandedBytes:options.maxExpandedBytes})!==text)fail('Source archive round trip differs');
 return archive;
}

function quotedUtf8Bytes(value){
 let size=2;
 for(const character of value){
  const cp=character.codePointAt(0);
  size+=cp===34||cp===92||cp===8||cp===9||cp===10||cp===12||cp===13?2:
   cp<32?6:cp<128?1:cp<2048?2:cp<65536?3:4;
 }
 if(!Number.isSafeInteger(size))fail('Archive quoted text exceeds supported size');
 return size;
}

function unpackSource(archive,options={}){
 exactKeys(archive,['schema','root','nodes'],'document');
 if(archive.schema!==SCHEMA||!Array.isArray(archive.nodes)||!archive.nodes.length)fail('Invalid source archive schema or nodes');
 exactKeys(archive.root,['sha256','bytes'],'root');
 if(!HEX.test(archive.root.sha256||'')||!Number.isSafeInteger(archive.root.bytes)||archive.root.bytes<0)fail('Invalid source archive root identity');
 const maxBytes=options.maxExpandedBytes??512*1024*1024;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0)fail('Invalid archive expansion budget');
 const values=new Map(),dependencies=new Map(),sizes=new Map(),quoteSizes=new Map();let expanded=0;
 for(const node of archive.nodes){
  if(!node||!HEX.test(node.sha256||'')||values.has(node.sha256)||!Number.isSafeInteger(node.bytes)||node.bytes<0)fail('Invalid or repeated source archive node');
  if(node.bytes>maxBytes-expanded)fail('Source archive exceeds expansion budget');
  let value,refs=[];
  if(node.kind==='text'){
   exactKeys(node,['sha256','bytes','kind','text'],'text node');
   if(typeof node.text!=='string')fail('Archive text node requires complete text');
   value=node.text;
  }else if(node.kind==='json-template'){
   exactKeys(node,['sha256','bytes','kind','parts'],'template node');
   if(!Array.isArray(node.parts)||!node.parts.length)fail('Archive template needs parts');
   if(node.parts.length>node.bytes)fail('Archive template has too many parts for its declared bytes');
   const pieces=[];let size=0;
   for(const part of node.parts){
    let piece,pieceBytes;
    if(part&&Object.prototype.hasOwnProperty.call(part,'text')){
     exactKeys(part,['text'],'literal part');
     if(typeof part.text!=='string'||!part.text.length)fail('Archive literal requires nonempty text');
     piece=part.text;pieceBytes=utf8ByteLength(piece);
    }else{
     exactKeys(part,['quote'],'quote part');
     if(!HEX.test(part.quote||'')||!values.has(part.quote))fail('Archive reference must point to an earlier complete node');
     if(!quoteSizes.has(part.quote))quoteSizes.set(part.quote,quotedUtf8Bytes(values.get(part.quote)));
     pieceBytes=quoteSizes.get(part.quote);
     if(pieceBytes>node.bytes-size)fail('Archive quoted text exceeds its declared bytes');
     piece=JSON.stringify(values.get(part.quote));refs.push(part.quote);
    }
    size+=pieceBytes;
    if(!Number.isSafeInteger(size)||size>node.bytes)fail('Archive template exceeds its declared bytes');
    pieces.push(piece);
   }
   value=pieces.join('');
  }else fail('Unknown source archive node kind');
  checkIdentity(identity(value),node,node.sha256);
  expanded+=node.bytes;values.set(node.sha256,value);sizes.set(node.sha256,node.bytes);dependencies.set(node.sha256,refs);
 }
 const value=values.get(archive.root.sha256);
 if(value===undefined)fail('Archive root is missing');
 if(sizes.get(archive.root.sha256)!==archive.root.bytes)fail('Source archive identity differs: root');
 // Detached data is not silently ignored by the receiving side.
 const reachable=new Set(),pending=[archive.root.sha256];
 while(pending.length){const id=pending.pop();if(reachable.has(id))continue;reachable.add(id);for(const dependency of dependencies.get(id))pending.push(dependency);}
 if(reachable.size!==archive.nodes.length)fail('Archive contains detached nodes');
 JSON.parse(value);return value;
}
function archiveStatistics(archive){
 // Call after packSource or unpackSource; statistics do not repeat receiving.
 const serialized=JSON.stringify(archive);
 return {schema:SCHEMA,source:{...archive.root},archive:identity(serialized),
  nodes:archive.nodes.length,text_nodes:archive.nodes.filter(n=>n.kind==='text').length,
  template_nodes:archive.nodes.filter(n=>n.kind==='json-template').length,
  expanded_node_bytes:archive.nodes.reduce((n,row)=>n+row.bytes,0)};
}
module.exports={SCHEMA,packSource,unpackSource,archiveStatistics};
