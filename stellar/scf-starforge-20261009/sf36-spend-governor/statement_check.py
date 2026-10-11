"""Focused original-Governor -> live WAL -> statement workflow. No network."""
import contextlib
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import governor as native
import statement as s

A, B = 'C'*56, 'D'*56
TODAY = datetime.now(timezone.utc).replace(microsecond=0)
LIMIT = str(native.MAX_AMOUNT)
CK, AK, OK = b'c'*32, b'a'*32, b'o'*32  # local fictional fixture, never production keys
POLICY = {'schema': native.SCHEMA, 'assets': [
    {'network': n, 'asset': a, **{k: LIMIT for k in native.CURRENCY_FIELDS}}
    for n, a in [('stellar:testnet', A), ('stellar:pubnet', A), ('stellar:testnet', B)]]}


def buy(g, rid, amount, *, actual=None, network='stellar:testnet', asset=A,
        actor='research-1', service='weather-api', days_ago=0, receipt=None):
    clock = TODAY - timedelta(days=days_ago)
    r = dict(request_id=rid, actor=actor, service=service, network=network, asset=asset,
             scheme='upto' if actual is not None else 'exact', max_amount=str(amount),
             resource='https://example.com/data', pay_to='fixture-recipient',
             max_timeout_seconds=60, method='GET', body_present=False, body_bytes=0,
             body_sha256=native.EMPTY_BODY_SHA256, accepted_terms_sha256='1'*64)
    with patch.object(native, 'now_utc', return_value=clock):
        g.reserve(r, native.issue_consent(CK, r, (clock+timedelta(minutes=5)).isoformat()))
    if actual is not None:
        proof=hashlib.sha256(rid.encode()).hexdigest()
        g.reconcile(native.issue_finality_attestation(OK, rid, str(actual), receipt or 'fixture:'+rid, proof))
    return r


class NativeStatementWorkflow(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.db=self.root/'fictional-buyer.sqlite'
        self.g=native.Governor(self.db, POLICY, CK, AK, OK)

    def tearDown(self):
        self.g.close()
        self.tmp.cleanup()

    def seed(self):
        buy(self.g,'settled-1',12000000,actual=12000000,days_ago=1)
        buy(self.g,'metered-1',5000000,actual=1250000,actor='research-2',days_ago=1)
        buy(self.g,'pending-old',9000000,days_ago=2)
        buy(self.g,'pending-today',3000000)
        buy(self.g,'large-pubnet',9007199254740993,actual=9007199254740993,network='stellar:pubnet',actor='-csv-safe',receipt='=HYPERLINK("https://example.com")')
        for i in range(3):
            buy(self.g,f'zero-metered-{i}',native.MAX_AMOUNT,actual=0,asset=B,service='metered-api')

    def test_native_lifecycle_amounts_capacity_and_filters(self):
        self.seed()
        before=list(self.g.db.iterdump())
        report=s.build_statement(s.read_snapshot(self.db),policy=POLICY,
                                 filters={'from_day':TODAY.date().isoformat()})
        pair=next(g for g in report['portfolio'] if (g['network'],g['asset'])==('stellar:testnet',A))
        self.assertEqual((pair[s.MONEY[0]],pair[s.MONEY[1]],pair[s.MONEY[2]]),('13250000','12000000','3750000'))
        self.assertEqual(pair['today_accounted_base_units'],'3000000')
        self.assertEqual(int(pair['remaining_total_base_units']),native.MAX_AMOUNT-25250000)
        self.assertNotIn('pending-old',[r['request_id'] for r in report['rows']])
        self.assertEqual(next(g for g in report['portfolio'] if g['asset']==B)[s.MONEY[2]],str(3*native.MAX_AMOUNT))
        self.assertEqual(self.g.audit()['rows'],8)
        self.assertEqual(before,list(self.g.db.iterdump()))
        # Compare the same capacity semantics to the unchanged native governor.
        request=buy(self.g,'native-cap-check',1)
        refreshed=s.build_statement(s.read_snapshot(self.db),policy=POLICY)
        group=next(g for g in refreshed['portfolio'] if (g['network'],g['asset'])==('stellar:testnet',A))
        self.assertEqual(group['remaining_total_base_units'],self.g.estimate(request)['limit_remaining']['max_total'])
        self.assertEqual(group['remaining_today_base_units'],self.g.estimate(request)['limit_remaining']['max_per_utc_day'])

    def test_concurrent_commit_does_not_mix_snapshot_rows_and_metadata(self):
        buy(self.g,'first',10)
        real_connect=sqlite3.connect
        owner=self
        class Reader(sqlite3.Connection):
            def execute(conn, query, *args):
                if query.startswith('SELECT COUNT(*)'):
                    buy(owner.g,'committed-during-read',20)
                return super().execute(query,*args)
        with patch.object(s.sqlite3,'connect',side_effect=lambda *a,**kw:real_connect(*a,**kw,factory=Reader)):
            snapshot=s.read_snapshot(self.db)
        self.assertEqual([r['request_id'] for r in snapshot['rows']],['first'])
        self.assertEqual((snapshot['journal_events'],snapshot['last_sequence']),(1,1))
        self.assertEqual(len(s.read_snapshot(self.db)['rows']),2)

    def test_export_exactness_html_and_csv_untrusted_text(self):
        self.seed()
        report=s.build_statement(s.read_snapshot(self.db))
        csvrows=list(csv.DictReader(io.StringIO(s.render_csv(report['rows']))))
        big=next(r for r in csvrows if r['request_id']=='large-pubnet')
        self.assertEqual(big['settled_base_units'],'9007199254740993')
        self.assertEqual(big['actor'],"'-csv-safe")
        self.assertTrue(big['receipt_ref'].startswith("'="))
        buy(self.g,'html-escape',1,actual=1,receipt='</script><script>globalThis.pwned=1</script>')
        report=s.build_statement(s.read_snapshot(self.db),labels={'assets':[{'network':'stellar:testnet','asset':A,'symbol':'<img src=x>','decimals':7}]})
        page=s.render_html(report)
        self.assertNotIn('</script><script>globalThis.pwned',page)
        self.assertNotIn('<img src=x>',page)
        self.assertIn('9007199254740993',json.dumps(report))
        self.assertEqual(s.format_units('9007199254740993',{'decimals':7,'symbol':'TEST'}),'900719925.4740993 TEST')
        self.assertIn("connect-src &#x27;none&#x27;",page)

    def test_cli_empty_readonly_invalid_and_output_preservation(self):
        def run(*args):
            with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                return s.main(list(args))
        out=self.root/'empty.json'
        self.assertEqual(run(str(self.db),'--output',str(out)),0)
        self.assertEqual(json.loads(out.read_text())['rows'],[])
        if os.name=='posix':self.assertEqual(out.stat().st_mode&0o777,0o600)
        before=out.read_bytes()
        self.assertEqual(run(str(self.db),'--output',str(out)),2)
        self.assertEqual(out.read_bytes(),before)
        self.assertEqual(run(str(self.root/'missing.db'),'--output',str(self.root/'no.json')),2)
        self.assertFalse((self.root/'missing.db').exists())
        self.assertEqual(run(str(self.db),'--output',str(self.db),'--format','json'),2)
        self.assertEqual(self.g.audit()['rows'],0)
        buy(self.g,'invalid',1)
        self.g.db.execute("UPDATE reservations SET state='unknown'")
        self.assertEqual(run(str(self.db),'--output',str(self.root/'invalid.json')),2)
        self.assertFalse((self.root/'invalid.json').exists())


if __name__=='__main__':
    unittest.main(verbosity=2)
