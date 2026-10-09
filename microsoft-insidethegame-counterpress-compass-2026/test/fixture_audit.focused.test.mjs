import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFixture, markdownReport} from '../src/fixture_audit.mjs';
const ev = (id,second,type,team='Harbor FC') => ({id,second,type,team,player:'H1',zone:'middle'});
test('exact deadline is open until later watermark; same-time regain succeeds',()=>{
  const justClock = auditFixture([ev('e001',0,'loss'),ev('e002',2,'pressure'),ev('e003',8,'clock')]);
  assert.equal(justClock.counts.unresolved,1);
  assert.equal(justClock.counts.expired,0);
  const complete = auditFixture([ev('e001',0,'loss'),ev('e002',2,'pressure'),ev('e003',8,'clock'),ev('e004',8,'regain')]);
  assert.equal(complete.counts.success,1);
  const expired = auditFixture([ev('e001',0,'loss'),ev('e002',2,'pressure'),ev('e003',8.01,'clock')]);
  assert.equal(expired.counts.expired,1);
  assert.equal(expired.findings.some(x=>x.code==='UNVERIFIED_TIMEOUT_COVERAGE'),true);
  const attested = auditFixture([ev('e001',0,'loss'),ev('e002',2,'pressure'),ev('e003',8.01,'clock')],{coverage:'operator-attested-complete'});
  assert.equal(attested.findings.some(x=>x.code==='UNVERIFIED_TIMEOUT_COVERAGE'),false);
});
test('ties and conflicting team loss windows require human review, not invented results',()=>{
  const r = auditFixture([ev('e001',1,'loss'),ev('e002',1,'regain'),ev('e003',2,'loss','Metro Rovers'),ev('e004',3,'loss')]);
  assert.equal(r.status,'REVIEW');
  assert.equal(r.findings.some(x=>x.code==='SAME_TIME_TACTICAL_ORDER'),true);
  assert.equal(r.findings.some(x=>x.code==='OVERLAPPING_TEAM_LOSS'),true);
});
test('unrelated pressure and invalid schema cannot become confirmed successes',()=>{
  const r = auditFixture([ev('e001',2,'pressure'),ev('e002',3,'regain')]);
  assert.equal(r.counts.success,0);
  assert.equal(r.findings.some(x=>x.code==='PRESSURE_OUTSIDE_COUNTERPRESS_WINDOW'),true);
  assert.equal(r.findings.some(x=>x.code==='REGAIN_WITHOUT_OPEN_LOSS'),true);
  const bad=auditFixture([ev('e001',2,'loss'),ev('e001',3,'regain')]);
  assert.equal(bad.status,'INVALID');
  assert.equal(bad.windows.length,0);
});
test('deterministic Markdown evidence includes source digest and no false provider score',()=>{
  const a=auditFixture([ev('e001',1,'loss'),ev('e002',2,'pressure'),ev('e003',3,'regain')],{sourceSha256:'abc'});
  assert.equal(a.counts.success,1);
  assert.equal(markdownReport(a),markdownReport(a));
  assert.match(markdownReport(a),/SHA-256:\*\* abc/);
});