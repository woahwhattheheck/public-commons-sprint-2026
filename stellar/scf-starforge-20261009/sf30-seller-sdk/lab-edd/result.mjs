// MIT. Reopen the complete laboratory result and every original/native member.
import { readLabZip } from './zip.mjs';
import { canonicalJson, sha256 } from './model.mjs';
export function readLabResult(bytes,{signal}={}){
  const members=readLabZip(bytes,{maxBytes:536870912,maxMembers:128,signal});
  const byName=new Map(members.map(member=>[member.filename,member]));
  const fail=message=>{throw Error(message);};
  const parse=name=>{const member=byName.get(name);if(!member)fail('A complete result member is absent: '+name);return JSON.parse(member.bytes.toString('utf8'));};
  const manifest=parse('manifest.json');
  if(manifest.schema!=='starforge.lab-edd-job-result.v1'||!Array.isArray(manifest.members)||members.length!==manifest.members.length+1)
    fail('The retained file is not a complete laboratory result.');
  const names=new Set();
  for(const expected of manifest.members){
    const actual=byName.get(expected.path);
    if(names.has(expected.path)||expected.path==='manifest.json'||!actual||actual.bytes.length!==expected.bytes||actual.sha256!==expected.sha256)
      fail('A complete result member changed: '+expected.path);
    names.add(expected.path);
  }
  for(const file of manifest.sourceFiles??[]){
    const actual=byName.get(manifest.originalMembers?.[file.slot]);
    if(!actual||actual.bytes.length!==file.bytes||actual.sha256!==file.sha256)fail('An original input changed: '+file.slot);
  }
  const source=parse('source/manifest.json'),document=parse('decisions.json'),review=parse('review.json'),preparation=parse('native-preparation.json');
  if(source.sourceSha256!==manifest.sourceSha256||document.sourceSha256!==manifest.sourceSha256||
    review.source?.sourceSha256!==manifest.sourceSha256||document.schema!=='starforge.lab-edd-decisions.v1'||
    canonicalJson(document.profile)!==canonicalJson(manifest.profile)||sha256(canonicalJson(document))!==manifest.documentSha256||
    review.documentSha256!==manifest.documentSha256||review.reviewSha256!==manifest.reviewSha256||
    canonicalJson(document)!==canonicalJson(review.document)||canonicalJson(preparation)!==canonicalJson(manifest.nativePreparation))
    fail('The original source, field decisions and computed review identities disagree.');
  let prepared=[];
  if(manifest.prepared){
    if(preparation.status!=='PREPARED')fail('Native preparation has no completed output state.');
    const archive=byName.get(manifest.prepared.archive);
    if(!archive||archive.bytes.length!==manifest.prepared.bytes||archive.sha256!==manifest.prepared.sha256)fail('The native receiving archive changed.');
    prepared=readLabZip(archive.bytes,{maxBytes:268435456,maxMembers:128,signal});
    const actual=new Map(prepared.map(member=>[member.filename,member]));
    if(prepared.length!==manifest.prepared.files.length)fail('The full native receiving file set changed.');
    for(const expected of manifest.prepared.files){
      const member=actual.get(expected.filename);
      if(!member||member.bytes.length!==expected.bytes||member.sha256!==expected.sha256)fail('A native receiving file changed: '+expected.filename);
    }
    if(manifest.prepared.directMember){
      const direct=byName.get(manifest.prepared.directMember);
      if(prepared.length!==1||!direct||direct.sha256!==prepared[0].sha256)fail('The direct native download differs from its complete member.');
    }
  }else if(preparation.status!=='REVIEW_REQUIRED')fail('The native preparation state is incomplete.');
  return {manifest,members,prepared,source,document,review,nativePreparation:preparation};
}
