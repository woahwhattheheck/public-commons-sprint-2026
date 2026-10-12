// MIT. Preserve the maintained SMB statement parsers through a fixed private pipe.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha,json,need,plain,currencyOf,money,dateValue} from './core.mjs';
const clone=value=>structuredClone(value);
const BRIDGE=fileURLToPath(new URL('./bank-parsers/bridge.py',import.meta.url));
function parserRun(request) {
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',['-I','-B',BRIDGE],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const chunks=[];let bytes=0,stderrBytes=0,done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const problem=(code,message)=>Object.assign(new Error(message),{code,status:400});
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(problem('BANK_PARSER_TIMEOUT','The original statement parser exceeded its10-second source budget.'));},10_000);
    child.on('error',error=>finish(problem(error.code==='ENOENT'?'BANK_PARSER_PYTHON_REQUIRED':'BANK_PARSER_START_FAILED',
      error.code==='ENOENT'?'Install Python3.10 or later to read original OFX/MT940 sources; CSV uses the native Node reader.':'The original statement parser could not start.')));
    child.stdout.on('data',part=>{bytes+=part.length;if(bytes>16_000_000){child.kill('SIGKILL');finish(problem('BANK_PARSER_REPORT_LIMIT','The original parsed statement report exceeds16MB.'));}else chunks.push(part);});
    child.stderr.on('data',part=>{stderrBytes+=part.length;if(stderrBytes>65536)child.kill('SIGKILL');});
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')finish(problem('BANK_PARSER_PIPE_FAILED','The private original statement pipe failed.'));});
    child.on('close',()=>{
      if(done)return;
      let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return finish(problem('BANK_PARSER_RESPONSE_FAILED','The original statement parser did not return a complete source report.'));}
      if(value?.ok!==true) {
        const error=problem('BANK_SOURCE_'+String(value?.error?.code??'PARSE_FAILED'),
          'The original statement parser rejected this source: '+String(value?.error?.code??'PARSE_FAILED')+'.');
        error.details=clone(value?.error??{});return finish(error);
      }
      finish(null,{report:value.report,metadata:value.metadata??{}});
    });
    child.stdin.end(JSON.stringify(request));
  });
}
export function normalizeStatementOptions(format,value,account=null) {
  if(format==='OFX') {
    need(value==null||plain(value)&&Object.keys(value).length===0,'BANK_STATEMENT_OPTIONS_NOT_APPLICABLE','OFX retains its original declared encoding and posted dates.');
    return null;
  }
  need(format==='MT940'&&plain(value),'BANK_MT940_OPTIONS_REQUIRED','Choose the original MT940 transport, encoding, century window and debit/reversal profile.');
  const {profile,encoding,debitCreditProfile,yearWindowStart,dateBasis}=value;
  need(['TEXT_BODY','FIN_ENVELOPE'].includes(profile)&&['ASCII','UTF-8','ISO-8859-1'].includes(encoding)&&
    ['CD_ONLY','CD_REVERSALS'].includes(debitCreditProfile)&&Number.isInteger(yearWindowStart)&&yearWindowStart>=1900&&yearWindowStart<=2000&&
    dateBasis==='VALUE_DATE','BANK_MT940_OPTIONS_REQUIRED','Use an explicit MT940 century window and complete original VALUE_DATE as the received-date basis.');
  const currencyScales={};
  need(value.currencyScales==null||plain(value.currencyScales),'BANK_CURRENCY_SCALES_REQUIRED','Map source currency codes to their exact decimal precision.');
  for(const [code,scale]of Object.entries(value.currencyScales??{}))currencyScales[currencyOf({code,scale}).code]=scale;
  if(account) {
    need(currencyScales[account.currency.code]===undefined||currencyScales[account.currency.code]===account.currency.scale,
      'BANK_CURRENCY_SCALE_MISMATCH','The original account precision differs from the selected source currency mapping.');
    currencyScales[account.currency.code]=account.currency.scale;
  }
  need(Object.keys(currencyScales).length>0&&Object.keys(currencyScales).length<=32,'BANK_CURRENCY_SCALES_REQUIRED',
    'Choose an original account or supply explicit scales for the MT940 source currencies.');
  return {profile,encoding,debitCreditProfile,yearWindowStart,dateBasis,currencyScales};
}
function ofxSections(report,metadata) {
  const sections=[],findings=report.findings??[],handoffRefs=new Set(report.handoff.flatMap(row=>row.source_refs.slice(0,1)));
  for(const [accountKey,entry]of Object.entries(report.accounts))for(const currencyCode of entry.currencies) {
    const account=entry.identity.account,kind=entry.identity.kind==='CREDITCARD'?'CREDIT_CARD':'BANK',
      id=sha(json({kind,account,currencyCode})),occurrences=[...report.occurrences.filter(row=>row.account_key===accountKey&&row.currency===currencyCode),
        ...report.pending_observations.filter(row=>row.account_key===accountKey&&row.currency===currencyCode)];
    const byFitid=new Map(),children=new Map();
    for(const item of occurrences)if(!item.row.pending) {
      const fitid=item.row.raw.FITID;
      if(!byFitid.has(fitid))byFitid.set(fitid,[]);byFitid.get(fitid).push(item);
      if(item.row.raw.CORRECTACTION==='REPLACE') {
        const target=item.row.raw.CORRECTFITID;
        if(!children.has(target))children.set(target,new Set());children.get(target).add(fitid);
      }
    }
    const graphProblem=(fitid,target)=>{
      if(!target||fitid===target)return 'OFX_CORRECTION_SELF_REFERENCE';
      if((children.get(target)?.size??0)>1)return 'OFX_CORRECTION_BRANCH';
      const seen=new Set([fitid]);let current=target;
      while(current) {
        if(seen.has(current))return 'OFX_CORRECTION_CYCLE';seen.add(current);
        const targets=[...new Set((byFitid.get(current)??[]).filter(item=>item.row.raw.CORRECTACTION==='REPLACE')
          .map(item=>item.row.raw.CORRECTFITID))];
        if(targets.length>1)return 'OFX_CORRECTION_BRANCH';
        current=targets[0]??null;
      }
      return null;
    };
    const rows=occurrences.map((occurrence,index)=>{
      const row=occurrence.row,raw=row.raw,pending=row.pending===true,correction=raw.CORRECTACTION??null,
        review=report.fitid_review.find(item=>item.account_key===accountKey&&item.fitid===raw.FITID),
        reasons=review?.reasons??[],equivalent=byFitid.get(raw.FITID)??[occurrence],
        sourceCurrency=Boolean(raw.CURRENCY||raw.ORIGCURRENCY),
        targetOnly=!correction&&reasons.includes('CORRECTION_OR_CURRENCY_REVIEW'),
        issue=correction==='REPLACE'?graphProblem(raw.FITID,raw.CORRECTFITID):null,
        typedSignature=metadata.ofxOccurrenceSignatures?.[occurrence.ref],
        hardReview=reasons.some(code=>['FITID_CONFLICT','ACCOUNT_HOLD','SOURCE_STATUS_REVIEW'].includes(code)),
        allowed=equivalent.every(item=>item.source_status_ok)&&!pending&&!sourceCurrency&&
          correction!=='DELETE'&&!targetOnly&&!hardReview&&!issue&&
          (!correction||correction==='REPLACE'&&raw.CORRECTFITID),
        representative=[...equivalent].sort((a,b)=>a.ref.localeCompare(b.ref))[0],
        duplicateOnly=allowed&&occurrence.ref!==representative.ref,
        posted=row.dates.DTPOSTED??row.dates.DTTRAN,sourceIssues=[
          ...reasons,...(pending?['PENDING_OBSERVATION']:[]),...(correction?['OFX_'+correction]:[]),
          ...(issue?[issue]:[]),...(duplicateOnly?['DUPLICATE_SOURCE_OCCURRENCE']:[])],
        originalSourceOccurrences=(occurrence.ref===representative.ref?equivalent:[occurrence]).map(item=>({
          ref:item.ref,sourceStatusOk:item.source_status_ok,typedRowSha256:metadata.ofxOccurrenceSignatures?.[item.ref]}));
      need(typeof typedSignature==='string'&&/^[a-f0-9]{64}$/.test(typedSignature),'BANK_PARSER_SIGNATURE_MISSING',
        'The original OFX parser must bind the complete selected typed occurrence.');
      return {rowNumber:index+1,lineNumber:row.source_line,raw:{values:[],fields:clone(raw),text:null},
        bookedDate:posted.local_date,valueDate:row.dates.DTAVAIL?.local_date??null,dateBasis:'OFX_DTPOSTED',
        amount:row.amount,transactionId:pending?null:raw.FITID,bankReference:raw.REFNUM??raw.SRVRTID??raw.CHECKNUM??'',
        reference:raw.MEMO??raw.REFNUM??raw.CHECKNUM??'',counterparty:raw.NAME??raw.PAYEE?.NAME??'',
        invoiceReference:'',balance:null,sourceEligible:Boolean(allowed&&!duplicateOnly),sourceIssues,
        requiresSourceResolution:Boolean(allowed&&(reasons.length||correction)),
        replacesTransactionIds:raw.CORRECTFITID?[raw.CORRECTFITID]:[],sourceOccurrence:occurrence.ref,
        sourceIdentity:clone({accountKey,currency:currencyCode,fitid:raw.FITID??null,correctionAction:correction,
          correctsFitid:raw.CORRECTFITID??null,typedRowSha256:typedSignature,sourceRef:occurrence.ref,
          equivalentOccurrenceCount:equivalent.length,sourceStatusOk:occurrence.source_status_ok,
          targetPresentInSource:Boolean(raw.CORRECTFITID&&(byFitid.get(raw.CORRECTFITID)?.length??0)>0)}),
        originalDates:clone(row.dates),originalSourceOccurrences};
    });
    const statements=report.sources.flatMap(source=>source.parsed.statements).filter(statement=>
      statement.kind===entry.identity.kind&&statement.currency===currencyCode&&
      Object.entries(account).every(([key,value])=>statement.account[key]===value));
    const windows=statements.map(row=>row.download_window).filter(Boolean);
    sections.push({id,kind,bankId:account.BANKID??null,accountReference:account.ACCTID,currencyCode,
      sourceAccountIdentity:clone(account),from:windows.map(row=>row.start.local_date).sort()[0]??null,
      until:windows.map(row=>row.end.local_date).sort().at(-1)??null,openingBalance:null,
      closingBalance:statements.length===1?{date:statements[0].ledger_balance.asof.local_date,amount:statements[0].ledger_balance.amount}:null,
      balanceSnapshots:clone(entry.snapshots),rows});
  }
  return {sections,issues:findings.map(row=>({code:row.code,message:row.detail,sourceRefs:clone(row.refs),level:row.level}))};
}
function mt940Sections(report,options) {
  const groups=new Map();
  for(const page of report.pages) {
    const original=page.data,accountReference=original.account,currencyCode=original.opening.currency,
      id=sha(json({kind:'BANK',accountReference,currencyCode}));
    if(!groups.has(id))groups.set(id,{id,kind:'BANK',bankId:null,accountReference,currencyCode,from:original.opening.date,
      until:original.closing.date,openingBalance:null,closingBalance:null,balanceSnapshots:[],sourceAccountIdentity:{account:accountReference},rows:[]});
    const section=groups.get(id),currency={code:currencyCode,scale:options.currencyScales[currencyCode]},occurrence=page.occurrences[0],
      pairs=original.raw_fields.map((record,index)=>record.tag==='61'?[record,...(original.raw_fields[index+1]?.tag==='86'?[original.raw_fields[index+1]]:[])]:null).filter(Boolean);
    section.from=[section.from,original.opening.date].sort()[0];section.until=[section.until,original.closing.date].sort().at(-1);
    section.balanceSnapshots.push({pageSha256:page.page_sha256,identity:clone(page.identity),
      opening:{date:original.opening.date,amount:money(BigInt(original.opening.minor),currency)},
      closing:{date:original.closing.date,amount:money(BigInt(original.closing.minor),currency)}});
    for(const transaction of original.transactions) {
      const rawPair=pairs[transaction.ordinal-1]??[],sourceIdentity={format:'MT940',statementIdentity:page.identity,ordinal:transaction.ordinal};
      section.rows.push({rowNumber:section.rows.length+1,lineNumber:occurrence.transaction_lines[transaction.ordinal-1],
        raw:{values:[],fields:clone(transaction),text:rawPair.map(row=>':'+row.tag+':'+row.lines.join('\n')).join('\n')},
        bookedDate:transaction.value_date,valueDate:transaction.value_date,dateBasis:'MT940_VALUE_DATE',
        amount:money(BigInt(transaction.amount_minor),currency),transactionId:null,
        bankReference:transaction.bank_reference??'',reference:transaction.owner_reference,
        counterparty:'',invoiceReference:'',balance:null,
        narrative:transaction.narrative_lines.join('\n'),sourceEligible:true,
        sourceIssues:clone(page.findings),requiresSourceResolution:page.findings.length>0,
        sourceIdentity,sourceIdentityKey:sha(json(sourceIdentity)),sourcePageSha256:page.page_sha256,
        originalEntryMonthDay:transaction.entry_mmdd,originalSourceOccurrences:clone(page.occurrences)});
    }
  }
  for(const section of groups.values())if(section.balanceSnapshots.length===1) {
    section.openingBalance=section.balanceSnapshots[0].opening;section.closingBalance=section.balanceSnapshots[0].closing;
  }
  return {sections:[...groups.values()],issues:report.findings.map(row=>({code:row.code,message:row.detail||row.code,sourcePages:clone(row.pages)}))};
}
export async function parseOriginalBankStatement(bytes,format,{account=null,statementOptions=null}={}) {
  const options=normalizeStatementOptions(format,statementOptions,account),scope=account?.id??'bank-inspection',
    source=Buffer.from(bytes),sourceName=format==='OFX'?'source.ofx':'source.mt940';
  let plan;
  if(format==='OFX')plan={schema:'ofx-intake-plan/v1',sources:[{file:sourceName,institution:scope}]};
  else plan={schema:'mt940-intake-plan/2',institution_scope:scope,year_window_start:options.yearWindowStart,
    currency_scales:options.currencyScales,complete_export_set:false,sources:[{id:'source',file:sourceName,
      sha256:sha(source),bytes:source.length,profile:options.profile,encoding:options.encoding,debit_credit_profile:options.debitCreditProfile}]};
  const original=await parserRun({format,sourceBase64:source.toString('base64'),plan}),report=original.report,
    parsed=format==='OFX'?ofxSections(report,original.metadata):mt940Sections(report,options);
  return {...parsed,layout:null,columns:[],requiresLayout:false,statementOptions:options,parserReport:report};
}
