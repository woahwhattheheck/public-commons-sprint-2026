// MIT. Display exact retained collective-investment and SDP observations.
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export function exactObservation(row){
 const value=row?.value??row?.projection??{},tokens=row?.numberTokens??row?.projectionNumberTokens??{};
 function walk(v,p){if(own(tokens,p))return String(tokens[p]);if(Array.isArray(v))return v.map((x,i)=>walk(x,p+'/'+i));
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,p+'/'+k.replaceAll('~','~0').replaceAll('/','~1'))]));return v;}
 return walk(value,'');
}
export function amountLabel(value,unit){return value===null||value===undefined?'Not supplied':String(value)+(unit?' '+unit:'');}
export function sectionTitle(key){return ({providerStatus:'Original provider status',status:'Reconciliation state',scope:'Original scope',rows:'All observations',totals:'Exact totals by role',findings:'Findings',sourceGaps:'Source coverage gaps',exceptions:'Exceptions',contributions:'Fund contributions',proposals:'Proposals and tallies',milestones:'Milestones and evidence',attestations:'Oracle attestations',disbursements:'Disbursements',payments:'SDP payments',receivers:'SDP receivers',wallets:'Recipient wallet providers',distributionWallets:'Distribution accounts',settlements:'Stellar movements',links:'Review decisions',decisions:'Review decisions',events:'Retained events',coverage:'Capture coverage'})[key]??String(key??'Records').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase());}
const preferred=['resourceId','kind','providerStatus','status','state','sourceScope','amount','amountUsdc','currency','asset','unit','role','values','reconciliationState','evidenceState','proposalId','milestoneId','distributionWalletId','versionId','code','reason'];
export function displayColumns(group,rows){
 
 if(['exceptions','findings','sourceGaps'].includes(group))return [['code','Finding'],['versionId','Original version'],['sourceId','Source'],['captureId','Collection'],['evidence','Evidence'],['reason','Reason'],['detail','Details'],['meaning','Meaning']];
 const known=new Set(rows.filter(r=>r&&typeof r==='object').flatMap(r=>Object.keys(r)));
 const selected=[...preferred.filter(k=>known.has(k)),...known].filter((v,i,a)=>a.indexOf(v)===i).slice(0,9);
 return selected.length?selected.map(k=>[k,sectionTitle(k)]):[['value','Value']];
}
export function resourceSummary(row){
 const v=exactObservation(row),kind=row?.kind??'',amount=v.amountUsdc??v.usdcAmount??v.amount??v.totalBalance??v.balanceUsdc??v.balance;
 const unit=kind.startsWith('escala-')&&(own(v,'amountUsdc')||own(v,'usdcAmount')||own(v,'balanceUsdc')||own(v,'totalBalance'))?'USDC':v.asset?.code??v.currency??'original units';
 return {value:v,title:v.name??v.title??v.reference??v.id??v.proposalId??v.milestoneId??v.disbursementId??v.fundId??row?.resourceId,status:v.status??v.state??v.result??row?.status??row?.kind,
 primary:amount===undefined?null:amountLabel(amount,unit),
 secondary:v.yesWeight!==undefined?'Yes '+v.yesWeight+' / No '+v.noWeight+' / Quorum '+v.quorumRequired:null,
 relation:[v.communityId,v.fundId,v.proposalId,v.milestoneId,v.disbursement_id,v.distribution_wallet_id].filter(Boolean).join(' / ')||null};
}
export const REGISTER_KINDS=[["escala-community","Communities"],["escala-fund","Funds"],["escala-contribution","Contributions"],["escala-proposal","Proposals"],["escala-tally","Voting tallies"],["escala-milestone","Milestones"],["escala-evidence","Milestone evidence"],["escala-attestation","Attestations"],["escala-disbursement","Treasury releases"],["sdp-disbursement","SDP disbursements"],["sdp-payment","SDP payments"],["sdp-distribution-wallet","Distribution accounts"],["sdp-receiver","Recipients"],["sdp-balance","Account balances"]];
export const OBSERVATION_SECTIONS={};
