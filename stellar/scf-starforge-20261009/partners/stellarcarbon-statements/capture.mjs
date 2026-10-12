// MIT. Complete public API pages and their connected original retirement records.
import {SOURCE_SCHEMA,TABLES,parseNativeJSON,normalizeRow,validateTables,need,windowOf,copy} from './source.mjs';
const BASES = new Set(['https://api.stellarcarbon.io','https://testnet-api.stellarcarbon.io']);
export async function captureNativeApi({baseUrl='https://api.stellarcarbon.io',fromDate,beforeDate,
  pageSize=200,checkpoint,retain=async()=>{},fetchImpl=globalThis.fetch,signal}={}) {
  need(BASES.has(baseUrl),'SOURCE_API_HOST','Choose the official mainnet or testnet API.');
  const period=windowOf({fromDate,beforeDate});
  pageSize=Number(pageSize);
  need(Number.isInteger(pageSize)&&pageSize>0&&pageSize<=1000,'SOURCE_API_PAGE_SIZE','Use 1 to 1,000 records per page.');
  const query={baseUrl,...period,pageSize};
  if(checkpoint) need(JSON.stringify(checkpoint.query)===JSON.stringify(query),'CAPTURE_SELECTION_CHANGED','Resume with the original source and period.');
  const progress=checkpoint?copy(checkpoint):{schema:'stellar-forge.stellarcarbon-api-capture.v1',query,startedAt:new Date().toISOString(),responses:[]};
  const cached=new Map(progress.responses.map(row=>[row.url,row]));
  async function get(path,parameters) {
    signal?.throwIfAborted();
    const url=new URL(path,baseUrl);
    for(const [key,value] of Object.entries(parameters||{})) if(value!==undefined)url.searchParams.set(key,String(value));
    const prior=cached.get(url.href);
    if(prior)return parseNativeJSON(prior.content);
    let response;
    for(let attempt=0;attempt<3;attempt++){
      response=await fetchImpl(url.href,{headers:{Accept:'application/json'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});
      if(response.status!==429||attempt===2)break;
      const retry=Number(response.headers.get('retry-after'));
      await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Math.min(30000,Number.isFinite(retry)?retry*1000:3000))));
    }
    need(response.ok,'SOURCE_API_RESPONSE','The original API returned HTTP '+response.status+' for '+url.pathname+'.',502);
    const content=await response.text();
    need(content.length<=16000000,'SOURCE_API_PAGE_LIMIT','The original API page exceeds the supported 16 MB text size.',413);
    const value=parseNativeJSON(content);
    const record={url:url.href,retrievedAt:new Date().toISOString(),status:response.status,content};
    progress.responses.push(record);cached.set(url.href,record);await retain(copy(progress));
    return value;
  }
  async function pages(path,key,identity){
    let cursor,rows=[],first=null,last=null;
    for(;;){
      const body=await get(path,{from_date:period.fromDate,before_date:period.beforeDate,order:'asc',limit:pageSize,...(cursor?{cursor}: {})});
      need(Array.isArray(body[key]),'SOURCE_API_SHAPE','The original '+path+' page is missing its records.');
      first ||= copy(body);last=copy(body);
      if(!body[key].length)return {rows,first,last,terminal:true};
      let previous=cursor?BigInt(cursor):-1n;
      for(const row of body[key]){
        need(typeof row[identity]==='string'&&/^\d+$/.test(row[identity]),'SOURCE_API_CURSOR','Keep the original exact API cursor.');
        const token=BigInt(row[identity]);
        need(token>previous,'SOURCE_API_CURSOR_ORDER','The API page did not advance in its requested ascending order.',502);
        previous=token;rows.push(row);
      }
      cursor=body[key].at(-1)[identity];
    }
  }
  const sinking=await pages('/sink-txs/','transactions','toid');
  const retired=await pages('/retirements/','retirements','certificate_id');
  const txs=new Map(sinking.rows.map(row=>[row.hash,row]));
  const certificates=new Map(retired.rows.map(row=>[row.certificate_id,row]));
  const details=new Map(),projects=new Map();
  // Follow complete relations. A period certificate can refer to an earlier contribution;
  // a period contribution can be filled by a later certificate.
  for(;;){
    let advanced=false;
    for(const tx of [...txs.values()])for(const status of tx.retirements||[])
      if(!certificates.has(status.certificate_id)){certificates.set(status.certificate_id,null);advanced=true;}
    for(const certificateId of [...certificates.keys()])if(!details.has(certificateId)){
      const detail=await get('/retirements/'+encodeURIComponent(certificateId));
      need(detail.certificate_id===certificateId&&Array.isArray(detail.retired_from)&&Array.isArray(detail.sink_statuses),
        'SOURCE_API_CERTIFICATE','The original certificate detail does not match its requested identity.',502);
      details.set(certificateId,detail);certificates.set(certificateId,detail);
      if(detail.vcs_project)projects.set(detail.vcs_project.id,detail.vcs_project);
      for(const status of detail.sink_statuses){
        const hash=status.hash || status.sinking_tx_hash;
        need(typeof hash==='string'&&/^[a-f0-9]{64}$/i.test(hash),'SOURCE_API_TRANSACTION','Keep the original linked transaction hash.');
        if(!txs.has(hash)){
          const transaction=await get('/sink-txs/'+encodeURIComponent(hash));
          need(transaction.hash===hash&&Array.isArray(transaction.retirements),'SOURCE_API_TRANSACTION','The linked original transaction is incomplete.',502);
          txs.set(hash,transaction);
        }
      }
      advanced=true;
    }
    if(!advanced)break;
  }
  const tables=Object.fromEntries(Object.keys(TABLES).map(table=>[table,[]]));
  for(const row of txs.values()){
    const mapped={hash:row.hash,created_at:row.created_at,contract_id:row.contract_id??null,
      funder:row.funder,recipient:row.recipient,carbon_amount:row.carbon_amount,
      source_asset_code:row.source_asset.code,source_asset_issuer:row.source_asset.issuer,
      source_asset_amount:row.source_asset.amount,dest_asset_code:row.dest_asset.code,
      dest_asset_issuer:row.dest_asset.issuer,dest_asset_amount:row.dest_asset.amount,
      vcs_project_id:row.vcs_project_id,memo_type:row.memo.type,memo_value:row.memo.value,toid:row.toid,
      contract_id_reported:Object.hasOwn(row,'contract_id'),provider_retirement_finalized:row.retirement_finalized};
    tables.sinking_txs.push(normalizeRow('sinking_txs',mapped));
    for(const allocation of row.retirements)tables.sink_status.push(normalizeRow('sink_status',{
      sinking_tx_hash:row.hash,certificate_id:allocation.certificate_id,amount_filled:allocation.amount_filled,finalized:allocation.finalized}));
  }
  for(const row of details.values()){
    tables.retirements.push(normalizeRow('retirements',{certificate_id:row.certificate_id,vcu_amount:row.vcu_amount,
      serial_number:row.serial_number,retirement_date:row.retirement_date,retirement_beneficiary:row.beneficiary,
      retirement_details:row.details,vcs_project_id:row.vcs_project.id,issuance_date:row.instrument.issuance_date,
      instrument_type:row.instrument.instrument_type,vintage_start:row.instrument.vintage_start,
      vintage_end:row.instrument.vintage_end,total_vintage_quantity:row.instrument.total_vintage_quantity,registry_url:row.registry_url}));
    for(const block of row.retired_from)tables.retirement_from_block.push(normalizeRow('retirement_from_block',{
      retirement_id:row.certificate_id,block_hash:block.block_hash,vcu_amount:block.vcu_amount}));
  }
  for(const row of projects.values())tables.vcs_projects.push(normalizeRow('vcs_projects',row));
  validateTables(tables,{format:'api-capture'});
  const aggregates=(body,key)=>Object.fromEntries(Object.entries(body).filter(([name])=>name!==key));
  progress.completedAt=new Date().toISOString();await retain(copy(progress));
  return {schema:SOURCE_SCHEMA,format:'api-capture',metadata:{...query,startedAt:progress.startedAt,completedAt:progress.completedAt,
      network:baseUrl.includes('testnet-')?'testnet':'mainnet',terminalPages:{sinking:sinking.terminal,retirements:retired.terminal},
      viewScope:'Date-filtered complete native views plus all connected sinking/certificate records.',
      availableTables:['sinking_txs','sink_status','retirements','retirement_from_block','vcs_projects'],
      providerTotals:{sinkingFirst:aggregates(sinking.first,'transactions'),sinkingLast:aggregates(sinking.last,'transactions'),
        retirementsFirst:aggregates(retired.first,'retirements'),retirementsLast:aggregates(retired.last,'retirements')},
      sourceSchema:'https://github.com/stellarcarbon/sc-sdk-typescript/blob/1f24e670d3c30414ccba0bd68b2268e7e5a130aa/openapi.json'},
    files:{},responses:copy(progress.responses),tables};
}
