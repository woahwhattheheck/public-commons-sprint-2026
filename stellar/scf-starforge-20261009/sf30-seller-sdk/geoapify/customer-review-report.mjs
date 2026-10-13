// MIT. Complete offline customer review from the unchanged shared model and browser source.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGeoapifyCustomerReview} from './customer-review-core.mjs';
import {renderGeoapifyCustomerReviewDocument} from './customer-review-ui.mjs';
const core=createGeoapifyCustomerReview({sha256:value=>createHash('sha256').update(value).digest('hex')});
const bootstrap=String.raw`
const customerReviewRoot=document.getElementById('customer-review');
try{
  if(!globalThis.crypto?.subtle||!globalThis.crypto?.randomUUID)
    throw new Error('Open this complete file in a current desktop browser with local-file cryptography enabled.');
  const browserReviewCore=createGeoapifyCustomerReview({sha256:async value=>{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }});
  let browserReviewStorage;try{browserReviewStorage=globalThis.localStorage;}catch{}
  const browserReviewSource=JSON.parse(document.getElementById('customer-review-source').textContent);
  const browserReviewRuntime=document.getElementById('customer-review-runtime').getAttribute('src').slice('data:text/javascript;base64,'.length);
  await mountGeoapifyCustomerReview(customerReviewRoot,{core:browserReviewCore,value:browserReviewSource,runtimeBase64:browserReviewRuntime,storage:browserReviewStorage});
}catch(error){
  customerReviewRoot.replaceChildren();
  const title=document.createElement('h1');title.textContent='Address review could not open';
  const message=document.createElement('p');message.textContent=error?.message??String(error);
  customerReviewRoot.append(title,message);
}
`;
let source;
async function runtime(){
  if(!source)source=Promise.all([
    readFile(new URL('./customer-review-core.mjs',import.meta.url),'utf8'),
    readFile(new URL('./customer-review-ui.mjs',import.meta.url),'utf8')
  ]).then(parts=>Buffer.from(parts.join('\n')+'\n'+bootstrap,'utf8').toString('base64')).catch(error=>{source=null;throw error;});
  return source;
}
export async function renderGeoapifyCustomerReview(value){
  if(value?.draft){await core.inspectReturn(value,value.draft.project);value=value.draft;}
  if(value?.project)await core.inspectDraft(value);else await core.inspectProject(value);
  const project=value.project??value;
  return renderGeoapifyCustomerReviewDocument(value,{runtimeBase64:await runtime(),title:project.title});
}
