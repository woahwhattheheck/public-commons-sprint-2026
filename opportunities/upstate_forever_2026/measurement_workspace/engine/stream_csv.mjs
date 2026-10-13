/** Incremental CSV parser, preserving the existing parser's fields and physical lines. */
import {InputError,clean} from './parse.mjs';
/** UTF-8 chunks may split any scalar, escaped quote or CRLF. No complete source is held. */
export function* csvRecords(chunks,{maxCell=1_000_000,maxColumns=10000,maxRecord=16*1024*1024}={}){
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  let field='',values=[],quoted=false,after=false,skipLF=false,first=true,line=1,start=1,recordSize=0;
  const endField=()=>{values.push(field);field='';after=false;if(values.length>maxColumns)throw new InputError('CSV has too many columns',413);};
  const endRecord=()=>{endField();const result=values.some(v=>v!=='')?{line:start,values}:null;values=[];recordSize=0;return result;};
  function* consume(text){for(const char of text){
    if(first){first=false;if(char==='\uFEFF')continue;}
    if(skipLF){skipLF=false;if(char==='\n')continue;}
    recordSize+=char.length;if(recordSize>maxRecord)throw new InputError('CSV record exceeds configured size at line '+start,413);
    if(quoted){if(char==='"'){quoted=false;after=true;}else{field+=char;if(char==='\n')line++;}}
    else if(after&&char==='"'){field+='"';quoted=true;after=false;}
    else if(char===',')endField();
    else if(char==='\n'||char==='\r'){const item=endRecord();if(item)yield item;line++;start=line;skipLF=char==='\r';}
    else if(after)throw new InputError('Unexpected character after closing quote at line '+line);
    else if(char==='"'){if(field)throw new InputError('Quote inside unquoted field at line '+line);quoted=true;}
    else field+=char;
    if(field.length>maxCell)throw new InputError('Field too large at line '+line,413);
  }}
  for(const chunk of chunks)yield* consume(decoder.decode(chunk,{stream:true}));
  yield* consume(decoder.decode());
  if(quoted)throw new InputError('Unclosed quoted field starting at line '+start);
  if(field||values.length||after){const item=endRecord();if(item)yield item;}
}
export function* csvRows(chunks,options){
  let headers;
  for(const record of csvRecords(chunks,options)){
    if(!headers){headers=record.values.map(clean);if(headers.some(x=>!x)||new Set(headers).size!==headers.length)throw new InputError('CSV header names must be nonempty and unique');yield {type:'header',headers};continue;}
    if(record.values.length!==headers.length)yield {type:'rejected',category:0,entry:{line:record.line,reason:`Expected ${headers.length} fields; received ${record.values.length}`,values:record.values}};
    else yield {type:'row',line:record.line,raw:Object.fromEntries(headers.map((h,i)=>[h,record.values[i]]))};
  }
  if(!headers)throw new InputError('CSV is empty');
}
