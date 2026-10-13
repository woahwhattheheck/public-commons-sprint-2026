// MIT. Lossless embedded JSON compression for complete offline applications.
import Zip from './connected_zip.cjs';
import Gzip from './connected_gzip.cjs';


function sharedStringPayload(value) {
  const strings=[],patches=[];
  function visit(item,path) {
    if(typeof item==='string'&&item.length>=1024) {
      let index=strings.indexOf(item);if(index<0){index=strings.length;strings.push(item)}
      patches.push([path,index]);return null;
    }
    if(Array.isArray(item))return item.map((x,i)=>visit(x,path.concat(i)));
    if(item&&typeof item==='object'){const out={};for(const [key,x]of Object.entries(item))Object.defineProperty(out,key,{value:visit(x,path.concat(key)),enumerable:true,writable:true,configurable:true});return out}
    return item;
  }
  const root=visit(value,[]),ordered=strings.map((text,index)=>({text,index})).sort((a,b)=>a.text.length-b.text.length),table=[],indices={};
  for(const {text,index}of ordered) {
    let parts=[text];
    for(let prior=table.length-1;prior>=0;prior--) {
      const needle=ordered[prior].text;if(needle.length>=text.length)continue;
      parts=parts.flatMap(part=>typeof part!=='string'?[part]:part.split(needle).flatMap((piece,at)=>at?[prior,piece]:[piece]).filter(piece=>piece!==''));
    }
    indices[index]=table.length;table.push(parts);
  }
  return {encoding:'json-shared-strings-v1',value:root,strings:table,patches:patches.map(([path,index])=>[path,indices[index]])};
}
function restoreSharedStrings(packed,maxBytes) {
  if(!packed||packed.encoding!=='json-shared-strings-v1'||!Array.isArray(packed.strings)||!Array.isArray(packed.patches))throw new Error('Invalid shared application strings.');
  const strings=[];let total=0;
  for(const parts of packed.strings) {
    if(!Array.isArray(parts))throw new Error('Invalid application string.');
    const text=parts.map(part=>{if(typeof part==='string')return part;if(!Number.isInteger(part)||part<0||part>=strings.length)throw new Error('Invalid application string reference.');return strings[part]}).join('');if(text.length>maxBytes||(total+=text.length)>maxBytes)throw new Error('Shared application strings exceed their limit.');strings.push(text);
  }
  let value=packed.value;
  for(const [path,index]of packed.patches) {
    if(!Array.isArray(path)||!Number.isInteger(index)||index<0||index>=strings.length)throw new Error('Invalid application string location.');
    if(!path.length){value=strings[index];continue}
    let target=value;
    for(const key of path.slice(0,-1)){if(!target||!Object.prototype.hasOwnProperty.call(target,key))throw new Error('Missing application string path.');target=target[key]}
    const key=path[path.length-1];if(!target||!Object.prototype.hasOwnProperty.call(target,key)||target[key]!==null)throw new Error('Invalid application string target.');
    Object.defineProperty(target,key,{value:strings[index],enumerable:true,writable:true,configurable:true});
  }
  return value;
}
function rawInflaterSource(source) {
  const integerEnd=source.indexOf('const gzipCrcTable ='),inflateStart=source.indexOf('function inflateRawBytes('),inflateEnd=source.indexOf('\n/**',inflateStart);
  if(integerEnd<0||inflateStart<integerEnd||inflateEnd<inflateStart)throw new Error('The maintained inflater source layout changed.');
  return source.slice(0,integerEnd)+source.slice(inflateStart,inflateEnd)+'\nmodule.exports={inflateRawBytes};\n';
}

