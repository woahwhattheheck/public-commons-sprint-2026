"""Non-custodial x402 buyer budget authorization and settlement receipt ledger.

Python 3.10+ standard library, SQLite WAL. No blockchain RPC, signer, wallet,
transaction, or money movement. Buyer-side offchain policy only; deploying agents
must not have keys able to issue consents or settlement attestations.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA="stellar-spend-governor/v1"
MAX_AMOUNT=2**63-1
ID_PATTERN=re.compile(r"^[A-Za-z0-9._:-]{1,160}$")
NETWORKS={"stellar:testnet", "stellar:pubnet"}
CURRENCY_FIELDS=("max_single", "max_total", "max_per_utc_day", "max_per_actor_utc_day", "max_per_service_utc_day")
# Consent must identify the same purchase the x402 signer is about to authorize.
# Reject unknown fields instead of silently dropping e.g. a caller-provided payTo.
REQUEST_FIELDS=("request_id", "actor", "service", "network", "asset", "scheme", "max_amount", "resource",
                "pay_to", "max_timeout_seconds", "method", "body_present", "body_bytes",
                "body_sha256", "accepted_terms_sha256")
HTTP_METHODS={"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}
EMPTY_BODY_SHA256=hashlib.sha256(b'').hexdigest()
CONSENT_KIND='owner-consent/complete-intent-v2'

class Denied(ValueError):
    """Decision is DENIED: safely do not create or submit a payment."""


def canonical(value: Any)->bytes:
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')


def parse_amount(value: Any, label="amount") -> int:
    # Force integer base-unit strings. JS floats / Python float / JSON numeric values are forbidden.
    if not isinstance(value,str) or not re.fullmatch(r"0|[1-9][0-9]*",value):
        raise Denied(f"{label} must be a canonical nonnegative integer BASE-UNIT STRING")
    if len(value)>19:raise Denied(f"{label} beyond supported signed 64-bit base unit ceiling")
    num=int(value)
    if num>MAX_AMOUNT:raise Denied(f"{label} beyond supported signed 64-bit base unit ceiling")
    return num


def as_time(s: str)->datetime:
    if not isinstance(s,str):raise Denied('timestamp is not a string')
    try:t=datetime.fromisoformat(s.replace('Z','+00:00'))
    except (ValueError,TypeError):raise Denied('timestamp must be ISO-8601 UTC')
    if t.tzinfo is None or t.utcoffset().total_seconds()!=0:raise Denied('timestamp must be explicitly UTC')
    return t


def now_utc()->datetime:return datetime.now(timezone.utc)


def validate_request(obj:dict[str,Any])->dict[str,Any]:
    if not isinstance(obj,dict) or set(obj)!=set(REQUEST_FIELDS):
        raise Denied('canonical buyer purchase intent fields mismatch')
    r={k:obj[k] for k in REQUEST_FIELDS}
    for k in ("request_id","actor","service"):
        if not isinstance(r[k],str) or not ID_PATTERN.fullmatch(r[k]):raise Denied(f'invalid {k}')
    if r['network'] not in NETWORKS:raise Denied('unsupported Stellar network')
    if not isinstance(r['asset'],str) or not re.fullmatch(r'[A-Z2-7]{56}',r['asset']):
        raise Denied('asset must be Soroban SEP-41 contract identifier, not classic asset alias')
    if r['scheme'] not in ('exact','upto'):raise Denied('unsupported payment scheme')
    if not isinstance(r['resource'],str) or not r['resource'].startswith('https://') or len(r['resource'])>2048:
        raise Denied('resource must be bounded HTTPS URL')
    if parse_amount(r['max_amount'],'max_amount')<1:raise Denied('max_amount must be positive')
    # A resource URL and amount alone do not identify a payment: recipient,
    # expiry, HTTP operation, body and accepted x402 requirement must bind too.
    payee=r['pay_to']
    if not isinstance(payee,str) or not (1<=len(payee)<=256) or payee!=payee.strip() or any(ord(c)<33 or ord(c)>126 for c in payee):
        raise Denied('pay_to must be a bounded nonempty printable payment recipient')
    timeout=r['max_timeout_seconds']
    if type(timeout) is not int or not (1<=timeout<=86400):
        raise Denied('max_timeout_seconds must be an integer in 1..86400')
    if not isinstance(r['method'],str) or r['method'] not in HTTP_METHODS:
        raise Denied('method must be an uppercase supported HTTP verb')
    present=r['body_present'];size=r['body_bytes']
    if type(present) is not bool or type(size) is not int or not (0<=size<=1_048_576):
        raise Denied('body presence/byte length invalid')
    if (not present) and size!=0:
        raise Denied('body absent but byte length is nonzero')
    for field in ('body_sha256','accepted_terms_sha256'):
        if not isinstance(r[field],str) or not re.fullmatch(r'[0-9a-f]{64}',r[field]):
            raise Denied(field+' must be lowercase SHA-256 hex')
    if not present and r['body_sha256']!=EMPTY_BODY_SHA256:
        raise Denied('absent body must have the SHA-256 of empty bytes')
    if r['method'] in ('GET','HEAD') and present:
        raise Denied('GET/HEAD cannot carry a request body')
    return r


def validate_policy(policy:dict[str,Any])->dict[tuple[str,str],dict[str,int]]:
    if not isinstance(policy,dict) or policy.get('schema')!=SCHEMA or not isinstance(policy.get('assets'),list):
        raise Denied('incorrect policy schema/assets')
    result={}
    for item in policy['assets']:
        pair=(item.get('network'),item.get('asset'))
        if pair[0] not in NETWORKS or not isinstance(pair[1],str) or not re.fullmatch(r'[A-Z2-7]{56}',pair[1]):
            raise Denied('invalid network/asset in policy')
        if pair in result:raise Denied('duplicate asset policy')
        limits={key:parse_amount(item.get(key),key) for key in CURRENCY_FIELDS}
        if any(v==0 for v in limits.values()):raise Denied('limits must be positive')
        result[pair]=limits
    if not result:raise Denied('empty asset allowlist')
    return result


def secret(key:bytes,name:str)->bytes:
    if not isinstance(key,bytes) or len(key)<32:raise Denied(f'{name} must be at least 32 random bytes, kept outside caller/DB')
    return key


def token_for(key:bytes,claims:dict[str,Any])->str:
    payload=base64.urlsafe_b64encode(canonical(claims)).rstrip(b'=')
    sig=hmac.new(key,payload,hashlib.sha256).digest()
    return payload.decode('ascii')+'.'+base64.urlsafe_b64encode(sig).rstrip(b'=').decode('ascii')


def token_claims(key:bytes,value:str)->dict[str,Any]:
    if not isinstance(value,str) or len(value)>8192:raise Denied("authorization token invalid or oversize")
    try:
        a,b=value.split('.')
        data=a.encode('ascii')
        candidate=base64.urlsafe_b64decode(b+'='*(-len(b)%4))
        expected=hmac.new(key,data,hashlib.sha256).digest()
        if not hmac.compare_digest(expected,candidate):raise ValueError('bad mac')
        raw=base64.urlsafe_b64decode(a+'='*(-len(a)%4))
        claims=json.loads(raw)
        if canonical(claims)!=raw:raise ValueError('noncanonical claims')
        if not isinstance(claims,dict):raise ValueError('object required')
        return claims
    except (AttributeError,TypeError,UnicodeError,ValueError,json.JSONDecodeError) as e:
        raise Denied('authorization signature or encoding invalid') from e


def issue_consent(consent_key:bytes,request:dict,expiry_utc:str)->str:
    """OPERATORS ONLY. One specific request, max amount, resource and short expiry."""
    r=validate_request(request)
    expiry=as_time(expiry_utc)
    if expiry<=now_utc():raise Denied('consent expiry must be in the future')
    if (expiry-now_utc()).total_seconds()>900:raise Denied('consent expires later than 15 minute safety window')
    return token_for(secret(consent_key,'consent key'),{'kind':CONSENT_KIND,'request':r,'expires_at':expiry_utc})


def issue_finality_attestation(operator_key:bytes,reservation_id:str,actual_amount:str,receipt_ref:str,proof_sha256:str)->str:
    """PRIVILEGED RECEIPT WATCHER ONLY: signs its actual finalized network receipt."""
    if not isinstance(reservation_id,str) or not ID_PATTERN.fullmatch(reservation_id):raise Denied('invalid reservation id')
    parse_amount(actual_amount)
    if not isinstance(receipt_ref,str) or not receipt_ref.strip() or len(receipt_ref)>512:raise Denied('empty/oversize receipt ref')
    if not isinstance(proof_sha256,str) or not re.fullmatch('[0-9a-f]{64}',proof_sha256):raise Denied('invalid original provider receipt sha256')
    return token_for(secret(operator_key,'operator key'),{'kind':'finality-attestation','request_id':reservation_id,'actual_amount':actual_amount,'receipt_ref':receipt_ref,'proof_sha256':proof_sha256})


class Governor:
    def __init__(self,db: str|Path,policy:dict,consent_key:bytes,audit_key:bytes,operator_key:bytes):
        self.limits=validate_policy(policy)
        self.ck=secret(consent_key,'consent key');self.ak=secret(audit_key,'audit key');self.ok=secret(operator_key,'operator key')
        self.db=sqlite3.connect(str(db),isolation_level=None,timeout=30)
        self.db.execute('PRAGMA busy_timeout=30000')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('''CREATE TABLE IF NOT EXISTS reservations (
            request_id TEXT PRIMARY KEY, request_digest TEXT NOT NULL,
            actor TEXT NOT NULL, service TEXT NOT NULL, network TEXT NOT NULL,
            asset TEXT NOT NULL, scheme TEXT NOT NULL, amount TEXT NOT NULL,
            day TEXT NOT NULL, state TEXT NOT NULL, actual TEXT NOT NULL,
            receipt_ref TEXT NOT NULL, proof_sha256 TEXT NOT NULL
        )''')
        self.db.execute('''CREATE TABLE IF NOT EXISTS journal (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL,
            prior_mac TEXT NOT NULL, mac TEXT NOT NULL
        )''')

    def close(self)->None:self.db.close()

    def _append(self,evt:dict)->None:
        prior=self.db.execute('SELECT mac FROM journal ORDER BY sequence DESC LIMIT 1').fetchone()
        prior_mac=prior[0] if prior else '0'*64
        serialized=canonical(evt).decode('ascii')
        mac=hmac.new(self.ak,(prior_mac+'\n'+serialized).encode('ascii'),hashlib.sha256).hexdigest()
        self.db.execute('INSERT INTO journal(event,prior_mac,mac) VALUES(?,?,?)',(serialized,prior_mac,mac))

    def _audit(self)->dict[str,dict]:
        """Verify HMAC chain AND persisted reservation projection before each mutation."""
        prior='0'*64; ledger={}; seq_expect=1
        for seq,serialized,parent,mac in self.db.execute('SELECT sequence,event,prior_mac,mac FROM journal ORDER BY sequence'):
            if seq!=seq_expect or parent!=prior:raise Denied('journal sequence/parent integrity failure')
            calc=hmac.new(self.ak,(parent+'\n'+serialized).encode('ascii'),hashlib.sha256).hexdigest()
            if not hmac.compare_digest(calc,mac):raise Denied('journal HMAC integrity failure')
            evt=json.loads(serialized)
            if canonical(evt).decode('ascii')!=serialized:raise Denied('journal canonical mismatch')
            if evt['type']=='reserve':
                rr=evt['reservation'];rid=rr['request_id']
                if rid in ledger:raise Denied('duplicate reservation event')
                ledger[rid]=rr.copy()
            elif evt['type']=='finalize':
                rid=evt['request_id'];rr=ledger.get(rid)
                if rr is None or rr['state']!='reserved':raise Denied('invalid finalize transition')
                if parse_amount(evt['actual'])>parse_amount(rr['amount']):raise Denied('settled more than authorized')
                rr.update(state='settled',actual=evt['actual'],receipt_ref=evt['receipt_ref'],proof_sha256=evt['proof_sha256'])
            else:raise Denied('unknown journal event')
            prior=mac;seq_expect+=1
        cols=['request_id','request_digest','actor','service','network','asset','scheme','amount','day','state','actual','receipt_ref','proof_sha256']
        on_disk={tuple(row)[0]:dict(zip(cols,row)) for row in self.db.execute('SELECT '+','.join(cols)+' FROM reservations')}
        if ledger!=on_disk:raise Denied('ledger projection tamper/rollback mismatch')
        return ledger

    def audit(self)->dict:
        ledger=self._audit()
        return {'outcome':'JOURNAL_CONSISTENT','rows':len(ledger),'events':self.db.execute('SELECT COUNT(*) FROM journal').fetchone()[0],
                'warning':'HMAC source keys are external; whole-database rollback requires independent checkpoint/witness detection'}

    def _budget(self,r:dict,day:str,ledger:dict)->dict:
        limits=self.limits.get((r['network'],r['asset']))
        if limits is None:raise Denied('asset/network not allowlisted by operator')
        other=[v for v in ledger.values() if v['network']==r['network'] and v['asset']==r['asset']]
        def amt(v):return parse_amount(v['amount']) if v['state']=='reserved' else parse_amount(v['actual'])
        spend={
         'max_single':0,
         'max_total':sum(map(amt,other)),
         'max_per_utc_day':sum(amt(x) for x in other if x['day']==day),
         'max_per_actor_utc_day':sum(amt(x) for x in other if x['day']==day and x['actor']==r['actor']),
         'max_per_service_utc_day':sum(amt(x) for x in other if x['day']==day and x['service']==r['service'])}
        amount=parse_amount(r['max_amount'])
        offenders=[k for k,prior in spend.items() if amount+prior>limits[k]]
        return {'approved':not offenders,'denied_by':offenders,'reserved_max_base_units':str(amount),'limit_remaining':{k:str(max(0,limits[k]-prior)) for k,prior in spend.items()}}

    def estimate(self,request:dict)->dict:
        r=validate_request(request)
        ledger=self._audit()
        return {**self._budget(r,now_utc().date().isoformat(),ledger),'note':'Read-only estimate is not a reservation; race requires atomic reserve.'}

    def reserve(self,request:dict,consent_token:str)->dict:
        r=validate_request(request);day=now_utc().date().isoformat()
        claims=token_claims(self.ck,consent_token)
        if claims.get('kind')!=CONSENT_KIND or claims.get('request')!=r:
            raise Denied('explicit owner consent does not bind exactly to this payment request')
        if as_time(claims.get('expires_at'))<=now_utc():raise Denied('explicit owner consent expired')
        digest=hashlib.sha256(canonical(r)).hexdigest()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            ledger=self._audit()
            prior=ledger.get(r['request_id'])
            if prior is not None:
                if prior['request_digest']!=digest:raise Denied('request_id reused with different terms')
                self.db.execute('COMMIT')
                return {'outcome':'IDEMPOTENT_EXISTING','state':prior['state'],'request_id':r['request_id'],
                        'max_amount':prior['amount'],'actual':prior['actual'],'receipt_ref':prior['receipt_ref']}
            budget=self._budget(r,day,ledger)
            if not budget['approved']:raise Denied('budget exceeded: '+','.join(budget['denied_by']))
            row={'request_id':r['request_id'],'request_digest':digest,'actor':r['actor'],'service':r['service'],
                 'network':r['network'],'asset':r['asset'],'scheme':r['scheme'],'amount':r['max_amount'],
                 'day':day,'state':'reserved','actual':'0','receipt_ref':'','proof_sha256':''}
            cols=list(row)
            self.db.execute(f"INSERT INTO reservations({','.join(cols)}) VALUES({','.join('?' for _ in cols)})",tuple(row.values()))
            self._append({'type':'reserve','reservation':row})
            self.db.execute('COMMIT')
            return {'outcome':'RESERVED','request_id':r['request_id'], 'max_amount':r['max_amount'], 'scheme':r['scheme'],
                    'network':r['network'],'asset':r['asset'], 'audit_required':'RECONCILE_FINALITY'}
        except BaseException:
            self.db.execute('ROLLBACK');raise

    def reconcile(self,attestation_token:str)->dict:
        """Call from trusted operator *after independently verifying actual chain finality*.
        Unused reservation capacity is released; a pending payment is NEVER auto-refunded.
        """
        claim=token_claims(self.ok,attestation_token)
        if claim.get('kind')!='finality-attestation':raise Denied('wrong attestation kind')
        rid=claim.get('request_id');actual=claim.get('actual_amount')
        if not isinstance(rid,str) or not ID_PATTERN.fullmatch(rid):raise Denied('invalid receipt reservation id')
        amount=parse_amount(actual);receipt=claim.get('receipt_ref');proof=claim.get('proof_sha256')
        if not isinstance(receipt,str) or not receipt or not isinstance(proof,str) or not re.fullmatch('[0-9a-f]{64}',proof):
            raise Denied('invalid receipt details')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            ledger=self._audit();row=ledger.get(rid)
            if row is None:raise Denied('unknown reserved payment')
            if row['state']=='settled':
                if row['actual']==actual and row['receipt_ref']==receipt and row['proof_sha256']==proof:
                    self.db.execute('COMMIT');return {'outcome':'IDEMPOTENT_FINALIZED','request_id':rid,'actual':actual}
                raise Denied('finality conflict for already finalized reservation')
            if amount>parse_amount(row['amount']):raise Denied('actual settlement exceeds signed/reserved maximum')
            if row['scheme']=='exact' and amount!=parse_amount(row['amount']):raise Denied('exact scheme must settle the exact reserved amount')
            if any(x['state']=='settled' and x['network']==row['network'] and x['receipt_ref']==receipt and x['request_id']!=rid for x in ledger.values()):
                raise Denied('finalized network receipt already assigned to another request')
            self.db.execute("UPDATE reservations SET state='settled',actual=?,receipt_ref=?,proof_sha256=? WHERE request_id=?",
                            (actual,receipt,proof,rid))
            self._append({'type':'finalize','request_id':rid,'actual':actual,'receipt_ref':receipt,'proof_sha256':proof})
            self.db.execute('COMMIT')
            return {'outcome':'FINALIZED','request_id':rid,'actual':actual,'unspent_released':str(parse_amount(row['amount'])-amount),
                    'note':'Operator-attested result; ledger itself does not fetch or independently validate Stellar RPC.'}
        except BaseException:
            self.db.execute('ROLLBACK');raise
