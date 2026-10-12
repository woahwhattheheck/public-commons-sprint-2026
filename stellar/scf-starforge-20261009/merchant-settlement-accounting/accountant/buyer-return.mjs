// MIT. Reuse the accountant engine for a source-bound return to the original buyer.
import {createHandoff,validateHandoff,validateRevision,inspectHandoff} from './engine.mjs';
import {BUYER_RETURN_PACKET_SCHEMA,isBuyerHandoff,buyerCanonical,buyerHash,inspectBuyerSource} from './buyer-source.mjs';
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const clone=x=>JSON.parse(buyerCanonical(x));

export function createBuyerReturnPacket({handoff,revisions,buyerSourceBytes}={}){
  validateHandoff(handoff,{allowBuyer:true});
  check(isBuyerHandoff(handoff),'BUYER_HANDOFF_REQUIRED','Choose a buyer accountant handoff.');
  const inspected=inspectBuyerSource(buyerSourceBytes);
  const rebuilt=createHandoff({buyerSourceBytes,id:handoff.id,name:handoff.name,actor:handoff.actor,createdAt:handoff.createdAt,labels:handoff.labels});
  check(buyerCanonical(rebuilt)===buyerCanonical(handoff),'BUYER_RETURN_SOURCE_CHANGED','The accountant handoff does not bind to these exact original issued allocations.',409);
  check(Array.isArray(revisions)&&revisions.length>0&&revisions.length<=2000,'BUYER_RETURN_REQUIRED','Select a saved accountant return and its complete preceding history.');
  let previous=null;
  const ids=new Set();
  for(const revision of revisions){
    validateRevision(handoff,revision);
    check(!ids.has(revision.id)&&revision.parentRevisionId===(previous?.id??null)&&revision.parentRevisionSha256===(previous?.integrity.sha256??null),'BUYER_RETURN_CHAIN_CHANGED','Retain one complete original accountant return chain.',409);
    ids.add(revision.id);previous=revision;
  }
  const body={schema:BUYER_RETURN_PACKET_SCHEMA,source:{sha256:inspected.sha256,bytes:inspected.raw.length,...clone(inspected.source.buyer)},
    handoff:clone(handoff),revisions:clone(revisions),selectedRevisionId:previous.id};
  return {...body,integrity:{sha256:buyerHash(buyerCanonical(body))}};
}

/** Pure, bounded exact-file validation. It neither writes books nor edits expenses. */
export function inspectBuyerReturn({packetBytes,buyerSourceBytes}={}){
  const raw=Buffer.from(packetBytes);
  check(raw.length>0&&raw.length<=64*1024*1024,'BUYER_RETURN_SIZE','Choose a buyer accountant return JSON file up to 64 MiB.');
  let packet;try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{check(false,'BUYER_RETURN_JSON','Choose a UTF-8 buyer accountant return JSON file.');}
  check(packet?.schema===BUYER_RETURN_PACKET_SCHEMA&&packet.integrity,'BUYER_RETURN_PACKET_REQUIRED','Download the original buyer-return.json file from the accountant handoff.');
  const rebuilt=createBuyerReturnPacket({handoff:packet.handoff,revisions:packet.revisions,buyerSourceBytes});
  check(buyerCanonical(packet)===buyerCanonical(rebuilt),'BUYER_RETURN_PACKET_CHANGED','The return packet or its original source identity changed.',409);
  const revision=packet.revisions.at(-1),view=inspectHandoff(packet.handoff,revision);
  return {schema:'stellar-forge.buyer-accountant-return-inspection.v1',packetSha256:buyerHash(raw),packetBytes:raw.length,
    source:clone(packet.source),handoffId:packet.handoff.id,handoffSha256:packet.handoff.integrity.sha256,
    selectedRevisionId:revision.id,selectedRevisionSha256:revision.integrity.sha256,
    revisions:packet.revisions.map(r=>({id:r.id,parentRevisionId:r.parentRevisionId,sha256:r.integrity.sha256,createdAt:r.createdAt,actor:r.actor,name:r.name,summary:r.summary})),
    rows:view.rows.map(row=>({sourceLineId:row.sourceLineId,rowId:row.rowId,kind:row.kind,sourceRowSha256:row.sourceRowSha256,
      original:clone(row.original),externalStatus:row.externalStatus,externalBookRef:row.externalBookRef,
      externalAccountCode:row.externalAccountCode,externalNote:row.externalNote,updatedBy:row.updatedBy,updatedAt:row.updatedAt,revisionId:row.revisionId})),
    summary:clone(revision.summary),issues:clone(revision.issues),missingRows:clone(revision.missingRows)};
}
