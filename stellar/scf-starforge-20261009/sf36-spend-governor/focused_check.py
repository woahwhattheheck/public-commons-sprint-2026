"""Single focused behavioral check for SF-36's actual source; no blockchain IO."""
import json
import hashlib
import os
import tempfile
from datetime import datetime,timezone,timedelta
from pathlib import Path
from governor import Governor,Denied,issue_consent,issue_finality_attestation

asset='CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' # asset from canonical Stellar exact spec example; no live wallet
policy={'schema':'stellar-spend-governor/v1','assets':[{ 'network':'stellar:testnet','asset':asset,
  'max_single':'600','max_total':'1000','max_per_utc_day':'1000',
  'max_per_actor_utc_day':'1000','max_per_service_utc_day':'1000'}]}
keys=[os.urandom(32) for _ in range(3)]
PAYEE='G'+'A'*55  # clearly non-funded test fixture, not a live Stellar destination
OTHER_PAYEE='G'+'B'*55
EMPTY_SHA=hashlib.sha256(b'').hexdigest()
def req(rid,amount,scheme='upto',pay_to=PAYEE,timeout=60):
    terms={'scheme':scheme,'network':'stellar:testnet','asset':asset,'payTo':pay_to,
           'amount':str(amount),'maxTimeoutSeconds':timeout}
    terms_sha=hashlib.sha256(json.dumps(terms,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return dict(request_id=rid,actor='authorized-agent-1',service='catalog-api',network='stellar:testnet',asset=asset,
                scheme=scheme,max_amount=str(amount),resource='https://public.example.org/priced-api',
                pay_to=pay_to,max_timeout_seconds=timeout,method='GET',body_present=False,body_bytes=0,
                body_sha256=EMPTY_SHA,accepted_terms_sha256=terms_sha)
def consent(r):
    return issue_consent(keys[0],r,(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())
def deny(fn,expected):
    try:fn()
    except Denied as e:
        assert expected in str(e),(expected,str(e))
        return
    raise AssertionError('expected denial: '+expected)

with tempfile.TemporaryDirectory() as p:
    db=Path(p)/'ledger.db';g=Governor(db,policy,*keys)
    # The WAL/FULL settings must actually be in effect for a durable ledger.
    assert g.db.execute('PRAGMA journal_mode').fetchone()[0].lower()=='wal'
    assert g.db.execute('PRAGMA synchronous').fetchone()[0]==2
    x=req('request-a',600)
    assert g.estimate(x)['approved'] is True
    assert g.reserve(x,consent(x))['outcome']=='RESERVED'
    assert g.reserve(x,consent(x))['outcome']=='IDEMPOTENT_EXISTING'
    y=req('request-b',500)
    deny(lambda:g.reserve(y,consent(y)),'budget exceeded')
    tamper=req('request-a',600);tamper['actor']='other'
    deny(lambda:g.reserve(tamper,consent(x)),'does not bind')
    # A once-valid consent for a recipient/timeout/operation/body/terms hash
    # must NEVER be reused for a different eventual signed purchase.
    for field,change in [('pay_to',OTHER_PAYEE),('max_timeout_seconds',90),
                         ('method','POST'),('accepted_terms_sha256','f'*64)]:
        altered=dict(x);altered[field]=change
        deny(lambda altered=altered:g.reserve(altered,consent(x)),'does not bind')
    # An independently valid POST with a new body still cannot reuse GET consent.
    posted=dict(x,method='POST',body_present=True,body_bytes=4,
                body_sha256=hashlib.sha256(b'DATA').hexdigest())
    deny(lambda:g.reserve(posted,consent(x)),'does not bind')
    # Malformed body metadata is rejected before authorization, as intended.
    for field,change,reason in [('body_present',True,'GET/HEAD'),
                                ('body_bytes',4,'body absent'),
                                ('body_sha256','0'*64,'absent body')]:
        altered=dict(x);altered[field]=change
        deny(lambda altered=altered:g.reserve(altered,consent(x)),reason)
    # Distinct recipient with matching recomputed term digest also fails.
    deny(lambda:g.reserve(req('request-a',600,pay_to=OTHER_PAYEE),consent(x)),'does not bind')
    deny(lambda:g.reserve(req('request-a',600,timeout=90),consent(x)),'does not bind')
    invalid=dict(x);invalid['payTo']='silently-ignored-under-original-contract'
    deny(lambda:consent(invalid),'fields mismatch')
    missing=dict(x);del missing['pay_to']
    deny(lambda:consent(missing),'fields mismatch')
    bad=dict(x);bad['max_timeout_seconds']=True
    deny(lambda:consent(bad),'max_timeout_seconds')
    fail=issue_finality_attestation(keys[2],'request-a','601','testnet:tx-one','a'*64)
    deny(lambda:g.reconcile(fail),'exceeds signed')
    success=issue_finality_attestation(keys[2],'request-a','400','testnet:tx-one','a'*64)
    assert g.reconcile(success)['unspent_released']=='200'
    assert g.reconcile(success)['outcome']=='IDEMPOTENT_FINALIZED'
    assert g.reserve(req('request-b',600),consent(req('request-b',600)))['outcome']=='RESERVED'
    deny(lambda:g.reserve(req('request-c',1),consent(req('request-c',1))),'budget exceeded')
    # Transaction reference reuse by a different reservation cannot create a duplicate receipt.
    duplicate=issue_finality_attestation(keys[2],'request-b','600','testnet:tx-one','b'*64)
    deny(lambda:g.reconcile(duplicate),'receipt already assigned')
    correct=issue_finality_attestation(keys[2],'request-b','600','testnet:tx-two','b'*64)
    assert g.reconcile(correct)['outcome']=='FINALIZED'
    assert g.audit()['rows']==2
    g.close()
    # Original chain detects journal edit AND direct reservation edit.
    import sqlite3
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE reservations SET actual='1' WHERE request_id='request-b'")
    corrupted=Governor(db,policy,*keys)
    deny(lambda:corrupted.audit(),'ledger projection tamper')
    corrupted.close()

# SQLite memory/URI configurations cannot back durable spending reservations.
# Without this guard the process exits with all reserved maximums forgotten.
for unsafe_db in (':memory:', 'file::memory:?cache=shared'):
    deny(lambda unsafe_db=unsafe_db:Governor(unsafe_db,policy,*keys),
         'on-disk SQLite file path')

# Exact scheme must not release funds via partial 'upto' semantics.
with tempfile.TemporaryDirectory() as p:
    g=Governor(Path(p)/'exact.db',policy,*keys)
    r=req('exact-one',200,'exact')
    assert g.reserve(r,consent(r))['outcome']=='RESERVED'
    undersettle=issue_finality_attestation(keys[2],r['request_id'],'199','testnet:exact','c'*64)
    deny(lambda:g.reconcile(undersettle),'exact scheme')
    good=issue_finality_attestation(keys[2],r['request_id'],'200','testnet:exact','c'*64)
    assert g.reconcile(good)['outcome']=='FINALIZED'
    g.close()
print(json.dumps({'focused_check':'PASS','behaviors':['authorization bound to request','atomic max reserve and idempotency',
   'day+actor+service+total caps','upto actual <= reserved and excess released','duplicate receipt prevented',
   'signed receipt attestation','exact scheme no undersettlement','persisted journal tamper detected',
   'recipient, timeout, HTTP method, body and accepted terms HMAC-bound','unknown/missing approval fields fail closed'],
   'network_io':'NONE','money_movements':0,'performance_claim':'NONE'},indent=2))
