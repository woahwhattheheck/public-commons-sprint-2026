// MIT. Original accounting lease, retained bank source files and atomic receipt reconciliation.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {json,sha,need,plain,field,identifier,dateValue,today,currencyKey,receiptSummary,invoiceSummary} from './core.mjs';
import {BANK_SOURCE_BYTES,BANK_SOURCE_ROWS,BANK_DERIVED_BYTES,BANK_IMPORT_SCHEMA,BANK_POSTING_SCHEMA,BANK_FILE_NAMES,
  bankAccountRows,bankImportRows,bankPage,bankHash,normalizeBankAccount,bankAccountSummary,
  inspectBankInput,normalizedBankSourceFiles,bankMatchIndex,bankSourceMatches,bankCurrentReceipts,bankRowDecision,bankRowStatus,
  bankImportSummary,bankRowView,compileBankPosting,bankPostingInput,applyBankPostingChanges,bankPostingDocuments} from './bank-receipts.mjs';
const FILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const clone=value=>structuredClone(value),at=()=>new Date().toISOString();
const sourceIndex=row=>Object.fromEntries(['id','transactionKey','replacesTransactionKeys','economicKey','amount','bookedDate','kind',
  'cashSource','sourceEligible','requiresSourceResolution','transactionIdentity','sourceIdentity'].filter(key=>row[key]!==undefined).map(key=>[key,clone(row[key])]));
