// MIT. Accountant return adapter for the original merchant reconciliation report.
// Pure operations: the original workspace owns source custody and immutable imports.
import {createHash,randomUUID} from 'node:crypto';
import {ADJUSTMENT_COLUMNS,freezeAccountantAdjustments,validateAccountantAdjustmentRow} from './adjustments.mjs';

export const HANDOFF_SCHEMA='stellar-forge.merchant-accountant-handoff.v1';
export const RETURN_SCHEMA='stellar-forge.merchant-accountant-return.v1';
export const EXTERNAL_STATUSES=Object.freeze(['UNREVIEWED','REVIEWED','BOOKED','EXCLUDED']);
export const EDITABLE_COLUMNS=Object.freeze(['externalStatus','externalBookRef','externalAccountCode','externalNote']);
const LABEL_FIELDS=Object.freeze(['assetLabel','unitLabel','accountCode','accountName']);
const SOURCE_FIELDS=Object.freeze([
  'eventId','optionId','at','timeBasis','origin','routeId','method','network',
  'assetDigest','recipientDigest','termsRecipientDigest','amountAtomic',
  'receiptFingerprint','transactionFingerprint','orderReferenceDigest',
  'transferEvidenceDigest','ledger','matchingEventDigest','transfer','delivery','exception',
  'termsMatch','termsCandidateCount','verificationScope','merchantQuoteUsd',
  'merchantVariableCostUsd','verifiedQuotedValueUsd','merchantPriceBasis',
  'recoveryId','recoveredEntryDigest','recoveredResponseSha256','recoveredResponseBytes',
]);
export const PROTECTED_COLUMNS=Object.freeze([
  'handoffId','sourceRunId','sourceReportSha256','sourcePeriodCloseId',
  'sourcePeriodCloseSha256','sourcePeriodCloseRevision','rowId','sourceRowSha256',
  ...SOURCE_FIELDS,...LABEL_FIELDS,
]);
export const CSV_COLUMNS=Object.freeze([...PROTECTED_COLUMNS,...EDITABLE_COLUMNS]);
export const accountantColumns=handoff=>[...PROTECTED_COLUMNS,...(handoff?.source?.adjustments?ADJUSTMENT_COLUMNS:[]),...EDITABLE_COLUMNS];
const protectedColumns=handoff=>[...PROTECTED_COLUMNS,...(handoff.source.adjustments?ADJUSTMENT_COLUMNS:[])];
const MAX_ROWS=22_000,MAX_RETURN_ROWS=50_000,MAX_REPORT_BYTES=128_000_000,MAX_CSV_BYTES=64*1024*1024;
const HEX=/^[a-f0-9]{64}$/;
const IDENTIFIER=/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const cell=value=>value===undefined||value===null?'':String(value);

export class AccountantError extends Error {
  constructor(code,message,status=400,details){super(message);this.name='AccountantError';this.code=code;this.status=status;if(details!==undefined)this.details=details;}
}
const check=(ok,code,message,status=400,details)=>{if(!ok)throw new AccountantError(code,message,status,details);};
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){check(Number.isFinite(value),'INVALID_RECORD','A retained record contains an invalid number.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  check(plain(value),'INVALID_RECORD','Use JSON-compatible records.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const copy=value=>JSON.parse(canonical(value));
const seal=record=>({...record,integrity:{sha256:sha(canonical(record))}});
function verifySeal(record,schema){
  check(plain(record)&&record.schema===schema&&plain(record.integrity)&&HEX.test(record.integrity.sha256),'INVALID_RECORD','Choose a retained accountant record of the expected type.');
  const {integrity,...body}=record;
  check(sha(canonical(body))===integrity.sha256,'RECORD_CHANGED','The retained accountant record changed.',409);
}
function bytes(value,maximum,label){
  check(Buffer.isBuffer(value)||value instanceof Uint8Array||typeof value==='string','INVALID_SOURCE',label+' must contain its original bytes.');
  const result=Buffer.from(value);
  check(result.length>0&&result.length<=maximum,'SOURCE_SIZE_UNSUPPORTED',label+' is empty or exceeds the supported size.');
  return result;
}
function utf8(value,label){try{return new TextDecoder('utf-8',{fatal:true}).decode(value);}catch{throw new AccountantError('INVALID_UTF8',label+' must be UTF-8.');}}
function parseJson(value,label){try{return JSON.parse(utf8(value,label));}catch(error){if(error instanceof AccountantError)throw error;throw new AccountantError('INVALID_JSON',label+' is not valid JSON.');}}
function shortText(value,label,maximum=160,{empty=false,multiline=false}={}){
  check(typeof value==='string'&&value.length<=maximum&&(empty||value.trim().length>0)&&
    !(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value),
    'INVALID_TEXT',label+' must be '+(empty?'':'nonempty ')+'text of at most '+maximum+' characters.');
  return value;
}
function timestamp(value){check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),'INVALID_TIMESTAMP','Use a timestamp with an explicit time zone.');return value;}
function identifier(value,label){check(typeof value==='string'&&IDENTIFIER.test(value),'INVALID_ID',label+' must be a retained identifier.');return value;}
const rowIdentity=(id,reportSha256,eventId)=>sha('stellar-forge.accountant-row.v1\n'+id+'\n'+reportSha256+'\n'+eventId);
const defaultAssignment=row=>({rowId:row.rowId,eventId:row.eventId,externalStatus:'UNREVIEWED',externalBookRef:'',externalAccountCode:'',externalNote:'',updatedAt:null,updatedBy:null,revisionId:null});

