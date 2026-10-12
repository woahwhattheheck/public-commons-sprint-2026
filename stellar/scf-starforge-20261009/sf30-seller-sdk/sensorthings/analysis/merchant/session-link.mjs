// SPDX-License-Identifier: MIT
// A navigation join in the existing session; no new session or persisted token.
const link=document.querySelector('#analysis-merchant-link');let token='';
function accept(value){try{const u=new URL(value,location.origin);if(u.origin===location.origin&&/^[A-Za-z0-9_-]{32,200}$/.test(u.hash.slice(1)))token=u.hash.slice(1);}catch{}}
accept(location.href);
document.querySelector('#connect-form')?.addEventListener('submit',()=>accept(document.querySelector('#private-link')?.value??''),true);
document.querySelector('#lock')?.addEventListener('click',()=>{token='';},true);
link?.addEventListener('click',()=>{link.href='/analysis/merchant/'+(token?'#'+token:'');});
