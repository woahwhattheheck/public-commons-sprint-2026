import test from "node:test";
import assert from "node:assert/strict";
import { validateReadiness, receiptIds } from "../submission/readiness-contract.mjs";

const GEN = "a".repeat(64);
function demo() {
  return {format:"permitpulse-demo-plan-v1",targetSeconds:165,scenes:[
    {start:0,end:25,title:"a",proof:"a"},{start:25,end:55,title:"b",proof:"b"},
    {start:55,end:90,title:"c",proof:"c"},{start:90,end:125,title:"d",proof:"d"},
    {start:125,end:165,title:"e",proof:"e"},
  ]};
}
function base() {
  return {
    format:"permitpulse-submission-readiness-v2",operation:"test",
    source:{stagingRepo:"woahwhattheheck/public-commons-sprint-2026",stagingDirectory:"permitpulse-all-gas",sourceMergeCommit:"5da9e9d7a46e389d29afc15112e477db829ec62f",sourceManifest:"permitpulse-all-gas/SOURCE_MANIFEST.json",sourceGeneration:GEN},
    officialRules:{url:"https://www.convex.dev/hackathons/all-gas",verifiedOn:"2026-09-19",deadline:"2026-09-22T12:00:00-07:00",cashPrizesUsd:[10000,5000,1500],requirements:["luma_registration","public_repo","root_hackathon_md","convex_backend","live_convex_or_chatgpt_url","real_openai_work","real_firecrawl_work","real_agentmail_work","social_build_post","video_under_180_seconds","vibeapps_submission"]},
    externalReceipts:receiptIds.map((id)=>({id,required:true,status:"OPEN",evidence:[]})),
    readyForSubmission:false,truthBoundary:"SOURCE_TEST_DEMO_EXTERNAL_RECEIPTS_GATED",
  };
}
function evidence(provider="provider", sourceGeneration=GEN) {
  return {provider,url:"https://example.com/receipt",capturedAt:"2026-09-19T23:00:00Z",sourceGeneration};
}

test("open staging ledger is valid but not ready",()=>{
  const result=validateReadiness(base(),demo());
  assert.equal(result.readyForSubmission,false);
  assert.equal(result.verifiedRequired,0);
});

test("all required live receipts can promote readiness to true",()=>{
  const value=base();
  for(const row of value.externalReceipts){ if(row.required){ row.status="VERIFIED"; row.evidence=[evidence(row.id)]; } }
  value.readyForSubmission=true;
  const result=validateReadiness(value,demo());
  assert.equal(result.readyForSubmission,true);
  assert.equal(result.verifiedRequired,result.requiredCount);
});


test("Luma registration is a required eligibility receipt",()=>{
  const value=base();
  for(const row of value.externalReceipts){
    if(row.id!=="luma_registration"){ row.status="VERIFIED"; row.evidence=[evidence(row.id)]; }
  }
  value.readyForSubmission=true;
  assert.throws(()=>validateReadiness(value,demo()),/readyForSubmission/);
});

test("ready true fails while any required receipt is open",()=>{
  const value=base(); value.readyForSubmission=true;
  assert.throws(()=>validateReadiness(value,demo()),/readyForSubmission/);
});

test("verified evidence must bind the exact source generation",()=>{
  const value=base(); const row=value.externalReceipts.find((r)=>r.id==="public_repo");
  row.status="VERIFIED"; row.evidence=[evidence("github","b".repeat(64))];
  assert.throws(()=>validateReadiness(value,demo()),/source generation mismatch/);
});

test("verified evidence must use https and canonical UTC",()=>{
  const value=base(); const row=value.externalReceipts.find((r)=>r.id==="public_repo");
  row.status="VERIFIED"; row.evidence=[{...evidence("github"),url:"http://example.com"}];
  assert.throws(()=>validateReadiness(value,demo()),/non-https/);
  row.evidence=[{...evidence("github"),capturedAt:"yesterday"}];
  assert.throws(()=>validateReadiness(value,demo()),/canonical UTC/);
});

test("duplicate receipt identities fail closed",()=>{
  const value=base(); value.externalReceipts[1].id=value.externalReceipts[0].id;
  assert.throws(()=>validateReadiness(value,demo()),/duplicate receipt id/);
});
