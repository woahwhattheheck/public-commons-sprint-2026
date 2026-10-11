// MIT. Existing SF93 incident state projected into its registered merchant's
// existing operator listener. The original watcher alone records recovery.
import { isAbsolute, resolve } from 'node:path';
import { openIncidentStore, statusView } from '../../sf93-seller-support-bundle/incident-store.mjs';
import { merchantBinding, idPattern } from '../../sf93-seller-support-bundle/incident-config.mjs';
import { acknowledgeIncident } from '../../sf93-seller-support-bundle/incident-operator.mjs';

const SCHEMA='stellar-forge.sf93.merchant-incident-view.v1';
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const fail=(code,status=409)=>Object.assign(new Error(code),{code,status});
const active=incident=>['OPEN','ACKNOWLEDGED'].includes(incident.status);
const deliveryKind=kind=>['DELIVERY_UNAVAILABLE','DELIVERY_BACKLOG','DELIVERY_EXHAUSTED'].includes(kind);

export function createMerchantIncidentSource({directory,merchantId},origins) {
  if(typeof directory!=='string' || !isAbsolute(directory) || resolve(directory)!==directory || directory==='/' ||
      !idPattern.test(merchantId ?? '') || typeof origins!=='function')
    throw new TypeError('An original private incident directory and registered merchant ID are required');
  async function snapshot() {
    let state;
    try {state=await(await openIncidentStore(directory)).read();}
    catch {throw fail('DELIVERY_INCIDENT_UNAVAILABLE',503);}
    const merchant=state.config.merchants.find(row=>row.id===merchantId);
    const current=origins();
    if(!merchant || !current?.seller || !current?.ops ||
        merchant.seller!==new URL(current.seller).origin || merchant.ops!==new URL(current.ops).origin)
      throw fail('DELIVERY_INCIDENT_MERCHANT_MISMATCH');
    return {state,merchant,binding:merchantBinding(state.config,merchant),
      view:statusView(state,{details:true})};
  }
  function project(incident,binding) {
    return {id:incident.id,merchantId:incident.merchantId,merchantLabel:incident.merchantLabel,
      kind:incident.kind,status:incident.status,revision:incident.revision,
      openedAt:incident.openedAt,updatedAt:incident.updatedAt,lastObservedAt:incident.lastObservedAt,
      closedAt:incident.closedAt,acknowledgment:incident.acknowledgment ?? null,
      notificationState:incident.notificationState ?? null,notificationIssue:incident.notificationIssue ?? null,
      signal:incident.signal ?? null,recoverySignal:incident.recoverySignal ?? null,
      beforeCapture:Boolean(incident.beforeCapture),afterCapture:Boolean(incident.afterCapture),
      currentMerchantBinding:incident.binding===binding,
      queueAction:incident.binding===binding && deliveryKind(incident.kind)
        ? {path:'/fulfillment',state:incident.kind==='DELIVERY_EXHAUSTED'?'attention':'all'} : null};
  }
  async function read({state:filter='active',cursor,limit=25}={}) {
    if(!['active','all','recovered'].includes(filter) || cursor!==undefined && !uuid(cursor) ||
        !Number.isInteger(limit) || limit<1 || limit>100) throw fail('DELIVERY_INCIDENT_QUERY_INVALID',400);
    const {state,view,merchant,binding}=await snapshot();
    const all=view.incidents.filter(item=>item.merchantId===merchantId)
      .sort((a,b)=>b.openedAt.localeCompare(a.openedAt)||b.id.localeCompare(a.id));
    const position=cursor===undefined?-1:all.findIndex(item=>item.id===cursor);
    if(cursor!==undefined&&position<0)throw fail('DELIVERY_INCIDENT_CURSOR_CHANGED');
    const matches=item=>filter==='all'||filter==='active'&&active(item)||filter==='recovered'&&item.status==='RECOVERED';
    const rows=all.slice(position+1).filter(matches),items=rows.slice(0,limit);
    const worker=view.worker;
    return {schema:SCHEMA,available:true,merchant:{id:merchant.id,label:merchant.label},
      capturedAt:new Date().toISOString(),active:all.filter(active).length,totalMatching:all.filter(matches).length,
      incidents:items.map(item=>project(item,binding)),nextCursor:rows.length>limit?items.at(-1).id:null,
      worker:worker?{status:worker.status,lastSweepAt:worker.lastSweepAt,stoppedAt:worker.stoppedAt,
        lastError:worker.lastError,heartbeatAgeSeconds:worker.lastSweepAt?
          Math.max(0,Math.floor((Date.now()-Date.parse(worker.lastSweepAt))/1000)):null}:null,
      staleAfterSeconds:Math.max(30,Math.ceil(state.config.pollMs*3/1000)),
    };
  }
  async function detail(id) {
    if(!uuid(id))throw fail('DELIVERY_INCIDENT_QUERY_INVALID',400);
    const {view,binding}=await snapshot();
    const incident=view.incidents.find(item=>item.id===id && item.merchantId===merchantId);
    if(!incident)throw fail('DELIVERY_INCIDENT_NOT_FOUND',404);
    return {schema:SCHEMA,incident:project(incident,binding)};
  }
  async function acknowledge(command) {
    if(!uuid(command?.id) || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision<1 ||
        typeof command.by!=='string' || typeof command.notes!=='string')
      throw fail('DELIVERY_INCIDENT_ACK_INVALID',400);
    const {view,binding}=await snapshot();
    const original=view.incidents.find(item=>item.id===command.id && item.merchantId===merchantId && item.binding===binding);
    if(!original)throw fail('DELIVERY_INCIDENT_NOT_FOUND',404);
    try {
      const incident=await acknowledgeIncident({directory,id:command.id,expectedRevision:command.expectedRevision,
        by:command.by,notes:command.notes});
      return {schema:SCHEMA,incident:project(incident,binding)};
    } catch(error) {
      const messages={SF93_INCIDENT_REVISION_CONFLICT:'DELIVERY_INCIDENT_STATE_CHANGED',
        SF93_INCIDENT_NOT_OPEN:'DELIVERY_INCIDENT_NOT_OPEN',SF93_OPERATOR_REQUIRED:'DELIVERY_INCIDENT_OPERATOR_REQUIRED',
        SF93_NOTE_INVALID:'DELIVERY_INCIDENT_NOTE_INVALID',SF93_STATE_BUSY:'DELIVERY_INCIDENT_BUSY'};
      if(messages[error.message])throw fail(messages[error.message],['SF93_NOTE_INVALID','SF93_OPERATOR_REQUIRED'].includes(error.message)?400:409);
      throw error;
    }
  }
  return Object.freeze({read,detail,acknowledge});
}
