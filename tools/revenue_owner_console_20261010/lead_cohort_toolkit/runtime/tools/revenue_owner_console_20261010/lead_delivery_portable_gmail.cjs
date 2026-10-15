'use strict';
/** Toolkit portable host for the maintained Gmail parsers. No provider or file operations.
 * The canonical package-contact adapter stays in the full application; this
 * complete feedback host needs no account configuration or contact dispatch. */
const sha=require('../../host/connected_sha256.cjs');
const bytes=require('../../host/connected_archive_bytes.cjs');
const mime=require('../../host/connected_mime.cjs');
const rawGmail=require('../../host/connected_gmail_raw.cjs');
const {createNativeDeliveryReports}=require('./native_delivery_report_core.cjs');
const {createGmailNativeMessages}=require('./gmail_native_messages.cjs');
const {googleGroupsFailure}=require('./native_google_groups_failure.cjs');
const {createLeadDeliveryFeedback}=require('./lead_delivery_feedback_core.cjs');
const defaultCore=require('./lead_fulfillment_core.cjs');
const {googleAttachmentFailure}=require('./native_google_attachment_failure.cjs');
const {googleSendingLimitFailure}=require('./native_google_sending_limit_failure.cjs');

function utf8(value){
  // Match Buffer/TextEncoder replacement of isolated surrogates.
  return bytes.utf8(String(value).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'\uFFFD'));
}
function createHash(algorithm){
  if(algorithm!=='sha256')throw new TypeError('The Gmail host requires SHA-256.');
  const chunks=[];let finished=false;
  return {update(value,encoding='utf8'){
    if(finished)throw new Error('Digest already finalized.');
    if(typeof value==='string'&&!['utf8','utf-8'].includes(encoding))throw new TypeError('Use original UTF-8 bytes.');
    chunks.push(typeof value==='string'?utf8(value):new Uint8Array(value));return this;
  },digest(format){
    if(finished)throw new Error('Digest already finalized.');
    if(format!=='hex')throw new TypeError('Use the original hexadecimal digest.');
    finished=true;return sha.sha256Bytes(bytes.join(chunks)).sha256;
  }};
}
const Buffer={
  byteLength(value,encoding='utf8'){
    if(!['utf8','utf-8'].includes(encoding))throw new TypeError('Use UTF-8 byte length.');
    return typeof value==='string'?utf8(value).length:value.byteLength;
  },
  from(value,encoding='utf8'){
    let out;
    if(value instanceof Uint8Array)out=new Uint8Array(value);
    else if(['base64','base64url'].includes(encoding))out=mime.decodeBase64(value);
    else if(['utf8','utf-8'].includes(encoding))out=utf8(value);
    else throw new TypeError('Unsupported Gmail byte encoding.');
    Object.defineProperty(out,'toString',{value(format='utf8'){
      if(format==='base64')return bytes.base64(out);
      if(format==='base64url')return bytes.base64(out).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      if(['utf8','utf-8'].includes(format))return mime.decodeCharset(out,'utf-8');
      if(['latin1','binary'].includes(format))return mime.latin1(out);
      throw new TypeError('Unsupported Gmail byte encoding.');
    }});return out;
  }
};
class ConnectedTextDecoder{
  constructor(charset='utf-8',options={}){
    this.charset=String(charset).toLowerCase();this.ignoreBOM=Boolean(options.ignoreBOM);
  }
  decode(input){
    const charset=['ascii','us-ascii','iso-8859-1','latin1','latin-1'].includes(this.charset)?'windows-1252':this.charset;
    const text=mime.decodeCharset(new Uint8Array(input),charset);
    return this.ignoreBOM?text:text.replace(/^\uFEFF/,'');
  }
}
function createPortableGmail(options={}){
  const core=options.core??defaultCore;
  const URLClass=options.URL??globalThis.URL;
  const domainToASCII=options.domainToASCII??(domain=>{
    if(/[\s\/\\#?@:%\u0000-\u001f\u007f]/u.test(domain))return '';
    if(typeof URLClass==='function'){
      try{return new URLClass('http://'+domain+'/').hostname;}catch{return '';}
    }
    // An ASCII original needs no IDNA conversion in a connected JS isolate.
    // Unicode names need the host's standards implementation; never guess them.
    if(/[^\x00-\x7f]/u.test(domain))throw new TypeError('This original domain requires the host IDNA converter.');
    return domain.toLowerCase();
  });
  const TextDecoder=options.TextDecoder??globalThis.TextDecoder??ConnectedTextDecoder;
  const report=createNativeDeliveryReports({createHash,domainToASCII,Buffer,TextDecoder});
  function originalPair(message,mailbox){
    const retained=message.portable_gmail_originals;
    if(!retained)return null;
    const {portable_gmail_originals:_,...fullView}=message;
    if(retained.version!=='dealscout.portable-gmail-originals.v1'||!retained.full||
       retained.full.portable_gmail_originals||core.hash(fullView)!==core.hash(retained.full))
      throw new TypeError('The retained FULL/RAW pair differs from its original native view.');
    const bound=rawGmail.bindGmailRawMessage(retained.full,retained.raw,{mailbox});
    if(core.hash(bound.source)!==core.hash(retained.binding)||
       core.hash(bound.delivery_sources)!==core.hash(retained.delivery_sources))
      throw new TypeError('The retained RAW binding differs from its original provider bytes.');
    return {...retained,bound};
  }
  const parseOriginal=report.parseDeliveryReports;
  report.parseDeliveryReports=(message,settings={})=>{
    const pair=originalPair(message,settings.mailbox);
    const full=parseOriginal(message,settings);
    // A complete FULL report retains its original event IDs on later RAW
    // enrichment. RAW materializes a missing machine body without replacing
    // the FULL source identity held by the original customer record.
    if(!pair||full.reports.length&&full.reports.every(row=>row.complete&&row.valid))return full;
    return parseOriginal(pair.bound.message,settings);
  };
  const normalized=createGmailNativeMessages({createHash,Buffer,rawGmail,googleGroupsFailure,
    parseDeliveryReports:report.parseDeliveryReports,TextDecoder,URL:URLClass});
  const originalNormalize=normalized.normalizeMessages;
  normalized.normalizeMessages=(input,settings)=>{
    const messages=report.unwrapNativeMessages(input);
    if(!messages.some(message=>message.portable_gmail_originals))return originalNormalize(input,settings);
    const pairs=messages.map(message=>originalPair(message,settings?.mailbox));
    const full=messages.map((message,index)=>pairs[index]?.full??message);
    const raw=pairs.flatMap(pair=>pair?[pair.raw]:[]);
    return originalNormalize(rawGmail.withGmailRawMessages(full,raw),settings);
  };
  const feedback=createLeadDeliveryFeedback({core,...report,...normalized,googleAttachmentFailure,googleSendingLimitFailure});
  return {core,report,normalized,feedback,rawGmail,googleSendingLimitFailure};
}
module.exports={createPortableGmail};