async function syncDirectory(path) {
  const handle=await open(path,constants.O_RDONLY|(constants.O_DIRECTORY??0)|(constants.O_NOFOLLOW??0));
  try {await handle.sync();}finally{await handle.close();}
}
function parsed(bytes,label) {
  try{return JSON.parse(bytes.toString('utf8'));}
  catch{need(false,'BANK_RETAINED_JSON_CHANGED','The retained '+label+' is not valid JSON.',409);}
}
function textSearch(query) {return query.search==null?'':field(query.search,'bank search',300,true).toLocaleLowerCase();}
function mutationRows(input,{empty=false}={}) {
  const rowIds=input.rowIds??[];
  need(Array.isArray(rowIds)&&rowIds.length<=BANK_SOURCE_ROWS&&(empty||rowIds.length>0),
    'BANK_ROWS_REQUIRED','Choose '+(empty?'at most':'between one and')+BANK_SOURCE_ROWS+' original bank rows.');
  const ids=rowIds.map(id=>bankHash(id));need(new Set(ids).size===ids.length,'BANK_ROW_REPEATED','Choose each original row once.');return ids;
}
export class BankReceiptsWorkspace {
  constructor(receivables) {this.receivables=receivables;this.workspace=receivables.workspace;}
  data(){return this.receivables.data();}
  _account(id) {
    identifier(id,'bank account');const row=bankAccountRows(this.data()).find(row=>row.id===id);
    need(row,'BANK_ACCOUNT_NOT_FOUND','Choose a retained bank account.',404);return row;
  }
  _import(id) {
    identifier(id,'bank import');const row=bankImportRows(this.data()).find(row=>row.id===id);
    need(row,'BANK_IMPORT_NOT_FOUND','Choose a retained original bank import.',404);
    need(row.schema===BANK_IMPORT_SCHEMA&&Array.isArray(row.index)&&Array.isArray(row.decisions)&&Array.isArray(row.postings)&&Array.isArray(row.history),
      'INVALID_BANK_IMPORT','The retained bank import state is invalid.',409);
    return row;
  }
  summary(id,data=this.data()){const row=bankImportRows(data).find(row=>row.id===id);need(row,'BANK_IMPORT_NOT_FOUND','Choose a retained bank import.',404);return bankImportSummary(row,data);}
  summaries(data=this.data()){const index=bankMatchIndex(data);return bankImportRows(data).map(row=>bankImportSummary(row,data,index));}
  postingSummary(importId,postingId,data=this.data()) {
    const bankImport=bankImportRows(data).find(row=>row.id===importId),row=bankImport?.postings.find(row=>row.id===postingId);
    need(row,'BANK_POSTING_NOT_FOUND','Choose a retained original bank posting.',404);
    return clone({id:row.id,bankImportId:importId,recordedAt:row.recordedAt,actor:row.actor,reviewSha256:row.reviewSha256,
      rowIds:row.rowIds,receiptIds:row.receiptIds,invoiceIds:row.invoiceIds,allocationIds:row.allocationIds,totals:row.totals,files:row.files});
  }
  async bankAccounts(query={}) {
    return this.workspace.serial(async()=>{
      const {offset,limit}=bankPage(query),search=textSearch(query);
      need(query.status===undefined||['ACTIVE','ARCHIVED'].includes(query.status),'INVALID_BANK_ACCOUNT_STATUS','Use ACTIVE or ARCHIVED.');
      const rows=bankAccountRows(this.data()).filter(row=>(!query.status||row.status===query.status)&&
        (!search||[row.reference,row.name,row.bankId,row.accountReference].join('\n').toLocaleLowerCase().includes(search)));
      return {schema:'stellar-forge.merchant-bank-accounts.v1',revision:this.workspace.state.revision,total:rows.length,offset,limit,
        accounts:rows.slice(offset,offset+limit).map(bankAccountSummary)};
    });
  }
  async saveBankAccount(value) {
    return this.receivables._mutate('bank_account_saved',value,async(data,actor)=>{
      const existing=value.id?this._account(value.id):null,normalized=normalizeBankAccount(value,existing);
      if(existing)need(value.expectedVersion===existing.version,'BANK_ACCOUNT_VERSION_CHANGED','Review the current bank account version before editing.',409);
      need(!bankAccountRows(data).some(row=>row.id!==normalized.id&&row.reference.toLocaleLowerCase()===normalized.reference.toLocaleLowerCase()),
        'BANK_ACCOUNT_REFERENCE_USED','Choose a distinct operator account reference.',409);
      if(existing&&bankImportRows(data).some(row=>row.accountId===existing.id))
        need(currencyKey(normalized.currency)===currencyKey(existing.currency)&&normalized.bankId===existing.bankId&&normalized.accountReference===existing.accountReference,
          'BANK_ACCOUNT_IDENTITY_RETAINED','Create a new account identity for a different original bank account or currency.',409);
      const recordedAt=at();
      if(existing) {
        const prior=bankAccountSummary(existing);Object.assign(existing,normalized,{updatedAt:recordedAt});
        existing.history.push({at:recordedAt,actor,action:'bank_account_saved',previous:prior,version:existing.version});
      } else {
        data.bankAccounts??=[];data.bankAccounts.unshift({...normalized,createdAt:recordedAt,updatedAt:recordedAt,
          history:[{at:recordedAt,actor,action:'bank_account_created',version:1}]});
      }
      return {bankAccountId:normalized.id};
    });
  }
  async inspectBankSource(value) {
    return this.workspace.serial(async()=>{
      const account=value?.accountId?this._account(value.accountId):null,compiled=await inspectBankInput(value,account);
      return {revision:this.workspace.state.revision,...compiled.view};
    });
  }
  async _retainFiles(files) {
    const root=join(this.workspace.directory,'exports'),parent=await lstat(root);
    need(parent.isDirectory()&&!parent.isSymbolicLink(),'BANK_EXPORT_DIRECTORY_CHANGED','The original accounting export directory changed.',409);
    const directoryId=randomUUID(),directory=join(root,directoryId);await mkdir(directory,{mode:0o700});
    const result={};
    for(const file of files) {
      need(FILE.test(file.name)&&!Object.hasOwn(result,file.name),'INVALID_BANK_FILE_NAME','Use a unique original bank document filename.',409);
      const bytes=Buffer.from(file.bytes);
      need(bytes.length>0&&bytes.length<=BANK_DERIVED_BYTES,'BANK_DOCUMENT_LIMIT','The derived bank source document exceeds16MB.');
      const handle=await open(join(directory,file.name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
      try {await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      result[file.name]={directoryId,name:file.name,bytes:bytes.length,sha256:sha(bytes),type:file.type,
        ...(file.customerId?{customerId:file.customerId,receiptId:file.receiptId,accountingDate:file.accountingDate}:{})};
    }
    await syncDirectory(directory);await syncDirectory(root);return result;
  }
  async _readRetained(metadata) {
    identifier(metadata?.directoryId,'bank export');
    need(FILE.test(metadata?.name??'')&&/^[a-f0-9]{64}$/.test(metadata.sha256??'')&&Number.isSafeInteger(metadata.bytes)&&
      metadata.bytes>0&&metadata.bytes<=BANK_DERIVED_BYTES,'INVALID_BANK_FILE_REFERENCE','The retained original bank file identity is invalid.',409);
    const root=join(this.workspace.directory,'exports'),directory=join(root,metadata.directoryId),
      parent=await lstat(root),dir=await lstat(directory);
    need(parent.isDirectory()&&!parent.isSymbolicLink()&&dir.isDirectory()&&!dir.isSymbolicLink(),
      'BANK_EXPORT_DIRECTORY_CHANGED','The retained original bank source directory changed.',409);
    const handle=await open(join(directory,metadata.name),constants.O_RDONLY|(constants.O_NOFOLLOW??0));let bytes;
    try {const stat=await handle.stat();need(stat.isFile()&&stat.size===metadata.bytes,'BANK_FILE_CHANGED',
      'The retained bank source file size changed.',409);bytes=await handle.readFile();}
    finally{await handle.close();}
    need(bytes.length===metadata.bytes&&sha(bytes)===metadata.sha256,'BANK_FILE_CHANGED',
      'The retained bank source differs from its original bytes.',409);
    return {bytes,type:metadata.type??'application/octet-stream'};
  }
  async _rows(bankImport) {
    const source=await this._readRetained(bankImport.files['source.'+bankImport.source.format.toLowerCase()]);
    need(source.bytes.length===bankImport.source.bytes&&sha(source.bytes)===bankImport.source.sha256,'BANK_SOURCE_CHANGED',
      'The original bank statement bytes no longer match this import.',409);
    const decoded=parsed((await this._readRetained(bankImport.files['rows.json'])).bytes,'source rows');
    need(decoded.schema==='stellar-forge.merchant-bank-source-rows.v1'&&decoded.source.sha256===bankImport.source.sha256&&
      decoded.section.id===bankImport.section.id&&Array.isArray(decoded.rows)&&
      sha(json(decoded.rows.map(sourceIndex)))===sha(json(bankImport.index)),
      'BANK_SOURCE_INDEX_CHANGED','The original bank row index differs from its retained source.',409);
    return decoded.rows;
  }
  async importBankSource(value) {
    return this.receivables._mutate('bank_source_imported',value,async(data,actor)=>{
      const account=this._account(value.accountId);
      need(account.status==='ACTIVE','BANK_ACCOUNT_ARCHIVED','Choose an active bank source account.',409);
      const compiled=await inspectBankInput(value,account);
      need(compiled.ready,'BANK_SOURCE_MAPPING_REQUIRED','Review the exact source section, currency, account identity and original column layout before importing.');
      const identity=sha(json({accountId:account.id,source:compiled.source.sha256,format:compiled.source.format,
        sectionId:compiled.section.id,layout:compiled.layout,statementOptions:compiled.statementOptions??null}));
      const previous=bankImportRows(data).find(row=>row.sourceIdentity===identity);
      if(previous)return {bankImportId:previous.id,existing:true};
      const recordedAt=at(),id=randomUUID(),body={schema:BANK_IMPORT_SCHEMA,id,accountId:account.id,account:bankAccountSummary(account),
        source:compiled.source,section:compiled.section,sections:compiled.sections,columns:compiled.columns,layout:compiled.layout,
        statementOptions:compiled.statementOptions??null,sourceIdentity:identity,createdAt:recordedAt,actor,
        sourceRowCount:compiled.rows.length,issues:compiled.view.issues};
      const files=await this._retainFiles([...normalizedBankSourceFiles(compiled),
        {name:'import.json',bytes:Buffer.from(json(body)),type:'application/json; charset=utf-8'},
        ...(compiled.parserReport?[{name:'parser-report.json',bytes:Buffer.from(json(compiled.parserReport)),type:'application/json; charset=utf-8'}]:[])]);
      const row={...body,status:'OPEN',closedAt:null,index:compiled.rows.map(sourceIndex),decisions:[],postings:[],files,
        history:[{at:recordedAt,actor,action:'bank_source_imported',sourceSha256:compiled.source.sha256,sourceIdentity:identity}]};
      data.bankImports??=[];data.bankImports.unshift(row);return {bankImportId:id};
    });
  }
  async bankImports(query={}) {
    return this.workspace.serial(async()=>{
      const {offset,limit}=bankPage(query),search=textSearch(query);
      if(query.accountId)this._account(query.accountId);
      need(query.status===undefined||['OPEN','CLOSED'].includes(query.status),'INVALID_BANK_IMPORT_STATUS','Use OPEN or CLOSED.');
      const rows=this.summaries().filter(row=>(!query.accountId||row.accountId===query.accountId)&&(!query.status||row.status===query.status)&&
        (!search||[row.accountReference,row.accountName,row.sourceName,row.sourceSha256].join('\n').toLocaleLowerCase().includes(search)));
      return {schema:'stellar-forge.merchant-bank-imports.v1',revision:this.workspace.state.revision,total:rows.length,offset,limit,
        imports:rows.slice(offset,offset+limit)};
    });
  }
  async _detail(bankImport,query={}) {
    const data=this.data(),view=query.view??'summary',{offset,limit}=bankPage(query),search=textSearch(query),lookup=bankMatchIndex(data);
    need(['summary','rows','history','postings'].includes(view),'INVALID_BANK_VIEW','Choose summary, rows, history or postings.');
    const rowStatus=query.rowStatus??query.status;
    need(rowStatus===undefined||['UNASSIGNED','POSTED','LINKED','IGNORED','DUPLICATE','CONFLICT','SOURCE_ONLY'].includes(rowStatus),
      'INVALID_BANK_ROW_STATUS','Choose a native bank source row status.');
    need(query.direction===undefined||['CREDIT','DEBIT','ZERO'].includes(query.direction),'INVALID_BANK_DIRECTION','Choose CREDIT, DEBIT or ZERO.');
    let items=[],total=0;
    if(view==='rows') {
      const rows=(await this._rows(bankImport)).filter(row=>(!query.direction||row.kind===query.direction)&&
        (!rowStatus||bankRowStatus(data,bankImport,row,lookup)===rowStatus)&&(!search||
          [row.id,row.rowNumber,row.transactionId,row.reference,row.bankReference,row.counterparty,row.invoiceReference,
            ...row.raw.values,...Object.values(row.raw.fields??{}),row.raw.text].join('\n').toLocaleLowerCase().includes(search)));
      total=rows.length;items=rows.slice(offset,offset+limit).map(row=>
        bankRowView(data,bankImport,row,this.workspace.state.customerStatements.customers,today(),lookup));
    } else if(view==='history') {
      const rows=[...bankImport.history].reverse().filter(row=>!search||json(row).toLocaleLowerCase().includes(search));
      total=rows.length;items=clone(rows.slice(offset,offset+limit));
    } else if(view==='postings') {
      const rows=[...bankImport.postings].reverse().filter(row=>!search||[row.id,row.actor,...row.receiptIds].join('\n').toLocaleLowerCase().includes(search));
      total=rows.length;items=rows.slice(offset,offset+limit).map(row=>this.postingSummary(bankImport.id,row.id,data));
    }
    return clone({schema:BANK_IMPORT_SCHEMA,revision:this.workspace.state.revision,bankImport:bankImportSummary(bankImport,data,lookup),
      account:bankImport.account,source:bankImport.source,layout:bankImport.layout,sections:bankImport.sections,
      columns:bankImport.columns,statementOptions:bankImport.statementOptions,issues:bankImport.issues,
      view,total,offset,limit,items,files:Object.values(bankImport.files)});
  }
  async bankImport(id,query={}){return this.workspace.serial(async()=>this._detail(this._import(id),query));}
  async previewBankPosting(id,value) {
    return this.workspace.serial(async()=>{
      const bankImport=this._import(id),rows=await this._rows(bankImport);
      const review=compileBankPosting(this.data(),bankImport,rows,this.workspace.state.customerStatements.customers,value);
      return {revision:this.workspace.state.revision,...review};
    });
  }
  async postBankReceipts(id,value) {
    identifier(id,'bank import');
    return this.receivables._mutate('bank_receipts_posted',{...value,bankImportId:id},async(data,actor)=>{
      const bankImport=this._import(id),proposal=value.proposal;
      need(plain(proposal)&&proposal.schema===BANK_POSTING_SCHEMA&&proposal.bankImportId===id&&
        typeof value.reviewSha256==='string'&&/^[a-f0-9]{64}$/.test(value.reviewSha256),
        'BANK_POSTING_REVIEW_REQUIRED','Commit the complete exact original bank posting preview.');
      const review=compileBankPosting(data,bankImport,await this._rows(bankImport),this.workspace.state.customerStatements.customers,
        bankPostingInput(proposal),{prior:proposal});
      need(review.reviewSha256===value.reviewSha256&&sha(json(review.proposal))===sha(json(proposal)),
        'BANK_POSTING_REVIEW_CHANGED','The original source, receipt, customer or dated allocation review changed; inspect the current preview.',409);
      const invoiceIds=new Set(review.proposal.selections.flatMap(row=>row.splits.flatMap(split=>[
        ...split.allocations.map(row=>row.invoiceId),...split.releasedAllocations.map(row=>row.invoiceId),
        ...(split.residualReceipt?.allocations??[]).map(row=>row.invoiceId)])));
      for(const invoiceId of invoiceIds)await this.receivables._file(invoiceId,'invoice.json');
      const recordedAt=at(),applied=applyBankPostingChanges(data,proposal,actor,recordedAt),
        documents=bankPostingDocuments(review,applied,actor,recordedAt),files=await this._retainFiles(documents);
      data.receipts=applied.data.receipts;data.invoices=applied.data.invoices;data.allocations=applied.data.allocations;
      const posting={id:proposal.id,recordedAt,actor,reviewSha256:review.reviewSha256,
        rowIds:proposal.selections.map(row=>row.rowId),receiptIds:applied.receiptIds,invoiceIds:applied.invoiceIds,
        allocationIds:applied.allocationIds,totals:clone(review.balanceEffects.totals),files};
      bankImport.postings.push(posting);
      for(const selection of proposal.selections) {
        const existing=bankRowDecision(bankImport,selection.rowId),decision={rowId:selection.rowId,
          status:selection.splits.every(row=>row.action==='LINK')?'LINKED':'POSTED',postingId:proposal.id,
          receiptIds:selection.splits.map(row=>row.receiptId),recordedAt,actor};
        if(existing)bankImport.history.push({at:recordedAt,actor,action:'bank_row_assignment_replaced',rowId:selection.rowId,previous:clone(existing),postingId:proposal.id});
        bankImport.decisions=bankImport.decisions.filter(row=>row.rowId!==selection.rowId);bankImport.decisions.push(decision);
      }
      Object.assign(bankImport.files,files);bankImport.history.push({at:recordedAt,actor,action:'bank_receipts_posted',
        bankPostingId:proposal.id,rowIds:posting.rowIds,receiptIds:posting.receiptIds,invoiceIds:posting.invoiceIds,reviewSha256:posting.reviewSha256});
      return {bankImportId:id,bankPostingId:proposal.id,receiptIds:applied.receiptIds,invoiceIds:applied.invoiceIds,allocationIds:applied.allocationIds};
    });
  }
  async ignoreBankRows(id,value) {
    identifier(id,'bank import');
    return this.receivables._mutate('bank_rows_ignored',{...value,bankImportId:id},async(data,actor)=>{
      const bankImport=this._import(id),rowIds=mutationRows(value),reason=field(value.reason,'source row exclusion reason',3000);
      need(bankImport.status==='OPEN','BANK_IMPORT_CLOSED','Reopen the original import before changing its source decisions.',409);
      for(const rowId of rowIds) {
        need(bankImport.index.some(row=>row.id===rowId),'BANK_ROW_NOT_FOUND','Choose an original row from this import.',404);
        const prior=bankRowDecision(bankImport,rowId);
        need(!prior||prior.status==='IGNORED','BANK_ROW_ALREADY_POSTED','Correct the original receipt assignment instead of ignoring posted incoming cash.',409);
      }
      const recordedAt=at();
      for(const rowId of rowIds) {
        const previous=bankRowDecision(bankImport,rowId);
        bankImport.decisions=bankImport.decisions.filter(row=>row.rowId!==rowId);
        bankImport.decisions.push({rowId,status:'IGNORED',reason,recordedAt,actor,receiptIds:[]});
        bankImport.history.push({at:recordedAt,actor,action:'bank_row_ignored',rowId,reason,previous:clone(previous)});
      }
      return {bankImportId:id};
    });
  }
  async restoreBankRows(id,value) {
    identifier(id,'bank import');
    return this.receivables._mutate('bank_rows_restored',{...value,bankImportId:id},async(data,actor)=>{
      const bankImport=this._import(id),rowIds=mutationRows(value,{empty:true}),reason=field(value.reason,'source restoration reason',3000);
      need(rowIds.length||bankImport.status==='CLOSED','BANK_RESTORE_EMPTY','Choose ignored rows or reopen a closed original import.');
      for(const rowId of rowIds)need(bankRowDecision(bankImport,rowId)?.status==='IGNORED',
        'BANK_ROW_NOT_IGNORED','Restore an original ignored row; recorded receipts remain available for explicit correction.',409);
      const recordedAt=at(),previousStatus=bankImport.status,previousClosedAt=bankImport.closedAt;
      for(const rowId of rowIds) {
        const previous=clone(bankRowDecision(bankImport,rowId));
        bankImport.decisions=bankImport.decisions.filter(row=>row.rowId!==rowId);
        bankImport.history.push({at:recordedAt,actor,action:'bank_row_restored',rowId,reason,previous});
      }
      bankImport.status='OPEN';bankImport.closedAt=null;
      bankImport.history.push({at:recordedAt,actor,action:'bank_import_reopened',previousStatus,previousClosedAt,reason,rowIds});
      return {bankImportId:id};
    });
  }
  async closeBankImport(id,value) {
    identifier(id,'bank import');
    return this.receivables._mutate('bank_import_closed',{...value,bankImportId:id},async(data,actor)=>{
      const bankImport=this._import(id),reason=field(value.reason??'','import closing note',3000,true),summary=bankImportSummary(bankImport,data);
      need(bankImport.status==='OPEN','BANK_IMPORT_ALREADY_CLOSED','This original bank import is already closed.',409);
      need(summary.unassignedCount+summary.duplicateCount+summary.conflictCount===0,'BANK_IMPORT_UNRESOLVED',
        'Post, link or explicitly ignore each original incoming cash row before closing this import.',409);
      bankImport.status='CLOSED';bankImport.closedAt=at();
      bankImport.history.push({at:bankImport.closedAt,actor,action:'bank_import_closed',reason});return {bankImportId:id};
    });
  }
  async _file(bankImport,name) {
    need(typeof name==='string','BANK_FILE_REQUIRED','Choose an original retained bank file.');
    if(name==='status.json')return {name:bankImport.id+'-status.json',type:'application/json; charset=utf-8',
      bytes:Buffer.from(json({schema:'stellar-forge.merchant-bank-import-status.v1',revision:this.workspace.state.revision,
        observedAt:at(),bankImport:bankImportSummary(bankImport,this.data()),history:bankImport.history}))};
    if(name==='reconciliation.json') {
      const ids=new Set(bankImport.decisions.flatMap(decision=>(decision.receiptIds??[]).flatMap(id=>[
        id,...bankCurrentReceipts(this.data(),id,bankImport,bankImport.index.find(row=>row.id===decision.rowId)).map(row=>row.id)])));
      return {name:bankImport.id+'-reconciliation.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json({
        schema:'stellar-forge.merchant-bank-reconciliation.v1',revision:this.workspace.state.revision,observedAt:at(),
        bankImport:bankImportSummary(bankImport,this.data()),source:bankImport.source,decisions:bankImport.decisions,
        postings:bankImport.postings,receipts:this.data().receipts.filter(row=>ids.has(row.id)).map(row=>receiptSummary(row,this.data())),
        history:bankImport.history}))};
    }
    need(FILE.test(name)&&Object.hasOwn(bankImport.files,name),'BANK_FILE_NOT_FOUND','Choose an original source or retained bank posting file.',404);
    const original=await this._readRetained(bankImport.files[name]);
    return {...original,name:name.startsWith('source.')?bankImport.source.name:bankImport.id+'-'+name};
  }
  async bankImportFile(id,name) {return this.workspace.serial(async()=>this._file(this._import(id),name));}
  async customerFiles(customerId,asOf=today()) {
    identifier(customerId,'customer');dateValue(asOf,'customer account date');const result=[];
    for(const bankImport of bankImportRows(this.data()))for(const posting of bankImport.postings)for(const [name,metadata] of Object.entries(posting.files)) {
      if(metadata.customerId!==customerId||metadata.accountingDate>asOf)continue;
      const original=await this._readRetained(metadata);
      result.push({...original,name:'documents/bank-'+posting.id+'-'+name});
    }
    return result;
  }
}
