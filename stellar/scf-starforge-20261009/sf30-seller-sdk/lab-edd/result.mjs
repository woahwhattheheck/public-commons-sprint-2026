// MIT. Reopen every source, native output and explicit cross-profile correspondence.
import { readLabZip } from './zip.mjs';
import { canonicalJson, sha256 } from './model.mjs';
import { reconcileDeliveries, previewReconciliation } from './reconciliation.mjs';
export function readLabResult(bytes,{signal}={}){
  const members=readLabZip(bytes,{maxBytes:536870912,maxMembers:128,signal});
  const byName=new Map(members.map(member=>[member.filename,member]));
  const fail=message=>{throw Error(message);};
  const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
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
  const fieldReview=(prefix,identity)=>{
    const source=parse(prefix+'source/manifest.json'),document=parse(prefix+'decisions.json'),
      review=parse(prefix+'review.json'),preparation=parse(prefix+'native-preparation.json');
    if(source.sourceSha256!==identity.sourceSha256||document.sourceSha256!==identity.sourceSha256||
      review.source?.sourceSha256!==identity.sourceSha256||document.schema!=='starforge.lab-edd-decisions.v1'||
      !same(source.profile,identity.profile)||!same(review.source.profile,identity.profile)||!same(document.profile,identity.profile)||
      sha256(canonicalJson(document))!==identity.documentSha256||review.documentSha256!==identity.documentSha256||
      review.reviewSha256!==identity.reviewSha256||!same(document,review.document)||!same(preparation,identity.nativePreparation))
      fail('The original source, field decisions and computed review identities disagree: '+prefix);
    return {source,document,review,nativePreparation:preparation};
  };
  const nativeFiles=(identity,preparation)=>{
    if(!identity.prepared){
      if(preparation.status!=='REVIEW_REQUIRED')fail('The native preparation state is incomplete.');
      return [];
    }
    if(preparation.status!=='PREPARED')fail('Native preparation has no completed output state.');
    const expectedArchive=identity.prepared,archive=byName.get(expectedArchive.archive);
    if(!archive||archive.bytes.length!==expectedArchive.bytes||archive.sha256!==expectedArchive.sha256)fail('The native receiving archive changed.');
    const prepared=readLabZip(archive.bytes,{maxBytes:268435456,maxMembers:128,signal});
    const actual=new Map(prepared.map(member=>[member.filename,member])),expectedNames=new Set();
    if(prepared.length!==expectedArchive.files.length)fail('The full native receiving file set changed.');
    for(const expected of expectedArchive.files){
      const member=actual.get(expected.filename);
      if(expectedNames.has(expected.filename)||!member||member.bytes.length!==expected.bytes||member.sha256!==expected.sha256)
        fail('A native receiving file changed: '+expected.filename);
      expectedNames.add(expected.filename);
    }
    if(expectedArchive.directMember){
      const direct=byName.get(expectedArchive.directMember);
      if(prepared.length!==1||!direct||direct.sha256!==prepared[0].sha256)fail('The direct native download differs from its complete member.');
    }
    return prepared;
  };
  const current=fieldReview('',manifest),prepared=nativeFiles(manifest,current.nativePreparation);
  let baseline=null,reconciliation=null;
  if(manifest.reconciliation){
    const identity=manifest.reconciliation;
    if(identity.schema!=='starforge.lab-edd-cross-profile-result.v1'||!manifest.originalMembers?.baseline)
      fail('The complete cross-profile result requires its original baseline.');
    baseline=fieldReview('baseline/',identity.baseline);
    baseline.prepared=nativeFiles(identity.baseline,baseline.nativePreparation);
    signal?.throwIfAborted();
    const sourceIdentity=source=>Object.fromEntries(Object.entries(source).filter(([key])=>key!=='unassigned'));
    if(!same(sourceIdentity(current.source),current.review.source)||!same(sourceIdentity(baseline.source),baseline.review.source))
      fail('An original full source manifest differs from its computed field review.');
    const currentSource={source:current.review.source,tables:parse('source/rows.json')};
    const baselineSource={source:baseline.review.source,tables:parse('baseline/source/rows.json')};
    const comparison=parse('comparison.json'),actualComparison=reconcileDeliveries(currentSource,baselineSource);
    if(comparison.comparisonSha256!==identity.comparisonSha256||!same(comparison,actualComparison)||
      !same(identity.mapping,{id:comparison.mapping.id,version:comparison.mapping.version})||
      !same(identity.sourceCounts,comparison.counts)||!same(identity.byKind,comparison.byKind))
      fail('The cross-profile comparison differs from its two complete original source tables.');
    const document=parse('reconciliation/decisions.json'),review=parse('reconciliation/review.json'),
      actualReview=previewReconciliation(actualComparison,document);
    if(identity.documentSha256!==actualReview.documentSha256||identity.reviewSha256!==actualReview.reviewSha256||
      !same(review,actualReview)||!same(identity.counts,actualReview.counts))
      fail('The retained correspondence differs from its exact source-bound review.');
    signal?.throwIfAborted();
    const outputComparison=parse('reconciliation/output-comparison.json');
    const actualOutput=reconcileDeliveries(currentSource,baselineSource,{currentReview:current.review,baselineReview:baseline.review});
    if(identity.outputComparisonSha256!==actualOutput.comparisonSha256||!same(outputComparison,actualOutput)||
      !same(identity.outputCounts,actualOutput.counts))
      fail('The prepared comparison differs from the two recorded native field reviews.');
    const editable=(prefix,metadata)=>{
      for(const [format,expected]of Object.entries(metadata??{})){
        const file=byName.get(prefix+format);
        if(!file||file.bytes.length!==expected.bytes||file.sha256!==expected.sha256)fail('A complete editable correspondence table changed.');
      }
    };
    editable('reconciliation/decisions.',identity.editableTables);
    editable('baseline/decisions.',identity.baseline.editableTables);
    const fields=byName.get('reconciliation/fields.csv');
    if(!fields||fields.bytes.length!==identity.fieldTable.bytes||fields.sha256!==identity.fieldTable.sha256)
      fail('The complete original field comparison changed.');
    reconciliation={comparison,document,review,outputComparison,baseline};
  }
  return {manifest,members,prepared,...current,baseline,reconciliation};
}
