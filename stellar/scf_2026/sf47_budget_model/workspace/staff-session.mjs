// Public staff context and CSRF remain in memory; original request bodies stay with their native desks.
let current = null, boundContext = null, sessionChannel = null;
const memberId = /^(?:owner|[a-z][a-z0-9._-]{2,63})$/;
const installationId = /^[0-9a-f]{32}$/;
const contextCopy = value => value ? {...value} : null;
export const currentStaffSession = () => current;
export const currentStaffContext = () => contextCopy(boundContext);

function contextFor(session) {
  if (!session?.authenticated || !session.principal) return null;
  const principal = session.principal;
  return {installationId:session.installationId || null,staffId:principal.id,
    actor:principal.actor,role:principal.role,displayName:principal.displayName};
}
function sessionError(code, message, status, context) {
  const error = new Error(message);error.code=code;error.status=status;
  error.staffContext=contextCopy(context);return error;
}
function requireSameSession(session, context) {
  if (!session?.authenticated) throw sessionError('ACCESS_REQUIRED',
    'Sign in as the original operator to continue this desk.',401,context);
  if (context?.installationId && session.installationId !== context.installationId)
    throw sessionError('STAFF_INSTALLATION_CHANGED',
      'This open desk belongs to another installation. Its original work remains on this page.',403,context);
  if (context?.staffId && session.principal?.id !== context.staffId)
    throw sessionError('STAFF_IDENTITY_CHANGED',
      'This open desk belongs to '+(context.displayName || context.staffId)+'. Sign in as that operator to continue.',403,context);
  return session;
}
export function staffDeskStorageKey(base, context=currentStaffContext()) {
  if (!context?.installationId || !context?.staffId) return base;
  if (!installationId.test(context.installationId) || !memberId.test(context.staffId))
    throw sessionError('STAFF_CONTEXT_INVALID','Reopen the original staff session before selecting a saved desk.',403,context);
  return base+':staff:'+context.installationId+':'+context.staffId;
}
export function assertStaffRequestActor(body, context=currentStaffContext()) {
  if (!context || context.staffId==='owner' || !body || typeof body!=='object'
      || !Object.hasOwn(body,'actor')) return;
  if (typeof body.actor!=='string' || body.actor.trim()!==context.actor)
    throw sessionError('STAFF_REQUEST_ACTOR_CHANGED',
      'This retained request belongs to its original recording operator. Keep the complete request and receive it with that operator.',403,context);
}
function publishSessionChange(kind) {
  try {sessionChannel?.postMessage({kind});} catch {}
}
try {
  if (typeof BroadcastChannel!=='undefined') {
    sessionChannel=new BroadcastChannel('sf47-staff-session');
    sessionChannel.onmessage=()=>{current=null;};
  }
} catch {}

async function decoded(response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(value.error?.message || value.error || value.message || 'The workspace request could not finish.');
    error.code = value.code || value.error?.code;error.status = response.status;
    if (response.status === 401) current = null;
    throw error;
  }
  return value;
}
export async function readStaffSession({bind=true}={}) {
  const value=await decoded(await fetch('/api/staff/session',{credentials:'same-origin',cache:'no-store'}));
  current=value;
  if (bind && value.authenticated) boundContext=contextFor(value);
  return value;
}
export async function resumeStaffSession(context=boundContext) {
  const value=requireSameSession(await readStaffSession({bind:false}),context);
  boundContext=contextFor(value);return value;
}
function recoveryRequired(error, context) {
  if (![401,403].includes(error.status) || !['ACCESS_REQUIRED','STAFF_CSRF',
      'STAFF_IDENTITY_CHANGED','STAFF_INSTALLATION_CHANGED','STAFF_REQUEST_ACTOR_CHANGED'].includes(error.code)) return;
  error.staffContext=contextCopy(context);
  if (typeof window!=='undefined') window.dispatchEvent(new CustomEvent('sf47-staff-recovery',{
    detail:{context:contextCopy(context),code:error.code,message:error.message}}));
}
function retainedBody(body, raw) {
  if (body===undefined) return {value:undefined,reusable:true};
  if (!raw) return {value:JSON.stringify(body),reusable:true};
  if (typeof body==='string' || typeof Blob!=='undefined' && body instanceof Blob)
    return {value:body,reusable:true};
  if (body instanceof ArrayBuffer) return {value:body.slice(0),reusable:true};
  if (ArrayBuffer.isView(body)) return {value:body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength),reusable:true};
  if (typeof URLSearchParams!=='undefined' && body instanceof URLSearchParams)
    return {value:new URLSearchParams(body),reusable:true};
  return {value:body,reusable:false};
}
export async function staffRequest(path, body, options={}) {
  const unbound=options.unbound===true;
  const context=unbound?null:contextCopy(options.staffContext===undefined?boundContext:options.staffContext);
  const retained=retainedBody(body,options.raw);
  if (!unbound && !options.raw) {
    try {assertStaffRequestActor(body,context);}
    catch(error) {recoveryRequired(error,context);throw error;}
  }
  let renewed=false;
  try {
    if (context && !current?.authenticated) {
      requireSameSession(await readStaffSession({bind:false}),context);
      renewed=true;
    }
    if (context && current?.authenticated) requireSameSession(current,context);
    while (true) {
      const headers=new Headers(options.headers);
      if (body!==undefined && !options.raw) headers.set('content-type','application/json');
      if (body!==undefined && current?.csrfToken) headers.set('X-CSRF-Token',current.csrfToken);
      if (context?.staffId) headers.set('X-Grant-Staff',context.staffId);
      if (context?.installationId) headers.set('X-Grant-Installation',context.installationId);
      const response=await fetch(path,{method:body===undefined?'GET':'POST',
        credentials:'same-origin',cache:'no-store',headers,signal:options.signal,body:retained.value});
      if (options.download && response.ok) return response;
      try {return await decoded(response);}
      catch(error) {
        // These native access outcomes occur before the original business writer.
        // One renewal resends the same captured body; network errors remain with the original desk.
        if (!unbound && context && !renewed && retained.reusable &&
            (error.status===401 || error.status===403 && error.code==='STAFF_CSRF')) {
          renewed=true;requireSameSession(await readStaffSession({bind:false}),context);continue;
        }
        throw error;
      }
    }
  } catch(error) {recoveryRequired(error,context);throw error;}
}

export async function signInStaff(staffId,accessCode) {
  current=await staffRequest('/api/staff/login',{staffId,accessCode},{unbound:true});
  boundContext=contextFor(current);publishSessionChange('signed-in');return current;
}
export async function signInOwner(token) {
  current=await decoded(await fetch('/api/staff/owner-session',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'}));
  boundContext=contextFor(current);
  try {sessionStorage.removeItem('sf47.access');} catch {}
  publishSessionChange('signed-in');return current;
}
export async function signOutStaff() {
  try {await staffRequest('/api/staff/logout',{});}
  finally {current=null;publishSessionChange('signed-out');}
}
