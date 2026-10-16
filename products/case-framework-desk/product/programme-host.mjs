// MIT. Serialized durable browser branches and whole-programme action ownership.
export function createCASEProgrammeHost({M,storage,session,uuid,changed=()=>{},initial=null}) {
 let work=initial?M.validate(structuredClone(initial)):M.initial(),busy=false,error='',saved=null,exported=null,tail=Promise.resolve(),timer=null,previous=null,recovery=null;
 let key='case-programme-page:'+uuid(); const pointer='case-programme-last:v1';
 const H={get work(){return work},get busy(){return busy},get error(){return error},get previous(){return previous},get recovery(){return recovery},get key(){return key}};
 async function write(){const selected=work,seq=selected.sequence,text=JSON.stringify(selected,null,2)+'\n';try{await storage.write(key,{id:key,text,programmeId:selected.id,sequence:seq});session.setItem(pointer,key);if(session.getItem(pointer)!==key)throw Error('Browser recovery pointer did not persist.');if(work===selected&&work.sequence===seq)saved={work,sequence:seq};error='';changed();}catch(e){error='Browser save failed: '+e.message+'. Keep this page and download the complete programme. Recovery key: '+key;recovery={key,text};changed();throw e;}}
 H.flush=()=>{const run=tail.catch(()=>{}).then(async()=>{for(;;){const w=work,seq=w.sequence;if(saved?.work===w&&saved.sequence===seq)return;await write();if(work===w&&work.sequence===seq)return;}});tail=run;return run;};
 H.dirty=()=>!((saved?.work===work&&saved.sequence===work.sequence)||(exported?.work===work&&exported.sequence===work.sequence));
 H.changed=()=>{changed();clearTimeout(timer);timer=setTimeout(()=>H.flush().catch(()=>{}),150);};
 H.guard=async fn=>{if(busy)throw Error('Finish the current programme operation first.');busy=true;error='';changed();try{return await fn();}catch(e){error=e.message;changed();throw e;}finally{busy=false;changed();}};
 H.ready=(async()=>{let old;try{old=session.getItem(pointer);}catch(e){error='Saved browser selection could not be read: '+e.message;}
  if(old){try{const record=await storage.read(old);if(record?.text){previous={key:old,text:record.text};const incoming=M.validate(M.parse(record.text));await M.verify(incoming);previous.work=incoming;}}catch(e){if(previous)previous.error=e.message;error='Previous browser copy needs attention. Its original is retained when available.';}}
  // An opened complete HTML is always the initial authority. Prior browser work is offered explicitly.
  changed();return H;})();
 H.usePrevious=()=>H.guard(async()=>{await H.ready;if(!previous?.work)throw Error('No valid prior browser programme. Download its original for recovery.');const current=work,seq=work.sequence;await M.importProgramme(work,previous.text,'Previous browser programme');if(work!==current||seq+1!==work.sequence)throw Error('Working programme changed during prior-copy admission.');H.changed();});
 H.open=raw=>H.guard(async()=>{const current=work,seq=work.sequence;const e=await M.importProgramme(work,raw.text,raw.name);if(work!==current||work.sequence!==seq+1)throw Error('Current programme changed during admission. Incoming original remains retained.');H.changed();return e;});
 H.restore=id=>H.guard(async()=>{M.restore(work,id);H.changed();});
 H.newProgramme=()=>H.guard(async()=>{await H.flush();work=M.initial();key='case-programme-page:'+uuid();saved=null;exported=null;H.changed();});
 H.markDownloaded=(origin,sequence)=>{if(work===origin&&work.sequence===sequence)exported={work,sequence};changed();};
 H.list=async()=>storage.list?await storage.list():[];
 H.addSaved=id=>H.guard(async()=>{const record=await storage.read(id);if(!record?.text)throw Error('Saved browser copy is absent.');const e=await M.importProgramme(work,record.text,'Browser copy '+id);H.changed();return e;});
 H.acknowledgeError=()=>{error='';changed();};
 return H;
}
