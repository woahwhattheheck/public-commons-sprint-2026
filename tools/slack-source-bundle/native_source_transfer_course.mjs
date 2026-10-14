import {createArchiveCodec} from "../../opportunities/upstate_forever_2026/source_tools/archive_codec.mjs";
import {createNativeSourceTransfer} from "./native_source_transfer.mjs";
import {pathToFileURL} from "node:url";
/** Authored protocol course; no service calls, mailbox data, or customer source. MIT. */
export async function runNativeSourceTransferCourse(codec, createTransfer) {
  const clone=x=>JSON.parse(JSON.stringify(x)),checks=[];
  const ok=(value,label)=>{if(!value)throw new Error("COURSE_FAILED: "+label);checks.push(label);};
  async function rejects(fn,code){try{await fn();throw new Error("NOT_REJECTED "+code);}catch(e){if(e.code!==code&&e.message!==code)throw e;checks.push(code);}}
  function fixture({readComplete=true,manifestPreview=false}={}){
    const records=new Map(),originals=new Map(),drafts=new Map(),uploads=new Map();
    let createCalls=0,attachCalls=0,page="# Authored source page\n",loseDraft=false,loseInsert=false,queuedInsert=false,taskReads=0,pendingContent="";
    const journal={load:async k=>clone(records.get(k)||null),compareAndSwap:async(k,rev,next)=>{if((records.get(k)?.revision??null)!==rev)return false;records.set(k,clone(next));return true;}};
    const call=async(name,args)=>{
      let v;
      if(name==="gmail_get_profile")v={email:"operator@example.test"};
      else if(name==="gmail_create_draft"){
        createCalls++;const id="draft-"+createCalls,message_id="message-"+createCalls;
        const parts=args.payload.parts.map((p,i)=>{
          if(!p.filename)return {...clone(p),part_id:String(i)};
          let b64=p.body.base64_url_content.replace(/-/g,"+").replace(/_/g,"/");b64+="=".repeat((4-b64.length%4)%4);
          const data=codec.base64Decode(b64),aid=message_id+"-"+i,file_id="file-"+aid;
          originals.set(file_id,codec.utf8Decode(data));
          return {part_id:String(i),filename:p.filename,mime_type:p.mime_type,body:{size:data.length,attachment_id:aid},read_attachment_supported:true};
        });
        const message={id:message_id,label_ids:["DRAFT"],thread_id:message_id,payload:{mime_type:"multipart/mixed",headers:[{name:"From",value:args.from_address||"operator@example.test"},{name:"Subject",value:args.subject}],parts}};
        drafts.set(id,message);v={id,message:{id:message_id,thread_id:message_id,label_ids:["DRAFT"]}};
        if(loseDraft){loseDraft=false;throw new Error("AUTHORED_CONNECTION_LOST_AFTER_ACCEPTANCE");}
      }else if(name==="gmail_read_email")v=[...drafts.values()].find(d=>d.id===args.message_id);
      else if(name==="gmail_list_drafts")v={drafts:[...drafts].map(([draft_id,m])=>({draft_id,message_id:m.id})),next_page_token:null};
      else if(name==="gmail_read_attachment"){
        const m=[...drafts.values()].find(d=>d.id===args.message_id),p=m.payload.parts.find(p=>p.body?.attachment_id===args.attachment_id||(args.filename&&p.filename===args.filename));
        const file_id="file-"+p.body.attachment_id;
        const preview=manifestPreview&&p.filename==="SOURCE_TRANSFER_MANIFEST.json"?JSON.stringify(JSON.parse(originals.get(file_id)),null,2):null;
        v={message_id:m.id,filename:p.filename,mime_type:p.mime_type,size_bytes:p.body.size,content:preview===null?"AUTHORED TRUNCATED PREVIEW":[{type:"text",text:preview}],content_truncated:preview===null,extraction_file_uri:{file_id:"extracted-"+file_id},file_uri:{file_id,download_url:"https://source.invalid/"+file_id,file_name:p.filename,mime_type:p.mime_type}};
      }else if(name==="notion_notion_get_self")v={workspace:{id:"workspace-authored"},user:{id:"user-authored"}};
      else if(name==="notion_fetch")v={id:"page-authored",text:page};
      else if(name==="notion_notion_create_attachment"){
        const id="upload-"+(uploads.size+1);uploads.set(id,args.content);
        v={file_upload_id:id,content_length:codec.utf8Encode(args.content).length,status:"uploaded",suggested_markdown:'<file src="file-upload://'+id+'"></file>'};
      }else if(name==="notion_notion_update_page"){
        attachCalls++;if(queuedInsert){queuedInsert=false;pendingContent=args.content;v={object:"async_task",id:"task-authored",status:"queued"};return {content:[{type:"text",text:JSON.stringify(v)}]};}page+="\n"+args.content.replace(/file-upload:\/\/(upload-\d+)/g,(_,id)=>"notion-file-block://authored/"+id);
        if(loseInsert){loseInsert=false;throw new Error("AUTHORED_INSERT_REPLY_LOST");}v={page_id:"page-authored"};
      }else if(name==="notion_notion_get_async_task"){
        taskReads++;
        if(taskReads>1){page+="\n"+pendingContent.replace(/file-upload:\/\/(upload-\d+)/g,(_,id)=>"notion-file-block://authored/"+id);pendingContent="";}
        v={object:"async_task",id:"task-authored",status:taskReads>1?"succeeded":"running"};
      }else if(name==="notion_notion_download_attachment")v={content:uploads.get(args.file_upload_id)};
      else if(name==="notion_notion_get_file_download_urls")v={files:args.references.map(reference=>({reference,url:"https://source.invalid/authored-download"})),unresolved:[]};
      else throw new Error("UNEXPECTED_ACTION "+name);
      return name.startsWith("notion")?{content:[{type:"text",text:JSON.stringify(v)}],isError:false}:{content:[{type:"text",text:"Action completed."}],structuredContent:clone(v),isError:false};
    };
    const api=createTransfer({codec,call,journal,readOriginal:readComplete?async ref=>originals.get(ref.file_id):null,now:()=>"2026-01-02T03:04:05.000Z"});
    const input={operation_id:"authored-operation",link_id:"authored-link",account_email:"operator@example.test",files:[{filename:"source.json",content:'{\r\n  "literal": "a  b\\tand \u00a0 snowman ☃", "id": 9007199254740993\r\n}\r\n'}]};
    input.files[0].bytes=codec.utf8Encode(input.files[0].content).length;input.files[0].sha256=codec.sha256(codec.utf8Encode(input.files[0].content));
    const target={page_id:"page-authored",workspace_id:"workspace-authored",user_id:"user-authored"};
    return {api,input,target,journal,records,drafts,call,originals,get createCalls(){return createCalls;},get attachCalls(){return attachCalls;},loseDraft:()=>{loseDraft=true;},loseInsert:()=>{loseInsert=true;},queueInsert:()=>{queuedInsert=true;}};
  }
  const f=fixture(),p=f.api.prepare(f.input),s=await f.api.start(p);
  const args=f.api.draftArgs(p);
  ok(p.transport==="attachment-manifest-v2"&&args.payload.parts.every(p=>p.filename&&p.content_disposition==="attachment"&&!p.charset&&!p.body.content)&&!Object.hasOwn(args,"from_address"),"new plans use minimal attachment-only MIME with a complete manifest file");
  const first=await f.api.advance(s.key),again=await f.api.advance(s.key);
  ok(first.record.manifest.verified&&first.record.manifest.content_verified.via==="complete_original_read","manifest original bytes verified separately from source files");
  ok(first.bytes_verified&&again.bytes_verified&&f.createCalls===1,"complete UTF8 original and repeat reuse one draft");
  ok(first.record.files[0].original.file_uri.file_id.startsWith("file-")&&!first.record.files[0].original.file_uri.file_id.startsWith("extracted-"),"original file is distinct from extraction preview");
  await f.api.toNotion(s.key,0,f.target);await f.api.toNotion(s.key,0,f.target);
  ok(f.attachCalls===1,"attached Notion file reused without duplicate page insertion");
  await rejects(()=>f.api.start(f.api.prepare({...f.input,files:[{...f.input.files[0],content:"changed"}]})),"SOURCE_IDENTITY_MISMATCH");
  await rejects(()=>f.api.toNotion(s.key,0,{...f.target,page_id:"other-page"}),"NOTION_TARGET_MISMATCH");
  const u=fixture(),up=u.api.prepare(u.input);await u.api.start(up);u.loseDraft();
  try{await u.api.advance(up.key);}catch(e){ok(e.message==="AUTHORED_CONNECTION_LOST_AFTER_ACCEPTANCE","accepted draft lost response retained");}
  const paused=await u.api.advance(up.key);ok(paused.state==="reconciliation_required"&&u.createCalls===1,"uncertain draft cannot auto-create again");
  const rec=await u.api.reconcileDraft(up.key,{draft_id:"draft-1",message_id:"message-1"});
  ok(rec.bytes_verified&&u.createCalls===1,"observed draft ID and original bytes reconcile same operation");
  const n=fixture(),np=n.api.prepare(n.input);await n.api.start(np);await n.api.advance(np.key);n.loseInsert();
  try{await n.api.toNotion(np.key,0,n.target);}catch(e){ok(e.message==="AUTHORED_INSERT_REPLY_LOST","accepted insertion lost response retained");}
  const recovered=await n.api.toNotion(np.key,0,n.target);
  ok(recovered.state==="notion_attached"&&n.attachCalls===1,"uncertain page insertion recovered by unique original section");
  const q=fixture(),qp=q.api.prepare(q.input);await q.api.start(qp);
  const parallel=await Promise.allSettled([q.api.advance(qp.key),q.api.advance(qp.key)]);
  ok(q.createCalls===1&&parallel.some(x=>x.status==="rejected"&&x.reason.code==="JOURNAL_CONFLICT"),"concurrent original creation admitted once");
  const m=fixture(),mp=m.api.prepare(m.input);await m.api.start(mp);await m.api.advance(mp.key);
  m.drafts.get("draft-1").payload.headers.push({name:"To",value:"external@example.test"});
  await rejects(()=>m.api.advance(mp.key),"DRAFT_HAS_RECIPIENT_OR_REPLY_HEADERS");
  const r=fixture(),rp=r.api.prepare(r.input);await r.api.start(rp);await r.api.advance(rp.key);
  const received=await r.api.receiveExisting({operation_id:"authored-receive",link_id:"authored-link",account_email:"operator@example.test",message_id:"message-1",files:rp.files});
  ok(received.bytes_verified&&r.createCalls===1,"receiving seat original read requires no new upload");
  const a=fixture(),ap=a.api.prepare(a.input);await a.api.start(ap);await a.api.advance(ap.key);a.queueInsert();
  const aq=await a.api.toNotion(ap.key,0,a.target);
  ok(aq.state==="notion_attachment_pending"&&aq.record.files[0].notion.async_task_id==="task-authored","queued Notion task handle persisted");
  const running=await a.api.toNotion(ap.key,0,a.target);
  ok(running.state==="notion_attachment_pending"&&a.attachCalls===1,"queued task polled without repeated insert");
  const done=await a.api.toNotion(ap.key,0,a.target);
  ok(done.state==="notion_attached"&&a.attachCalls===1,"completed task original attachment readback");
  const legacy=fixture(),lp=legacy.api.prepare({...legacy.input,transport:"inline-manifest-v1"});
  ok(!Object.hasOwn(lp,"transport")&&!Object.hasOwn(lp.manifest,"transport"),"historical v1 plan and manifest shape retained");
  await legacy.api.start(lp);legacy.loseDraft();
  try{await legacy.api.advance(lp.key);}catch{}
  const retained=await legacy.api.start(legacy.api.prepare(legacy.input));
  ok(retained.plan.fingerprint===lp.fingerprint&&retained.phase==="draft_create_pending"&&legacy.createCalls===1,"new default preparation preserves original pending v1 identity");
  await legacy.api.reconcileDraft(lp.key,{draft_id:"draft-1",message_id:"message-1"});
  ok((await legacy.api.advance(lp.key)).bytes_verified&&legacy.createCalls===1,"historical inline manifest resumes and reconciles original draft");
  const extracted=fixture({readComplete:false,manifestPreview:true}),ep=extracted.api.prepare(extracted.input);
  await extracted.api.start(ep);
  const ev=await extracted.api.advance(ep.key);
  ok(ev.record.manifest.content_verified.via==="complete_extracted_json"&&!ev.record.manifest.verified&&!ev.bytes_verified,"complete reformatted manifest validates metadata without claiming original byte verification");
  const complete=createTransfer({codec,call:extracted.call,journal:extracted.journal,readOriginal:async ref=>extracted.originals.get(ref.file_id)});
  const resumed=await complete.advance(ep.key);
  ok(resumed.bytes_verified&&resumed.record.manifest.verified&&extracted.createCalls===1,"metadata-only operation resumes with complete original reads and one unchanged draft");
  const truncated=fixture({readComplete:false}),tp=truncated.api.prepare(truncated.input);await truncated.api.start(tp);
  await rejects(()=>truncated.api.advance(tp.key),"COMPLETE_MANIFEST_READER_REQUIRED");
  const changed=fixture({readComplete:false,manifestPreview:true}),cp=changed.api.prepare(changed.input);await changed.api.start(cp);await changed.api.advance(cp.key);
  const mf=changed.drafts.get("draft-1").payload.parts.find(p=>p.filename==="SOURCE_TRANSFER_MANIFEST.json");
  const mfid="file-"+mf.body.attachment_id,body=JSON.parse(changed.originals.get(mfid));
  body.operation_id="other-operation";changed.originals.set(mfid,JSON.stringify(body));
  await rejects(()=>changed.api.advance(cp.key),"DRAFT_MANIFEST_MISMATCH");
  await rejects(()=>f.api.prepare({...f.input,files:[{...f.input.files[0],filename:"source_transfer_manifest.json"}]}),"RESERVED_MANIFEST_FILENAME");
  return {schema:"commons.native-source-transfer-course/v1",scope:"authored protocol behavior; no live service writes",checks};
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runNativeSourceTransferCourse(createArchiveCodec(), createNativeSourceTransfer);
  process.stdout.write(JSON.stringify(result, null, 2)+"\n");
}
