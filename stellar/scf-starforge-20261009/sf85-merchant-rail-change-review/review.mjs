/** SF85: offline original SF84 seller HTTP402 before/after payment-rail review. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {inspectBytes} from '../sf84-mpp-market-intake/inspect.mjs';
import {extract,diff} from './terms.mjs';
export class ReviewError extends Error {
  constructor(code){super(code);this.code=code;this.name='ReviewError';}
}
export function compareCaptures(beforeBytes,afterBytes) {
  const before=inspectBytes(beforeBytes),after=inspectBytes(afterBytes),flags=[];
  if(!before.serviceUrl || !after.serviceUrl || !before.method || !after.method) flags.push('MISSING_CAPTURE_URL_OR_METHOD');
  if(before.serviceUrl!==after.serviceUrl) flags.push('CAPTURE_RESOURCE_CHANGED');
  if(before.method!==after.method) flags.push('CAPTURE_HTTP_METHOD_CHANGED');
  if(before.httpStatus!==402 || after.httpStatus!==402) flags.push('NON_402_CAPTURE');
  for(const [when,r] of [['BEFORE',before],['AFTER',after]]) {
    for(const rail of ['x402','mpp'])
      if(['invalid','ambiguous'].includes(r[rail].status)) flags.push(when+'_'+rail.toUpperCase()+'_'+r[rail].status.toUpperCase());
    if(!['x402-v2-402','mpp-402','multi-protocol-402'].includes(r.classification)) flags.push(when+'_NO_VALID_RAIL');
  }
  const b=extract(before,flags),a=extract(after,flags);
  const x=diff(b.x,a.x,'x402'),m=diff(b.m,a.m,'mpp');
  const changes=[...x.changes,...m.changes],opaqueChanges=[...x.opaque,...m.opaque];
  const decision=flags.length ? 'SOURCE_OR_SCOPE_REVIEW_REQUIRED' :
    changes.length ? 'MATERIAL_RAIL_CHANGE_REVIEW' :
    opaqueChanges.length ? 'MATERIAL_TERMS_SAME_OPAQUE_FIELDS_CHANGED' : 'NO_MATERIAL_RAIL_DELTA_OBSERVED';
  return {schema:'scf.sf85.merchant-rail-review.v1',decision,
    source:{
      before:{sha256:before.capturedSha256,status:before.httpStatus,classification:before.classification,x402Status:before.x402.status,mppStatus:before.mpp.status},
      after:{sha256:after.capturedSha256,status:after.httpStatus,classification:after.classification,x402Status:after.x402.status,mppStatus:after.mpp.status}
    },
    scope:{beforeUrl:before.serviceUrl,afterUrl:after.serviceUrl,beforeMethod:before.method,afterMethod:after.method,
      beforeX402Resource:before.x402.offer?.resourceUrl??null,afterX402Resource:after.x402.offer?.resourceUrl??null},
    counts:{before:{x402:b.x.length,mpp:b.m.length},after:{x402:a.x.length,mpp:a.m.length}},
    flags:[...new Set(flags)].sort(),changes,opaqueChanges,
    boundaries:{importedParser:'original SF84 inspectBytes',originalSellerProof:false,
      merchantAuthorizationVerified:false,paymentOrSettlementVerified:false,paidOfferApproved:false,
      buyerRetryPerformed:false,sellerAcceptedMilestone:false,paymentRailsNeverInterchangeable:true,
      note:'An original file hash is not seller authentication. No invoice, transaction or seller signoff is implied.'}
  };
}
const safe = v=>String(v??'').replace(/[\r\n\t|<>]/g,' ').slice(0,250);
export function renderMarkdown(r) {
  const lines=['# SF85 · Merchant 402 protocol-change review','',
    'Decision: **'+r.decision+'**','',
    'Before file SHA-256: '+r.source.before.sha256,
    'After file SHA-256: '+r.source.after.sha256,
    'Seller scope: '+safe(r.scope.beforeMethod)+' '+safe(r.scope.beforeUrl),
    'Later scope: '+safe(r.scope.afterMethod)+' '+safe(r.scope.afterUrl),
    'Offer counts: x402 '+r.counts.before.x402+' → '+r.counts.after.x402+
      '; MPP '+r.counts.before.mpp+' → '+r.counts.after.mpp,'',
    '## Scope/source review','',...(r.flags.length?r.flags.map(x=>'- '+x):['- No parser/scope flags.']),'',
    '## Material rail changes',''];
  lines.push(...(r.changes.length?r.changes.map(c=>c.rail==='x402'?
    '- **'+c.kind+' x402** ('+c.count+'): '+safe(c.scheme)+' '+safe(c.network)+' asset '+safe(c.asset)+
      ' amount '+safe(c.amount)+' to '+safe(c.payTo)+'; timeout '+safe(c.maxTimeoutSeconds):
    '- **'+c.kind+' MPP** ('+c.count+'): '+safe(c.method)+' '+safe(c.intent)+' realm '+safe(c.realm)+
      ', canonical request digest '+c.requestSha256):['- No material changes recorded.']));
  lines.push('','## Additional challenge or offer changes','',
    ...(r.opaqueChanges.length?r.opaqueChanges.map(c=>'- '+c.rail+': '+c.kind+
      '; material tuple digest '+c.materialIdentitySha256):['- None.']),
    '','## Operator handoff','',
    '- Confirm both capture sources, seller authorization and identical intended buyer scope.',
    '- Review each changed original x402 tuple or MPP charge/session request separately; never mix payment rails.',
    '- Use the existing SF70/SF76/SF77 diagnosis and paid workorder only with seller-approved terms.',
    '- Keep actual customer acceptance and transaction receipts separate. This report is not payment evidence.','');
  return lines.join('\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  try{
    const args=process.argv.slice(2);
    if(![2,4].includes(args.length)||(args.length===4&&(args[2]!=='--format'||!['markdown','json'].includes(args[3]))))
      throw new ReviewError('USAGE: node review.mjs before.json after.json [--format markdown|json]');
    const result=compareCaptures(readFileSync(args[0]),readFileSync(args[1]));
    process.stdout.write(args[3]==='markdown'?renderMarkdown(result):JSON.stringify(result,null,2)+'\n');
  }catch(e){console.error('SF85_REVIEW_ERROR: '+(e.code??'ORIGINAL_SOURCE_OR_FILE_ERROR'));process.exitCode=2;}
}
