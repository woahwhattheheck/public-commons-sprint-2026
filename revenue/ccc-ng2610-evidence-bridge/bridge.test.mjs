// MIT. Focused acceptance of provider envelopes and the W3 admission gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidence} from './bridge.mjs';
const input = {
  month:'2026-09',
  mapping:{schema_version:1,source_authorized:true,authorization_reference:'FIXTURE_ONLY_LOCAL_TEST',
    incident_fields:{incident_id:'number',priority:'priority',opened_at:'opened_at',investigation_at:'investigation_at',outage_start_at:'outage_start_at',outage_end_at:'outage_end_at',approved_maintenance:'approved_maintenance'},
    priority_values:{'1':'P1'},
    change_fields:{change_id:'number',completed_at:'closed_at',outcome:'close_code'},change_outcomes:{good:'success'},
    jira:{change_link_field:'fields.customfield_10007'},
    cloudwatch_series:[{id:'m1',start:'2026-09-01T00:00:00Z',end:'2026-09-01T00:05:00Z',period_seconds:300}]},
  incidents:{result:[{number:'INC1',priority:'1',opened_at:'2026-09-01T00:00:00Z',investigation_at:'2026-09-01T00:14:00Z',outage_start_at:'',outage_end_at:'',approved_maintenance:''}]},
  changes:{result:[{number:'CHG1',closed_at:'2026-09-03T05:00:00Z',close_code:'good'}]},
  jira:{issues:[{key:'OPS-1',fields:{customfield_10007:'CHG1'}}],total:1},
  cloudwatch:{MetricDataResults:[{Id:'m1',StatusCode:'Complete',Timestamps:[Date.parse('2026-09-01T00:00:00Z')/1000],Values:[1]}]}
};
test('official envelope shapes, deterministic scorer inputs, incomplete metric and non-UTC rejections',()=>{
  const x=buildEvidence(input);
  assert.deepEqual(buildEvidence(structuredClone(input)),x);
  assert.match(x['incidents.csv'],/INC1,P1,2026-09-01T00:00:00.000Z/);
  assert.match(x['changes.csv'],/CHG1,2026-09-03T05:00:00.000Z,success/);
  assert.equal(JSON.parse(x['manifest.json']).jira.matched_changes,1);
  const partial=structuredClone(input);partial.cloudwatch.MetricDataResults[0].StatusCode='PartialData';
  assert.throws(()=>buildEvidence(partial),/not complete/);
  const gap=structuredClone(input);gap.cloudwatch.MetricDataResults[0].Timestamps=[];gap.cloudwatch.MetricDataResults[0].Values=[];
  assert.deepEqual(JSON.parse(buildEvidence(gap)['manifest.json']).exception_codes,['AWS_CLOUDWATCH_GAPS:m1']);
  const naive=structuredClone(input);naive.incidents.result[0].opened_at='2026-09-01 00:00:00';
  assert.throws(()=>buildEvidence(naive),/explicit timezone/);
  const denied=structuredClone(input);denied.mapping.source_authorized=false;
  assert.throws(()=>buildEvidence(denied),/authorization/);
});
