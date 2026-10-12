// MIT. Pinned RisingWave 3.1.0 native cursor status and authoritative EOF.
import { randomUUID } from 'node:crypto';
import { fail, identifier, qualified, bound, epochMs, SOURCE_PIN, now } from './common.mjs';
import { rowsAsObjects } from './transport.mjs';
const U64=18446744073709551615n;
function epoch(value){
  if(typeof value!=='string'||!/^[0-9]+$/.test(value)||BigInt(value)>U64)throw fail('RISINGWAVE_CURSOR_EPOCH_INVALID');
  return value;
}
export function parseRisingWaveCursorState(text){
  if(typeof text!=='string')throw fail('RISINGWAVE_CURSOR_STATE_INVALID');
  let match=/^InitLogStoreQuery \{ seek_timestamp: ([0-9]+), expected_timestamp: (None|Some\(([0-9]+)\)) \}$/.exec(text);
  if(match)return {kind:'InitLogStoreQuery',seekEpoch:epoch(match[1]),expectedEpoch:match[3]?epoch(match[3]):null,
    seekUnixMs:epochMs(match[1]),snapshot:false,raw:text};
  match=/^Fetch \{ from_snapshot: (true|false), rw_timestamp: ([0-9]+), expected_timestamp: (None|Some\(([0-9]+)\)), cached rows: ([0-9]+), query init at ([0-9]+)ms before \}$/.exec(text);
  if(match)return {kind:'Fetch',snapshot:match[1]==='true',epoch:epoch(match[2]),unixMs:epochMs(match[2]),
    expectedEpoch:match[4]?epoch(match[4]):null,cachedRows:match[5],queryAgeText:match[6],raw:text};
  if(text==='Invalid')throw fail('RISINGWAVE_CURSOR_INVALID','The native subscription cursor is invalid and must reopen from its retained checkpoint.');
  throw fail('RISINGWAVE_CURSOR_STATUS_PROTOCOL_CHANGED','The native cursor state does not match the pinned 3.1.0 grammar.',{state:text,sourcePin:SOURCE_PIN});
}
export async function observeRisingWaveCursor(connection,cursor){
  const result=await connection.query('SHOW SUBSCRIPTION CURSORS',[],{phase:'cursor-observation'});
  const rows=rowsAsObjects(result),required=['Worker Id','Session Id','User','Host','Database','Cursor Name','Subscription Name','State','Idle Duration Ms','Info'];
  if(required.some(name=>!result.fields.some(field=>field.name===name)))throw fail('RISINGWAVE_CURSOR_STATUS_FIELDS_CHANGED');
  const failures=rows.filter(row=>row.Info!==null&&row.Info!=='');
  if(failures.length)throw fail('RISINGWAVE_CURSOR_OBSERVATION_PARTIAL','The native cursor inventory has incomplete frontend responses.',
    {info:failures.map(row=>row.Info)});
  const matches=rows.filter(row=>row['Session Id']===connection.identity.sessionId&&row.Database===connection.identity.database&&
    row.User===connection.identity.user&&row['Cursor Name']===cursor.name&&row['Subscription Name']===cursor.subscription.name);
  if(matches.length!==1)throw fail('RISINGWAVE_CURSOR_OBSERVATION_AMBIGUOUS','The native status must identify exactly this owned session and cursor.',
    {sessionId:connection.identity.sessionId,cursor:cursor.name,count:matches.length});
  const raw=matches[0];
  if(cursor.workerId!==null&&cursor.workerId!==raw['Worker Id'])throw fail('RISINGWAVE_CURSOR_WORKER_CHANGED');
  cursor.workerId=raw['Worker Id'];
  return {at:now(),sourcePin:SOURCE_PIN,workerId:raw['Worker Id'],sessionId:raw['Session Id'],database:raw.Database,
    user:raw.User,host:raw.Host,cursor:raw['Cursor Name'],subscription:raw['Subscription Name'],
    state:parseRisingWaveCursorState(raw.State),raw};
}
export async function declareRisingWaveCursor(connection,query,{mode='full',sinceMs=null}={}){
  if(!['full','changes'].includes(mode))throw fail('RISINGWAVE_CURSOR_MODE_INVALID');
  if(mode==='changes'&&(typeof sinceMs!=='string'||!/^[0-9]+$/.test(sinceMs)))throw fail('RISINGWAVE_SINCE_TIMESTAMP_REQUIRED');
  const cursor={name:'sf30_'+randomUUID().replaceAll('-',''),subscription:query.subscription,workerId:null,mode,closed:false};
  const statement='DECLARE '+identifier(cursor.name)+' SUBSCRIPTION CURSOR FOR '+qualified(query.subscription)+
    (mode==='full'?' FULL':' SINCE '+sinceMs);
  await connection.query(statement,[],{phase:'declare'});
  cursor.initial=await observeRisingWaveCursor(connection,cursor);
  if(mode==='full'&&(cursor.initial.state.kind!=='Fetch'||cursor.initial.state.snapshot!==true))throw fail('RISINGWAVE_FULL_SNAPSHOT_STATE_REQUIRED');
  cursor.statement=statement;
  return cursor;
}
export async function fetchRisingWaveCursor(connection,cursor,{batchSize=1000,timeoutSeconds=1,timeoutMs=30000}={}){
  bound(batchSize,1,10000,'RISINGWAVE_FETCH_BATCH_INVALID');
  bound(timeoutSeconds,0,30,'RISINGWAVE_FETCH_TIMEOUT_INVALID');
  if(cursor.closed)throw fail('RISINGWAVE_CURSOR_CLOSED');
  const statement='FETCH '+batchSize+' FROM '+identifier(cursor.name)+' WITH (timeout='+ "'" +timeoutSeconds+'s'+ "'" +')';
  const response=await connection.query(statement,[],{phase:'fetch',timeoutMs:Math.max(timeoutMs,timeoutSeconds*1000+2000)});
  const observation=await observeRisingWaveCursor(connection,cursor);
  return {statement,response,observation,at:now(),
    nativeEof:response.rows.length===0&&observation.state.kind==='InitLogStoreQuery'};
}
export async function closeRisingWaveCursor(connection,cursor){
  if(cursor.closed)return;
  await connection.query('CLOSE '+identifier(cursor.name),[],{phase:'close-cursor'});
  cursor.closed=true;
}
