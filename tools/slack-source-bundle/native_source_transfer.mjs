/**
 * Same-account original source files through native Gmail drafts and Notion.
 * Uses the caller's existing atomic journal. No send, delete, account switching,
 * credential loading, service installation, background worker, or hidden retry.
 * MIT.
 */
export function createNativeSourceTransfer({codec, call, journal, now = () => new Date().toISOString(), readOriginal = null}) {
  const SCHEMA = "commons.native-source-transfer/v1";
  const MAX = 16 * 1024 * 1024;
  const INLINE = "inline-manifest-v1", ATTACHED = "attachment-manifest-v2";
  const MANIFEST_FILE = "SOURCE_TRANSFER_MANIFEST.json";
  const TYPES = {json:"application/json",txt:"text/plain",md:"text/markdown",html:"text/html",csv:"text/csv",tsv:"text/tab-separated-values",xml:"application/xml",css:"text/css",svg:"image/svg+xml",yaml:"application/yaml",yml:"application/yaml"};
  function fail(code, detail) { const e = new Error(code); e.code = code; if(detail!==undefined)e.detail=detail; throw e; }
  function assert(ok, code, detail) { if(!ok)fail(code,detail); }
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function text(x, name, max=512){assert(typeof x==="string"&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x),"INVALID_"+name);return x;}
  function email(x){text(x,"EMAIL");assert(/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(x),"INVALID_EMAIL");return x.toLowerCase();}
  function mailbox(value){
    text(value,"FROM",1024);
    const match=value.match(/^[^<>\r\n]*<([^<>\r\n]+)>$/);
    return email(match?match[1]:value);
  }
  function digest(s){return codec.sha256(codec.utf8Encode(s));}
  function canonical(v){if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";if(v&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";return JSON.stringify(v);}
  function escaped(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function unescaped(s){return s.replace(/&quot;/g,'"').replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&");}
  function bytesOf(s){assert(typeof s==="string","COMPLETE_UTF8_CONTENT_REQUIRED");const b=codec.utf8Encode(s);assert(codec.utf8Decode(b)===s,"INVALID_UTF8_SOURCE");return b;}
  function bodyResult(result) {
    assert(result && typeof result==="object","INVALID_PROVIDER_RESULT");
    if(result.isError===true)fail("PROVIDER_ERROR",result);
    let value=result.structuredContent;
    if(!value) {
      const blocks=(result.content||[]).filter(x=>x.type==="text");
      if(blocks.length===1){try{value=JSON.parse(blocks[0].text);}catch{}}
    }
    assert(value&&typeof value==="object","UNRECOGNIZED_PROVIDER_RESULT",result);
    if(value.isError===true || value.error || value.ok===false)fail("PROVIDER_ERROR",result);
    return value;
  }
  async function invoke(name,args){const result=await call(name,args);return {raw:result,value:bodyResult(result)};}
  function identity(f){return {filename:f.filename,mime_type:f.mime_type,bytes:f.bytes,sha256:f.sha256};}
  function fileContent(plan,index){const f=plan.files[index];assert(f,"UNKNOWN_FILE");const b=codec.base64Decode(f.content_base64);assert(b.length===f.bytes&&codec.sha256(b)===f.sha256,"STORED_SOURCE_CHANGED");return codec.utf8Decode(b);}
  function prepare(input){
    const operation_id=text(input.operation_id,"OPERATION",96);
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(operation_id),"INVALID_OPERATION");
    const link_id=text(input.link_id,"LINK_ID"), account_email=email(input.account_email);
    assert(Array.isArray(input.files)&&input.files.length>0&&input.files.length<=32,"INVALID_FILES");
    const transport=input.transport??ATTACHED;
    assert([INLINE,ATTACHED].includes(transport),"UNKNOWN_TRANSFER_TRANSPORT");
    const names=new Set();let total=0;
    const files=input.files.map(f=>{
      const filename=text(f.filename,"FILENAME",160);
      assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)&&!filename.includes(".."),"UNSAFE_FILENAME");
      assert(transport!==ATTACHED||filename.toLowerCase()!==MANIFEST_FILE.toLowerCase(),"RESERVED_MANIFEST_FILENAME");
      assert(!names.has(filename.toLowerCase()),"DUPLICATE_FILENAME");names.add(filename.toLowerCase());
      const ext=filename.split(".").at(-1).toLowerCase(),mime_type=TYPES[ext];
      assert(mime_type&&(!f.mime_type||f.mime_type===mime_type),"UNSUPPORTED_TEXT_FORMAT");
      const b=bytesOf(f.content);total+=b.length;assert(total<=MAX,"SOURCE_LIMIT_EXCEEDED");
      const sha256=codec.sha256(b);
      assert(Number.isSafeInteger(f.bytes)&&f.bytes===b.length&&f.sha256===sha256,"SOURCE_IDENTITY_MISMATCH",filename);
      return {filename,mime_type,bytes:b.length,sha256,content_base64:codec.base64Encode(b)};
    });
    const edition=transport===ATTACHED?{transport}:{};
    const manifest={schema:SCHEMA,...edition,operation_id,link_id,account_email,files:files.map(identity)};
    const fingerprint=digest(canonical(manifest));
    return {schema:SCHEMA,...edition,operation_id,link_id,account_email,files,manifest,fingerprint,key:"native-source-transfer:"+digest(link_id+"\n"+operation_id),subject:"INTERNAL SOURCE TRANSFER - DO NOT SEND - "+operation_id+" - "+fingerprint.slice(0,16)};
  }
  function validatePlan(plan){
    assert(plan?.schema===SCHEMA,"INVALID_PLAN");
    const rebuilt=prepare({transport:plan.transport??INLINE,operation_id:plan.operation_id,link_id:plan.link_id,account_email:plan.account_email,files:plan.files.map((f,i)=>({...f,content:fileContent(plan,i)}))});
    assert(canonical(rebuilt)===canonical(plan),"PLAN_IDENTITY_MISMATCH");return plan;
  }
  async function start(plan){
    validatePlan(plan);
    let record=await journal.load(plan.key);
    if(record){
      assert(record.schema===SCHEMA&&record.key===plan.key,"INVALID_OPERATION_RECORD");validatePlan(record.plan);
      // A newer caller resumes the original transport, identity, pending action and receipts.
      const source=p=>({operation_id:p.operation_id,link_id:p.link_id,account_email:p.account_email,files:p.files.map(identity)});
      assert(canonical(source(record.plan))===canonical(source(plan)),"OPERATION_PAYLOAD_CONFLICT");return record;
    }
    record={schema:SCHEMA,key:plan.key,revision:1,plan:clone(plan),phase:"prepared",created_at:now(),updated_at:now(),draft:null,files:plan.files.map(f=>({identity:identity(f),original:null,verified:null,notion:null})),receipts:[],errors:[]};
    if(!await journal.compareAndSwap(plan.key,null,record))fail("JOURNAL_CONFLICT");
    return clone(record);
  }
  async function current(key){
    const s=await journal.load(key);assert(s?.schema===SCHEMA&&s.key===key,"UNKNOWN_OPERATION");validatePlan(s.plan);return s;
  }
  async function save(s,patch){
    const next={...clone(s),...clone(patch),revision:s.revision+1,updated_at:now()};
    assert(await journal.compareAndSwap(s.key,s.revision,next),"JOURNAL_CONFLICT");
    return next;
  }
  async function fault(s,error,stage){
    const item={at:now(),stage,code:error?.code||"TRANSPORT_OR_PROVIDER_EXCEPTION",message:String(error?.message||error),detail:error?.detail||null};
    try{await save(s,{errors:[...s.errors,item]});}catch{}
    throw error;
  }
  async function account(plan){
    const r=await invoke("gmail_get_profile",{link_id:plan.link_id});
    assert(email(r.value.email||r.value.email_address||r.value.emailAddress)===plan.account_email,"ACCOUNT_IDENTITY_MISMATCH");return r;
  }
  function manifestFile(plan){
    const content=canonical(plan.manifest)+"\n",bytes=bytesOf(content);
    return {filename:MANIFEST_FILE,mime_type:"application/json",bytes:bytes.length,sha256:codec.sha256(bytes),content_base64:codec.base64Encode(bytes)};
  }
  function draftArgs(plan){
    validatePlan(plan);
    if(plan.transport===ATTACHED){
      const parts=[manifestFile(plan),...plan.files].map(f=>({
        mime_type:f.mime_type,filename:f.filename,content_disposition:"attachment",
        body:{base64_url_content:f.content_base64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
      }));
      return {link_id:plan.link_id,subject:plan.subject,payload:{mime_type:"multipart/mixed",parts},response_fields:["id","message"]};
    }
    const content='<p>Internal source transfer. Do not send.</p><pre id="source-transfer-manifest">'+escaped(canonical(plan.manifest))+"</pre>";
    return {link_id:plan.link_id,from_address:plan.account_email,subject:plan.subject,payload:{mime_type:"multipart/mixed",parts:[{mime_type:"text/html",charset:"UTF-8",body:{content}},...plan.files.map(f=>({mime_type:f.mime_type,filename:f.filename,content_disposition:"attachment",body:{base64_url_content:f.content_base64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}}))]},response_fields:["id","message"]};
  }

  /**
   * Pure inspection of the minimal recipient-free connector recipe. Findings
   * describe deviations from this recipe, not every provider-valid MIME form.
   * Size is exact JSON.stringify UTF-8; a supplied budget is advisory only.
   */
  function inspectDraftArguments(args,{maxRequestBytes=null}={}){
    assert(maxRequestBytes===null||(Number.isSafeInteger(maxRequestBytes)&&maxRequestBytes>0),"INVALID_REQUEST_BYTE_ADVISORY");
    assert(args&&typeof args==="object"&&!Array.isArray(args),"DRAFT_ARGUMENTS_REQUIRED");
    let serialized;try{serialized=JSON.stringify(args);}catch{fail("DRAFT_ARGUMENTS_NOT_JSON");}
    const request=bytesOf(serialized),findings=[],attachments=[],inline=[];
    const finding=(code,path,detail)=>findings.push({code,path,...(detail===undefined?{}:{detail})});
    const keys=(v,allowed,path)=>{
      if(!v||typeof v!=="object"||Array.isArray(v)){finding("OBJECT_REQUIRED",path);return false;}
      for(const k of Object.keys(v))if(!allowed.includes(k))finding("FIELD_OUTSIDE_MINIMAL_RECIPE",path+"."+k);
      return true;
    };
    keys(args,["link_id","subject","payload","response_fields","from_address","draft_id"],"$");
    for(const k of ["link_id"])if(typeof args[k]!=="string"||!args[k])finding("REQUIRED_TEXT_MISSING","$."+k);
    if(!Object.hasOwn(args,"draft_id")&&(typeof args.subject!=="string"||!args.subject))finding("REQUIRED_TEXT_MISSING","$.subject");
    if(Object.hasOwn(args,"draft_id")&&(typeof args.draft_id!=="string"||!args.draft_id))finding("REQUIRED_TEXT_MISSING","$.draft_id");
    if(typeof args.subject==="string"&&/[\r\n]/.test(args.subject))finding("HEADER_LINE_BREAK","$.subject");
    const payload=args.payload;
    if(keys(payload,["mime_type","parts"],"$.payload")){
      if(payload.mime_type!=="multipart/mixed")finding("MIXED_PAYLOAD_REQUIRED","$.payload.mime_type");
      if(!Array.isArray(payload.parts)||!payload.parts.length)finding("PARTS_REQUIRED","$.payload.parts");
      else payload.parts.forEach((part,index)=>{
        const path="$.payload.parts["+index+"]";
        if(!part||typeof part!=="object"||Array.isArray(part)){finding("OBJECT_REQUIRED",path);return;}
        const attached=Object.hasOwn(part,"filename")||part.content_disposition==="attachment";
        keys(part,attached?["mime_type","filename","content_disposition","body"]:["mime_type","charset","body"],path);
        if(attached&&Object.hasOwn(part,"charset"))finding("ATTACHMENT_CHARSET_OUTSIDE_MINIMAL_RECIPE",path+".charset","Keep charset on an optional inline text part; the maintained attachment recipe omits it.");
        if(typeof part.mime_type!=="string"||!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(part.mime_type||""))finding("BARE_MIME_TYPE_REQUIRED",path+".mime_type");
        if(attached){
          if(typeof part.filename!=="string"||!part.filename||/[\u0000-\u001f\u007f]/.test(part.filename))finding("FILENAME_REQUIRED",path+".filename");
          if(part.content_disposition!=="attachment")finding("ATTACHMENT_DISPOSITION_REQUIRED",path+".content_disposition");
          const entry={index,filename:part.filename??null,mime_type:part.mime_type??null,bytes:null,sha256:null};
          attachments.push(entry);
          if(!keys(part.body,["base64_url_content"],path+".body"))return;
          const value=part.body.base64_url_content;
          if(typeof value!=="string"||!/^[A-Za-z0-9_-]*={0,2}$/.test(value)){finding("BASE64URL_ATTACHMENT_REQUIRED",path+".body");return;}
          const bare=value.replace(/=+$/,""),padding=value.length-bare.length;
          if(bare.length%4===1||(padding&&padding!==(4-bare.length%4)%4)){finding("BASE64URL_INVALID",path+".body");return;}
          try{
            const standard=bare.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-bare.length%4)%4);
            const bytes=codec.base64Decode(standard);
            const roundtrip=codec.base64Encode(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
            if(roundtrip!==bare){finding("BASE64URL_INVALID",path+".body");return;}
            entry.bytes=bytes.length;entry.sha256=codec.sha256(bytes);
          }catch{finding("BASE64URL_INVALID",path+".body");}
        }else{
          if(!["text/plain","text/html"].includes(part.mime_type))finding("INLINE_TEXT_TYPE_REQUIRED",path+".mime_type");
          if(part.charset!==undefined&&String(part.charset).toLowerCase()!=="utf-8")finding("INLINE_CHARSET_OUTSIDE_RECIPE",path+".charset");
          if(keys(part.body,["content"],path+".body")&&typeof part.body.content==="string"){
            const bytes=bytesOf(part.body.content);inline.push({index,mime_type:part.mime_type,bytes:bytes.length,sha256:codec.sha256(bytes)});
          }else finding("INLINE_TEXT_REQUIRED",path+".body.content");
        }
      });
    }
    if(!attachments.length)finding("SOURCE_ATTACHMENTS_REQUIRED","$.payload.parts");
    const seen=new Set();for(const f of attachments){if(typeof f.filename!=="string")continue;const key=f.filename.toLowerCase();if(seen.has(key))finding("DUPLICATE_ATTACHMENT_FILENAME","$.payload.parts["+f.index+"].filename");seen.add(key);}
    const complete=attachments.every(f=>f.bytes!==null);
    return {schema:"commons.native-source-request-preview/v1",recipe:"recipient-free-base64url-attachments",
      recipe_compatible:findings.length===0,findings,request_utf8_bytes:request.length,request_sha256:codec.sha256(request),
      attachment_count:attachments.length,attachment_bytes:complete?attachments.reduce((n,f)=>n+f.bytes,0):null,
      attachments,inline_parts:inline,
      size_advisory:{configured_bytes:maxRequestBytes,exceeded:maxRequestBytes===null?null:request.length>maxRequestBytes,provider_limit_inferred:false},
      provider_acceptance:"not_observed"};
  }
  function preview(plan,options={}){
    return inspectDraftArguments(draftArgs(plan),options);
  }

  function mimeParts(p){return [p,...(p.parts||[]).flatMap(mimeParts)];}
  function inspectMessage(plan,message){
    assert(Array.isArray(message.label_ids)&&message.label_ids.includes("DRAFT")&&!message.label_ids.includes("SENT"),"MESSAGE_IS_NOT_UNSENT_DRAFT");
    const headers=message.payload?.headers||[];
    const values=name=>headers.filter(h=>String(h.name).toLowerCase()===name).map(h=>String(h.value));
    assert(["to","cc","bcc","reply-to","in-reply-to","references"].every(n=>values(n).length===0),"DRAFT_HAS_RECIPIENT_OR_REPLY_HEADERS");
    assert(values("subject").length===1&&values("subject")[0]===plan.subject,"DRAFT_SUBJECT_MISMATCH");
    assert(values("from").length===1&&mailbox(values("from")[0])===plan.account_email,"DRAFT_ACCOUNT_MISMATCH");
    const parts=mimeParts(message.payload);
    if(plan.transport!==ATTACHED){
      const marker=parts.filter(p=>p.mime_type==="text/html"&&typeof p.body?.content==="string").map(p=>p.body.content.match(/<pre id="source-transfer-manifest">([\s\S]*?)<\/pre>/)?.[1]).filter(Boolean);
      assert(marker.length===1&&unescaped(marker[0])===canonical(plan.manifest),"DRAFT_MANIFEST_MISMATCH");
    }
    const expected=plan.transport===ATTACHED?[...plan.files,manifestFile(plan)]:plan.files;
    const attached=parts.filter(p=>p.filename);
    assert(attached.length===expected.length,"DRAFT_FILE_COUNT_MISMATCH");
    const found=expected.map(f=>{
      const hits=attached.filter(p=>p.filename===f.filename);
      assert(hits.length===1,"DRAFT_FILE_IDENTITY_AMBIGUOUS",f.filename);
      const p=hits[0];
      assert(p.mime_type===f.mime_type&&p.body?.size===f.bytes,"DRAFT_FILE_METADATA_MISMATCH",f.filename);
      assert(p.read_attachment_supported===true,"ATTACHMENT_NOT_SUPPORTED",f.filename);
      const aid=p.body.attachment_id;
      const complete=typeof aid==="string"&&aid&&!/truncat|\.\.\.|…/i.test(aid);
      return {filename:f.filename,part_id:p.part_id,attachment_id:complete?aid:null};
    });
    return found.slice(0,plan.files.length);
  }
  async function readAttachment(s,f,part){
    const args={link_id:s.plan.link_id,message_id:s.draft.message_id};
    if(part.attachment_id)args.attachment_id=part.attachment_id;else args.filename=part.filename;
    const r=await invoke("gmail_read_attachment",args),v=r.value;
    assert(v.filename===f.filename&&v.size_bytes===f.bytes&&v.mime_type===f.mime_type,"ORIGINAL_FILE_METADATA_MISMATCH");
    assert(v.file_uri&&typeof v.file_uri==="object"&&v.file_uri.file_id&&v.file_uri.download_url,"ORIGINAL_FILE_REFERENCE_MISSING");
    // file_uri is the original. content/extraction_file_uri may be a preview or a different JSON file.
    const original={message_id:s.draft.message_id,attachment_id:part.attachment_id,filename:f.filename,file_uri:clone(v.file_uri),provider_bytes:v.size_bytes,observed_at:now(),content_truncated:v.content_truncated===true};
    let verified=null;
    if(readOriginal){const bytes=bytesOf(await readOriginal(clone(v.file_uri)));assert(bytes.length===f.bytes&&codec.sha256(bytes)===f.sha256,"ORIGINAL_BYTES_MISMATCH");verified={bytes:bytes.length,sha256:f.sha256,at:now(),via:"complete_original_read",file_id:v.file_uri.file_id,attachment_id:part.attachment_id};}
    return {original,verified,receipt:r.raw,value:v};
  }
  async function attachment(s,index,part){
    const {value,...got}=await readAttachment(s,s.plan.files[index],part);return got;
  }
  async function readManifest(s,message){
    if(s.plan.transport!==ATTACHED)return null;
    const expected=manifestFile(s.plan),part=mimeParts(message.payload).find(p=>p.filename===MANIFEST_FILE);
    assert(part,"DRAFT_MANIFEST_MISSING");
    const aid=part.body?.attachment_id;
    const got=await readAttachment(s,expected,{filename:MANIFEST_FILE,attachment_id:typeof aid==="string"&&aid&&!/truncat|\.\.\.|…/i.test(aid)?aid:null});
    let via="complete_original_read";
    if(!got.verified){
      // Extraction may reformat JSON. It proves complete metadata, never original file bytes.
      const v=got.value,blocks=v.content;
      const content=typeof blocks==="string"?blocks:Array.isArray(blocks)&&blocks.every(b=>b.type==="text"&&typeof b.text==="string")?blocks.map(b=>b.text).join("\n"):null;
      assert(v.content_truncated===false&&content!==null,"COMPLETE_MANIFEST_READER_REQUIRED");
      let parsed;try{parsed=JSON.parse(content);}catch{fail("DRAFT_MANIFEST_CONTENT_INVALID");}
      assert(canonical(parsed)===canonical(s.plan.manifest),"DRAFT_MANIFEST_MISMATCH");
      via="complete_extracted_json";
    }
    return {identity:identity(expected),original:got.original,verified:got.verified,content_verified:{via,at:now()},receipt:got.receipt};
  }
  async function acceptManifest(s,message){
    const got=await readManifest(s,message);if(!got)return s;
    const {receipt,...manifest}=got;
    return save(s,{manifest,receipts:[...s.receipts,{kind:"original_manifest",at:now(),provider:receipt}]});
  }
  async function advance(key){
    let s=await current(key);
    await account(s.plan);
    if(s.phase==="draft_create_pending")return {state:"reconciliation_required",record:s,reason:"Original draft creation may have succeeded. Reconcile an observed matching draft; do not create another."};
    if(s.phase==="prepared"){
      s=await save(s,{phase:"draft_create_pending"});
      try{
        const r=await invoke("gmail_create_draft",draftArgs(s.plan)),d=r.value;
        assert(d.id&&d.message?.id,"DRAFT_RECEIPT_INCOMPLETE",r.raw);
        s=await save(s,{phase:"draft_available",draft:{id:d.id,message_id:d.message.id,thread_id:d.message.thread_id||null},receipts:[...s.receipts,{kind:"draft",at:now(),provider:r.raw}]});
      }catch(e){return fault(s,e,"draft_create");}
    }
    assert(["draft_available","files_available"].includes(s.phase),"INVALID_OPERATION_PHASE");
    const mail=await invoke("gmail_read_email",{link_id:s.plan.link_id,message_id:s.draft.message_id,format:"full"});
    assert(mail.value.id===s.draft.message_id,"MESSAGE_ID_MISMATCH");
    const parts=inspectMessage(s.plan,mail.value);
    s=await acceptManifest(s,mail.value);
    for(let i=0;i<parts.length;i++){
      if(s.files[i].original&&s.files[i].original.attachment_id===parts[i].attachment_id&&(!readOriginal||s.files[i].verified))continue;
      try{
        const got=await attachment(s,i,parts[i]),files=clone(s.files);
        files[i]={...files[i],original:got.original,verified:got.verified};
        s=await save(s,{files,receipts:[...s.receipts,{kind:"original_file",index:i,at:now(),provider:got.receipt}]});
      }catch(e){return fault(s,e,"original_file_"+i);}
    }
    if(s.phase!=="files_available")s=await save(s,{phase:"files_available"});
    return {state:"original_files_available",record:s,bytes_verified:s.files.every(f=>f.verified),recipient_materialization:"pending"};
  }
  async function reconcileDraft(key,{draft_id,message_id}){
    let s=await current(key);assert(s.phase==="draft_create_pending","DRAFT_RECONCILIATION_NOT_NEEDED");
    assert(readOriginal,"COMPLETE_ORIGINAL_READER_REQUIRED_FOR_UNCERTAIN_DRAFT");
    text(draft_id,"DRAFT_ID");text(message_id,"MESSAGE_ID");await account(s.plan);
    const r=await invoke("gmail_read_email",{link_id:s.plan.link_id,message_id,format:"full"});
    assert(r.value.id===message_id,"MESSAGE_ID_MISMATCH");inspectMessage(s.plan,r.value);
    // A caller-supplied draft ID must come from a complete native list_drafts result.
    let token,found=false;
    for(let n=0;n<100;n++){
      const args={link_id:s.plan.link_id,max_results:100};if(token)args.next_page_token=token;
      const listed=await invoke("gmail_list_drafts",args);
      const rows=listed.value.drafts;assert(Array.isArray(rows),"DRAFT_LIST_SCHEMA_MISMATCH");
      found=rows.some(d=>(d.draft_id||d.id)===draft_id&&(d.message?.id===message_id||d.message_id===message_id));
      if(found)break;
      const next=listed.value.next_page_token;if(!next)break;
      assert(next!==token,"PAGINATION_DID_NOT_ADVANCE");token=next;
      if(n===99)fail("DRAFT_SEARCH_INCOMPLETE");
    }
    assert(found,"DRAFT_ID_NOT_OBSERVED");
    const selected={...s,draft:{id:draft_id,message_id,thread_id:r.value.thread_id||null}};
    const parts=inspectMessage(s.plan,r.value),files=clone(s.files),receipts=[...s.receipts,{kind:"reconciled_draft",at:now(),provider:r.raw}];
    const manifestRead=await readManifest(selected,r.value);
    let manifest;
    if(manifestRead){const {receipt,...retained}=manifestRead;manifest=retained;receipts.push({kind:"original_manifest",at:now(),provider:receipt});}
    for(let i=0;i<parts.length;i++){const got=await attachment(selected,i,parts[i]);files[i]={...files[i],original:got.original,verified:got.verified};receipts.push({kind:"original_file",index:i,at:now(),provider:got.receipt});}
    s=await save(s,{phase:"files_available",draft:selected.draft,files,receipts,...(manifest?{manifest}:{})});
    return {state:"original_files_available",record:s,bytes_verified:true,recipient_materialization:"pending"};
  }
  async function refreshOriginal(key,index){
    let s=await current(key);await account(s.plan);assert(s.draft,"DRAFT_NOT_AVAILABLE");
    const mail=await invoke("gmail_read_email",{link_id:s.plan.link_id,message_id:s.draft.message_id,format:"full"});
    assert(mail.value.id===s.draft.message_id,"MESSAGE_ID_MISMATCH");
    const parts=inspectMessage(s.plan,mail.value);assert(parts[index],"UNKNOWN_FILE");
    s=await acceptManifest(s,mail.value);
    const got=await attachment(s,index,parts[index]),files=clone(s.files);
    files[index]={...files[index],original:got.original,verified:got.verified};
    return save(s,{files,receipts:[...s.receipts,{kind:"original_file_refreshed",index,at:now(),provider:got.receipt}]});
  }
  async function verifyOriginal(key,index){
    assert(readOriginal,"COMPLETE_ORIGINAL_READER_REQUIRED");let s=await current(key);const f=s.files[index];assert(f?.original,"ORIGINAL_NOT_AVAILABLE");
    const bytes=bytesOf(await readOriginal(clone(f.original.file_uri)));assert(bytes.length===f.identity.bytes&&codec.sha256(bytes)===f.identity.sha256,"ORIGINAL_BYTES_MISMATCH");
    const files=clone(s.files);files[index].verified={bytes:bytes.length,sha256:f.identity.sha256,at:now(),via:"complete_original_read",file_id:f.original.file_uri.file_id,attachment_id:f.original.attachment_id};return save(s,{files});
  }
  async function notionIdentity(target,{readPage=true}={}){
    text(target.page_id,"PAGE_ID");text(target.workspace_id,"WORKSPACE_ID");text(target.user_id,"NOTION_USER_ID");
    const r=await invoke("notion_notion_get_self",{});
    assert(r.value.workspace?.id===target.workspace_id&&r.value.user?.id===target.user_id,"NOTION_IDENTITY_MISMATCH");
    if(!readPage)return null;
    const page=await invoke("notion_fetch",{id:target.page_id});
    assert(String(page.value.id).replace(/-/g,"")===target.page_id.replace(/-/g,""),"NOTION_TARGET_MISMATCH");return page;
  }
  function marker(s,index){return "### Source transfer "+s.plan.operation_id+" "+index+" "+s.files[index].identity.sha256;}
  function pageReference(s,index,page){
    const str=page.value.text;assert(typeof str==="string","NOTION_PAGE_TEXT_REQUIRED");
    const mark=marker(s,index),start=str.indexOf(mark);if(start<0)return null;
    assert(str.indexOf(mark,start+mark.length)<0,"DUPLICATE_TRANSFER_SECTION");
    const rest=str.slice(start+mark.length),end=rest.search(/\n#{1,3} /),section=end<0?rest:rest.slice(0,end);
    const refs=[...section.matchAll(/<(?:file|embed) src="(notion-file-block:\/\/[^"]+)"/g)].map(m=>m[1]);
    assert(refs.length===1,"NOTION_FILE_READBACK_INCOMPLETE");return refs[0];
  }
  async function toNotion(key,index,target){
    let s=await current(key);const f=s.files[index];assert(f?.original,"ORIGINAL_NOT_AVAILABLE");
    const expected={page_id:target.page_id,workspace_id:target.workspace_id,user_id:target.user_id};
    let n=f.notion,page=await notionIdentity(expected,{readPage:!n?.async_task_id});
    if(n)assert(canonical(n.target)===canonical(expected),"NOTION_TARGET_CONFLICT");
    if(n?.phase==="attached")return {state:"notion_attached",record:s,reference:n.reference};
    if(n?.phase==="upload_pending")return {state:"reconciliation_required",record:s,reason:"Notion upload outcome is uncertain. Preserve original upload receipt; do not create another."};
    if(n?.phase==="attach_pending"){
      if(n.async_task_id){
        const status=await invoke("notion_notion_get_async_task",{task_id:n.async_task_id});
        const task=status.value.async_task||status.value;
        const receipts=[...s.receipts,{kind:"notion_task_status",index,at:now(),provider:status.raw}];
        s=await save(s,{receipts});
        if(task.status!=="succeeded"){
          if(task.status==="failed")return {state:"notion_attachment_failed",record:s,task};
          assert(["queued","running","retrying"].includes(task.status),"UNKNOWN_NOTION_TASK_STATUS",status.raw);
          return {state:"notion_attachment_pending",record:s,task};
        }
        page=await notionIdentity(expected);
      }
      const reference=pageReference(s,index,page);
      if(!reference)return {state:"reconciliation_required",record:s,reason:"Page insertion outcome is uncertain. Read this exact target again before retrying."};
      const files=clone(s.files);files[index].notion={...n,phase:"attached",reference};
      s=await save(s,{files});return {state:"notion_attached",record:s,reference};
    }
    if(!n){
      assert(f.identity.bytes<=5*1024*1024,"NOTION_DIRECT_FREE_SIZE_LIMIT");
      const files=clone(s.files);files[index].notion={target:expected,phase:"upload_pending"};
      s=await save(s,{files});
      try{
        const content=fileContent(s.plan,index),args={filename:f.identity.filename,content_type:f.identity.mime_type};
        if(f.identity.bytes<=200*1024)args.content=content;
        else{assert(f.identity.bytes<=5*1024*1024,"NOTION_DIRECT_FREE_SIZE_LIMIT");args.source_url=f.original.file_uri.download_url;}
        const r=await invoke("notion_notion_create_attachment",args),u=r.value;
        assert(u.status==="uploaded"&&u.file_upload_id&&u.content_length===f.identity.bytes,"NOTION_UPLOAD_RECEIPT_MISMATCH",r.raw);
        assert(typeof u.suggested_markdown==="string"&&u.suggested_markdown.includes("file-upload://"+u.file_upload_id),"NOTION_ATTACHMENT_MARKUP_MISSING");
        n={target:expected,phase:"uploaded",upload:clone(u)};
        const next=clone(s.files);next[index].notion=n;
        s=await save(s,{files:next,receipts:[...s.receipts,{kind:"notion_upload",index,at:now(),provider:r.raw}]});
      }catch(e){return fault(s,e,"notion_upload_"+index);}
    }
    if(n.phase==="uploaded"){
      // Verify fresh identity/target and read current body immediately before append.
      page=await notionIdentity(expected);
      const existing=pageReference(s,index,page);
      if(existing){const files=clone(s.files);files[index].notion={...n,phase:"attached",reference:existing};s=await save(s,{files});return {state:"notion_attached",record:s,reference:existing};}
      const content=marker(s,index)+"\n\n"+f.identity.filename+" — "+f.identity.bytes+" bytes; SHA256 "+f.identity.sha256+".\n\n"+n.upload.suggested_markdown+"\n";
      const files=clone(s.files);files[index].notion={...n,phase:"attach_pending"};s=await save(s,{files});
      try{
        const r=await invoke("notion_notion_update_page",{page_id:expected.page_id,command:"insert_content",position:{type:"end"},content,allow_async:false});
        const task=r.value.object==="async_task"?r.value:r.value.async_task;
        if(task){
          assert(task.id,"NOTION_TASK_ID_MISSING",r.raw);
          const pending=clone(s.files);pending[index].notion={...pending[index].notion,async_task_id:task.id};
          s=await save(s,{files:pending,receipts:[...s.receipts,{kind:"notion_attachment_queued",index,at:now(),provider:r.raw}]});
          return {state:"notion_attachment_pending",record:s,task};
        }
        const read=await invoke("notion_fetch",{id:expected.page_id}),reference=pageReference(s,index,read);
        assert(reference,"NOTION_FILE_READBACK_PENDING");
        const done=clone(s.files);done[index].notion={...n,phase:"attached",reference};
        s=await save(s,{files:done,receipts:[...s.receipts,{kind:"notion_attached",index,at:now(),provider:r.raw}]});
        return {state:"notion_attached",record:s,reference};
      }catch(e){return fault(s,e,"notion_attach_"+index);}
    }
    fail("INVALID_NOTION_PHASE");
  }
  async function reconcileNotionUpload(key,index,file_upload_id){
    let s=await current(key),f=s.files[index];assert(f?.notion?.phase==="upload_pending","UPLOAD_RECONCILIATION_NOT_NEEDED");
    text(file_upload_id,"FILE_UPLOAD_ID");await notionIdentity(f.notion.target);
    assert(f.identity.bytes<=200*1024,"LARGE_UPLOAD_REQUIRES_ORIGINAL_PROVIDER_RECEIPT");
    const r=await invoke("notion_notion_download_attachment",{file_upload_id});
    const b=bytesOf(r.value.content);assert(b.length===f.identity.bytes&&codec.sha256(b)===f.identity.sha256,"NOTION_UPLOAD_BYTES_MISMATCH");
    const upload={file_upload_id,filename:f.identity.filename,content_length:b.length,status:"uploaded",suggested_markdown:(f.identity.mime_type==="text/html"?'<embed src="file-upload://'+file_upload_id+'"></embed>':'<file src="file-upload://'+file_upload_id+'"></file>')};
    const files=clone(s.files);files[index].notion={...f.notion,phase:"uploaded",upload};
    s=await save(s,{files,receipts:[...s.receipts,{kind:"notion_upload_reconciled",index,at:now(),provider:r.raw}]});
    return toNotion(key,index,f.notion.target);
  }
  async function downloadNotion(key,index){
    const s=await current(key),n=s.files[index]?.notion;assert(n?.phase==="attached","NOTION_ATTACHMENT_NOT_READY");
    await notionIdentity(n.target);
    return invoke("notion_notion_get_file_download_urls",{references:[n.reference]});
  }

  async function receiveExisting({operation_id,link_id,account_email,message_id,files}){
    text(operation_id,"OPERATION",96);text(link_id,"LINK_ID");text(message_id,"MESSAGE_ID");
    account_email=email(account_email);await account({link_id,account_email});
    assert(Array.isArray(files)&&files.length>0&&files.length<=32,"INVALID_FILES");
    const seen=new Set();
    files=files.map(f=>{
      text(f.filename,"FILENAME",160);assert(!seen.has(f.filename),"DUPLICATE_FILENAME");seen.add(f.filename);
      assert(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=MAX&&/^[0-9a-f]{64}$/.test(f.sha256),"EXPECTED_SOURCE_IDENTITY_REQUIRED");
      return identity(f);
    });
    const mail=await invoke("gmail_read_email",{link_id,message_id,format:"full"});
    assert(mail.value.id===message_id,"MESSAGE_ID_MISMATCH");
    const labels=mail.value.label_ids||[];
    assert(labels.includes("DRAFT")&&!labels.includes("SENT"),"MESSAGE_IS_NOT_UNSENT_DRAFT");
    const headers=mail.value.payload?.headers||[],from=headers.filter(h=>h.name.toLowerCase()==="from");
    assert(from.length===1&&mailbox(from[0].value)===account_email,"DRAFT_ACCOUNT_MISMATCH");
    assert(!headers.some(h=>["to","cc","bcc","reply-to","in-reply-to","references"].includes(h.name.toLowerCase())),"DRAFT_HAS_RECIPIENT_OR_REPLY_HEADERS");
    const parts=mimeParts(mail.value.payload),out=[];
    for(let i=0;i<files.length;i++){
      const f=files[i],hits=parts.filter(p=>p.filename===f.filename);
      assert(hits.length===1,"DRAFT_FILE_IDENTITY_AMBIGUOUS",f.filename);
      const p=hits[0];assert(p.read_attachment_supported===true&&p.mime_type===f.mime_type&&p.body?.size===f.bytes,"DRAFT_FILE_METADATA_MISMATCH");
      const a=p.body.attachment_id,part={filename:f.filename,attachment_id:typeof a==="string"&&a&&!/truncat|\.\.\.|…/i.test(a)?a:null};
      const fake={plan:{link_id,files},draft:{message_id}};
      const got=await attachment(fake,i,part);out.push({identity:f,...got});
    }
    return {schema:SCHEMA,operation_id,link_id,account_email,message_id,state:"original_files_available",files:out,bytes_verified:out.every(x=>x.verified),recipient_materialization:"pending"};
  }

  return {receiveExisting,prepare,start,advance,reconcileDraft,refreshOriginal,verifyOriginal,toNotion,reconcileNotionUpload,downloadNotion,inspectMessage,draftArgs,preview,inspectDraftArguments,bodyResult};
}