// compactBootstrap reuses the exact restored payload.bootstrap in an ordinary script element.
// Its closure keeps the inflater modules separate from the original application's declarations.
// Default execution preserves the existing application script byte-for-byte.
export function compactInlinePayload(html,{dataId,zipGlobal,bootstrapBefore,gzipSource,codecGlobal='InlinePayloadDeflate',maxBytes=33554432,compactBootstrap=false}={}) {
  if(typeof html!=='string'||typeof gzipSource!=='string'||!gzipSource)throw new Error('Supply complete application HTML and the maintained DEFLATE module.');
  if(typeof dataId!=='string'||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(dataId))throw new Error('Choose the existing JSON data element identifier.');
  if(typeof zipGlobal!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(zipGlobal)||!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(codecGlobal))throw new Error('Use valid bootstrap module identifiers.');
  if(typeof bootstrapBefore!=='string'||!bootstrapBefore||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>268435456)throw new Error('Supply the existing bootstrap anchor and complete payload limit.');
  const marker='<script id="'+dataId+'" type="application/json">';
  const start=html.indexOf(marker),end=html.indexOf('</script>',start+marker.length);
  if(start<0||end<0)throw new Error('The complete JSON payload element is missing.');
  const original=html.slice(start+marker.length,end),originalPayload=JSON.parse(original);if(compactBootstrap&&(typeof originalPayload.bootstrap!=='string'||!originalPayload.bootstrap))throw new Error('The complete original bootstrap is required for compact execution.');if(Zip.utf8(original).length>maxBytes)throw new Error('The complete original payload exceeds the selected limit.');
  const bytes=Zip.utf8(JSON.stringify(sharedStringPayload(JSON.parse(original))));if(bytes.length>maxBytes)throw new Error('The complete JSON payload exceeds the selected limit.');
  const compressed=Gzip.deflateRawBytes(bytes,{huffman:'auto'});
  const packed={encoding:'deflate-base64',bytes:bytes.length,crc32:Zip.crc32(bytes),data:Zip.base64(compressed.data)};
  const restore='const '+codecGlobal+'=(()=>{const module={exports:{}};const exports=module.exports;\n'+rawInflaterSource(gzipSource)+'\nreturn module.exports;})();\n{'+
    'const restoreSharedStrings='+restoreSharedStrings.toString()+';'+
    'const element=document.getElementById('+JSON.stringify(dataId)+');const packed=JSON.parse(element.textContent);'+
    'if(packed.encoding!=="deflate-base64"||!Number.isSafeInteger(packed.bytes)||packed.bytes<1||packed.bytes>'+maxBytes+')throw new Error("Invalid complete application payload.");'+
    'const original='+codecGlobal+'.inflateRawBytes('+zipGlobal+'.fromBase64(packed.data),{expected_bytes:packed.bytes,max_output_bytes:'+maxBytes+'}).data;'+
    'if('+zipGlobal+'.crc32(original)!==packed.crc32)throw new Error("The complete application payload changed.");'+
    'element.textContent=JSON.stringify(restoreSharedStrings(JSON.parse('+zipGlobal+'.utf8Text(original)),'+maxBytes+'));}';
  const scriptStart=html.indexOf('<script>',end+9),scriptEnd=html.indexOf('</script>',scriptStart+8);
  if(scriptStart<0||scriptEnd<0)throw new Error('The application bootstrap is missing.');
  const bootstrap=html.slice(scriptStart+8,scriptEnd),anchor=bootstrap.indexOf(bootstrapBefore);
  if(anchor<0)throw new Error('The application bootstrap anchor is missing.');
  const prefix=bootstrap.slice(0,anchor)+restore.replace(/<\/script/gi,'<\\/script');
  const runRetained='const application=document.createElement("script");application.textContent="(()=>{\\n"+JSON.parse(document.getElementById('+JSON.stringify(dataId)+').textContent).bootstrap+"\\n})();";document.body.appendChild(application);';
  const restoredBootstrap=compactBootstrap?'(()=>{\n'+prefix+runRetained+'\n})();':prefix+bootstrap.slice(anchor);
  return html.slice(0,start+marker.length)+JSON.stringify(packed)+html.slice(end,scriptStart+8)+restoredBootstrap+html.slice(scriptEnd);
}