function validateReport(report){
  check(plain(report)&&report.schema==='stellar-forge.merchant-reconciliation.v1'&&Array.isArray(report.ledger)&&report.ledger.length<=MAX_ROWS&&Array.isArray(report.options)&&plain(report.hashes),'INVALID_ORIGINAL_REPORT','Use a completed original merchant reconciliation report.');
  const seen=new Set();
  for(const row of report.ledger){
    check(plain(row)&&HEX.test(row.eventId)&&HEX.test(row.optionId)&&HEX.test(row.assetDigest)&&
      ['stellar:testnet','stellar:pubnet'].includes(row.network)&&typeof row.amountAtomic==='string'&&
      /^[1-9][0-9]{0,38}$/.test(row.amountAtomic)&&BigInt(row.amountAtomic)<(1n<<127n)&&
      typeof row.transfer==='string'&&typeof row.delivery==='string'&&typeof row.at==='string'&&Number.isFinite(Date.parse(row.at)),
      'INVALID_ORIGINAL_ROW','An original ledger row has invalid event, option, amount or classification fields.');
    check(!seen.has(row.eventId),'DUPLICATE_SOURCE_EVENT','The original report contains a duplicate event.');seen.add(row.eventId);
  }
}

/** Freeze one original report and operator-supplied labels. No files or network. */
export function createHandoff({reportBytes,source,name,actor,labels=[],createdAt=new Date().toISOString(),id=randomUUID(),periodCloseBytes,adjustmentsBytes}={}){
  const raw=bytes(reportBytes,MAX_REPORT_BYTES,'Original report'),report=parseJson(raw,'Original report');validateReport(report);
  identifier(id,'Handoff ID');shortText(name,'Handoff name');shortText(actor,'Operator',1000);timestamp(createdAt);
  check(plain(source),'SOURCE_IDENTITY_REQUIRED','Choose the original completed reconciliation.');
  identifier(source.runId,'Original reconciliation ID');
  for(const key of ['reportSha256','manifestSha256','inputManifestSha256'])check(HEX.test(source[key]),'SOURCE_IDENTITY_REQUIRED','Retain the original '+key+'.');
  check(sha(raw)===source.reportSha256,'SOURCE_REPORT_CHANGED','The original report bytes do not match the selected source.',409);
  const retainedSource={runId:source.runId,reportSha256:source.reportSha256,reportBytes:raw.length,
    manifestSha256:source.manifestSha256,inputManifestSha256:source.inputManifestSha256,
    reportSchema:report.schema,reportCreatedAt:report.createdAt??null,periodClose:null};
  let periodCloseDocument;
  if(source.periodClose!==undefined&&source.periodClose!==null){
    const close=source.periodClose;check(plain(close),'INVALID_PERIOD_CLOSE','Use an original retained period-close snapshot.');
    identifier(close.id,'Original close ID');
    check(Number.isSafeInteger(close.revision)&&close.revision>=1,
      'INVALID_PERIOD_CLOSE','Retain the original positive close revision.');
    check(HEX.test(close.sha256),'INVALID_PERIOD_CLOSE','Retain the original close file hash.');
    const closeRaw=bytes(periodCloseBytes,MAX_REPORT_BYTES,'Original period-close snapshot');
    check(sha(closeRaw)===close.sha256,'PERIOD_CLOSE_CHANGED','The original close snapshot changed.',409);
    const closeDocument=parseJson(closeRaw,'Original period-close snapshot');
    periodCloseDocument=closeDocument;
    check(plain(closeDocument)&&closeDocument.schema==='stellar-forge.merchant-period-close.v1',
      'INVALID_PERIOD_CLOSE','Use an original merchant period-close snapshot.');
    check(closeDocument.id===close.id&&closeDocument.revision===close.revision&&
      closeDocument.runId===source.runId&&closeDocument.reportSha256===source.reportSha256&&
      closeDocument.inputManifestSha256===source.inputManifestSha256,
      'PERIOD_CLOSE_SOURCE_MISMATCH','The original close identity, revision or reconciliation source does not match this handoff.',409);
    check(plain(report.period)&&plain(closeDocument.scope)&&canonical(closeDocument.scope)===canonical(report.period)&&
      plain(closeDocument.period)&&typeof closeDocument.exportId==='string'&&IDENTIFIER.test(closeDocument.exportId)&&
      HEX.test(closeDocument.reviewNotesSha256)&&Number.isSafeInteger(closeDocument.reviewSnapshotRevision)&&
      closeDocument.reviewSnapshotRevision>=0&&typeof closeDocument.includeSources==='boolean',
      'PERIOD_CLOSE_SOURCE_MISMATCH','The original close must retain this report’s period scope, export and frozen review identity.',409);
    retainedSource.periodClose={id:close.id,revision:close.revision,sha256:close.sha256,bytes:closeRaw.length,
      schema:closeDocument.schema,runId:closeDocument.runId,exportId:closeDocument.exportId,
      reportSha256:closeDocument.reportSha256,inputManifestSha256:closeDocument.inputManifestSha256,
      reviewNotesSha256:closeDocument.reviewNotesSha256,reviewSnapshotRevision:closeDocument.reviewSnapshotRevision,
      period:copy(closeDocument.period),scope:copy(closeDocument.scope)};
  }else check(periodCloseBytes===undefined||periodCloseBytes===null,'PERIOD_CLOSE_IDENTITY_REQUIRED','Retain the identity of the supplied original close snapshot.');
  const adjustmentSnapshot=freezeAccountantAdjustments({adjustmentsBytes,report,source,periodCloseDocument});
  if(adjustmentSnapshot)retainedSource.adjustments=adjustmentSnapshot.source;
  check(Array.isArray(labels)&&labels.length<=MAX_ROWS+200,'INVALID_LABELS','Provide option labels as an array.');
  const knownOptions=new Set([...report.options.map(option=>option.optionId),...report.ledger.map(row=>row.optionId)]),labelMap=new Map();
  for(const value of labels){
    check(plain(value)&&HEX.test(value.optionId)&&knownOptions.has(value.optionId),'UNKNOWN_LABEL_OPTION','Label an actual option from this reconciliation.');
    check(!labelMap.has(value.optionId),'DUPLICATE_OPTION_LABEL','Each option may have one retained set of labels.');
    check(Object.keys(value).every(key=>key==='optionId'||LABEL_FIELDS.includes(key)),'INVALID_LABEL_FIELD','Use assetLabel, unitLabel, accountCode and accountName.');
    const label={};for(const field of LABEL_FIELDS)label[field]=shortText(value[field]??'',field,160,{empty:true});
    labelMap.set(value.optionId,label);
  }
  const rows=report.ledger.map(original=>({rowId:rowIdentity(id,source.reportSha256,original.eventId),eventId:original.eventId,
    sourceRowSha256:sha(canonical(original)),original:copy(original),label:copy(labelMap.get(original.optionId)??Object.fromEntries(LABEL_FIELDS.map(key=>[key,'']))),
    ...(adjustmentSnapshot?{adjustments:copy(adjustmentSnapshot.rows.get(original.eventId))}:{})}));
  const summary={totalRows:rows.length,optionCount:new Set(rows.map(row=>row.original.optionId)).size,
    nativeCapturedRows:rows.filter(row=>row.original.origin!=='RECOVERED_ORIGINAL_SF31_OUTCOME').length,
    recoveredRows:rows.filter(row=>row.original.origin==='RECOVERED_ORIGINAL_SF31_OUTCOME').length,
    testnetRows:rows.filter(row=>row.original.network==='stellar:testnet').length,
    publicNetworkRows:rows.filter(row=>row.original.network==='stellar:pubnet').length,
    officialTransferMatches:rows.filter(row=>row.original.transfer==='OFFICIAL_TRANSFER_MATCHED').length,
    missingLabelRows:rows.filter(row=>LABEL_FIELDS.some(field=>row.label[field]==='')).length,
    ...(adjustmentSnapshot?{adjustments:adjustmentSnapshot.summary}:{})};
  return seal({schema:HANDOFF_SCHEMA,id,name,actor,createdAt,source:retainedSource,
    sourceHashes:copy(report.hashes),sourceAccountingStatus:report.accountingStatus??null,
    sourceOptions:copy(report.options),labels:[...labelMap].map(([optionId,label])=>({optionId,...label})),rows,summary});
}

