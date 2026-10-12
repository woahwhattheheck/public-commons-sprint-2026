// MIT. Complete frozen workflow report exports, retained with the original Console writer.
import { mkdir, open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeConsoleWorkflowFile as writeOpenApiWorkflowFile } from './client-files.mjs';
import { canonical, digest, fail } from './records.mjs';
import { MAX_WORKFLOW_REPORT_REQUEST_BYTES, validateWorkflowReportPacket } from './workflow-reports.mjs';
import { workflowReportHtml, workflowReportStepsCsv, workflowReportChangesCsv } from './public/workflow-report-format.mjs';

export const WORKFLOW_REPORT_FILES = Object.freeze(['report.json', 'report.html', 'steps.csv', 'changes.csv']);
const need=(value,message,code='CONSOLE_REPORT_FILE',status=400)=>{if(!value)throw fail(code,message,status);};
const same=(a,b)=>canonical(a)===canonical(b);
const owned=info=>!process.getuid||info.uid===process.getuid();
const regular=info=>info.isFile()&&owned(info)&&
  (process.platform==='win32'||!(info.mode&0o077));

export async function workflowReportDirectory(directory,{create=false}={}) {
  need(typeof directory==='string'&&directory.length>0,'Select one private report directory.');
  const path=resolve(directory);
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&owned(info)&&
    (process.platform==='win32'||!(info.mode&0o077))&&await realpath(path)===path,
    'Use an owned private report directory at its original absolute path.');
  return path;
}

/** Read the complete original browser or client JSON packet without following a file link. */
export async function readWorkflowReportFile(path) {
  need(typeof path==='string'&&path.length>0,'Select the complete original report JSON file.');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat();
    need(before.isFile()&&before.size<=MAX_WORKFLOW_REPORT_REQUEST_BYTES,
      'Receive a complete regular report JSON file within its original capacity.');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs,
      'The selected report file changed during reading.','CONSOLE_REPORT_FILE_CHANGED',409);
    let packet;
    try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw fail('CONSOLE_REPORT_FILE','Read the complete original UTF-8 report JSON.',400);}
    return validateWorkflowReportPacket(packet);
  } finally {await handle.close();}
}
function outputs(packet) {
  return [
    ['report.json',()=>JSON.stringify(packet)+'\n'],
    ['report.html',()=>workflowReportHtml(packet)],
    ['steps.csv',()=>workflowReportStepsCsv(packet)],
    ['changes.csv',()=>workflowReportChangesCsv(packet)]
  ];
}
function result(directory,packet,files) {
  return {state:'REOPENED',directory,profileId:packet.archive.profile.id,
    selection:packet.selection,contentSha256:packet.contentSha256,
    archiveSha256:packet.archive.contentSha256,packet,files};
}

/** The JSON packet is committed first; each other format uses those exact frozen bytes. */
export async function writeWorkflowReportExports({directory,packet}) {
  packet=JSON.parse(JSON.stringify(validateWorkflowReportPacket(packet)));
  const path=await workflowReportDirectory(directory,{create:true}),files=[];
  for(const [name,render]of outputs(packet)){
    const file=await writeOpenApiWorkflowFile(join(path,name),render());
    files.push({name,...file});
  }
  return result(path,packet,files);
}
async function inspectFile(path,text) {
  const expected=Buffer.from(text),expectedSha=digest(expected);
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat();
    need(regular(before)&&before.size===expected.length,
      'Keep the complete original report export file.','CONSOLE_REPORT_EXPORT_CHANGED',409);
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);
    let bytes=0;
    while(bytes<before.size){
      const read=await handle.read(buffer,0,Math.min(buffer.length,before.size-bytes),bytes);
      need(read.bytesRead>0,'The complete report export changed while reading.','CONSOLE_REPORT_EXPORT_CHANGED',409);
      hash.update(buffer.subarray(0,read.bytesRead));bytes+=read.bytesRead;
    }
    const after=await handle.stat(),named=await lstat(path),sha256=hash.digest('hex');
    need(regular(named)&&!named.isSymbolicLink()&&named.dev===before.dev&&named.ino===before.ino&&
      after.size===before.size&&after.mtimeMs===before.mtimeMs&&sha256===expectedSha,
      'The report export differs from its original frozen report.','CONSOLE_REPORT_EXPORT_CHANGED',409);
    return {state:'REOPENED',path,bytes,sha256};
  } finally {await handle.close();}
}

/** Reopen all four original exports offline and match each against its retained report. */
export async function reopenWorkflowReportExports({directory}) {
  const path=await workflowReportDirectory(directory),packet=await readWorkflowReportFile(join(path,'report.json')),files=[];
  for(const [name,render]of outputs(packet))files.push({name,...await inspectFile(join(path,name),render())});
  return result(path,packet,files);
}

/** A repeated capture keeps its first saved report, then finishes any missing formats. */
export async function captureWorkflowReport(client,{directory,runId,baselineRunId=null}) {
  const path=await workflowReportDirectory(directory,{create:true});
  const selection={runId,baselineRunId};
  let packet;
  try{packet=await readWorkflowReportFile(join(path,'report.json'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(packet)need(same(packet.selection,selection),
    'This directory retains another original report selection. Choose a new directory.',
    'CONSOLE_REPORT_OUTPUT_CONFLICT',409);
  else packet=await client.build(selection);
  return writeWorkflowReportExports({directory:path,packet});
}
