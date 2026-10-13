/** Read the exact retained soil report with authenticated companion links.
 * This is a view of the existing source operation, not another source writer.
 */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy = value => JSON.parse(JSON.stringify(value));

function ticket(file) {
  if (!file || typeof file.url !== 'string' || !file.url.startsWith('/api/file/') ||
      !/^[a-f0-9]{64}$/.test(file.sha256 || '') ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 0)
    throw new Error('Reopen the saved soil operation to obtain its current original file link.');
  const url = new URL(file.url, location.origin);
  if (url.origin !== location.origin) throw new Error('Choose the original operator file link.');
  return url;
}
function filename(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') ||
      path.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('A soil companion has an invalid original relative path.');
  return path;
}
function checksum(buffer) {
  return crypto.subtle.digest('SHA-256',buffer).then(value =>
    [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join(''));
}

export function openSoilReport({container, report, documents, files, onError=()=>{}}) {
  const original = copy(report), retained = copy(documents), available = copy(files);
  const reports = available.filter(row=>row.sha256===original.sha256);
  if (reports.length !== 1) throw new Error('Choose one exact retained soil report.');
  const file = reports[0], url=ticket(file);
  const paths = new Map();
  for (const member of retained) {
    const path = filename(member.path);
    if (paths.has(path)) throw new Error('The saved soil report repeats a companion path.');
    const candidates = available.filter(row=>row.sha256===member.sha256 &&
      (!member.filename || row.filename===member.filename));
    if (!candidates.length) throw new Error('Reopen the complete saved soil operation; a report companion is missing.');
    const selected=candidates[0];
    if (selected.bytes !== member.bytes) throw new Error('A retained soil report companion changed size.');
    paths.set(path,{...member,file:selected,url:ticket(selected)});
  }
  if (!paths.has(original.path) || paths.get(original.path).sha256!==original.sha256)
    throw new Error('The report differs from its retained source member.');
  const controller = new AbortController();
  let closed=false;
  const dialog=document.createElement('dialog');
  dialog.className='sp-browser sp-result sp-soil-report';
  dialog.setAttribute('aria-label','Soil evidence report');
  const download=new URL(url);download.searchParams.set('download','1');
  dialog.innerHTML='<header><div><h2>Soil evidence report</h2><p>Exact saved report with its original source companions.</p></div>'+
    '<button type="button" data-soil-close>Close</button></header>'+
    '<p role="status" data-soil-status>Opening and checking the saved report…</p>'+
    '<div class="sp-actions"><a href="'+escapeHTML(download.href)+'" download="'+escapeHTML(file.filename)+'">Download original report</a></div>'+
    '<iframe title="Complete soil evidence and interpretation" sandbox="allow-same-origin allow-downloads allow-popups" referrerpolicy="no-referrer" '+
    'style="display:block;width:100%;height:65vh;border:1px solid #b8b8b8;background:#fff"></iframe>'+
    '<details><summary>Complete report companions</summary><ul data-soil-files></ul></details>';
  const list=dialog.querySelector('[data-soil-files]');
  for (const [path,member] of paths) {
    const link=document.createElement('a'),row=document.createElement('li');
    const downloadURL=new URL(member.url);downloadURL.searchParams.set('download','1');
    link.href=downloadURL.href;link.download=member.file.filename;
    link.textContent=path;row.append(link);list.append(row);
  }
  const dispose=()=>{
    if(closed)return;
    closed=true;controller.abort();
    dialog.close();dialog.remove();
  };
  dialog.querySelector('[data-soil-close]').addEventListener('click',dispose);
  dialog.addEventListener('cancel',event=>{event.preventDefault();dispose();});
  dialog.addEventListener('close',dispose);
  container.append(dialog);dialog.showModal();
  (async()=>{
    try {
      const response=await fetch(url.href,{credentials:'same-origin',redirect:'error',signal:controller.signal});
      if(!response.ok)throw new Error('The original report could not be read ('+response.status+'). Reopen the saved operation.');
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength!==file.bytes || await checksum(bytes)!==file.sha256)
        throw new Error('The report bytes differ from the saved soil source.');
      if(closed || !dialog.isConnected)return;
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const parsed=new DOMParser().parseFromString(text,'text/html');
      // Only the served view is rewritten. Download always returns original bytes.
      const base=new URL(original.path,'https://soil-report.invalid/');
      for(const link of parsed.querySelectorAll('a[href]')){
        const value=link.getAttribute('href');
        const resolved=new URL(value,base);
        if(resolved.origin==='https://soil-report.invalid'){
          const path=decodeURIComponent(resolved.pathname.slice(1));
          const member=paths.get(path);
          if(!member)throw new Error('A report link has no retained companion: '+value);
          const target=new URL(member.url);target.searchParams.set('download','1');
          link.href=target.href;link.setAttribute('download',member.file.filename);
          link.target='_blank';link.rel='noopener noreferrer';
        } else if(['https:','http:'].includes(resolved.protocol)){
          link.href=resolved.href;link.target='_blank';link.rel='noopener noreferrer';
        } else {
          link.removeAttribute('href');link.removeAttribute('download');
        }
      }
      for(const node of parsed.querySelectorAll('script,iframe,object,embed,base,form,meta[http-equiv]'))node.remove();
      const policy=parsed.createElement('meta');policy.httpEquiv='Content-Security-Policy';
      policy.content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'";
      parsed.head.prepend(policy);
      if(closed || !dialog.isConnected)return;
      dialog.querySelector('iframe').srcdoc='<!doctype html>'+parsed.documentElement.outerHTML;
      dialog.querySelector('[data-soil-status]').textContent='The complete saved report is open. Its file links download the exact retained companions.';
    } catch(problem){
      if(closed || problem.name==='AbortError')return;
      const status=dialog.querySelector('[data-soil-status]');
      status.setAttribute('role','alert');status.textContent=problem.message;
      onError(problem);
    }
  })();
  return {dispose};
}