export function validateHandoff(handoff){
  verifySeal(handoff,HANDOFF_SCHEMA);identifier(handoff.id,'Handoff ID');
  check(plain(handoff.source)&&HEX.test(handoff.source.reportSha256)&&Array.isArray(handoff.rows)&&handoff.rows.length<=MAX_ROWS,'INVALID_HANDOFF','The handoff has invalid source or rows.');
  if(handoff.source.adjustments)check(HEX.test(handoff.source.adjustments.sha256)&&Number.isSafeInteger(handoff.source.adjustments.bytes)&&
    handoff.source.adjustments.bytes>0,'INVALID_HANDOFF','Retain the complete original adjustment source descriptor.');
  const seen=new Set();for(const row of handoff.rows){
    check(plain(row)&&HEX.test(row.rowId)&&HEX.test(row.eventId)&&plain(row.original)&&row.original.eventId===row.eventId&&
      row.rowId===rowIdentity(handoff.id,handoff.source.reportSha256,row.eventId)&&row.sourceRowSha256===sha(canonical(row.original))&&plain(row.label),
      'HANDOFF_ROW_CHANGED','A retained source row changed.',409);
    if(handoff.source.adjustments)validateAccountantAdjustmentRow(row);
    check(!seen.has(row.rowId),'DUPLICATE_HANDOFF_ROW','A handoff source row is repeated.');seen.add(row.rowId);
  }
  return handoff;
}
function validateAssignment(assignment,row){
  check(plain(assignment)&&assignment.rowId===row.rowId&&assignment.eventId===row.eventId,'ASSIGNMENT_IDENTITY_CHANGED','A retained accountant assignment is bound to another source row.',409);
  check(EXTERNAL_STATUSES.includes(assignment.externalStatus),'INVALID_EXTERNAL_STATUS','Choose an available accountant-reported status.');
  shortText(assignment.externalBookRef,'External book reference',200,{empty:true});
  shortText(assignment.externalAccountCode,'External account code',160,{empty:true});
  shortText(assignment.externalNote,'External note',4000,{empty:true,multiline:true});
  check(assignment.externalStatus!=='BOOKED'||assignment.externalBookRef.trim().length>0,'BOOK_REFERENCE_REQUIRED','A BOOKED return needs the accountant’s external book reference.');
}
export function validateRevision(handoff,revision){
  validateHandoff(handoff);verifySeal(revision,RETURN_SCHEMA);identifier(revision.id,'Import revision ID');
  check(revision.handoffId===handoff.id&&revision.handoffSha256===handoff.integrity.sha256&&revision.sourceReportSha256===handoff.source.reportSha256,
    'RETURN_SOURCE_MISMATCH','The accountant return belongs to another handoff.',409);
  check(Array.isArray(revision.assignments)&&revision.assignments.length===handoff.rows.length,'INVALID_ASSIGNMENTS','A retained import must cover every original handoff row.');
  const sources=new Map(handoff.rows.map(row=>[row.rowId,row])),seen=new Set();
  for(const assignment of revision.assignments){const row=sources.get(assignment.rowId);check(row&&!seen.has(assignment.rowId),'INVALID_ASSIGNMENTS','The retained assignment source is missing or repeated.');validateAssignment(assignment,row);seen.add(assignment.rowId);}
  return revision;
}
function assignmentsFor(handoff,revision){
  if(revision!==undefined&&revision!==null){validateRevision(handoff,revision);return new Map(revision.assignments.map(row=>[row.rowId,row]));}
  return new Map(handoff.rows.map(row=>[row.rowId,defaultAssignment(row)]));
}
function protectedValues(handoff,row){
  const values={handoffId:handoff.id,sourceRunId:handoff.source.runId,sourceReportSha256:handoff.source.reportSha256,
    sourcePeriodCloseId:handoff.source.periodClose?.id??null,sourcePeriodCloseSha256:handoff.source.periodClose?.sha256??null,
    sourcePeriodCloseRevision:handoff.source.periodClose?.revision??null,rowId:row.rowId,sourceRowSha256:row.sourceRowSha256};
  for(const key of SOURCE_FIELDS)values[key]=row.original[key];
  for(const key of LABEL_FIELDS)values[key]=row.label[key];
  if(handoff.source.adjustments)Object.assign(values,row.adjustments,{sourceAdjustmentsSha256:handoff.source.adjustments.sha256});
  return Object.fromEntries(protectedColumns(handoff).map(key=>[key,cell(values[key])]));
}

