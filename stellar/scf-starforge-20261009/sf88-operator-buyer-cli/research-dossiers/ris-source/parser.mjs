// MIT. Ordered RIS framing; exact source bytes remain the authoritative representation.
// The original Citation.js 0.9 parser's normalization contract is documented in
// SOURCE_CONTRACT.md. This reader does not use its lossy whitespace/ER framing.
import {digest,need} from '../../node/store.mjs';
import {RIS_LIMITS,RIS_PARSER_VERSION} from './constants.mjs';

function encodingFor(bytes,declared){
  need(['utf-8','windows-1252','utf-16le','utf-16be'].includes(declared),'RIS_ENCODING_INVALID');
  let detected=null,bomBytes=0;
  if(bytes.length>=3&&bytes[0]===239&&bytes[1]===187&&bytes[2]===191){detected='utf-8';bomBytes=3;}
  else if(bytes.length>=2&&bytes[0]===255&&bytes[1]===254){detected='utf-16le';bomBytes=2;}
  else if(bytes.length>=2&&bytes[0]===254&&bytes[1]===255){detected='utf-16be';bomBytes=2;}
  need(detected===null||detected===declared,'RIS_DECLARED_ENCODING_BOM_CONFLICT');
  const unit=declared.startsWith('utf-16')?2:1;
  need((bytes.length-bomBytes)%unit===0,'RIS_ENCODING_TRUNCATED');
  const decoder=new TextDecoder(declared,{fatal:true,ignoreBOM:true});
  const decode=(start,end)=>{
    try{return decoder.decode(bytes.subarray(start,end));}
    catch{need(false,'RIS_ENCODING_INVALID_BYTES');}
  };
  // Validate the whole document, including whitespace outside records.
  decode(bomBytes,bytes.length);
  return {encoding:declared,bomBytes,unit,decode};
}
function linesOf(bytes,encoding){
  const {unit,bomBytes,decode}=encoding,lines=[];
  const code=at=>unit===1?bytes[at]:encoding.encoding==='utf-16le'?bytes.readUInt16LE(at):bytes.readUInt16BE(at);
  let start=bomBytes,at=start;
  while(at<bytes.length){
    const value=code(at);
    if(value!==10&&value!==13){at+=unit;continue;}
    const end=at;at+=unit;
    if(value===13&&at<bytes.length&&code(at)===10)at+=unit;
    need(at-start<=RIS_LIMITS.lineBytes,'RIS_LINE_TOO_LARGE');
    need(lines.length<RIS_LIMITS.linesPerDocument,'RIS_LINE_COUNT_LIMIT');
    lines.push({number:lines.length+1,start,end,next:at,text:decode(start,end),eol:decode(end,at)});
    start=at;
  }
  if(start<bytes.length){
    need(bytes.length-start<=RIS_LIMITS.lineBytes,'RIS_LINE_TOO_LARGE');
    need(lines.length<RIS_LIMITS.linesPerDocument,'RIS_LINE_COUNT_LIMIT');
    lines.push({number:lines.length+1,start,end:bytes.length,next:bytes.length,text:decode(start,bytes.length),eol:''});
  }
  return lines;
}
export function parseRisDocument(input,{encoding='utf-8'}={}){
  need(Buffer.isBuffer(input)||input instanceof Uint8Array,'RIS_ORIGINAL_BYTES_REQUIRED');
  const bytes=Buffer.from(input);
  need(bytes.length<=RIS_LIMITS.documentBytes,'RIS_DOCUMENT_TOO_LARGE');
  const codec=encodingFor(bytes,encoding),lines=linesOf(bytes,codec);
  const records=[],diagnostics=[],unparsedSegments=[];
  let current=null,previousField=null,outside=null;
  const issue=(code,line,severity='error',detail={})=>{
    const value={code,severity,line:line.number,start:line.start,end:line.next,
      ...(current?{ordinal:current.ordinal}:{}),...detail};
    need(diagnostics.length<RIS_LIMITS.diagnostics,'RIS_DIAGNOSTIC_COUNT_LIMIT');
    diagnostics.push(value);if(current)current.diagnostics.push(value);return value;
  };
  const addOutside=line=>{
    if(outside&&outside.end===line.start){outside.end=line.next;outside.lineEnd=line.number;}
    else{outside={start:line.start,end:line.next,lineStart:line.number,lineEnd:line.number};unparsedSegments.push(outside);}
    if(line.text.trim()!=='')issue('CONTENT_OUTSIDE_RIS_RECORD',line);
  };
  const finish=(end,line,terminated)=>{
    if(!current)return;
    need(end-current.start<=RIS_LIMITS.recordBytes,'RIS_RECORD_TOO_LARGE');
    current.end=end;current.bytes=end-current.start;
    current.lineEnd=line;current.sha256=digest(bytes.subarray(current.start,end));
    current.rawText=codec.decode(current.start,end);
    current.terminated=terminated;
    current.complete=terminated&&!current.diagnostics.some(value=>value.severity==='error');
    records.push(current);current=null;previousField=null;
  };
  for(const line of lines){
    const tagged=/^([A-Z0-9]{2}) {2}-(?: (.*))?$/.exec(line.text);
    if(tagged?.[1]==='TY'){
      if(current){
        issue('RECORD_TERMINATOR_MISSING',line);
        finish(line.start,line.number-1,false);
      }
      need(records.length<RIS_LIMITS.records,'RIS_RECORD_LIMIT');
      current={ordinal:records.length+1,start:line.start,lineStart:line.number,tags:[],diagnostics:[]};
      previousField=null;outside=null;
      if(!String(tagged[2]??'').trim())issue('RECORD_TYPE_MISSING',line);
    }
    if(!current){addOutside(line);continue;}
    need(line.next-current.start<=RIS_LIMITS.recordBytes,'RIS_RECORD_TOO_LARGE');
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(line.text))
      issue('CONTROL_CHARACTER_IN_RIS_TEXT',line);
    if(tagged){
      need(current.tags.length<RIS_LIMITS.fieldsPerRecord,'RIS_FIELD_LIMIT');
      const tag=tagged[1],value=tagged[2]??'';
      const field={index:current.tags.length,tag,value,lineStart:line.number,lineEnd:line.number,
        byteStart:line.start,byteEnd:line.next,lines:[{line:line.number,start:line.start,end:line.next,
          text:line.text,eol:line.eol,kind:'tag'}],continuations:[]};
      current.tags.push(field);previousField=field;
      if(tag==='ER'){
        if(value.trim()!=='')issue('RECORD_TERMINATOR_VALUE',line);
        finish(line.next,line.number,true);
      }
      continue;
    }
    if(/^[A-Za-z0-9]{2}[ \t]+-/.test(line.text)){
      issue('RIS_TAG_DELIMITER_INVALID',line);
      previousField=null;continue;
    }
    if(!previousField){issue('RIS_CONTINUATION_WITHOUT_FIELD',line);continue;}
    const priorLine=previousField.lines.at(-1);
    previousField.value+=priorLine.eol+line.text;
    const continuation={line:line.number,start:line.start,end:line.next,text:line.text,eol:line.eol,kind:'continuation'};
    previousField.lines.push(continuation);previousField.continuations.push(continuation);
    previousField.lineEnd=line.number;previousField.byteEnd=line.next;
  }
  if(current){
    const last=lines.at(-1);
    issue('RECORD_TERMINATOR_MISSING',last??{number:1,start:bytes.length,next:bytes.length});
    finish(bytes.length,last?.number??1,false);
  }
  for(const segment of unparsedSegments){
    segment.bytes=segment.end-segment.start;segment.sha256=digest(bytes.subarray(segment.start,segment.end));
    segment.whitespaceOnly=codec.decode(segment.start,segment.end).trim()==='';
  }
  return {parser:RIS_PARSER_VERSION,encoding,bomBytes:codec.bomBytes,lineCount:lines.length,
    bytes:bytes.length,sha256:digest(bytes),records,diagnostics,unparsedSegments};
}
