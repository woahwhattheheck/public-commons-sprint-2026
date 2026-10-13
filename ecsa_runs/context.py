"""Optional native-provider event hook; works without changing model signatures."""
from __future__ import annotations
from contextvars import ContextVar
from contextlib import contextmanager
import time
from .store import RunStore

_CURRENT = ContextVar('ecsa_native_execution', default=None)

@contextmanager
def native_context(store: RunStore, job: dict):
    token=_CURRENT.set((store,job))
    try: yield
    finally: _CURRENT.reset(token)

def current_execution():
    current=_CURRENT.get()
    if current is None: return None
    store,job=current
    return {'job_id':job['id'],'attempt':job['attempt'],'workspace':str(store.root)}

def emit_event(stage: str, details: dict | None = None):
    """Append a real model stage atomically only while this attempt owns its lease."""
    current=_CURRENT.get()
    if current is None: return False
    if not isinstance(stage,str) or not stage: raise ValueError('stage must be nonempty')
    store,job=current
    with store.transaction() as con:
        row=con.execute('SELECT state,lease_token,lease_until FROM jobs WHERE id=?',(job['id'],)).fetchone()
        if row['state']!='running' or row['lease_token']!=job['lease_token'] or row['lease_until']<time.time():
            return False
        store._event(con,job['id'],'native_stage',{'stage':stage,'attempt':job['attempt'],'details':details or {}})
    return True
