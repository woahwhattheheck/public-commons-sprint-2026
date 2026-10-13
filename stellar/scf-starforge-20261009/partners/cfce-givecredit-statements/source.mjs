// MIT. Original CFCE rows, native ledger editions and Stellarcarbon records remain separate.
export {need,copy,plain,text,id,units,decimal,parseNativeJSON,dayOf,windowOf,civilDate,inWindow}
  from '../stellarcarbon-statements/source.mjs';
import {need,copy,plain,text,id,units,decimal,parseNativeJSON,dayOf,windowOf,validateTables,receiveBackup}
  from '../stellarcarbon-statements/source.mjs';
export const SOURCE_SCHEMA='stellar-forge.givecredit-source.v1';
export const REGISTRY_TABLES=['donations','nfts','organizations','initiatives','credits','providers','stories','impactlinks'];
export const LEDGER_TABLES=['transactions','transfers','donationEvents','contractObservations'];
const numeric={donations:{amount:4,usdvalue:4},nfts:{coinValue:4,usdValue:4},
  credits:{value:2,current:2,goal:2}};
export function amount(value,scale,label='source amount'){
  need(typeof value==='string','AMOUNT_STRING_REQUIRED','Keep '+label+' as an exact string.');
  units(value,scale);return value;
}
export function atoms(value,label='token amount'){
  need(typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&BigInt(value)<(1n<<127n),
    'INVALID_ATOMS','Keep '+label+' as a nonnegative i128 integer string.');
  return value;
}
export function signedAtoms(value,label='balance'){
  need(typeof value==='string'&&/^-?(0|[1-9]\d*)$/.test(value)&&BigInt(value)>=-(1n<<127n)&&BigInt(value)<(1n<<127n),
    'INVALID_ATOMS','Keep '+label+' as an i128 integer string.');return value;
}
export function network(value){need(['mainnet','testnet'].includes(value),'NETWORK_REQUIRED','Choose the original Stellar network.');return value;}
export const txKey=row=>network(row.network)+':'+text(row.hash,'transaction hash',64).toLowerCase();
export const keyForReceipt=row=>[String(row.chainName||row.chain||'').toLowerCase(),String(row.network||'').toLowerCase(),String(row.transactionId||'').toLowerCase()].join(':');
export function normalizeRegistryTables(input){
  need(plain(input),'REGISTRY_TABLES_REQUIRED','Receive the original registry tables.');
  const tables={};
  for(const table of REGISTRY_TABLES){
    const rows=input[table]||[];need(Array.isArray(rows),'REGISTRY_TABLE_REQUIRED','Keep '+table+' as whole rows.');
    const seen=new Set();
    tables[table]=rows.map(value=>{
      need(plain(value),'REGISTRY_ROW_REQUIRED','Keep every original '+table+' row.');
      const row=copy(value);id(row.id,'original registry identifier');
      need(!seen.has(row.id),'REGISTRY_DUPLICATE_ID','The source repeats '+table+' ID '+row.id+'.');seen.add(row.id);
      for(const [field,scale] of Object.entries(numeric[table]||{}))
        if(row[field]!==null&&row[field]!==undefined)amount(row[field],scale,table+'.'+field);
      if(row.created)dayOf(row.created);
      if(table==='donations'){
        need(typeof row.organizationId==='string'&&typeof row.amount==='string'&&typeof row.usdvalue==='string'&&typeof row.created==='string',
          'DONATION_FIELDS_REQUIRED','Keep the original donation identity, organization, amounts and creation date.');
      }
      if(table==='nfts'){
        need(typeof row.donorAddress==='string'&&typeof row.tokenId==='string','RECEIPT_FIELDS_REQUIRED','Keep the original donor address and minted receipt identifier.');
      }
      return row;
    });
  }
  return tables;
}
function tableRows(content){
  const source=content.trim();
  if(!source)return [];
  let value;
  try{value=parseNativeJSON(source);}catch(error){
    value=source.split(/\r?\n/).filter(line=>line.trim()).map(line=>parseNativeJSON(line));
  }
  if(Array.isArray(value))return value;
  need(plain(value)&&Array.isArray(value.data),'REGISTRY_FILE_FORMAT','Receive an original JSON array, NDJSON file or success/data response.');
  need(value.success!==false,'REGISTRY_RESPONSE_FAILED','The retained registry response reports a failed request.');
  return value.data;
}
export function receiveRegistryFiles(files,metadata={}){
  need(plain(files),'REGISTRY_FILES_REQUIRED','Choose the complete original registry export files.');
  const input={},coverage=[];
  for(const table of REGISTRY_TABLES){
    const name=[table+'.json',table+'.ndjson',table].find(key=>typeof files[key]==='string');
    if(name){input[table]=tableRows(files[name]);coverage.push(table);}
  }
  need(coverage.length,'REGISTRY_FILES_REQUIRED','No declared registry table was found.');
  return {schema:SOURCE_SCHEMA,kind:'registry',metadata:{...copy(metadata),coverage,
    dateBasis:'Original registry created timestamps; statement windows are inclusive fromDate and exclusive beforeDate.'},
    files:copy(files),responses:[],tables:normalizeRegistryTables(input)};
}
export function receiveCarbon(source,{network:sourceNetwork,label}={}){
  network(sourceNetwork);
  need(source?.schema==='stellar-forge.stellarcarbon-source-edition.v1','CARBON_SOURCE_REQUIRED','Receive the complete original Stellarcarbon source edition.');
  validateTables(source.tables,{format:source.format});
  return {schema:SOURCE_SCHEMA,kind:'carbon',metadata:{...copy(source.metadata),network:sourceNetwork,
    label:label||source.label||'Stellarcarbon source'},files:{},responses:[],tables:{},carbon:copy(source)};
}
export function validateSourceEdition(source){
  need(plain(source)&&source.schema===SOURCE_SCHEMA&&['registry','ledger','carbon'].includes(source.kind),
    'SOURCE_SCHEMA','Receive a GiveCredit registry, ledger or Stellarcarbon source edition.');
  need(plain(source.metadata)&&plain(source.files)&&Array.isArray(source.responses)&&plain(source.tables),
    'SOURCE_INCOMPLETE','Keep complete source files, responses, metadata and derived rows.');
  for(const [name,content] of Object.entries(source.files)){
    need(typeof name==='string'&&!name.includes('\0')&&typeof content==='string','SOURCE_FILE_REQUIRED','Retain complete original source files.');
  }
  for(const row of source.responses){
    const retainedImport=source.kind==='ledger'&&plain(row)&&row.transport==='retained-original-import';
    const originalImport=retainedImport&&row.retrievedAt===null&&
      typeof row.importedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(row.importedAt)&&Number.isFinite(Date.parse(row.importedAt))&&
      typeof row.url==='string'&&/^https?:\/\/[^\s]+$/i.test(row.url);
    need(plain(row)&&typeof row.content==='string'&&
      (originalImport||typeof row.retrievedAt==='string'),
      'SOURCE_RESPONSE_REQUIRED','Retain each original response and its retrieval date, or an explicitly imported original ledger response with its source URL and separate import date.');
  }
  if(source.kind==='registry')normalizeRegistryTables(source.tables);
  if(source.kind==='carbon'){
    network(source.metadata.network);
    need(source.carbon?.schema==='stellar-forge.stellarcarbon-source-edition.v1','CARBON_SOURCE_REQUIRED','Retain the original Stellarcarbon edition.');
    validateTables(source.carbon.tables,{format:source.carbon.format});
    if(source.carbon.format==='native-backup'){
      const rebuilt=receiveBackup(source.carbon.files,source.carbon.metadata);
      need(JSON.stringify(rebuilt.tables)===JSON.stringify(source.carbon.tables),'CARBON_SOURCE_CHANGED','Keep the original carbon rows tied to their retained source files.');
    }
  }
  if(source.kind==='ledger'){
    network(source.metadata.network);
    for(const table of LEDGER_TABLES){
      need(Array.isArray(source.tables[table]),'LEDGER_TABLE_REQUIRED','Retain complete '+table+' records.');
      const seen=new Set();
      for(const row of source.tables[table]){
        need(plain(row)&&row.network===source.metadata.network,'LEDGER_NETWORK_MISMATCH','Each ledger record must keep its source network.');
        const key=table==='transactions'?txKey(row):id(row.key,'ledger record key');
        need(!seen.has(key),'LEDGER_DUPLICATE_KEY','The ledger edition repeats '+key+'.');seen.add(key);
        if(row.ledger!==null&&row.ledger!==undefined)atoms(String(row.ledger),'ledger sequence');
        if(row.createdAt)dayOf(row.createdAt);
        if(table==='transfers'){
          atoms(row.amountAtoms);text(row.from,'original source address',160);text(row.to,'original destination address',160);
          need(plain(row.asset)&&typeof row.asset.key==='string'&&row.asset.decimals!==null&&row.asset.decimals!==undefined&&Number.isInteger(Number(row.asset.decimals))&&Number(row.asset.decimals)>=0&&Number(row.asset.decimals)<=38,
            'ASSET_REQUIRED','Keep the original asset identity and decimal precision.');
          need(typeof row.hash==='string'&&/^[a-fA-F0-9]{64}$/.test(row.hash),'HASH_REQUIRED','Keep the original payment transaction hash.');
        }
        if(table==='donationEvents'){
          atoms(row.amountAtoms);text(row.contractId,'original contract',160);text(row.donor,'original donor address',160);text(row.provider,'original provider address',160);
        }
        if(table==='contractObservations'){
          for(const field of ['bucketAtoms','minimumAtoms','accountedRemainderAtoms','tokenBalanceAtoms'])
            if(row[field]!==null&&row[field]!==undefined)signedAtoms(row[field],field);
        }
      }
    }
  }
  return source;
}
export function sourceSummary(source){
  validateSourceEdition(source);
  if(source.kind==='carbon')return {kind:source.kind,network:source.metadata.network,
    counts:Object.fromEntries(Object.entries(source.carbon.tables).map(([name,rows])=>[name,rows.length])),
    contributions:source.carbon.tables.sinking_txs.length,
    carbon:decimal(source.carbon.tables.sinking_txs.reduce((n,row)=>n+units(row.carbon_amount),0n))};
  return {kind:source.kind,network:source.metadata.network||null,
    counts:Object.fromEntries(Object.entries(source.tables).map(([name,rows])=>[name,rows.length])),
    files:Object.keys(source.files).length,responses:source.responses.length,coverage:copy(source.metadata.coverage||Object.keys(source.tables))};
}
