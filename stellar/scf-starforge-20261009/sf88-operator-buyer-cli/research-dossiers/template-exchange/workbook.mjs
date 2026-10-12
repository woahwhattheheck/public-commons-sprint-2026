// MIT. Bound native workbook calls; no network or spreadsheet code execution.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const WORKBOOK_SCHEMA='sf88-template-workbook/v1';
export const MAX_WORKBOOK_BYTES=32*1024*1024;
export const hashBytes=body=>createHash('sha256').update(body).digest('hex');
export function requireValue(ok,code,status=400){if(!ok){const e=new Error(code);e.code=code;e.status=status;throw e;}}
const modulePath=fileURLToPath(new URL('./workbook.py',import.meta.url));
export function workbookFilename(value){
  requireValue(typeof value==='string'&&value.length>0&&value.length<=240&&!/[\\/\u0000-\u001f]/u.test(value),'TEMPLATE_FILENAME_INVALID');
  requireValue(/\.(?:xlsx|csv|tsv)$/iu.test(value),'TEMPLATE_FILE_FORMAT_REQUIRED');return value;
}
export function checkTemplateSignal(signal){
  requireValue(signal===undefined||signal!==null&&typeof signal.aborted==='boolean'&&
    typeof signal.addEventListener==='function'&&typeof signal.removeEventListener==='function',
    'TEMPLATE_ABORT_SIGNAL_REQUIRED');
  requireValue(!signal?.aborted,'TEMPLATE_OPERATION_CANCELLED',499);
}
export async function callWorkbook(input,{python='python3',signal,timeoutMs=60000}={}){
  requireValue(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=300000,'TEMPLATE_TIMEOUT_INVALID');
  checkTemplateSignal(signal);
  const body=Buffer.from(JSON.stringify(input),'utf8');
  requireValue(body.length<MAX_WORKBOOK_BYTES*3,'TEMPLATE_REQUEST_TOO_LARGE',413);
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I','-B',modulePath],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let out=[],length=0,stderr=0,closed=false,failure=null,killTimer;
    const fail=(code,status=400)=>{
      if(!failure){failure=Object.assign(new Error(code),{code,status});}
      child.kill('SIGTERM');
      killTimer??=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},500);
      killTimer.unref?.();
    };
    const cancel=()=>fail('TEMPLATE_OPERATION_CANCELLED',499);
    signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>fail('TEMPLATE_WORKBOOK_TIMEOUT',504),timeoutMs);timer.unref?.();
    child.on('error',()=>fail('TEMPLATE_PYTHON_UNAVAILABLE',503));
    child.stdin.on('error',()=>{if(!failure)fail('TEMPLATE_WORKBOOK_INPUT_FAILED',502);});
    child.stdout.on('data',chunk=>{
      length+=chunk.length;
      if(length>MAX_WORKBOOK_BYTES*4)fail('TEMPLATE_WORKBOOK_RESPONSE_TOO_LARGE',413);
      else out.push(chunk);
    });
    child.stderr.on('data',chunk=>{stderr+=chunk.length;if(stderr>8192)fail('TEMPLATE_WORKBOOK_DIAGNOSTIC_LIMIT',502);});
    child.on('close',code=>{
      closed=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',cancel);
      if(failure){reject(failure);return;}
      try{
        checkTemplateSignal(signal);
        const result=JSON.parse(Buffer.concat(out).toString('utf8'));
        requireValue(result?.ok===true&&code===0,result?.error?.code??'TEMPLATE_WORKBOOK_FAILED');
        resolve(result.result);
      }catch(error){reject(error.code?error:Object.assign(new Error('TEMPLATE_WORKBOOK_RESPONSE_INVALID'),{code:'TEMPLATE_WORKBOOK_RESPONSE_INVALID',status:502}));}
    });
    // Reconcile an abort that arrived during child acquisition before sending input.
    if(signal?.aborted){cancel();child.stdin.end();}else child.stdin.end(body);
  });
}
export async function inspectWorkbook(bytes,{filename,format,delimiter,...options}={}){
  requireValue(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_WORKBOOK_BYTES,'TEMPLATE_WORKBOOK_SIZE_INVALID',413);
  const result=await callWorkbook({action:'inspect',filename:workbookFilename(filename),format,delimiter,bodyBase64:bytes.toString('base64')},options);
  checkTemplateSignal(options.signal);
  requireValue(result.schema===WORKBOOK_SCHEMA&&result.sha256===hashBytes(bytes)&&result.bytes===bytes.length,'TEMPLATE_INSPECTION_CHANGED',502);
  return result;
}
export async function patchWorkbook(bytes,{filename,format,delimiter,patches,...options}={}){
  requireValue(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_WORKBOOK_BYTES,'TEMPLATE_WORKBOOK_SIZE_INVALID',413);
  const result=await callWorkbook({action:'patch',filename:workbookFilename(filename),format,delimiter,bodyBase64:bytes.toString('base64'),patches},options);
  checkTemplateSignal(options.signal);
  requireValue(typeof result.bodyBase64==='string','TEMPLATE_WORKBOOK_RESPONSE_INVALID',502);
  const body=Buffer.from(result.bodyBase64,'base64');
  requireValue(body.toString('base64')===result.bodyBase64&&body.length<=MAX_WORKBOOK_BYTES&&
    result.report?.sourceSha256===hashBytes(bytes)&&result.report.outputSha256===hashBytes(body)&&
    result.inspection?.sha256===hashBytes(body),'TEMPLATE_OUTPUT_CHANGED',502);
  return {body,report:result.report,inspection:result.inspection};
}
export function valueText(value){
  if(value?.type==='blank')return '';
  if(value?.type==='boolean')return value.value?'TRUE':'FALSE';
  return String(value?.value??'');
}
export function cellAt(inspection,sheet,cell){
  const page=inspection.sheets.find(s=>s.name===sheet);
  requireValue(page?.kind==='worksheet','TEMPLATE_SHEET_NOT_FOUND');
  const found=page.cells.find(c=>c.address===cell);
  if(found)return structuredClone(found);
  const value={value:{type:'blank',value:null},formula:null,style:null};
  // The Python engine fingerprints canonical, sorted UTF-8 JSON.
  const canonical=JSON.stringify({formula:null,style:null,value:{type:'blank',value:null}});
  return {address:cell,...value,fingerprint:hashBytes(Buffer.from(canonical))};
}
export function cellColumn(cell){
  const m=/^([A-Z]{1,3})([1-9][0-9]*)$/u.exec(cell);requireValue(m,'TEMPLATE_CELL_INVALID');
  return m[1];
}
export function cellRow(cell){cellColumn(cell);return Number(cell.match(/[0-9]+$/u)[0]);}
export function locateReturnedCell(inspection,binding){
  let cell=binding.cell;
  if(binding.rowIdentity){
    const {column,value}=binding.rowIdentity;
    requireValue(/^[A-Z]{1,3}$/u.test(column)&&typeof value==='string','TEMPLATE_ROW_IDENTITY_INVALID');
    const sheet=inspection.sheets.find(s=>s.name===binding.sheet);
    requireValue(sheet?.kind==='worksheet','TEMPLATE_RETURN_SHEET_MISSING');
    const matches=sheet.cells.filter(c=>cellColumn(c.address)===column&&valueText(c.value)===value);
    requireValue(matches.length===1,'TEMPLATE_RETURN_ROW_IDENTITY_AMBIGUOUS');
    cell=cellColumn(binding.cell)+cellRow(matches[0].address);
  }
  return {sheet:binding.sheet,cell,value:cellAt(inspection,binding.sheet,cell)};
}
