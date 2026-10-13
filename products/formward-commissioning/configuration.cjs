'use strict';
const core=require('./formward_commissioning.cjs');
const SCHEMA='tjlabs.formward-commissioning-configuration/v1';
const copy=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function need(value,message){if(!value)throw new TypeError(message);}
function text(v,max=10000){return typeof v==='string'&&v.length<=max;}
function identifier(v){return typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(v);}
function link(v){return v===''||/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#][^\s"<>]*)?$/.test(v);}
function validateConfiguration(input){
 const c=copy(typeof input==='string'?JSON.parse(input):input);
 need(object(c)&&c.schema===SCHEMA,'Use a complete commissioning configuration.');
 need(identifier(c.pack_id)&&identifier(c.edition_id),'Use stable, distinct workspace and edition identifiers.');
 need(text(c.title,300)&&c.title.trim()&&object(c.customer)&&text(c.customer.name,300)&&text(c.customer.domain,300),'Keep the title and customer identity fields. Empty customer identity is allowed during preparation.');
 need(Array.isArray(c.cases)&&c.cases.length>=1&&c.cases.length<=100,'Configure between 1 and 100 forms.');
 need(new Set(c.cases.map(x=>x?.id)).size===c.cases.length,'Each configured form needs a unique identifier.');
 for(const item of c.cases){
  need(object(item)&&identifier(item.id)&&object(item.source)&&object(item.plan),'Keep the complete form, source and operating plan.');
  const s=item.source,p=item.plan;
  for(const k of ['url','summary','budget','observed_at'])need(text(s[k],k==='summary'?20000:2000),'Keep source '+k+' as text; leave unknown values empty.');
  need(link(s.url),'Use an actual HTTPS source reference, or leave it empty.');
  need(s.observed_at===''||(Number.isFinite(Date.parse(s.observed_at))&&new Date(s.observed_at).toISOString()===s.observed_at),'Record source observation time as actual canonical UTC, or leave it empty.');
  for(const k of ['title','preserved','route','demonstration','scope','qualification','privacy_map'])need(text(p[k],20000),'Keep the operating-plan '+k+' field.');
  need(p.title.trim(),'Give each form a readable title.');
  need(Array.isArray(p.steps)&&p.steps.length<=100&&p.steps.every(x=>text(x,10000)),'Keep complete ordered commissioning steps.');
  need(Array.isArray(p.contract_urls)&&p.contract_urls.length<=100&&p.contract_urls.every(x=>text(x,2000)&&x&&link(x)),'Use complete HTTPS contract source URLs.');
  need(!Object.hasOwn(item,'observations')&&!Object.hasOwn(item,'working'),'Configuration describes forms. Reopen actual observations and unfinished work using a separate complete saved record.');
  core.readiness(item.settings); // Valid draft; an unconfigured endpoint is intentionally not ready.
 }
 core.createKit(c);return c;
}
function createConfiguration({id,title='Form commissioning',caseCount=1}={}){
 need(identifier(id),'Supply your own stable workspace identifier.');
 need(Number.isSafeInteger(caseCount)&&caseCount>=1&&caseCount<=100,'Use a form count from 1 to 100.');
 const configuration={schema:SCHEMA,pack_id:id,edition_id:id+'-edition',customer:{name:'',domain:''},title,cases:[]};
 for(let i=1;i<=caseCount;i++)configuration.cases.push({
  id:'form-'+i,
  source:{url:'',summary:'Prepare the owned form, deploy its source, and retain the actual submission and receiving results.',budget:'',observed_at:''},
  plan:{
   title:caseCount===1?'Form commissioning':'Form '+i,
   preserved:'Keep the existing website, CMS, editable source and its owner’s account.',
   route:'Owned website form → configured Formward submission inbox → confirmed notification recipient.',
   steps:[
    'Record the actual website, form fields and recipient. Keep the current editable source and rollback copy.',
    'Select or create the form in the owner’s Formward account. Configure its allowed website origins and actual notification recipient.',
    'Confirm the notification recipient in the provider dashboard when required. Record the account’s consent and privacy settings.',
    'Enter the actual endpoint, website origin, success path, recipient and field definitions in this workbench.',
    'Save the complete working kit and deploy the generated form or fragment within the existing website.',
    'Operate the rendered form on the actual website, receive its complete endpoint response and submission identifier, and inspect the destination mailbox.',
    'Retain the actual receiving observations, full editable source, complete working record and rollback instructions for the owner.'
   ],
   demonstration:'Use the owner’s authorized sample values for a real submission. The local preview is inert. Record the actual response and mailbox result separately.',
   scope:'The website and provider account remain owned by their operator. This workbench prepares source and retains commissioning work; it does not provision the account or change its notification settings.',
   qualification:'Choose the actual delivery scope and website integration before deployment.',
   privacy_map:'Record the real purpose, fields, recipient, retention, consent requirements and privacy notice for this form.',
   contract_urls:['https://formward.eu/docs','https://formward.eu/docs/ingest','https://formward.eu/docs/fields','https://formward.eu/docs/responses','https://formward.eu/docs/ajax']
  },
  settings:{language:'en',endpoint:'',site_origin:'',success_path:'',subject:'',recipient:'',title:'Contact',introduction:'',success_text:'Your message was received.',failure_text:'Your message could not be sent. Your entries have been kept.',uncertain_text:'Your message may have been received. Please check with the recipient before sending it again.',privacy_text:'',privacy_url:'',button_label:'Send message',require_consent:false,consent_text:'',fields:[
   {name:'name',label:'Name',type:'text',required:false,value:'',options:[]},
   {name:'email',label:'Email',type:'email',required:true,value:'',options:[]},
   {name:'message',label:'Message',type:'textarea',required:true,value:'',options:[]}
  ]}
 });
 return validateConfiguration(configuration);
}
module.exports={SCHEMA,validateConfiguration,createConfiguration};
