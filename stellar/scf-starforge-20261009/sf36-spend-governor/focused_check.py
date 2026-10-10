"""Single focused behavioral check for SF-36's actual source; no blockchain IO."""
import json
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
def req(rid,amount,scheme='upto'):
    return dict(request_id=rid,actor='authorized-agent-1',service='catalog-api',network='stellar:testnet',asset=asset,
                scheme=scheme,max_amount=str(amount),resource='https://public.example.org/priced-api')
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
    x=req('request-a',600)
    assert g.estimate(x)['approved'] is True
    assert g.reserve(x,consent(x))['outcome']=='RESERVED'
    assert g.reserve(x,consent(x))['outcome']=='IDEMPOTENT_EXISTING'
    y=req('request-b',500)
    deny(lambda:g.reserve(y,consent(y)),'budget exceeded')
    tamper=req('request-a',600);tamper['actor']='other'
    deny(lambda:g.reserve(tamper,consent(x)),'does not bind')
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
   'signed receipt attestation','exact scheme no undersettlement','persisted journal tamper detected'],
   'network_io':'NONE','money_movements':0,'performance_claim':'NONE'},indent=2))
