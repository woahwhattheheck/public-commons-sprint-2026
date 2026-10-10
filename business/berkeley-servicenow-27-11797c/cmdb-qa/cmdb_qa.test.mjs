// Focused offline regression on this one changed utility; no hosted Actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseCsv, reconcileCsv, findingsCsv } from './cmdb_qa.mjs';

const h = 'sys_id,name,sys_class_name,assigned_to,install_status,serial_number,location';
const row = (id, name, owner = 'tech-1', status = 'installed', serial = 'SN1', location = 'Office') =>
  [id, name, 'cmdb_ci_computer', owner, status, serial, location].join(',');

// One test covering parser, audit invariants, fail-closed inputs and CLI receipts.
test('quote parsing, source/target reconciliation, evidence redaction and offline exit contract', () => {
  const parser = parseCsv('\uFEFFid,description\r\na,"hello, ""world""\r\nwith newline"\r\n');
  assert.deepEqual(parser.headers, ['id', 'description']);
  assert.equal(parser.records[0].description, 'hello, "world"\r\nwith newline');
  assert.throws(() => parseCsv('id,name\na,"unterminated'), /CSV_UNTERMINATED_QUOTE/);
  assert.throws(() => parseCsv('id,id\na,b'), /CSV_HEADER_INVALID_OR_DUPLICATE/);
  assert.throws(() => parseCsv('id,name\na,b,c'), /CSV_COLUMN_COUNT/);

  const source = [h, row('ASSET-1', 'Laptop', 'alice'), row('ASSET-2', 'Switch', 'bob')].join('\r\n') + '\r\n';
  const same = reconcileCsv(source, source);
  assert.equal(same.result, 'PASS');
  assert.equal(same.summary.findings, 0);
  assert.deepEqual(same.findings, []);
  const changed = [h, row('ASSET-1', 'Laptop', 'charlie'), row('ASSET-3', 'Router', 'bob')].join('\r\n') + '\r\n';
  const findings = reconcileCsv(source, changed);
  assert.equal(findings.result, 'REVIEW_REQUIRED');
  assert.deepEqual(findings.findings.map(f => `${f.record_key}:${f.reason}:${f.field}`), [
    'ASSET-1:FIELD_CHANGED:assigned_to', 'ASSET-2:RECORD_REMOVED:*', 'ASSET-3:RECORD_ADDED:*',
  ]);
  assert.equal(findings.summary.critical, 2);
  assert.equal(findings.summary.findings, 3);
  assert.equal(findings.findings[0].before_sha256.length, 64);
  assert.equal(JSON.stringify(findings).includes('alice'), false, 'private values must be hashed');
  assert.deepEqual(reconcileCsv(source, changed), findings, 'same text produces deterministic audit');
  const safe = findingsCsv([{ record_key: '=HYPERLINK("example")', reason: 'FIELD_CHANGED',
    field: 'assigned_to', severity: 'critical', before_sha256: '0', after_sha256: '1' }]);
  assert.match(safe, /"'=HYPERLINK\(""example""\)"/);

  assert.throws(() => reconcileCsv([h, row('ASSET-1', 'a'), row('ASSET-1', 'b')].join('\n'), source), /SOURCE_DUPLICATE_KEY/);
  assert.throws(() => reconcileCsv(source, 'sys_id,name\na,b'), /TARGET_FIELD_MISSING/);
  assert.throws(() => reconcileCsv(source, changed, { fields: ['name','name'] }), /AUDIT_FIELD_SPEC_INVALID/);

  const dir = mkdtempSync(join(tmpdir(), 'berkeley-snow-qa-'));
  try {
    const src = join(dir, 'src.csv'), dst = join(dir, 'dst.csv'), out = join(dir, 'results');
    writeFileSync(src, source); writeFileSync(dst, changed);
    const run = spawnSync(process.execPath, [new URL('./cmdb_qa.mjs', import.meta.url).pathname,
      '--source', src, '--target', dst, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /REVIEW_REQUIRED findings=3 critical=2/);
    const report = JSON.parse(readFileSync(join(out, 'audit.json'), 'utf8'));
    assert.equal(report.summary.findings, 3);
    assert.equal(readFileSync(join(out, 'discrepancies.csv'), 'utf8').split('\r\n').length, 5);
    const rerun = spawnSync(process.execPath, [new URL('./cmdb_qa.mjs', import.meta.url).pathname,
      '--source', src, '--target', dst, '--out', out], { encoding: 'utf8' });
    assert.equal(rerun.status, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'audit.json'), 'utf8')), report);
    const pass = spawnSync(process.execPath, [new URL('./cmdb_qa.mjs', import.meta.url).pathname,
      '--source', src, '--target', src, '--out', out], { encoding: 'utf8' });
    assert.equal(pass.status, 0);
    writeFileSync(dst, [h, row('ASSET-1', 'Laptop'), row('ASSET-1','Duplicate')].join('\n'));
    const invalid = spawnSync(process.execPath, [new URL('./cmdb_qa.mjs', import.meta.url).pathname,
      '--source', src, '--target', dst, '--out', out], { encoding: 'utf8' });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /TARGET_DUPLICATE_KEY/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
