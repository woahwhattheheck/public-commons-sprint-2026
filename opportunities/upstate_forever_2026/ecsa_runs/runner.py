"""Finite foreground supervisor; warm processes per exact provider edition.

The supervisor owns durable leases and stays responsive when native C is busy.
It executes only the queue present at invocation unless drain_new=True is explicit.
"""
from __future__ import annotations
import contextlib
import multiprocessing as mp
import os
from pathlib import Path
import signal
import time
import traceback
import uuid
from typing import Callable
from .store import RunStore
from .provider import ProviderSession


def _worker(root: str, pipe, snapshot_sha: str):
    # A process group lets cancellation stop native compiler/solver descendants too.
    if os.name == 'posix': os.setsid()
    store = RunStore(root)
    session = None
    try:
        while True:
            message = pipe.recv()
            if message is None: break
            job, spec = message
            started = time.monotonic()
            log = store.root / 'logs' / f"{job['id']}-attempt-{job['attempt']}.log"
            with log.open('a', buffering=1) as stream, contextlib.redirect_stdout(stream), contextlib.redirect_stderr(stream):
                try:
                    if session is None: session = ProviderSession(store, snapshot_sha)
                    from .context import native_context
                    with native_context(store, job):
                        result = session.execute(spec, job)
                    sha = store.put(result)
                    import resource
                    metrics = {'wall_seconds': time.monotonic() - started, 'pid': os.getpid(),
                               'max_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                               'worker_run_number': session.count, 'log': log.relative_to(store.root).as_posix()}
                    pipe.send({'result_sha': sha, 'metrics': metrics})
                except BaseException as exc:
                    detail = ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__))
                    print(detail, flush=True)
                    pipe.send({'error': f'{type(exc).__name__}: {exc}',
                               'metrics': {'wall_seconds': time.monotonic() - started,
                                           'log': log.relative_to(store.root).as_posix()}})
                    # A partially failed native engine is not reused for subsequent runs.
                    return
    except (EOFError, BrokenPipeError):
        pass
    finally:
        if session is not None: session.close()
        pipe.close()


def _stop(slot):
    process = slot['process']
    if process.is_alive():
        # If child has not reached setsid, kill only the process, not our own group.
        try:
            if os.name == 'posix' and os.getpgid(process.pid) == process.pid:
                os.killpg(process.pid, signal.SIGTERM)
            else: process.terminate()
        except ProcessLookupError: pass
        process.join(1)
        if process.is_alive():
            try:
                if os.name == 'posix' and os.getpgid(process.pid) == process.pid:
                    os.killpg(process.pid, signal.SIGKILL)
                else: process.kill()
            except ProcessLookupError: pass
            process.join(1)
    else: process.join()
    slot['pipe'].close()


def _spawn(ctx, store, snapshot):
    parent, child = ctx.Pipe()
    process = ctx.Process(target=_worker, args=(str(store.root), child, snapshot))
    process.start(); child.close()
    return {'process': process, 'pipe': parent, 'snapshot': snapshot, 'job': None}


