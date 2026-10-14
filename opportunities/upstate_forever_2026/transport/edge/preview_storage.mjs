/* HTTPS preview transport memory. Scientific authority stays in native TaskRequests/journal. */
export class PreviewStateError extends Error {
  constructor(code,message,id=null){super(message);this.code=code;this.status=code==="PREVIEW_STATE_LOST"?409:503;this.id=id;}
}
export class PreviewSql {
  constructor(){this.requests=new Map();this.chunks=new Map();this.routes=new Map();this.sessions=new Map();this.lost=new Set();this.bytes=0;this.sizes=new Map();}
  forget(map,name,key){map.delete(key);const label=name+":"+key;this.bytes-=this.sizes.get(label)||0;this.sizes.delete(label);}
  remember(map,name,key,value){
    const label=name+":"+key,size=JSON.stringify(value).length*2+256;
    let after=this.bytes-(this.sizes.get(label)||0)+size;
    if(after>24*1024*1024)for(const[id,row]of this.requests){
      if((name==="request"&&key===id)||!["complete","failed"].includes(row.state))continue;
      this.forget(this.requests,"request",id);
      for(const chunkKey of this.chunks.keys())if(JSON.parse(chunkKey)[0]===id)this.forget(this.chunks,"chunk",chunkKey);
      if(!this.lost.has(id)){this.lost.add(id);this.bytes+=256;}
      after=this.bytes-(this.sizes.get(label)||0)+size;
      if(after<=24*1024*1024)break;
    }
    if(after>24*1024*1024)throw new PreviewStateError("TRANSPORT_BACKPRESSURE","Existing connection metadata is being retained; retry the same request.");
    this.bytes=after;this.sizes.set(label,size);map.set(key,value);
  }
  exec(query,...args){
    let rows=[];
    if(query.startsWith('CREATE TABLE'))return {toArray:()=>[]};
    if(query.startsWith('SELECT record FROM relay_requests WHERE id=')){const row=this.requests.get(args[0]);if(row)rows=[{record:row.record}];}
    else if(query.startsWith('INSERT INTO relay_requests(')){const[id,state,updated,record]=args;if(this.lost.has(id))throw new PreviewStateError("PREVIEW_STATE_LOST","Reconcile this same original native operation after connection metadata was released.",id);this.remember(this.requests,"request",id,{id,state,updated,record,last_polled:this.requests.get(id)?.last_polled||0});}
    else if(query.startsWith('SELECT bytes,sha256 FROM relay_chunks')){const row=this.chunks.get(JSON.stringify(args));if(row)rows=[row];}
    else if(query.startsWith('INSERT INTO relay_chunks(')){const[id,side,offset,bytes,sha256]=args,key=JSON.stringify([id,side,offset]);if(!this.chunks.has(key))this.remember(this.chunks,"chunk",key,{bytes,sha256});}
    else if(query.startsWith('SELECT epoch,expires FROM relay_sessions')){const row=this.sessions.get(args[0]);if(row)rows=[row];}
    else if(query.startsWith('SELECT path FROM relay_routes')){const row=this.routes.get(JSON.stringify(args));if(row)rows=[{path:row}];}
    else if(query==='DELETE FROM relay_routes'){for(const key of this.routes.keys())this.forget(this.routes,"route",key);}
    else if(query.startsWith('INSERT OR IGNORE INTO relay_routes'))this.remember(this.routes,"route",JSON.stringify(args),args[1]);
    else if(query.startsWith("SELECT record FROM relay_requests WHERE (state IN")){
      const extra=/OR id IN \(([^)]+)\)/.exec(query),count=extra?(extra[1].match(/\?/g)||[]).length:0;
      const live=new Set(args.slice(0,count)),excluded=new Set(args.slice(count));
      rows=[...this.requests.values()].filter(row=>(['queued','executing','responding'].includes(row.state)||live.has(row.id))&&!excluded.has(row.id)).sort((a,b)=>a.last_polled-b.last_polled).slice(0,64).map(row=>({record:row.record}));
    }
    else if(query.startsWith('UPDATE relay_requests SET last_polled=')){const row=this.requests.get(args[1]);if(row)row.last_polled=args[0];}
    else if(query.startsWith('DELETE FROM relay_sessions WHERE expires<')){for(const[k,v]of this.sessions)if(v.expires<args[0])this.forget(this.sessions,"session",k);}
    else if(query.startsWith('INSERT INTO relay_sessions'))this.remember(this.sessions,"session",args[0],{epoch:args[1],expires:args[2]});
    else if(query.startsWith('DELETE FROM relay_sessions WHERE digest='))this.forget(this.sessions,"session",args[0]);
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