// Apostrophe is a reversible spreadsheet-display escape, including for literal
// leading apostrophes. Original source values remain intact in the sealed record.
const longNumericText=value=>/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/.test(value)&&value.replace(/\D/g,'').length>15;
const needsSpreadsheetEscape=value=>/^['\t\r\n]/.test(value)||/^\s*[=+\-@]/u.test(value)||longNumericText(value);
const spreadsheetEncode=value=>needsSpreadsheetEscape(value)?"'"+value:value;
const spreadsheetDecode=value=>value.startsWith("'")&&needsSpreadsheetEscape(value.slice(1))?value.slice(1):value;
const quoteCsv=value=>'"'+spreadsheetEncode(cell(value)).replace(/"/g,'""')+'"';
export function renderCsv(handoff,revision){
  validateHandoff(handoff);const assignments=assignmentsFor(handoff,revision),columns=accountantColumns(handoff),lines=[columns.map(quoteCsv).join(',')];
  for(const row of handoff.rows){const values={...protectedValues(handoff,row),...assignments.get(row.rowId)};lines.push(columns.map(key=>quoteCsv(values[key])).join(','));}
  return Buffer.from(lines.join('\r\n')+'\r\n','utf8');
}

/** RFC-4180-style records, preserving quoted newlines and precise text fields. */
export function parseReturnCsv(csvBytes,{columns=CSV_COLUMNS}={}){
  const raw=bytes(csvBytes,MAX_CSV_BYTES,'Accountant CSV'),text=utf8(raw,'Accountant CSV').replace(/^\uFEFF/,'');
  check(!text.includes('\u0000'),'INVALID_CSV','The CSV contains a NUL character.');
  const records=[];let values=[],value='',quoted=false,closed=false,started=false,line=1,startLine=1;
  const field=()=>{values.push(value);value='';closed=false;started=false;check(values.length<=columns.length+8,'TOO_MANY_COLUMNS','The CSV has too many columns.');};
  const record=()=>{field();records.push({rowNumber:records.length+1,lineNumber:startLine,values});values=[];check(records.length<=MAX_RETURN_ROWS+1,'TOO_MANY_RETURN_ROWS','The CSV exceeds '+MAX_RETURN_ROWS+' return rows.');};
  for(let i=0;i<text.length;i++){
    const character=text[i];
    if(quoted){
      if(character==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}
      else{value+=character;if(character==='\n')line++;else if(character==='\r'&&text[i+1]!=='\n')line++;}
    }else if(closed){
      if(character===',')field();
      else if(character==='\r'||character==='\n'){if(character==='\r'&&text[i+1]==='\n')i++;record();line++;startLine=line;}
      else throw new AccountantError('INVALID_CSV','Unexpected text after a closing quote on line '+line+'.');
    }else if(character==='"'){
      check(!started&&value.length===0,'INVALID_CSV','A quote appears inside an unquoted field on line '+line+'.');quoted=true;started=true;
    }else if(character===',')field();
    else if(character==='\r'||character==='\n'){if(character==='\r'&&text[i+1]==='\n')i++;record();line++;startLine=line;}
    else{started=true;value+=character;}
    check(value.length<=32_000,'CSV_FIELD_TOO_LARGE','A CSV field exceeds the supported text size.');
  }
  check(!quoted,'INVALID_CSV','The CSV ends inside a quoted field.');
  if(closed||started||value.length||values.length)record();
  while(records.length&&records.at(-1).values.every(item=>item===''))records.pop();
  check(records.length>0,'CSV_HEADER_REQUIRED','Use the exported accountant template.');
  const headers=records[0].values,seen=new Set();
  for(const header of headers){check(!seen.has(header),'DUPLICATE_CSV_HEADER','A CSV column is repeated: '+header);seen.add(header);}
  const missing=columns.filter(column=>!seen.has(column)),unknown=headers.filter(column=>!columns.includes(column));
  check(missing.length===0&&unknown.length===0,'CSV_COLUMNS_CHANGED','Use all original template columns; their order may change.',400,{missing,unknown});
  return {sha256:sha(raw),bytes:raw.length,headers,records:records.slice(1),blankRows:records.slice(1).filter(row=>row.values.every(item=>item==='')).length};
}

function editsFrom(values,previous){
  const output={};for(const key of EDITABLE_COLUMNS){const incoming=values[key];output[key]=incoming===spreadsheetEncode(previous[key])?previous[key]:spreadsheetDecode(incoming);}
  if(output.externalStatus==='')output.externalStatus='UNREVIEWED';
  validateAssignment({...previous,...output},previous);return output;
}
function issue(code,message,record,extra={}){return {code,message,rowNumber:record.rowNumber,lineNumber:record.lineNumber,...extra};}

/** Compare a returned template to frozen source; merge valid rows into its parent. */
export function importReturn({handoff,csvBytes,actor,name,parentRevision=null,createdAt=new Date().toISOString(),id=randomUUID()}={}){
  validateHandoff(handoff);identifier(id,'Import revision ID');shortText(actor,'Operator',1000);shortText(name,'Import name');timestamp(createdAt);
  if(parentRevision){validateRevision(handoff,parentRevision);check(parentRevision.id!==id,'DUPLICATE_REVISION_ID','Use a new immutable import revision ID.');}
  const parsed=parseReturnCsv(csvBytes,{columns:accountantColumns(handoff)}),assignments=assignmentsFor(handoff,parentRevision);
  const byId=new Map(handoff.rows.map(row=>[row.rowId,row])),byEvent=new Map(handoff.rows.map(row=>[row.eventId,row]));
  const returned=[],touches=new Map(),touched=new Set();
  for(const record of parsed.records){
    if(record.values.every(value=>value===''))continue;
    const values=Object.fromEntries(parsed.headers.map((header,index)=>[header,record.values[index]??'']));
    const row=byId.get(spreadsheetDecode(values.rowId)),eventRow=byEvent.get(spreadsheetDecode(values.eventId)),targets=[...new Set([row?.rowId,eventRow?.rowId].filter(Boolean))];
    for(const target of targets){touches.set(target,(touches.get(target)??0)+1);touched.add(target);}
    returned.push({...record,fieldCount:record.values.length,values,row,eventRow,targets});
  }
  const results=[],issues=[];let appliedRows=0,unchangedRows=0,conflictRows=0,unknownRows=0;
  for(const record of returned){
    const result={rowNumber:record.rowNumber,lineNumber:record.lineNumber,rowId:record.values.rowId||null,eventId:record.values.eventId||null,status:null,issues:[]};
    const add=value=>{result.issues.push(value);issues.push(value);};
    if(record.values&&record.targets.length===0){result.status='UNKNOWN_ROW';unknownRows++;add(issue('UNKNOWN_ROW','This row does not identify an event in the selected handoff.',record,{rowId:result.rowId,eventId:result.eventId}));}
    else if(record.values&&record.targets.some(target=>touches.get(target)>1)){
      result.status='DUPLICATE_ROW';conflictRows++;add(issue('DUPLICATE_ROW','Every repeated target is preserved from the previous revision; keep one returned row per event.',record,{rowId:result.rowId,eventId:result.eventId,affectedRowIds:record.targets}));
    }else if(record.values&&record.row&&record.eventRow&&record.row.rowId===record.eventRow.rowId){
      const row=record.row,expected=protectedValues(handoff,row);
      // Field-count errors remain local to the row, so other valid rows can import.
      if(record.fieldCount!==parsed.headers.length){result.status='ROW_LENGTH_MISMATCH';conflictRows++;add(issue('ROW_LENGTH_MISMATCH','This row has a different number of fields from the template.',record,{rowId:row.rowId,eventId:row.eventId,expected:parsed.headers.length,received:record.fieldCount}));}
      else {
        const changed=protectedColumns(handoff).filter(key=>record.values[key]!==expected[key]&&spreadsheetDecode(record.values[key])!==expected[key]);
        if(changed.length){result.status='PROTECTED_VALUE_CONFLICT';conflictRows++;add(issue('PROTECTED_VALUE_CONFLICT','Original identity, amounts, classifications and retained labels must match the exported source.',record,{rowId:row.rowId,eventId:row.eventId,fields:changed.map(field=>({field,expected:expected[field],received:record.values[field]}))}));}
        else {
          const previous=assignments.get(row.rowId);let edits;
          try{edits=editsFrom(record.values,previous);}catch(error){if(!(error instanceof AccountantError))throw error;result.status='INVALID_EDIT';conflictRows++;add(issue(error.code,error.message,record,{rowId:row.rowId,eventId:row.eventId}));}
          if(edits){
            const changed=EDITABLE_COLUMNS.some(key=>edits[key]!==previous[key]);
            result.status=changed?'APPLIED':'UNCHANGED';
            if(changed){assignments.set(row.rowId,{...previous,...edits,updatedAt:createdAt,updatedBy:actor,revisionId:id});appliedRows++;}else unchangedRows++;
          }
        }
      }
    }else{result.status='IDENTITY_CONFLICT';conflictRows++;add(issue('IDENTITY_CONFLICT','The row ID and event ID do not identify the same frozen source row.',record,{rowId:result.rowId,eventId:result.eventId,affectedRowIds:record.targets}));}
    results.push(result);
  }
  const merged=handoff.rows.map(row=>copy(assignments.get(row.rowId)));
  const missingRows=handoff.rows.filter(row=>!touched.has(row.rowId)).map(row=>({rowId:row.rowId,eventId:row.eventId,externalStatus:assignments.get(row.rowId).externalStatus}));
  const summary={totalRows:handoff.rows.length,returnedRows:returned.length,appliedRows,unchangedRows,conflictRows,unknownRows,missingRows:missingRows.length,
    ignoredBlankRows:parsed.blankRows,unreviewedRows:merged.filter(row=>row.externalStatus==='UNREVIEWED').length,
    reviewedRows:merged.filter(row=>row.externalStatus==='REVIEWED').length,bookedRows:merged.filter(row=>row.externalStatus==='BOOKED').length,
    excludedRows:merged.filter(row=>row.externalStatus==='EXCLUDED').length,
    outcome:conflictRows||unknownRows?'CONFLICTS':missingRows.length?'PARTIAL':'COMPLETE'};
  return seal({schema:RETURN_SCHEMA,id,handoffId:handoff.id,handoffSha256:handoff.integrity.sha256,
    sourceReportSha256:handoff.source.reportSha256,parentRevisionId:parentRevision?.id??null,parentRevisionSha256:parentRevision?.integrity.sha256??null,
    createdAt,actor,name,importSha256:parsed.sha256,importBytes:parsed.bytes,assignments:merged,results,issues,missingRows,summary});
}

/** Complete inspection data; callers may page rows before sending it to a UI. */
export function inspectHandoff(handoff,revision){
  validateHandoff(handoff);const assignments=assignmentsFor(handoff,revision);
  return {schema:HANDOFF_SCHEMA,id:handoff.id,name:handoff.name,actor:handoff.actor,createdAt:handoff.createdAt,
    handoff:{schema:HANDOFF_SCHEMA,id:handoff.id,name:handoff.name,actor:handoff.actor,createdAt:handoff.createdAt,integrity:copy(handoff.integrity)},
    source:copy(handoff.source),sourceHashes:copy(handoff.sourceHashes),sourceOptions:copy(handoff.sourceOptions),
    summary:copy(handoff.summary),revision:revision?{id:revision.id,parentRevisionId:revision.parentRevisionId,createdAt:revision.createdAt,actor:revision.actor,name:revision.name,summary:copy(revision.summary),importSha256:revision.importSha256}:null,
    rows:handoff.rows.map(row=>({...copy(row),...copy(assignments.get(row.rowId))})),issues:copy(revision?.issues??[]),missingRows:copy(revision?.missingRows??[])};
}
const adjustmentAmounts=row=>row.adjustments?'<br><small>Returned '+html(row.adjustments.refundedAmountAtomic)+' · remaining '+html(row.adjustments.remainingAmountAtomic)+'<br>Pending return '+html(row.adjustments.pendingRefundAmountAtomic)+' · cancelled '+html(row.adjustments.cancelledAmountAtomic)+'<br>'+html(row.adjustments.refundStatus)+(row.adjustments.latestRefundTransferAt?'<br>Latest native refund '+html(row.adjustments.latestRefundTransferAt):'')+(row.adjustments.latestCancellationEffectiveAt?'<br>Latest cancellation '+html(row.adjustments.latestCancellationEffectiveAt):'')+'</small>':'';
const html=value=>cell(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function renderHtml(handoff,revision){
  const view=inspectHandoff(handoff,revision),source=handoff.source,summary=revision?.summary;
  const rows=view.rows.map(row=>{const original=row.original;return '<tr><td><strong>'+html(original.routeId)+'</strong><br>'+html(original.method)+'<br><small>'+html(row.eventId)+'</small></td><td>'+html(original.network)+'<br>'+html(original.verificationScope)+'<br>'+html(original.transfer)+'<br>'+html(original.delivery)+'</td><td>'+html(original.amountAtomic)+' <small>atomic units</small>'+adjustmentAmounts(row)+'<br>'+html(row.label.assetLabel)+' / '+html(row.label.unitLabel)+'<br><small>Asset '+html(original.assetDigest)+'<br>Option '+html(original.optionId)+'</small></td><td>'+html(original.at)+'<br>'+html(original.timeBasis)+'<br><small>'+html(original.origin)+'</small></td><td>'+html(original.merchantQuoteUsd??'Unknown')+'<br><small>'+html(original.merchantPriceBasis??'Quote basis unavailable')+'</small></td><td>'+html(row.externalStatus)+'<br>'+html(row.externalBookRef)+'<br>'+html(row.externalAccountCode||row.label.accountCode)+'<br><small>'+html(row.label.accountName)+'</small></td><td class="note">'+html(row.externalNote)+'<br><small>'+html(row.updatedBy??'')+' '+html(row.updatedAt??'')+'</small></td></tr>';}).join('');
  const issues=(revision?.issues??[]).map(item=>'<tr><td>'+html(item.rowNumber)+'</td><td>'+html(item.code)+'</td><td>'+html(item.message)+(item.fields?'<br><small>'+item.fields.map(field=>html(field.field)+': '+html(field.received)+' (source '+html(field.expected)+')').join('<br>')+'</small>':'')+'</td></tr>').join('');
  return Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html(handoff.name)+' — accountant handoff</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:28px;font:14px/1.5 system-ui,sans-serif;color:#171717;background:#fff}main{max-width:1600px;margin:auto}h1{font-size:25px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 10px}p{max-width:1050px}small{font-size:11px;color:#555;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:160px 1fr;gap:5px 16px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.summary{border:1px solid #aaa;padding:14px 18px;margin:18px 0;display:flex;gap:24px;flex-wrap:wrap}.summary strong{display:block;font-size:21px}.table{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border:1px solid #b7b7b7;padding:9px;overflow-wrap:anywhere}th{background:#ededed;font-size:12px}td.note{white-space:pre-wrap;min-width:160px}code{font-size:12px;overflow-wrap:anywhere}@media print{body{padding:0;font-size:10px}thead{display:table-header-group}tr{break-inside:avoid}.table{overflow:visible}th,td{padding:5px}small{font-size:9px}}</style></head><body><main><h1>'+html(handoff.name)+'</h1><p>Accountant return for the original merchant settlement reconciliation. Original payment evidence, native amounts and merchant quotes stay attached to each event. External status, book reference, account code and notes record the accountant’s returned information.</p><dl><dt>Handoff</dt><dd>'+html(handoff.id)+'</dd><dt>Prepared</dt><dd>'+html(handoff.createdAt)+' · '+html(handoff.actor)+'</dd><dt>Reconciliation</dt><dd>'+html(source.runId)+'</dd><dt>Original report SHA256</dt><dd><code>'+html(source.reportSha256)+'</code></dd>'+(source.periodClose?'<dt>Original period close</dt><dd>'+html(source.periodClose.id)+' · revision '+html(source.periodClose.revision)+'<br><code>'+html(source.periodClose.sha256)+'</code></dd>':'')+(source.adjustments?'<dt>Adjustment snapshot</dt><dd>'+html(source.adjustments.exportedAt)+' · revision '+html(source.adjustments.workspaceRevision)+'<br><code>'+html(source.adjustments.sha256)+'</code></dd>':'')+(revision?'<dt>Accountant return</dt><dd>'+html(revision.name)+' · '+html(revision.id)+' · '+html(revision.createdAt)+'<br>'+html(revision.actor)+' · '+html(summary.outcome)+'</dd><dt>Returned CSV SHA256</dt><dd><code>'+html(revision.importSha256)+'</code></dd>':'')+'</dl><div class="summary"><span><strong>'+view.summary.totalRows+'</strong>Source events</span><span><strong>'+view.summary.testnetRows+'</strong>Testnet events</span><span><strong>'+view.summary.publicNetworkRows+'</strong>Public-network events</span>'+(summary?'<span><strong>'+summary.bookedRows+'</strong>Accountant marked BOOKED</span><span><strong>'+summary.conflictRows+'</strong>Conflicting return rows</span><span><strong>'+summary.missingRows+'</strong>Rows omitted from this return</span>':'')+'</div><p>Amounts below use the original asset’s atomic units. Asset and account labels were supplied for this handoff. Merchant quote USD is the original quote field. BOOKED records the accountant’s reported external entry and requires its book reference. A webhook acceptance and a testnet transfer keep their original classifications.</p><h2>Complete handoff and current assignments</h2><div class="table"><table><thead><tr><th>Resource / original event</th><th>Network and original evidence</th><th>Original amount and unit identity</th><th>Source time</th><th>Merchant quote USD</th><th>Accountant status / book / account</th><th>Accountant note</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(issues?'<h2>Return conflicts and unmatched rows</h2><p>These rows retain their preceding assignments. Missing rows also retain their preceding assignments; a later return may complete them.</p><div class="table"><table><thead><tr><th>CSV row</th><th>Code</th><th>Detail</th></tr></thead><tbody>'+issues+'</tbody></table></div>':'')+'<h2>Return template</h2><p>Edit only <code>'+EDITABLE_COLUMNS.join(', ')+'</code>. Available statuses: '+EXTERNAL_STATUSES.join(', ')+'. Keep native amount strings, original identity columns and supplied labels intact. Partial returns preserve omitted events. Shared external book references are supported for batch entries.</p></main></body></html>','utf8');
}