def run_pending(store: RunStore, workers: int = 2, job_ids: list[str] | None = None,
                lease_seconds: float = 30, poll_seconds: float = .1,
                progress: Callable[[dict], None] | None = None,
                drain_new: bool = False) -> dict:
    """Run queued jobs to completion; returns counts for the selected queue.

    Multiple supervisors can safely share a workspace. A supervisor crash leaves
    an expiring lease, not a permanently occupied queue. A cancelled worker is
    terminated; a stale worker never acquires the right to overwrite a new result.
    """
    if workers < 1 or workers > (os.cpu_count() or 1): raise ValueError('workers exceeds available CPUs or is less than one')
    if lease_seconds < .3 or poll_seconds <= 0 or poll_seconds >= lease_seconds / 2:
        raise ValueError('Use lease_seconds>=.3 and poll_seconds<lease_seconds/2')
    if job_ids is None and not drain_new:
        with store.connection() as con:
            job_ids = [r[0] for r in con.execute("SELECT id FROM jobs WHERE state IN ('queued','running','cancelling')")]
    selected = set(job_ids) if job_ids is not None else None
    owner = f'{os.getpid()}-{uuid.uuid4().hex[:12]}'
    ctx = mp.get_context('spawn')
    slots, completed = [], {}
    next_heartbeat = 0.0
    def emit(job_id):
        row = store.get(job_id)
        completed[job_id] = row['state']
        if progress: progress(row)
    try:
        while True:
            now = time.monotonic()
            for slot in list(slots):
                job = slot['job']
                if job is None:
                    if not slot['process'].is_alive(): _stop(slot); slots.remove(slot)
                    continue
                row = store.get(job['id'])
                timeout = slot['spec'].get('timeout_seconds')
                if row['lease_token'] != job['lease_token']:
                    _stop(slot); slots.remove(slot); emit(job['id']); continue
                if row['state'] == 'cancelling' or (timeout is not None and now-slot['started'] >= timeout):
                    _stop(slot); slots.remove(slot)
                    store.finish(job['id'], job['lease_token'], error='Cancelled' if row['state']=='cancelling' else 'Execution deadline exceeded')
                    emit(job['id']); continue
                if slot['pipe'].poll():
                    try: outcome = slot['pipe'].recv()
                    except EOFError: outcome = {'error': f"Worker exited with code {slot['process'].exitcode}", 'retry': True}
                    store.finish(job['id'], job['lease_token'], **outcome)
                    emit(job['id']); slot['job'] = None
                    if outcome.get('error'):
                        _stop(slot); slots.remove(slot)
                elif not slot['process'].is_alive():
                    store.finish(job['id'], job['lease_token'], error=f"Worker exited with code {slot['process'].exitcode}", retry=True)
                    emit(job['id']); _stop(slot); slots.remove(slot)
            if now >= next_heartbeat:
                for slot in list(slots):
                    if slot['job'] and not store.heartbeat(slot['job']['id'], slot['job']['lease_token'], lease_seconds):
                        _stop(slot); slots.remove(slot)
                next_heartbeat = now + lease_seconds / 3
            # Claim only capacity we can execute. Reuse the matching exact edition.
            while sum(s['job'] is not None for s in slots) < workers:
                job = store.claim(owner, lease_seconds, job_ids)
                if job is None: break
                spec = store.read(job['spec_sha'])
                idle = next((s for s in slots if s['job'] is None and s['snapshot'] == spec['snapshot_sha']), None)
                if idle is None:
                    if len(slots) >= workers:
                        victim = next(s for s in slots if s['job'] is None)
                        _stop(victim); slots.remove(victim)
                    idle = _spawn(ctx, store, spec['snapshot_sha']); slots.append(idle)
                idle.update(job=job, spec=spec, started=time.monotonic())
                idle['pipe'].send((job, spec))
                if progress: progress(store.get(job['id']))
            if not any(s['job'] for s in slots):
                with store.connection() as con:
                    rows = con.execute("SELECT id,state FROM jobs WHERE state IN ('queued','running','cancelling')").fetchall()
                outstanding = [r for r in rows if selected is None or r['id'] in selected]
                if not outstanding: break
                # Other supervisors own these jobs or their leases need to expire.
                store.recover()
            time.sleep(poll_seconds)
    except BaseException:
        for slot in slots:
            job = slot['job']
            _stop(slot)
            if job: store.finish(job['id'], job['lease_token'], error='Supervisor interrupted', retry=True)
        slots.clear()
        raise
    finally:
        for slot in slots:
            try:
                slot['pipe'].send(None)
                slot['process'].join(1)
            except (BrokenPipeError, EOFError, OSError): pass
            _stop(slot)
    with store.connection() as con:
        rows = con.execute('SELECT id,state FROM jobs').fetchall()
    counts = {}
    for row in rows:
        if selected is None or row['id'] in selected: counts[row['state']] = counts.get(row['state'], 0)+1
    return counts
