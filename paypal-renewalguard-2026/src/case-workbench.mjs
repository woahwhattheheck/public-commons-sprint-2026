import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { CaseError, CaseStore, digest } from './case-store.mjs';
import { summarize, validId } from './logic.mjs';

const PROCESS_WORKER = randomUUID(), SHARED_RUNNING = new Map();
async function processIdentity(pid) {
  try {
    const [stat,boot]=await Promise.all([readFile('/proc/'+pid+'/stat','utf8'),readFile('/proc/sys/kernel/random/boot_id','utf8')]);
    return {host:hostname(),boot:boot.trim(),pid,start:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};
  } catch { return {host:hostname(),pid,start:null,boot:null}; }
}
async function workerAlive(worker) {
  if (!worker?.identity || worker.identity.host!==hostname()) return false;
  try { process.kill(worker.identity.pid,0); }
  catch(error) { if(error.code==='ESRCH')return false;if(error.code==='EPERM')return true;throw error; }
  const now=await processIdentity(worker.identity.pid);
  if(worker.identity.boot&&now.boot&&worker.identity.boot!==now.boot)return false;
  if(worker.identity.start&&now.start&&worker.identity.start!==now.start)return false;
  return true;
}
const UUID = /^[a-z0-9][a-z0-9-]{7,95}$/;
const SHA = /^[a-f0-9]{64}$/;
const ACTIONS = new Set(['refresh_portfolio','intake','capture','save_plan','ai_note','review','resolve','reopen','restore']);
const PRIORITIES = new Set(['normal','high','urgent']);
const WORK = new Set(['todo','in_progress','waiting','ready']);
const OUTCOMES = new Set(['support_completed','monitoring','subscription_ended','no_follow_up']);
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CaseError('invalid_input', label + ' must be an object');
  return value;
}
function text(value, label, maximum, required = false) {
  if (typeof value !== 'string' || [...value].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw new CaseError('invalid_input', label + ' must be text of at most ' + maximum + ' characters');
  const result = value.trim();
  if (required && !result) throw new CaseError('invalid_input', label + ' is required');
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
function same(a,b) { return digest(canonical(a)) === digest(canonical(b)); }
function documentId(kind, operationId, suffix = '') { return kind + '-' + digest(operationId + ':' + suffix).slice(0,32); }
function fail(code, message, status=400, details={}) { throw new CaseError(code,message,status,details); }
export function sourceScope(mode, clientId = '') {
  if (mode !== 'demo' && mode !== 'sandbox') fail('invalid_mode','Choose demo or PayPal sandbox');
  const fingerprint = mode === 'sandbox' ? digest(clientId || 'unconfigured') : null;
  return {
    schema:'renewalguard-source-scope-v1', id:mode + '-' + digest(mode + ':' + (fingerprint || 'renewalguard-demo-v1')),
    mode, provider:mode === 'sandbox' ? 'paypal_sandbox' : 'renewalguard_demo',
    origin:mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : null,
    app_fingerprint:fingerprint,
  };
}
export function validatePlan(value) {
  object(value,'Work plan');
  const result = {
    title:text(value.title ?? '', 'Title',160,true),
    owner:text(value.owner ?? '', 'Owner',120),
    due_date:text(value.due_date ?? '', 'Due date',10),
    priority:value.priority, work_status:value.work_status,
    next_action:text(value.next_action ?? '', 'Next action',1000,true),
    notes:text(value.notes ?? '', 'Work notes',8000),
    customer_note:text(value.customer_note ?? '', 'Customer note',4000),
    outcome:text(value.outcome ?? '', 'Resolution outcome',40),
    resolution_summary:text(value.resolution_summary ?? '', 'Resolution summary',2000),
  };
  if (!PRIORITIES.has(result.priority) || !WORK.has(result.work_status)) fail('invalid_input','Choose a valid priority and work status');
  if (result.due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(result.due_date) ||
      !Number.isFinite(Date.parse(result.due_date + 'T12:00:00Z')) ||
      new Date(result.due_date + 'T12:00:00Z').toISOString().slice(0,10) !== result.due_date))
    fail('invalid_input','Due date must be a real calendar date');
  if (result.outcome && !OUTCOMES.has(result.outcome)) fail('invalid_input','Choose a valid resolution outcome');
  return result;
}
function requireRevision(input, head) {
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 1) fail('invalid_revision','A saved case revision is required');
  if (input.expected_revision !== head.version)
    fail('revision_changed','A newer case revision is saved. Compare it before saving your draft.',409,{current_revision:head.version});
}
function reference(document, sha, extra={}) {
  return {id:document.id,sha,at:document.at,...extra};
}
function allReferences(value) {
  return [...value.sources,...value.plans,...value.notes,...value.reviews,...value.resolutions];
}
export class CaseWorkbench {
  constructor({root,scope,listing,detail,draft,clock=()=>new Date().toISOString()}) {
    this.scope=scope; this.store=new CaseStore(root,scope);
    this.providers={listing,detail,draft}; this.clock=clock;
    const runningKey=this.store.root;
    if(!SHARED_RUNNING.has(runningKey))SHARED_RUNNING.set(runningKey,new Map());
    this.running=SHARED_RUNNING.get(runningKey);this.workerId=PROCESS_WORKER;
    this.identity=processIdentity(process.pid);
  }
  caseId(id) {
    if (!validId(id)) fail('invalid_subscription','A PayPal subscription ID is required');
    return 'case-' + digest(this.scope.id + ':' + id).slice(0,48);
  }
  async caseHead(id) {
    if (!/^case-[a-f0-9]{48}$/.test(id || '')) fail('invalid_case','Invalid case identifier');
    const head=await this.store.head('cases',id);
    if (!head) fail('case_not_found','Case not found in this source scope',404);
    return head;
  }
  async workspace() {
    const heads=await this.store.list('cases'), today=this.clock().slice(0,10);
    const cases=heads.map(head=>{
      const value=head.value, plan=value.plans.at(-1), source=value.sources.at(-1);
      return {id:value.id,subscription_id:value.subscription_id,revision:head.version,stage:value.stage,
        created_at:value.created_at,updated_at:value.updated_at,plan:plan || null,source:source || null,
        review_id:value.current_review_id || null,
        overdue:value.stage==='open' && !!plan?.due_date && plan.due_date<today};
    }).sort((a,b)=>Number(b.overdue)-Number(a.overdue) ||
      (a.plan?.due_date || '9999').localeCompare(b.plan?.due_date || '9999') || a.id.localeCompare(b.id));
    const portfolio=await this.store.head('portfolio','current');
    const recent=(await this.store.list('operations')).filter(x=>!x.value.id.startsWith('intake-'))
      .sort((a,b)=>b.value.updated_at.localeCompare(a.value.updated_at)).slice(0,30).map(x=>{
        const v=x.value;return {request_id:v.id,action:v.action,state:v.state,phase:v.phase,case_id:v.case_id || null,
          updated_at:v.updated_at,progress:v.progress || null,error:v.error || null};
      });
    return {schema:'renewalguard-workspace-v1',scope:this.scope,cases,recent_operations:recent,
      counts:{total:cases.length,open:cases.filter(x=>x.stage==='open').length,resolved:cases.filter(x=>x.stage==='resolved').length,
        overdue:cases.filter(x=>x.overdue).length,ready:cases.filter(x=>x.stage==='open' && x.plan?.work_status==='ready').length},
      portfolio:portfolio ? {revision:portfolio.version,sha:portfolio.value.document_sha,
        ...await this.store.get(portfolio.value.document_sha)} : null};
  }
  async getCase(id) {
    const head=await this.caseHead(id), value=head.value;
    const source=value.sources.at(-1), plan=value.plans.at(-1);
    const review=value.reviews.find(x=>x.id===value.current_review_id), resolution=value.resolutions.at(-1);
    return {schema:'renewalguard-case-view-v1',scope:this.scope,revision:head.version,journal_sha:head.sha,case:value,
      source:source?await this.store.get(source.sha):null,plan:plan?await this.store.get(plan.sha):null,
      review:review?await this.store.get(review.sha):null,resolution:resolution?await this.store.get(resolution.sha):null};
  }
  async document(caseId, sha) {
    if (!SHA.test(sha || '')) fail('invalid_hash','A complete document hash is required');
    const head=await this.caseHead(caseId);
    if (!allReferences(head.value).some(x=>x.sha===sha)) fail('document_not_found','Document is not part of this case',404);
    return {sha,document:await this.store.get(sha)};
  }
  async exportCase(id, version = null) {
    const current=await this.caseHead(id);
    const head=version===null?current:await this.store.readVersion('cases',id,version), documents=[];
    for (const ref of allReferences(head.value)) documents.push({sha:ref.sha,document:await this.store.get(ref.sha)});
    const payload={schema:'renewalguard-case-handover-v1',scope:this.scope,case_revision:head.version,
      case_journal_sha:head.sha,case:head.value,documents};
    return {...payload,sha256:digest(payload)};
  }
  async operation(requestId) {
    if (!UUID.test(requestId || '')) fail('invalid_request','A stable request ID is required');
    const head=await this.store.head('operations',requestId);
    if (!head) return {found:false,request_id:requestId};
    const value=head.value;
    return {found:true,request_id:requestId,action:value.action,case_id:value.case_id || null,input_sha256:value.input_sha256,
      state:value.state,phase:value.phase,started_at:value.started_at,updated_at:value.updated_at,
      active:value.state==='working' && (this.running.has(requestId) || (value.worker?.id!==this.workerId && await workerAlive(value.worker))),result:value.result || null,error:value.error || null,
      progress:value.progress || null};
  }
  async resume(requestId) {
    if (!UUID.test(requestId || '')) fail('invalid_request','A stable request ID is required');
    const op=await this.store.head('operations',requestId);
    if (!op) fail('request_not_found','Original request not found in this source scope',404);
    const saved=op.value.input_document_sha ? await this.store.get(op.value.input_document_sha) : {input:op.value.input};
    return this.run(requestId,op.value.action,saved.input);
  }
  async run(requestId, action, input) {
    if (!UUID.test(requestId || '')) fail('invalid_request','A stable request ID is required');
    if (!ACTIONS.has(action)) fail('invalid_action','Unknown case action');
    object(input,'Command input');
    const inputHash=digest(canonical({action,input}));
    const running=this.running.get(requestId);
    if (running) {
      if (running.inputHash!==inputHash) fail('request_changed','This request ID already belongs to different input',409);
      return running.promise;
    }
    const promise=this.execute(requestId,action,structuredClone(input),inputHash);
    this.running.set(requestId,{inputHash,promise});
    try { return await promise; }
    finally { this.running.delete(requestId); }
  }
  async execute(id,action,input,inputHash) {
    let op=await this.store.head('operations',id);
    if (!op) {
      const inputDocumentSha=await this.store.put({schema:'renewalguard-command-input-v1',scope_id:this.scope.id,
        id,action,input});
      const caseId=input.case_id || (validId(input.subscription_id)?this.caseId(input.subscription_id):null);
      try { op=await this.store.append('operations',id,{expectedVersion:0,expectedSha:null,operationId:id,at:this.clock(),
        value:{schema:'renewalguard-operation-v1',id,scope_id:this.scope.id,action,input_document_sha:inputDocumentSha,case_id:caseId,input_sha256:inputHash,
          state:'working',phase:'received',started_at:this.clock(),updated_at:this.clock(),data:{}}}); }
      catch(error) { if(error.code!=='revision_changed')throw error; op=await this.store.head('operations',id); }
    }
    if (op.value.input_sha256!==inputHash) fail('request_changed','This request ID already belongs to different input',409);
    const context={id,input,action,op};
    if (op.value.state==='done') return this.operation(id);
    if (op.value.state==='rejected') throw new CaseError(op.value.error.code,op.value.error.message,op.value.error.status,op.value.error.details);
    if(op.value.state==='working' && op.value.worker?.id!==this.workerId && await workerAlive(op.value.worker))
      fail('operation_active','The original operation is running in another local server process',409);
    try {
      context.op=await this.store.append('operations',id,{expectedVersion:op.version,expectedSha:op.sha,
        operationId:id,at:this.clock(),value:{...op.value,state:'working',
          worker:{id:this.workerId,identity:await this.identity},updated_at:this.clock()}});
    } catch(error) {
      if(error.code==='revision_changed')fail('operation_active','Another worker continued this original request; read its retained status',409);
      throw error;
    }
    try {
      if (op.value.phase==='prepared') return await this.publishPrepared(context);
      if (op.value.phase==='case_committed') return await this.finish(context,op.value.result);
      await this.change(context,{state:'working',error:null});
      if (action==='refresh_portfolio') return await this.refreshPortfolio(context);
      if (action==='intake') return await this.intake(context);
      if (action==='restore') return await this.restore(context);
      if (action==='capture') return await this.capture(context);
      const head=await this.caseHead(input.case_id); requireRevision(input,head);
      if (action==='reopen') return await this.reopen(context,head);
      if (head.value.stage!=='open') fail('case_resolved','Reopen this case before adding new work',409);
      if (action==='save_plan') return await this.savePlan(context,head);
      if (action==='ai_note') return await this.aiNote(context,head);
      if (action==='review') return await this.review(context,head);
      return await this.resolve(context,head);
    } catch(error) {
      // A committed case is authoritative even if recording its response failed.
      const latest=await this.store.head('operations',id).catch(()=>null);
      if (latest?.value.phase==='prepared' || latest?.value.phase==='case_committed') throw error;
      const definitive=error instanceof CaseError && error.status<500;
      await this.change(context,{state:definitive?'rejected':'retryable',phase:definitive?'rejected':'interrupted',
        error:{code:error.code || 'provider_or_storage',message:String(error.message || 'Operation interrupted').slice(0,240),
          status:error.status || 503,details:error.details || {}}}).catch(()=>{});
      throw error;
    }
  }
  async change(context,patch) {
    const current=await this.store.head('operations',context.id);
    if(current.value.worker?.id!==this.workerId)
      fail('operation_active','The original request has a different active worker',409);
    const value={...current.value,...patch,updated_at:this.clock()};
    context.op=await this.store.append('operations',context.id,{
      expectedVersion:current.version,expectedSha:current.sha,operationId:context.id,at:this.clock(),value});
    return context.op;
  }
  async saveData(context,patch) {
    return this.change(context,{data:{...context.op.value.data,...patch}});
  }
  async finish(context,result) {
    await this.change(context,{state:'done',phase:'complete',result,error:null});
    return this.operation(context.id);
  }
  async prepare(context,kind,id,head,value,result) {
    await this.change(context,{phase:'prepared',prepared:{
      kind,id,expected_version:head?.version || 0,expected_sha:head?.sha || null,value,result,
    }});
    return this.publishPrepared(context);
  }
  async publishPrepared(context) {
    const prepared=context.op.value.prepared;
    if (!prepared) fail('operation_incomplete','Prepared operation record is missing',500);
    const committed=await this.store.findOperation(prepared.kind,prepared.id,context.id);
    let result=committed;
    if (!result) {
      try {
        result=await this.store.append(prepared.kind,prepared.id,{
          expectedVersion:prepared.expected_version,expectedSha:prepared.expected_sha,
          operationId:context.id,at:context.op.value.updated_at,value:prepared.value});
      } catch(error) {
        if (error.code==='revision_changed') {
          await this.change(context,{state:'rejected',phase:'rejected',error:{
            code:error.code,message:error.message,status:409,details:error.details || {}}});
        }
        throw error;
      }
    }
    const response={...prepared.result,revision:result.version,journal_sha:result.sha};
    await this.change(context,{phase:'case_committed',result:response});
    return this.finish(context,response);
  }
  async source(context, subscriptionId) {
    const retained=context.op.value.data.source;
    if (retained) return {sha:retained.sha,document:await this.store.get(retained.sha)};
    const raw=await this.providers.detail(this.scope.mode,subscriptionId), facts=summarize(raw);
    if (facts.subscription_id!==subscriptionId) fail('provider_identity','Provider returned a different subscription',502);
    const document={schema:'renewalguard-subscription-snapshot-v1',id:documentId('source',context.id,subscriptionId),
      scope_id:this.scope.id,case_id:this.caseId(subscriptionId),at:this.clock(),operation_id:context.id,
      provider:this.scope.provider,request:{origin:this.scope.origin,method:'GET',
        path:'/v1/billing/subscriptions/'+subscriptionId+'?fields=last_failed_payment'},facts};
    const sha=await this.store.put(document);
    await this.saveData(context,{source:{sha}});
    return {sha,document};
  }
  addSource(value, source) {
    const copy=structuredClone(value), document=source.document;
    if (!copy.sources.some(x=>x.id===document.id))
      copy.sources.push(reference(document,source.sha,{status:document.facts.status,tier:document.facts.tier,
        fingerprint:document.facts.fingerprint,next_billing_at:document.facts.next_billing_at,last_failed_at:document.facts.last_failed_at}));
    copy.updated_at=this.clock();
    return copy;
  }
  event(context,value,type,details={}) {
    value.events.push({id:documentId('event',context.id,type),type,at:this.clock(),operation_id:context.id,...details});
    value.updated_at=this.clock();
  }
  async refreshPortfolio(context) {
    let sha=context.op.value.data.portfolio_sha;
    if (!sha) {
      const list=await this.providers.listing(this.scope.mode);
      if (!Array.isArray(list.items) || list.items.some(x=>!validId(x.id))) fail('provider_list','Provider list is malformed',502);
      const document={schema:'renewalguard-portfolio-v1',id:documentId('portfolio',context.id),scope_id:this.scope.id,
        at:this.clock(),operation_id:context.id,items:list.items,pages_read:list.pages_read,incomplete:!!list.incomplete};
      sha=await this.store.put(document); await this.saveData(context,{portfolio_sha:sha});
    }
    const current=await this.store.head('portfolio','current');
    return this.prepare(context,'portfolio','current',current,{document_sha:sha},{state:'portfolio_saved',document_sha:sha});
  }
  async intake(context) {
    const ids=context.input.subscription_ids;
    if (!Array.isArray(ids) || ids.length<1 || ids.length>200 || ids.some(id=>!validId(id)) || new Set(ids).size!==ids.length)
      fail('invalid_input','Choose 1–200 distinct subscriptions from the retained portfolio');
    const portfolioSha=context.input.portfolio_sha;
    if (!SHA.test(portfolioSha || '')) fail('invalid_input','The original portfolio snapshot is required');
    const portfolio=await this.store.get(portfolioSha);
    if (portfolio.schema!=='renewalguard-portfolio-v1' || portfolio.scope_id!==this.scope.id ||
        ids.some(id=>!portfolio.items.some(x=>x.id===id))) fail('source_changed','Selected subscriptions do not belong to this portfolio',409);
    const results=[...(context.op.value.data.results || [])];
    for (const id of ids) {
      if (results.some(x=>x.subscription_id===id)) continue;
      const childId='intake-'+digest(context.id+':'+id).slice(0,48);
      const response=await this.run(childId,'capture',{subscription_id:id});
      results.push({subscription_id:id,request_id:childId,...response.result});
      await this.change(context,{phase:'intaking',data:{...context.op.value.data,results},
        progress:{completed:results.length,total:ids.length}});
    }
    return this.finish(context,{state:'intake_complete',portfolio_sha:portfolioSha,cases:results});
  }
  async capture(context) {
    const id=context.input.subscription_id, caseId=this.caseId(id);
    let head=await this.store.head('cases',caseId);
    if (head && context.input.expected_revision!==undefined) requireRevision(context.input,head);
    const source=await this.source(context,id);
    // Refresh reuses the latest case only when no expected revision was supplied.
    // It adds a source event and preserves every intervening plan or resolution.
    head=await this.store.head('cases',caseId);
    if (head && context.input.expected_revision!==undefined) requireRevision(context.input,head);
    const value=this.addSource(head?.value || {
      schema:'renewalguard-case-v1',id:caseId,scope_id:this.scope.id,subscription_id:id,stage:'open',
      created_at:this.clock(),updated_at:this.clock(),sources:[],plans:[],notes:[],reviews:[],resolutions:[],
      current_review_id:null,events:[],
    },source);
    const previous=head?.value.sources.at(-1)?.fingerprint;
    if (previous && previous!==source.document.facts.fingerprint) value.current_review_id=null;
    this.event(context,value,head?'source_refreshed':'case_opened',{source_id:source.document.id,
      changed:!!previous && previous!==source.document.facts.fingerprint});
    return this.prepare(context,'cases',caseId,head,value,{state:head?'source_refreshed':'case_opened',case_id:caseId});
  }
  async savePlan(context,head) {
    const work=validatePlan(context.input.work), source=head.value.sources.at(-1);
    if (!source) fail('source_missing','Capture this subscription before saving a plan',409);
    const old=head.value.plans.at(-1), number=(old?.number || 0)+1;
    if (old) {
      const previous=await this.store.get(old.sha);
      if (same(previous.work,work) && previous.source_fingerprint===source.fingerprint)
        return this.finish(context,{state:'plan_unchanged',case_id:head.value.id,revision:head.version,plan_id:old.id});
    }
    const document={schema:'renewalguard-work-plan-v1',id:documentId('plan',context.id),case_id:head.value.id,
      scope_id:this.scope.id,at:this.clock(),operation_id:context.id,number,previous_id:old?.id || null,
      source_id:source.id,source_sha:source.sha,source_fingerprint:source.fingerprint,work};
    const sha=await this.store.put(document),value=structuredClone(head.value);
    value.plans.push(reference(document,sha,{number,title:work.title,owner:work.owner,due_date:work.due_date,
      priority:work.priority,work_status:work.work_status,source_fingerprint:source.fingerprint}));
    value.current_review_id=null;
    this.event(context,value,'plan_saved',{plan_id:document.id,number,source_id:source.id});
    return this.prepare(context,'cases',value.id,head,value,{state:'plan_saved',case_id:value.id,plan_id:document.id});
  }
  async sourceChanged(context,head,source) {
    const value=this.addSource(head.value,source);
    value.current_review_id=null;
    this.event(context,value,'source_changed',{source_id:source.document.id});
    return this.prepare(context,'cases',value.id,head,value,{state:'source_changed',case_id:value.id,
      message:'PayPal facts changed. The saved plan is retained; review the new snapshot and save a new plan edition.'});
  }
  async aiNote(context,head) {
    const source=await this.source(context,head.value.subscription_id);
    if (head.value.sources.at(-1)?.fingerprint!==source.document.facts.fingerprint)
      return this.sourceChanged(context,head,source);
    let noteSha=context.op.value.data.note_sha,document;
    if (noteSha) document=await this.store.get(noteSha);
    else {
      await this.change(context,{phase:'generating_note'});
      const proposal=await this.providers.draft(source.document.facts);
      if (!proposal || typeof proposal.text!=='string' || !proposal.text.trim() || proposal.text.length>16000)
        fail('provider_note','The note provider returned an invalid response',502);
      document={schema:'renewalguard-support-note-v1',id:documentId('note',context.id),case_id:head.value.id,
        scope_id:this.scope.id,at:this.clock(),operation_id:context.id,source_id:source.document.id,
        source_sha:source.sha,source_fingerprint:source.document.facts.fingerprint,proposal};
      noteSha=await this.store.put(document); await this.saveData(context,{note_sha:noteSha});
    }
    const value=this.addSource(head.value,source);
    value.notes.push(reference(document,noteSha,{kind:document.proposal.kind,source_id:document.source_id}));
    this.event(context,value,'note_prepared',{note_id:document.id,source_id:document.source_id,kind:document.proposal.kind});
    return this.prepare(context,'cases',value.id,head,value,{state:'note_prepared',case_id:value.id,note_id:document.id});
  }
  async review(context,head) {
    const planRef=head.value.plans.at(-1);
    if (!planRef || planRef.id!==context.input.plan_id) fail('plan_changed','Select the current saved work plan',409);
    const plan=await this.store.get(planRef.sha), reviewer=text(context.input.reviewer ?? '', 'Reviewer',120,true);
    const summary=text(context.input.summary ?? '', 'Review summary',2000,true);
    if (plan.work.work_status!=='ready' || !plan.work.owner || !OUTCOMES.has(plan.work.outcome) || !plan.work.resolution_summary)
      fail('plan_incomplete','Set an owner, mark work ready, and save a resolution outcome and summary before review',409);
    const source=await this.source(context,head.value.subscription_id);
    if (plan.source_fingerprint!==source.document.facts.fingerprint) return this.sourceChanged(context,head,source);
    const document={schema:'renewalguard-resolution-review-v1',id:documentId('review',context.id),
      case_id:head.value.id,scope_id:this.scope.id,at:this.clock(),operation_id:context.id,reviewer,summary,
      plan_id:plan.id,plan_sha:planRef.sha,source_id:source.document.id,source_sha:source.sha,
      source_fingerprint:source.document.facts.fingerprint,outcome:plan.work.outcome};
    const sha=await this.store.put(document),value=this.addSource(head.value,source);
    value.reviews.push(reference(document,sha,{reviewer,plan_id:plan.id,plan_number:plan.number,outcome:document.outcome}));
    value.current_review_id=document.id;
    this.event(context,value,'resolution_reviewed',{review_id:document.id,plan_id:plan.id,source_id:document.source_id});
    return this.prepare(context,'cases',value.id,head,value,{state:'resolution_reviewed',case_id:value.id,review_id:document.id});
  }
  async resolve(context,head) {
    const reviewRef=head.value.reviews.find(x=>x.id===context.input.review_id && x.id===head.value.current_review_id);
    if (!reviewRef) fail('review_changed','Open the current saved review before resolving this case',409);
    const review=await this.store.get(reviewRef.sha), planRef=head.value.plans.at(-1);
    if (planRef?.id!==review.plan_id || planRef?.sha!==review.plan_sha) fail('plan_changed','The saved plan has changed since review',409);
    const source=await this.source(context,head.value.subscription_id);
    if (source.document.facts.fingerprint!==review.source_fingerprint) return this.sourceChanged(context,head,source);
    const plan=await this.store.get(planRef.sha);
    const document={schema:'renewalguard-case-resolution-v1',id:documentId('resolution',context.id),
      case_id:head.value.id,scope_id:this.scope.id,at:this.clock(),operation_id:context.id,
      review_id:review.id,review_sha:reviewRef.sha,plan_id:plan.id,plan_sha:planRef.sha,
      source_id:source.document.id,source_sha:source.sha,source_fingerprint:source.document.facts.fingerprint,
      outcome:plan.work.outcome,summary:plan.work.resolution_summary,owner:plan.work.owner,reviewer:review.reviewer};
    const sha=await this.store.put(document),value=this.addSource(head.value,source);
    value.stage='resolved';
    value.resolutions.push(reference(document,sha,{outcome:document.outcome,review_id:review.id,owner:document.owner}));
    this.event(context,value,'case_resolved',{resolution_id:document.id,review_id:review.id,outcome:document.outcome});
    return this.prepare(context,'cases',value.id,head,value,{state:'case_resolved',case_id:value.id,resolution_id:document.id});
  }
  async reopen(context,head) {
    if (head.value.stage!=='resolved') fail('case_open','This case is already open',409);
    const reason=text(context.input.reason ?? '', 'Reason for reopening',2000,true);
    const value=structuredClone(head.value); value.stage='open';value.current_review_id=null;
    this.event(context,value,'case_reopened',{reason,previous_resolution_id:value.resolutions.at(-1)?.id || null});
    return this.prepare(context,'cases',value.id,head,value,{state:'case_reopened',case_id:value.id});
  }
  async restore(context) {
    const envelope=object(context.input.handover,'Case handover'), {sha256,...payload}=envelope;
    if (envelope.schema!=='renewalguard-case-handover-v1' || !SHA.test(sha256 || '') || digest(payload)!==sha256)
      fail('handover_changed','The complete case handover checksum does not match');
    if (!same(envelope.scope,this.scope)) fail('scope_changed','Switch to the original source and sandbox app before restoring this case',409);
    const value=structuredClone(object(envelope.case,'Retained case')),id=this.caseId(value.subscription_id);
    if (value.id!==id || value.scope_id!==this.scope.id || value.schema!=='renewalguard-case-v1' ||
        !['open','resolved'].includes(value.stage) || !Array.isArray(value.events) ||
        ['sources','plans','notes','reviews','resolutions'].some(k=>!Array.isArray(value[k])))
      fail('handover_invalid','Retained case identity or history is invalid');
    const existing=await this.store.head('cases',id);
    if (existing) {
      const current=await this.exportCase(id);
      if (current.sha256===sha256 || existing.value.restored_from?.sha256===sha256)
        return this.finish(context,{state:'already_retained',case_id:id,revision:existing.version});
      fail('case_exists','This case already has retained work. Open it or compare the exported handover; existing history is preserved.',409);
    }
    if (!Array.isArray(envelope.documents)) fail('handover_invalid','Retained documents are missing');
    const refs=allReferences(value),seen=new Set();
    if (refs.some(ref=>!ref || !SHA.test(ref.sha || '') || typeof ref.id!=='string') ||
        envelope.documents.length!==refs.length) fail('handover_invalid','The complete case document set is required');
    for (const item of envelope.documents) {
      if (!item || !SHA.test(item.sha || '') || digest(item.document)!==item.sha ||
          item.document?.scope_id!==this.scope.id || item.document.case_id!==id ||
          !refs.some(ref=>ref.sha===item.sha && ref.id===item.document.id) || seen.has(item.sha))
        fail('handover_invalid','A retained case document is inconsistent');
      seen.add(item.sha);
    }
    if (refs.some(ref=>!seen.has(ref.sha))) fail('handover_invalid','The handover is missing an original document');
    for (const item of envelope.documents) await this.store.put(item.document);
    value.restored_from={sha256,case_revision:envelope.case_revision,case_journal_sha:envelope.case_journal_sha,at:this.clock()};
    this.event(context,value,'handover_restored',{source_revision:envelope.case_revision,handover_sha256:sha256});
    return this.prepare(context,'cases',id,null,value,{state:'handover_restored',case_id:id,source_revision:envelope.case_revision});
  }
}
