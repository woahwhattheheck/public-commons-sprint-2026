import {createHash} from 'node:crypto';
export const SOURCE={repository:'BootNodeDev/strata-vault-kit',commit:'400754230a3fecaa69385687ba8457f1c2250d13'};
export const CONTRACTS=['async_vault','nav_oracle','share_token','identity_verifier','compliance','asset'];
export const READS={
 async_vault:['asset','share_token','oracle','governance','manager','treasury','guardian','custodian','deposit_cap','paused','notice','wind_down_delay','upgrade_delay','upgrade_proposal','schema_version','current_epoch','net_deployed','free_reserve','committed','uncovered','liquid_reserve','cancellable_escrow','pending_mint_shares','pending_burn_shares','total_economic_supply','wind_down','wind_down_owed','wind_down_supply','wind_down_acc'],
 nav_oracle:['get_admin','config','state','latest','is_stale','attested_at'],
 share_token:['get_admin','compliance','identity_verifier','paused','name','symbol','decimals','total_supply'],
 identity_verifier:[],compliance:['linked_tokens'],asset:['name','symbol','decimals']
};
export const ROLES=[['async_vault','manager'],['async_vault','treasury'],['async_vault','guardian'],['nav_oracle','attester'],['nav_oracle','guardian'],['share_token','manager'],['share_token','compliance']];
export function check(ok,message){if(!ok)throw new Error(message);}
export function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){check(Number.isSafeInteger(value),'Only safe integer JSON numbers are supported. Use decimal strings for native wide integers.');return String(value);}
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 check(value&&Object.getPrototypeOf(value)===Object.prototype,'Expected a plain JSON object.');
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export const copy=value=>JSON.parse(canonical(value));
export function exactKeys(value,keys,label){check(value&&typeof value==='object'&&!Array.isArray(value),label+' must be an object.');check(Object.keys(value).every(k=>keys.includes(k)),label+' contains unsupported fields.');}
function text(value,label,max=500){check(typeof value==='string'&&value.trim()&&value.length<=max,label+' is required.');}
function address(value,label,kind='[GC]'){check(new RegExp('^'+kind+'[A-Z2-7]{55}$').test(value),label+' must be an explicit Stellar address.');}
function endpoint(value,label,allowHttp){text(value,label,2000);const u=new URL(value);check((u.protocol==='https:'||(allowHttp&&u.protocol==='http:'))&&!u.username&&!u.password&&!u.search&&!u.hash,label+' must be a public HTTP(S) endpoint without credentials/query/fragment.');}
function arrayUnique(a,label,max){check(Array.isArray(a)&&a.length<=max,label+' exceeds its supported bound.');check(new Set(a).size===a.length,label+' contains duplicates.');}
export function validateSelection(value){
 const s=copy(value);exactKeys(s,['schema','title','source','network','contracts','expected','roles','accounts','bootstrapAccounts','evidence','executables'],'selection');
 check(s.schema==='strata.commissioning-selection/v1','Unsupported selection schema.');text(s.title,'title');
 check(canonical(s.source)===canonical(SOURCE),'This receiver is bound to the exact reviewed source; a different source needs an explicit adapter revision.');
 exactKeys(s.network,['name','passphrase','rpcUrl','horizonUrl','allowHttp'],'network');
 text(s.network.name,'network.name');text(s.network.passphrase,'network.passphrase');check(typeof s.network.allowHttp==='boolean','allowHttp must be explicit.');
 endpoint(s.network.rpcUrl,'rpcUrl',s.network.allowHttp);endpoint(s.network.horizonUrl,'horizonUrl',s.network.allowHttp);
 exactKeys(s.contracts,CONTRACTS,'contracts');for(const c of CONTRACTS)address(s.contracts[c],c,'C');
 exactKeys(s.executables,CONTRACTS,'executables');for(const[k,v]of Object.entries(s.executables))check(v==='stellar-asset'||/^[0-9a-f]{64}$/.test(v),'Executable expectation must be the original WASM SHA256 or stellar-asset.');
 exactKeys(s.expected,Object.keys(READS).flatMap(c=>READS[c].map(m=>c+'.'+m)),'expected');canonical(s.expected);
 check(Array.isArray(s.roles)&&s.roles.length<=ROLES.length,'roles must be explicit.');
 const roleKeys=new Set();for(const r of s.roles){exactKeys(r,['contract','role','members'],'role expectation');const k=r.contract+'.'+r.role;check(ROLES.some(([c,n])=>c===r.contract&&n===r.role)&&!roleKeys.has(k),'Unknown/duplicate role expectation.');roleKeys.add(k);arrayUnique(r.members,k,256);r.members.forEach(a=>address(a,k));}
 check(Array.isArray(s.accounts)&&s.accounts.length<=256,'accounts must be explicit.');
 const seen=new Set();for(const a of s.accounts){exactKeys(a,['address','thresholds','signers'],'account');address(a.address,'account','G');check(!seen.has(a.address),'Duplicate account.');seen.add(a.address);exactKeys(a.thresholds,['low_threshold','med_threshold','high_threshold'],'thresholds');for(const k of ['low_threshold','med_threshold','high_threshold'])check(Number.isInteger(a.thresholds[k])&&a.thresholds[k]>=0&&a.thresholds[k]<=255,'Invalid explicit threshold.');
 check(Array.isArray(a.signers)&&a.signers.length<=21,'Expected complete signer policy.');const keys=new Set();for(const signer of a.signers){exactKeys(signer,['key','type','weight'],'signer');text(signer.key,'signer key');text(signer.type,'signer type');check(!keys.has(signer.key)&&Number.isInteger(signer.weight)&&signer.weight>=0&&signer.weight<=255,'Invalid/duplicate signer policy.');keys.add(signer.key);}}
 arrayUnique(s.bootstrapAccounts,'bootstrapAccounts',256);s.bootstrapAccounts.forEach(a=>address(a,'bootstrap account','G'));
 check(Array.isArray(s.evidence)&&s.evidence.length<=200,'evidence must be explicit.');for(const e of s.evidence){exactKeys(e,['id','description','reference','sha256'],'evidence');text(e.id,'evidence id');text(e.description,'evidence description',4000);text(e.reference,'evidence reference',4000);check(e.sha256===null||/^[0-9a-f]{64}$/.test(e.sha256),'Evidence hash must be actual or null.');}
 check(new Set(s.evidence.map(e=>e.id)).size===s.evidence.length,'Duplicate evidence ID.');
 return s;
}
export function publicDeployment(deployment){
 check(deployment&&typeof deployment==='object','Complete original Deployment required.');
 const result={schema:'strata.public-deployment/v1',network:deployment.network,deployedAt:deployment.deployedAt,ledger:deployment.ledger,asset:{code:deployment.asset?.code,issuer:deployment.asset?.issuer,contract:deployment.asset?.contract},contracts:{},accounts:{}};
 for(const c of CONTRACTS.filter(c=>c!=='asset')){address(deployment.contracts?.[c],c,'C');result.contracts[c]=deployment.contracts[c];}
 address(result.asset.contract,'asset','C');address(result.asset.issuer,'issuer','G');text(result.network,'network');text(result.deployedAt,'deployedAt');text(result.asset.code,'asset.code');check(Number.isSafeInteger(result.ledger)&&result.ledger>=0,'Invalid original ledger.');
 check(deployment.accounts&&Object.keys(deployment.accounts).length<=256,'Original accounts required.');
 for(const[name,a]of Object.entries(deployment.accounts)){text(name,'account name');address(a?.public,'public account','G');result.accounts[name]={public:a.public};}
 return copy(result);
}
export function requestFor(selection,operationId,createdAt){const s=validateSelection(selection);text(operationId,'operationId',160);check(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(operationId),'Unsafe operationId.');check(new Date(createdAt).toISOString()===createdAt,'Canonical UTC createdAt required.');return{schema:'strata.commissioning-request/v1',operationId,createdAt,selection:s,selectionSha256:hash(s)};}
export function validateRequest(r){check(r&&r.schema==='strata.commissioning-request/v1','Invalid request.');const expected=requestFor(r.selection,r.operationId,r.createdAt);check(canonical(r)===canonical(expected),'Request changed.');return expected;}
