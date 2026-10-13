import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SECRET=/^[a-f0-9]{64}$/;
const MAX_RECEIPT=4*1024*1024,MAX_HISTORY=4*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
function check(ok,message,status=400){if(!ok)throw Object.assign(new Error(message),{status});}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function publicGrant(row){return {id:row.id,name:row.name,householdId:row.household_id,createdAt:row.created_at,revokedAt:row.revoked_at};}
/** Access and request receipts live in the existing household database and transaction.
 * Credentials are never included in the household export or operation request. */
export function createAssistantAccess({db,transaction,household,current,digest}){
  db.exec("CREATE TABLE IF NOT EXISTS assistant_grants(id TEXT PRIMARY KEY,visitor_id TEXT NOT NULL REFERENCES visitors(id),household_id TEXT NOT NULL REFERENCES households(id),name TEXT NOT NULL,token_sha256 TEXT NOT NULL UNIQUE,request_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT);"+
    "CREATE TABLE IF NOT EXISTS assistant_requests(household_id TEXT NOT NULL REFERENCES households(id),request_id TEXT NOT NULL,data_json TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(household_id,request_id));");
  function list(owner,home){household(owner,home);return db.prepare('SELECT * FROM assistant_grants WHERE visitor_id=? AND household_id=? ORDER BY created_at,id').all(owner,home).map(publicGrant);}
  function create(owner,body,checkContext){
    check(object(body)&&UUID.test(body.requestId)&&SECRET.test(body.token),'Generate an original connection identity and 32-byte token in the browser.');
    check(typeof body.name==='string'&&body.name.trim().length>0&&body.name.trim().length<=100&&!/[\x00-\x1f\x7f]/.test(body.name),'Name this assistant using 1–100 printable characters.');
    const home=body.context?.householdId;household(owner,home);
    const requestSha=digest({householdId:home,name:body.name.trim(),tokenSha256:hash(body.token)});
    return transaction(()=>{
      const prior=db.prepare('SELECT * FROM assistant_grants WHERE id=?').get(body.requestId);
      if(prior){
        check(prior.visitor_id===owner&&prior.household_id===home&&prior.request_sha256===requestSha,'This connection identity already belongs to another exact request.',409);
        return publicGrant(prior);
      }
      checkContext();
      check(Number(db.prepare('SELECT COUNT(*) AS n FROM assistant_grants WHERE visitor_id=? AND revoked_at IS NULL').get(owner).n)<50,'Revoke an unused assistant before creating another connection.',409);
      const at=new Date().toISOString();
      db.prepare('INSERT INTO assistant_grants VALUES(?,?,?,?,?,?,?,NULL)').run(body.requestId,owner,home,body.name.trim(),hash(body.token),requestSha,at);
      return publicGrant(db.prepare('SELECT * FROM assistant_grants WHERE id=?').get(body.requestId));
    });
  }
  function revoke(owner,body,checkContext){
    check(UUID.test(body?.grantId),'Choose the original connection.');
    return transaction(()=>{
      const row=db.prepare('SELECT * FROM assistant_grants WHERE id=? AND visitor_id=?').get(body.grantId,owner);
      check(row,'Connection not found in this browser workspace.',404);
      if(!row.revoked_at){
        checkContext();check(body.context.householdId===row.household_id,'Open this connection’s original household before revoking it.',409);
        db.prepare('UPDATE assistant_grants SET revoked_at=? WHERE id=?').run(new Date().toISOString(),row.id);
      }
      return publicGrant(db.prepare('SELECT * FROM assistant_grants WHERE id=?').get(row.id));
    });
  }
  function authenticate(token){
    check(typeof token==='string'&&SECRET.test(token),'Use the private connection token from the original household browser.',401);
    const row=db.prepare('SELECT * FROM assistant_grants WHERE token_sha256=?').get(hash(token));
    check(row&&!row.revoked_at,'This assistant connection is unknown or revoked.',401);
    household(row.visitor_id,row.household_id);
    return {...publicGrant(row),owner:row.visitor_id};
  }
  function inspectReceipt(value,depth=0){
    check(depth<=16,'The receiving lineage exceeds sixteen household generations; keep the original complete archive.');
    check(object(value),'Invalid saved assistant operation.');
    const {sha256,...body}=value;
    check(UUID.test(body.requestId)&&UUID.test(body.grantId)&&typeof body.at==='string'&&Number.isFinite(Date.parse(body.at))&&
      object(body.request)&&typeof body.request.name==='string'&&object(body.request.arguments)&&
      body.requestSha256===digest(body.request)&&object(body.result)&&digest(body)===sha256,
      'An assistant operation has changed or is incomplete.');
    check(Buffer.byteLength(JSON.stringify(value))<=MAX_RECEIPT,'The complete assistant outcome exceeds its retained limit.');
    if(body.receivedFrom!==undefined){
      const origin=body.receivedFrom;
      check(object(origin)&&UUID.test(origin.householdId)&&origin.sourceReceipt&&origin.sha256===origin.sourceReceipt.sha256,'Invalid original assistant receiving lineage.');
      inspectReceipt(origin.sourceReceipt,depth+1);
      const {receivedFrom,...currentBody}=body;
      const {sha256:sourceSha,receivedFrom:priorOrigin,...originalBody}=origin.sourceReceipt;
      check(digest(currentBody)===digest(originalBody),'A received assistant outcome differs from its retained original request and result.');
    }
    return value;
  }
  function records(owner,home){
    household(owner,home);
    return db.prepare('SELECT data_json,sha256 FROM assistant_requests WHERE household_id=? ORDER BY request_id').all(home).map(row=>{
      const data=JSON.parse(row.data_json);check(digest(data)===row.sha256,'Saved assistant outcome integrity check failed.',409);
      return inspectReceipt({...data,sha256:row.sha256});
    });
  }
  function inspectRecords(rows){
    check(Array.isArray(rows)&&rows.length<=2000&&Buffer.byteLength(JSON.stringify(rows))<=MAX_HISTORY,'The complete assistant request history exceeds its supported receiving size.');
    const ids=new Set();for(const row of rows){inspectReceipt(row);check(!ids.has(row.requestId),'Duplicate assistant request identity.');ids.add(row.requestId);}
    return rows;
  }
  function read(owner,home,id){
    household(owner,home);check(UUID.test(id),'Use the original operation UUID.');
    const row=db.prepare('SELECT data_json,sha256 FROM assistant_requests WHERE household_id=? AND request_id=?').get(home,id);
    if(!row)return {status:'not_found',requestId:id,householdId:home};
    const data=JSON.parse(row.data_json);check(digest(data)===row.sha256,'Saved assistant outcome integrity check failed.',409);
    return {status:data.receivedFrom?'received_history':'committed',householdId:home,operation:inspectReceipt({...data,sha256:row.sha256})};
  }
  function run(grant,id,request,fn){
    check(UUID.test(id)&&object(request)&&object(request.arguments),'Use a stable operation UUID and exact tool arguments.');
    return transaction(()=>{
      // Recheck revocation inside the same transaction as the original writer.
      const row=db.prepare('SELECT * FROM assistant_grants WHERE id=?').get(grant.id);
      check(row&&row.visitor_id===grant.owner&&row.household_id===grant.householdId&&!row.revoked_at,'The assistant connection was revoked.',401);
      const previous=read(grant.owner,grant.householdId,id);
      if(previous.operation){
        check(!previous.operation.receivedFrom,'This imported operation is historical. Read its result, then use a new operation UUID and current context for new work.',409);
        check(previous.operation.requestSha256===digest(request),'This operation UUID already has another exact request.',409);
        return {operation:previous.operation,replayed:true,result:previous.operation.result};
      }
      check(current(grant.owner).id===grant.householdId,'Select this assistant’s linked household in the original browser before continuing.',409);
      const result=fn();
      check(object(result),'The original operation did not return a complete result.',500);
      const body={requestId:id,grantId:grant.id,at:new Date().toISOString(),request:structuredClone(request),requestSha256:digest(request),result:structuredClone(result)};
      const receipt={...body,sha256:digest(body)};
      inspectReceipt(receipt);
      const all=records(grant.owner,grant.householdId);inspectRecords([...all,receipt]);
      db.prepare('INSERT INTO assistant_requests VALUES(?,?,?,?)').run(grant.householdId,id,JSON.stringify(body),receipt.sha256);
      return {operation:receipt,replayed:false,result};
    });
  }
  function importRecords(owner,home,rows,sourceHouseholdId){
    household(owner,home);inspectRecords(rows);
    const wrapped=rows.map(row=>{
      const {sha256,...source}=row;
      const body={...source,receivedFrom:{householdId:sourceHouseholdId,sha256,sourceReceipt:row}};
      return {...body,sha256:digest(body)};
    });
    // Admit the complete receiving postimage before retaining any of its rows.
    // A size/lineage refusal rolls back the enclosing original household import.
    inspectRecords(wrapped);
    for(const row of wrapped){
      const {sha256,...body}=row;
      db.prepare('INSERT INTO assistant_requests VALUES(?,?,?,?)').run(home,row.requestId,JSON.stringify(body),sha256);
    }
  }
  return {list,create,revoke,authenticate,records,inspectRecords,read,run,importRecords};
}
