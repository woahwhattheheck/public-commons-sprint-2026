/* HTTPS preview transport memory. Scientific authority stays in native TaskRequests/journal. */
export class PreviewSql {
  constructor(){this.requests=new Map();this.chunks=new Map();this.routes=new Map();this.sessions=new Map();this.metadataBytes=0;this.maximumBytes=40*1024*1024;this.maximumRecords=4096;this.maximumChunks=65536;}
  capacity(){const error=new Error('Preview metadata capacity is occupied by active original requests. Finish/reconcile those requests and retry the SAME unadmitted request; native TaskRequests/journal remain authoritative.');error.code='TRANSPORT_BACKPRESSURE';error.status=503;throw error;}
  retire(protectedId){
    for(const[id,row]of this.requests){
      if(id===protectedId||!['complete','failed'].includes(row.state))continue;
      this.requests.delete(id);this.metadataBytes-=row.cost;
      for(const key of this.chunks.keys())if(JSON.parse(key)[0]===id){this.chunks.delete(key);this.metadataBytes-=256;}
      return true;
    }
    return false;
  }
  admit(cost,recordDelta=0,chunkDelta=0,protectedId=null){
    while(this.metadataBytes+cost>this.maximumBytes||this.requests.size+recordDelta>this.maximumRecords||this.chunks.size+chunkDelta>this.maximumChunks){if(!this.retire(protectedId))this.capacity();}
  }
  exec(query,...args){
    let rows=[];
    if(query.startsWith('CREATE TABLE'))return {toArray:()=>[]};
    if(query.startsWith('SELECT record FROM relay_requests WHERE id=')){const row=this.requests.get(args[0]);if(row)rows=[{record:row.record}];}
    else if(query.startsWith('INSERT INTO relay_requests(')){const[id,state,updated,record]=args,old=this.requests.get(id),cost=record.length*2+512;this.admit(cost-(old?.cost||0),old?0:1,0,id);this.metadataBytes+=cost-(old?.cost||0);this.requests.set(id,{id,state,updated,record,cost,last_polled:old?.last_polled||0});}
    else if(query.startsWith('SELECT bytes,sha256 FROM relay_chunks')){const row=this.chunks.get(JSON.stringify(args));if(row)rows=[row];}
    else if(query.startsWith('INSERT INTO relay_chunks(')){const[id,side,offset,bytes,sha256]=args,key=JSON.stringify([id,side,offset]);if(!this.chunks.has(key)){this.admit(256,0,1,id);this.chunks.set(key,{bytes,sha256});this.metadataBytes+=256;}}
    else if(query.startsWith('SELECT epoch,expires FROM relay_sessions')){const row=this.sessions.get(args[0]);if(row)rows=[row];}
    else if(query.startsWith('SELECT path FROM relay_routes')){const row=this.routes.get(JSON.stringify(args));if(row)rows=[{path:row}];}
    else if(query==='DELETE FROM relay_routes')this.routes.clear();
    else if(query.startsWith('INSERT OR IGNORE INTO relay_routes'))this.routes.set(JSON.stringify(args),args[1]);
    else if(query.startsWith("SELECT record FROM relay_requests WHERE (state IN")){
      const extra=/OR id IN \(([^)]+)\)/.exec(query),count=extra?(extra[1].match(/\?/g)||[]).length:0;
      const live=new Set(args.slice(0,count)),excluded=new Set(args.slice(count));
      rows=[...this.requests.values()].filter(row=>(['queued','executing','responding'].includes(row.state)||live.has(row.id))&&!excluded.has(row.id)).sort((a,b)=>a.last_polled-b.last_polled).slice(0,64).map(row=>({record:row.record}));
    }
    else if(query.startsWith('UPDATE relay_requests SET last_polled=')){const row=this.requests.get(args[1]);if(row)row.last_polled=args[0];}
    else if(query.startsWith('DELETE FROM relay_sessions WHERE expires<')){for(const[k,v]of this.sessions)if(v.expires<args[0])this.sessions.delete(k);}
    else if(query.startsWith('INSERT INTO relay_sessions'))this.sessions.set(args[0],{epoch:args[1],expires:args[2]});
    else if(query.startsWith('DELETE FROM relay_sessions WHERE digest='))this.sessions.delete(args[0]);
    else throw new Error('Unsupported preview metadata query');
    return {toArray:()=>rows};
  }
}

export function previewStorage(original){
  const values=new Map(),sql=new PreviewSql();
  let transactionTail=Promise.resolve();
  const storage={sql,
    async get(key){if(values.has(key))return values.get(key);return original.get(key);},
    async put(key,value){values.set(key,value);},
    async list(options){return original.list(options);},
    async transaction(callback){
      const previous=transactionTail;let release;
      transactionTail=new Promise(resolve=>{release=resolve;});
      await previous;
      try{return await callback(storage);}finally{release();}
    },
    transactionSync(callback){return callback();}
  };
  return storage;
}

export async function signPreviewSession(payload,secret){
  const text=btoa(JSON.stringify(payload)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)));
  return text+'.'+Array.from(signature,x=>x.toString(16).padStart(2,'0')).join('');
}

export async function readPreviewSession(value,secret,epoch,transportEpoch){
  try{
    const parts=String(value).split('.');if(parts.length!==2)return false;
    const[body,digest]=parts;if(!/^[A-Za-z0-9_-]+$/.test(body||'')||!/^[a-f0-9]{64}$/.test(digest||''))return false;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const signature=Uint8Array.from(digest.match(/../g),x=>parseInt(x,16));
    if(!await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(body)))return false;
    const plain=atob(body.replaceAll('-','+').replaceAll('_','/'));
    if(btoa(plain).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')!==body)return false;
    const decoded=JSON.parse(plain);
    return decoded.epoch===epoch&&decoded.transport_epoch===transportEpoch&&decoded.expires>Date.now();
  }catch{return false;}
}
