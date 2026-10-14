'use strict';
/** Exact bytes from an authorized Gmail raw read. No I/O, mail mutation or source execution. */
const codec=require('./connected_zip.cjs');
const hashes=require('./connected_sha256.cjs');
const SCHEMA='commons.original-mime-attachment/v1';
const need=(ok,message)=>{if(!ok)throw TypeError(message);};
const digest=body=>hashes.sha256Bytes(body);
const trimHeader=text=>text.replace(/^[ \t]+|[ \t]+$/g,'');
function positive(value,name){need(Number.isSafeInteger(value)&&value>0,'Choose a positive '+name);return value;}
function latin1(bytes){let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return out;}
function octets(text){const out=new Uint8Array(text.length);for(let i=0;i<text.length;i++){need(text.charCodeAt(i)<=255,'Receive original MIME octets');out[i]=text.charCodeAt(i);}return out;}
function base64url(value,maxBytes){
  need(typeof value==='string'&&/^[A-Za-z0-9_-]*={0,2}$/.test(value),'Receive complete original base64url');
  need(value.length<=Math.ceil(maxBytes/3)*4+2,'Message exceeds selected capacity');
  const bare=value.replace(/=+$/,'');need(bare.length%4!==1,'Incomplete base64url');
  const padding='='.repeat((4-bare.length%4)%4);
  need(value===bare||value===bare+padding,'Inconsistent base64url padding');
  const body=codec.fromBase64(bare.replace(/-/g,'+').replace(/_/g,'/')+padding);
  need(body.length<=maxBytes,'Message exceeds selected capacity');return body;
}
function headersOf(text,maxHeaderBytes){
  const split=/\r?\n\r?\n/.exec(text);
  need(split&&split.index<=maxHeaderBytes,'Receive complete MIME headers within selected capacity');
  const raw=text.slice(0,split.index);need(!/\r(?!\n)/.test(raw),'Bare carriage return in headers');
  const fields=[];
  for(const line of raw.split(/\r?\n/)){
    if(/^[ \t]/.test(line)){need(fields.length,'Folded header needs its original field');fields[fields.length-1][1]+=line;}
    else{const m=/^([!#$%&'*+\-.^_\x60|~0-9A-Za-z]+):[ \t]*(.*)$/.exec(line);need(m,'Receive complete named headers');fields.push([m[1].toLowerCase(),m[2]]);}
  }
  const values=new Map();
  for(const [name,originalValue]of fields){
    const value=trimHeader(originalValue);
    need(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value),'Control character in header');
    if(!values.has(name))values.set(name,[]);values.get(name).push(value);
  }
  return {values,body:text.slice(split.index+split[0].length)};
}
function single(headers,name,fallback=''){
  const values=headers.get(name)||[];need(values.length<=1,'Repeated '+name+' is ambiguous');
  return values.length?values[0]:fallback;
}
function parameters(value){
  const fields=[];let part='',quoted=false,escaped=false;
  for(const char of value){
    if(escaped){part+=char;escaped=false;continue;}
    if(quoted&&char==='\\'){part+=char;escaped=true;continue;}
    if(char==='"'){quoted=!quoted;part+=char;continue;}
    if(char===';'&&!quoted){fields.push(trimHeader(part));part='';}else part+=char;
  }
  need(!quoted&&!escaped,'Incomplete MIME parameter quoting');fields.push(trimHeader(part));
  const kind=(fields.shift()||'').toLowerCase(),params=new Map();
  for(const field of fields){
    const m=/^([!#$%&'*+\-.^_\x60|~0-9A-Za-z]+)[ \t]*=[ \t]*([\s\S]*)$/.exec(field);need(m,'Receive complete MIME parameters');
    const key=m[1].toLowerCase();let item=m[2];
    if(item.startsWith('"')){
      need(item.endsWith('"')&&item.length>=2,'Incomplete parameter quoting');
      const quotedBody=item.slice(1,-1);let decoded='';
      for(let i=0;i<quotedBody.length;i++){
        if(quotedBody[i]==='\\'){need(i+1<quotedBody.length,'Incomplete quoted pair');decoded+=quotedBody[++i];}
        else{need(quotedBody[i]!=='"','Unescaped quote inside parameter');decoded+=quotedBody[i];}
      }
      item=decoded;
    }
    else need(/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(item),'Quote MIME parameter special characters');
    need(!params.has(key),'Repeated MIME parameter is ambiguous');params.set(key,item);
  }
  return {kind,params};
}
function percent(value){
  const out=[];
  for(let i=0;i<value.length;i++){
    if(value[i]==='%'){need(/^[0-9a-fA-F]{2}$/.test(value.slice(i+1,i+3)),'Incomplete encoded parameter');out.push(parseInt(value.slice(i+1,i+3),16));i+=2;}
    else{need(value.charCodeAt(i)<128,'Encoded parameters require ASCII');out.push(value.charCodeAt(i));}
  }
  return out;
}
function decodeParameter(parts){
  const first=parts[0],prefix=first.encoded?/^([^']*)'[^']*'([\s\S]*)$/.exec(first.value):null;
  if(first.encoded)need(prefix,'Encoded filename needs charset and language fields');
  else need(parts.every(part=>!part.encoded),'Encoded continuation needs charset in segment zero');
  const charset=prefix?prefix[1].toLowerCase():'utf-8',data=[];
  need(['utf-8','us-ascii','iso-8859-1'].includes(charset),'Unsupported filename charset');
  for(let i=0;i<parts.length;i++){
    const value=i===0&&prefix?prefix[2]:parts[i].value;
    const chunk=parts[i].encoded?percent(value):Array.from(octets(value));
    for(const byte of chunk)data.push(byte);
  }
  const bytes=new Uint8Array(data);
  if(charset==='iso-8859-1')return latin1(bytes);
  if(charset==='us-ascii')need(bytes.every(byte=>byte<128),'Non-ASCII filename');
  return codec.utf8Text(bytes);
}
function parameter(params,name){
  const continued=[];
  for(const [key,value]of params){const m=new RegExp('^'+name+'\\*(0|[1-9][0-9]*)(\\*)?$').exec(key);if(m)continued.push({index:Number(m[1]),encoded:!!m[2],value});}
  const extended=params.get(name+'*');need(!(extended!==undefined&&continued.length),'Competing extended parameter forms');
  if(continued.length){continued.sort((a,b)=>a.index-b.index);need(continued.every((part,i)=>part.index===i),'Parameter continuation gap or duplicate');return decodeParameter(continued);}
  if(extended!==undefined)return decodeParameter([{encoded:true,value:extended}]);
  const normal=params.get(name);return normal===undefined?null:codec.utf8Text(octets(normal));
}
function splitMultipart(body,boundary){
  need(typeof boundary==='string'&&boundary.length>0&&boundary.length<=70&&
    /^[0-9A-Za-z'()+_,\-./:=? ]*[0-9A-Za-z'()+_,\-./:=?]$/.test(boundary),'Receive the original legal MIME boundary');
  const escaped=boundary.replace(/[.*+?^{}$()|[\]\\]/g,'\\$&');
  const expression=new RegExp('(^|\\r?\\n)--'+escaped+'(--)?[ \\t]*(\\r?\\n|$)','g');
  const children=[];let start=null,closed=false,match;
  while((match=expression.exec(body))){
    if(start!==null)children.push(body.slice(start,match.index));
    if(match[2]){closed=true;break;}start=expression.lastIndex;
  }
  need(closed&&start!==null,'Original multipart message is incomplete');return children;
}
function transferBody(text,encoding){
  if(encoding==='base64'){need(!/[^A-Za-z0-9+/=\r\n \t]/.test(text),'Non-MIME base64 characters');return codec.fromBase64(text.replace(/[\r\n \t]/g,''));}
  if(encoding==='quoted-printable'){
    need(!/[^\x09\x0a\x0d\x20-\x7e]/.test(text),'Unencoded non-printable quoted-printable octet');
    // RFC 2045 6.7: transport-added trailing whitespace is discarded before decoding.
    text=text.replace(/[ \t]+(?=\r?\n|$)/g,'');
    const data=[];
    for(let i=0;i<text.length;i++){
      if(text[i]==='='){
        if(text.slice(i+1,i+3)==='\r\n'){i+=2;continue;}if(text[i+1]==='\n'){i++;continue;}
        need(/^[0-9a-fA-F]{2}$/.test(text.slice(i+1,i+3)),'Incomplete quoted-printable attachment');
        data.push(parseInt(text.slice(i+1,i+3),16));i+=2;
      }else data.push(text.charCodeAt(i));
    }
    return new Uint8Array(data);
  }
  need(['7bit','8bit','binary',''].includes(encoding),'Unsupported attachment transfer encoding');
  const bytes=octets(text);if(encoding==='7bit'||encoding==='')need(bytes.every(byte=>byte<128),'Non-ASCII octets in 7bit attachment');
  return bytes;
}
function inspectMimeAttachments(rawBytes,options={}){
  need(rawBytes instanceof Uint8Array,'Receive original raw message bytes');
  const maxMessageBytes=positive(options.maxMessageBytes??64*1024*1024,'message byte capacity');
  const maxHeaderBytes=positive(options.maxHeaderBytes??64*1024,'header byte capacity');
  const maxParts=positive(options.maxParts??1000,'MIME part count');
  const maxDepth=positive(options.maxDepth??32,'MIME nesting depth');
  need(rawBytes.length<=maxMessageBytes,'Message exceeds selected capacity');
  const attachments=[];let count=0;
  function visit(text,path,depth){
    need(depth<=maxDepth&&++count<=maxParts,'MIME structure exceeds selected capacity');
    const {values,body}=headersOf(text,maxHeaderBytes),media=parameters(single(values,'content-type','text/plain'));
    need(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(media.kind),'Incomplete MIME media type');
    const disposition=parameters(single(values,'content-disposition',''));
    const filename=parameter(disposition.params,'filename')??parameter(media.params,'name');
    const encoding=single(values,'content-transfer-encoding','7bit').toLowerCase();
    if(media.kind.startsWith('multipart/')){
      need(['7bit','8bit','binary'].includes(encoding),'Multipart encoding must preserve boundaries');
      splitMultipart(body,parameter(media.params,'boundary')).forEach((child,index)=>visit(child,path.concat(index),depth+1));
    }else if(filename!==null||disposition.kind==='attachment'){
      attachments.push({part_path:path,filename,media_type:media.kind,disposition:disposition.kind,transfer_encoding:encoding,encoded_body:body});
    }
  }
  visit(latin1(rawBytes),[],0);
  return {attachments,part_count:count,raw:digest(rawBytes)};
}
function receiveGmailRawAttachment(message,selection){
  need(message&&typeof message==='object'&&selection&&typeof selection==='object','Use the actual raw response and original selection');
  const request=selection.read_request;
  need(request&&typeof request.link_id==='string'&&request.link_id&&typeof request.message_id==='string'&&request.message_id===message.id,'Select the exact original account read and message ID');
  need(typeof selection.filename==='string'&&selection.filename,'Select the exact original attachment filename');
  const expected=selection.expected;
  need(expected&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&/^[0-9a-f]{64}$/.test(expected.sha256),'Retain original complete attachment size and SHA-256');
  const maxMessageBytes=positive(selection.maxMessageBytes??64*1024*1024,'message byte capacity');
  const raw=base64url(message.raw,maxMessageBytes),inspected=inspectMimeAttachments(raw,{...selection,maxMessageBytes});
  let matches=inspected.attachments.filter(part=>part.filename===selection.filename);
  if(selection.part_path!==undefined){need(Array.isArray(selection.part_path)&&selection.part_path.every(n=>Number.isSafeInteger(n)&&n>=0),'Select a complete numeric MIME part path');matches=matches.filter(part=>JSON.stringify(part.part_path)===JSON.stringify(selection.part_path));}
  need(matches.length===1,'Select one unambiguous complete original attachment');
  const part=matches[0];if(selection.media_type!==undefined)need(selection.media_type===part.media_type,'Selected media type differs');
  const data=transferBody(part.encoded_body,part.transfer_encoding),actual=digest(data);
  need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'Full attachment differs from retained original bytes');
  return {schema:SCHEMA,source:{provider:'gmail',link_id:request.link_id,message_id:message.id,raw_bytes:inspected.raw.bytes,raw_sha256:inspected.raw.sha256},
    attachment:{filename:part.filename,part_path:part.part_path,media_type:part.media_type,transfer_encoding:part.transfer_encoding,...actual},data};
}
/** Select the same complete MIME attachment, then restore its retained original source. */
function receiveGmailSourceCarrier(message,selection){
  need(selection&&selection.source_carrier,'Select the complete original source identity');
  const attachment=receiveGmailRawAttachment(message,selection);
  const restored=require('./connected_source_carrier.cjs').receiveSourceCarrier(
    attachment.data,{carrier:selection.expected,source:selection.source_carrier},
    {maxSourceBytes:selection.maxSourceBytes,maxCarrierBytes:selection.maxCarrierBytes});
  return {...attachment,original:restored.source,carrier:{
    schema:restored.schema,...restored.carrier,gzip:restored.gzip,members:restored.members
  },data:restored.data};
}
module.exports={inspectMimeAttachments,receiveGmailRawAttachment,receiveGmailSourceCarrier};
