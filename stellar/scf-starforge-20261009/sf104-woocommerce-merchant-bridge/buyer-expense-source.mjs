// MIT. Capture a delivered original Woo refund for the buyer expense workspace.
import {readFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {receiveRefund} from './refund-handoff.mjs';
import {inspectRefund,bindRefundAdjustment,wooMoney} from './refund-operator.mjs';
import {privateDirectory} from '../sf88-operator-buyer-cli/node/store.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x==='object' ?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])) : x;
const digest = x => hash(JSON.stringify(stable(x)));
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const HEX=/^[a-f0-9]{64}$/;
export const SCHEMA='stellar-forge.buyer-refund-source.v1';
const transferIdentity=p=>digest({network:p.network,asset:p.asset,transaction:p.transaction,
  event:p.matchingEventId,payer:p.payer,recipient:p.recipient,amount:p.atomicAmount});

/** Run the original receiving validation/install solely in the selected private
 * intake directory. Neither the original store nor any network is contacted. */
export async function captureBuyerRefund({sourceDirectory,manifestSha256,siteUrl,intakeDirectory}){
  need(typeof siteUrl==='string','Select the original store URL');
  const url=new URL(siteUrl);
  need(url.protocol==='https:' && !url.username && !url.password && !url.search && !url.hash &&
       siteUrl===url.origin+url.pathname.replace(/\/$/,''),'Use the exact original HTTPS store origin/path without credentials');
  need(typeof manifestSha256==='string' && HEX.test(manifestSha256),'Select the original manifest SHA-256');
  for(const p of [sourceDirectory,intakeDirectory])need(typeof p==='string' && resolve(p)===p,'Use absolute original paths');
  const source=await privateDirectory(sourceDirectory,{create:false});
  const workspace=await privateDirectory(intakeDirectory);
  const config={siteUrl,workspace};
  const receipt=await receiveRefund(config,source,{expectedManifestSha256:manifestSha256});
  const original=await inspectRefund(config,receipt.adjustmentId,{live:false});
  const manifestRaw=await readFile(join(receipt.receiptDirectory,'manifest.json'));
  need(hash(manifestRaw)===manifestSha256,'The original manifest changed after receiving');
  const manifest=JSON.parse(manifestRaw),files=[];
  for(const entry of manifest.files){
    const p=join(receipt.operationDirectory,entry.name),before=await lstat(p);
    need(before.isFile()&&!before.isSymbolicLink(),'The received source is not a regular file');
    const raw=await readFile(p),after=await lstat(p);
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&
      raw.length===entry.bytes&&hash(raw)===entry.sha256,'The received original member changed');
    files.push({...entry,base64:raw.toString('base64')});
  }
  const read=name=>JSON.parse(Buffer.from(files.find(x=>x.name===name).base64,'base64'));
  const before=read('order-before.json'),accounting=read('adjustments.json');
  const selected=bindRefundAdjustment(accounting,receipt.adjustmentId,before,config,receipt.orderReference);
  const input=original.input,payment=before.originalPayment,paid=payment.reviewedTransfer,proof=input.reviewedRefund;
  const amount=wooMoney(input.wooAmount,input.priceDecimals,{positive:true});
  const orderAmount=wooMoney(before.order.total,input.priceDecimals,{positive:true});
  const latest=original.attempts.at(-1);
  const refund=latest?.order?.refunds?.find(x=>x.adjustmentId===input.adjustmentId);
  const purchase={site_url:siteUrl,order_reference:input.orderReference,event_id:input.eventId,
    identity_sha256:input.identitySha256,transaction:input.originalTransactionHash,
    network:paid.network,asset:paid.asset,payer:paid.payer,recipient:paid.recipient,
    amount:paid.atomicAmount,transfer_identity:transferIdentity(paid),matching_event_id:paid.matchingEventId,
    route_id:payment.binding.routeId,method:payment.binding.method,approved_at:payment.binding.approvedAt,
    original_snapshot_at:before.observedAt,observation:paid,
    currency:input.currency,store_amount:orderAmount.amount,store_units:orderAmount.units.toString(),
    price_decimals:input.priceDecimals};
  const credit={adjustment_id:input.adjustmentId,order_reference:input.orderReference,
    event_id:input.eventId,original_transaction:input.originalTransactionHash,
    original_operation_status:original.status,refund_id:refund?.id==null?null:String(refund.id),
    amount:input.amountAtomic,network:proof.network,asset:proof.asset,
    payer:proof.payer,recipient:proof.recipient,transaction:proof.transaction,
    transfer_identity:transferIdentity(proof),transfer_at:proof.transferAt,
    matching_event_id:proof.matchingEventId,observed_at:proof.observedAt,
    observation:proof,observation_sha256:digest(proof),
    currency:input.currency,store_amount:amount.amount,store_units:amount.units.toString(),
    price_decimals:input.priceDecimals,reason:input.reason,
    input_sha256:input.sha256,source_sha256:input.sourceSha256,
    request_sha256:input.requestSha256};
  return {schema:SCHEMA,captured_at:new Date().toISOString(),source_directory:source,
    site_url:siteUrl,manifest_sha256:manifestSha256,manifest_base64:manifestRaw.toString('base64'),
    receipt,original_status:original.status,purchase,credit,
    original_record:selected.record,files,
    basis:'Original SF104 receiveRefund and inspectRefund; original monetary mapping and saved reverse-transfer proof; no network operation'};
}
export async function main(args=process.argv.slice(2)){
  const values={};
  for(let i=0;i<args.length;i+=2){need(['--source-dir','--manifest-sha256','--site','--intake'].includes(args[i])&&
    typeof args[i+1]==='string'&&!Object.hasOwn(values,args[i]),'Use each declared original-source option once');values[args[i]]=args[i+1];}
  const result=await captureBuyerRefund({sourceDirectory:values['--source-dir'],
    manifestSha256:values['--manifest-sha256'],siteUrl:values['--site'],intakeDirectory:values['--intake']});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(String(error.message||error)+'\n');process.exitCode=1;});
