import {currentStaffContext, resumeStaffSession, signInStaff, signInOwner} from './staff-session.mjs';

const text=value=>String(value??'');
const contextKey=value=>JSON.stringify([value?.installationId??null,value?.staffId??null]);
export function mountStaffRecovery({getContext=currentStaffContext,onRestored=()=>{},inform=()=>{}}={}) {
  if (!document.querySelector('link[data-staff-recovery-style]')) {
    const link=document.createElement('link');link.rel='stylesheet';link.href='/staff-recovery.css';
    link.dataset.staffRecoveryStyle='true';document.head.append(link);
  }
  let active=true,context=null,busy=false,returnFocus=null,requestCode='';
  const dialog=document.createElement('dialog');dialog.className='staff-recovery';
  dialog.setAttribute('aria-labelledby','staff-recovery-title');
  dialog.innerHTML='<form><header><h2 id="staff-recovery-title">Resume this working desk</h2>'
    +'<p data-recovery-message></p></header><dl><dt>Operator</dt><dd data-recovery-operator></dd>'
    +'<dt>Installation</dt><dd data-recovery-installation></dd></dl>'
    +'<p data-recovery-detail>Entered fields, original files and the prepared request remain in the open desk.</p>'
    +'<div data-recovery-credentials><label data-recovery-member>Staff sign-in ID<input name="staffId" autocomplete="username" readonly></label>'
    +'<label data-recovery-secret>Access code<input name="accessCode" type="password" autocomplete="current-password"></label></div>'
    +'<p data-recovery-status role="status" aria-live="polite"></p>'
    +'<div class="staff-recovery-actions"><button type="submit" data-recovery-signin>Sign in and resume</button>'
    +'<button type="button" data-recovery-check>Use my restored sign-in</button>'
    +'<button type="button" data-recovery-close>Keep this desk open</button></div>'
    +'<p><a href="/team" target="_blank" rel="noopener">Open Team workspace in a separate tab</a></p></form>';
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector);
  const status=(message,error=false)=>{
    const node=$('[data-recovery-status]');node.textContent=message;
    node.setAttribute('role',error?'alert':'status');
  };
  function controls(value) {
    busy=value;
    dialog.setAttribute('aria-busy',String(value));
    for(const node of dialog.querySelectorAll('button,input'))node.disabled=value;
    $('[data-recovery-close]').disabled=false;
  }
  function close() {
    if(dialog.open)dialog.close();
    $('[name=accessCode]').value='';
    if(returnFocus?.isConnected)returnFocus.focus();
  }
  async function restored(work) {
    if(busy||!context)return;
    const selected={...context},key=contextKey(selected);controls(true);status('Opening the original sign-in…');
    try {
      await work(selected);
      const session=await resumeStaffSession(selected);
      if(!active||contextKey(context)!==key)return;
      $('[name=accessCode]').value='';close();
      onRestored(session,selected);
      inform('The original staff session is open. Continue with the retained desk and its original save.');
    } catch(error) {
      if(active&&contextKey(context)===key)status(error.message||'The original sign-in could not be opened.',true);
    } finally {if(active&&contextKey(context)===key)controls(false);}
  }
  function show(selected,error={}) {
    if(!active||!selected?.staffId)return;
    // Parallel failed reads keep the active form, entered code and in-flight sign-in intact.
    if(dialog.open||busy)return;
    context={...selected};requestCode=error.code||'';
    returnFocus=document.activeElement;
    $('[data-recovery-message]').textContent=error.message||'The original session needs to be reopened before this request can continue.';
    $('[data-recovery-operator]').textContent=(selected.displayName||selected.staffId)+' · '+selected.staffId;
    $('[data-recovery-installation]').textContent=selected.installationId||'Original workspace';
    $('[name=staffId]').value=selected.staffId;
    $('[name=accessCode]').value='';
    const owner=selected.staffId==='owner',differentInstallation=requestCode==='STAFF_INSTALLATION_CHANGED';
    const differentActor=requestCode==='STAFF_REQUEST_ACTOR_CHANGED';
    $('[data-recovery-member]').hidden=owner;
    $('[data-recovery-secret]').firstChild.textContent=owner?'Private owner access key':'Staff access code';
    $('[data-recovery-credentials]').hidden=differentInstallation||differentActor;
    $('[data-recovery-signin]').hidden=differentInstallation||differentActor;
    $('[data-recovery-check]').hidden=differentInstallation||differentActor;
    $('[data-recovery-detail]').textContent=differentInstallation
      ?'Keep or download this complete desk, then receive its original file in the selected installation. The installed case and its saved request history remain the source of record.'
      :differentActor
        ?'The prepared request retains its original recording operator. Download or keep the complete desk, and reopen that request with the original operator. Other work can continue in a separate desk.'
        :'Entered fields, original files and the prepared request remain in this open desk. Reopening the sign-in leaves those original inputs in place.';
    status('');controls(false);
    if(!dialog.open)dialog.showModal();
    if(!differentInstallation&&!differentActor)$('[name=accessCode]').focus();
    else $('[data-recovery-close]').focus();
  }
  const listener=event=>show(event.detail?.context||getContext(),event.detail||{});
  window.addEventListener('sf47-staff-recovery',listener);
  dialog.querySelector('form').addEventListener('submit',event=>{
    event.preventDefault();
    const secret=$('[name=accessCode]').value.trim();
    if(!secret){status('Enter the original access code from the private access file.',true);return;}
    restored(selected=>selected.staffId==='owner'?signInOwner(secret):signInStaff(selected.staffId,secret));
  });
  $('[data-recovery-check]').addEventListener('click',()=>restored(()=>Promise.resolve()));
  $('[data-recovery-close]').addEventListener('click',close);
  dialog.addEventListener('cancel',()=>{$('[name=accessCode]').value='';});
  return {show,dispose(){active=false;window.removeEventListener('sf47-staff-recovery',listener);close();dialog.remove();}};
}
