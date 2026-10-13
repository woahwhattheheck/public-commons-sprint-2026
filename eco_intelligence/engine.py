"""Typed evidence tools and retained guided actions over original Eco services."""
from __future__ import annotations
from datetime import datetime, timezone
from itertools import product
import json
import asyncio
import inspect as inspect_module
import httpx
from .common import IntelligenceError, digest, public_metadata, now
from .repository import Repository
from .store import Store
from .schemas import Inspect, Action
from .profiling import profile, compare_rasters, pair_tables

class Engine:
    def __init__(self, repository: Repository, store: Store, native_app=None, calibration=None, gateway=None):
        self.repo, self.store, self.native_app = repository, store, native_app
        self.calibration = calibration
        self.gateway = gateway

    def inspect(self, tenant: str, sid: str, request: Inspect) -> dict:
        op = request.operation
        sources = []
        if op == 'inventory':
            result = self.repo.inventory(tenant)
            sources = [{'registry':'inventory','sha256':digest(result)}]
        elif op == 'job':
            result = self.repo.artifacts(tenant, request.object_id or '')
            sources = [{'registry':'job','id':request.object_id,'sha256':result['record_sha256']}]
        elif op == 'ensemble':
            result = public_metadata(self.repo.row(tenant,'ensemble',request.object_id or ''))
            sources = [{'registry':'ensemble','id':request.object_id,'sha256':digest(result)}]
        else:
            if request.ref is None:
                raise IntelligenceError('Select a registered input.')
            path, source = self.repo.source(tenant,request.ref.model_dump(exclude_none=True))
            sources.append(source)
            if op == 'profile':
                result = public_metadata(profile(path))
            else:
                if request.other is None:
                    raise IntelligenceError('Select a second registered input.')
                other, source2 = self.repo.source(tenant,request.other.model_dump(exclude_none=True))
                sources.append(source2)
                if op == 'raster_compare':
                    result = compare_rasters(path,other,request.band)
                else:
                    result, _, _ = pair_tables(path,other,request.keys,request.observed_column,request.predicted_column)
                    result['unit_note'] = 'Values compared as stored; confirm identical units, period and spatial support before scientific interpretation.'
            for item in sources:
                self.repo.assert_unchanged(tenant,item)
        evidence = self.store.evidence(tenant,sid,{'operation':request.model_dump(exclude_none=True), 'sources':sources,'result':result})
        self.store.event(tenant,sid,'inspection',{'evidence_id':evidence['id'],'operation':op})
        return evidence

    def calibration_data(self, tenant: str, action: Action):
        if action.observed is None or action.predicted is None:
            raise IntelligenceError('Choose registered observations and predictions.')
        if not action.observed_unit or action.observed_unit != action.predicted_unit:
            raise IntelligenceError('Provide matching explicit units for observations and predictions. Convert data before calibration.')
        pa, sa = self.repo.source(tenant,action.observed.model_dump(exclude_none=True))
        pb, sb = self.repo.source(tenant,action.predicted.model_dump(exclude_none=True))
        summary, obs, pred = pair_tables(pa,pb,[action.time_column],action.observed_column,action.predicted_column,retain_points=True,canonical_time=True)
        # Original calibrator sorts string dates. Canonical UTC timestamps guarantee chronological holdout.
        seen = set()
        for o,p in zip(obs,pred):
            raw = json.loads(o['date'])[0]
            try:
                date = datetime.fromisoformat(raw.replace('Z','+00:00'))
                date = date.replace(tzinfo=timezone.utc) if date.tzinfo is None else date.astimezone(timezone.utc)
                canonical = date.isoformat()
            except ValueError as exc:
                raise IntelligenceError('Calibration time column must contain unambiguous ISO dates or timestamps.') from exc
            if canonical in seen:
                raise IntelligenceError('Multiple rows represent the same timestamp. Aggregate periods/sites explicitly before fitting.')
            seen.add(canonical)
            o['date'] = p['date'] = canonical
        if len(obs) < action.min_points:
            raise IntelligenceError(f'Need {action.min_points} finite paired periods; found {len(obs)}.')
        for source in (sa,sb):
            self.repo.assert_unchanged(tenant,source)
        payload = {'tenant_id':tenant,'observations':obs,'predictions':pred,'observed_key':'observed_sediment',
                   'predicted_key':'predicted_sediment','timestamp_key':'date','area_ha':action.area_ha,
                   'holdout_fraction':action.holdout_fraction,'min_points':action.min_points}
        return payload,[sa,sb],summary

    def prepare(self, tenant: str, sid: str, action: Action) -> dict:
        if action.native_experiment_id is not None:
            raise IntelligenceError('Select the installed original experiment host binding.',503)
        sources, context = [], {}
        if action.kind != 'analyze_collection' and self.gateway is not None:
            self.gateway.check(action.kind)
        if action.kind == 'analyze_collection':
            if not action.refs:
                raise IntelligenceError('Select the files to analyze.')
            sources = [self.repo.source(tenant,r.model_dump(exclude_none=True))[1] for r in action.refs]
            context = {'files':len(sources),'bytes':sum(s['bytes'] for s in sources)}
        elif action.kind == 'calibration':
            _,sources,context = self.calibration_data(tenant,action)
            context['method'] = self.gateway.method('calibration') if self.gateway is not None else 'Original Eco chronological-holdout nonnegative output-scaling calibrator; not a native SDR parameter fit.'
        else:
            job = self.repo.row(tenant,'job',action.job_id or '')
            sources = [{'registry':'job','id':job['id'],'sha256':digest(public_metadata(job))}]
            context = {'job':public_metadata(job)}
            if action.kind == 'run_job':
                if str(job.get('status','')).lower() in {'running','queued','complete','completed','succeeded','success'}:
                    raise IntelligenceError('This job already has an active or completed run. Open its outputs or create a new scenario in the original workbench.',409)
            else:
                keys = sorted(action.parameter_grid)
                if not keys or any(not action.parameter_grid[k] for k in keys):
                    raise IntelligenceError('Supply nonempty parameter value lists.')
                count = 1
                for k in keys: count *= len(action.parameter_grid[k])
                if count > action.max_members:
                    raise IntelligenceError(f'Grid contains {count} members, exceeding the requested max_members {action.max_members}.')
                context['members'] = count
                context['existing_ensembles'] = [e['id'] for e in self.repo.inventory(tenant)['ensembles'] if e.get('job_id')==job['id']]
        body = {'action':action.model_dump(exclude_none=True),'sources':sources,'context':context}
        result = self.store.put_plan(tenant,sid,body)
        self.store.event(tenant,sid,'plan_prepared',{'plan_id':result['id'],'kind':action.kind})
        return result

    def verify_sources(self, tenant: str, sources: list):
        for source in sources:
            if source.get('registry'):
                row = public_metadata(self.repo.row(tenant,source['registry'],source['id']))
                if digest(row) != source['sha256']:
                    raise IntelligenceError('The original job changed after this action was prepared. Refresh its plan.',409)
            else:
                self.repo.assert_unchanged(tenant,source)

    async def native_post(self, tenant: str, path: str, body: dict) -> dict:
        if self.native_app is None:
            raise IntelligenceError('Mount the extension in the original app to execute native jobs.',503)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.native_app),base_url='http://eco.internal',timeout=None) as client:
            response = await client.post(path,params={'tenant_id':tenant},json=body)
        if response.status_code >= 400:
            # Native errors may contain filesystem paths. Keep diagnostics on the original job page.
            raise IntelligenceError(f'Original Eco endpoint returned HTTP {response.status_code}. Its job diagnostics remain available.',response.status_code)
        return response.json()

    async def execute(self, tenant: str, pid: str) -> dict:
        plan = self.store.plan(tenant,pid)
        if plan['status'] == 'complete':
            return plan
        if plan['status'] != 'ready':
            return await self.reconcile(tenant,pid)
        await asyncio.to_thread(self.verify_sources,tenant,plan['body']['sources'])
        if not self.store.begin_plan(tenant,pid):
            return self.store.plan(tenant,pid)
        action = Action.model_validate(plan['body']['action'])
        sid = plan['session']
        try:
            if action.kind == 'analyze_collection':
                result = {'evidence':[], 'files':[]}
                for ref in action.refs:
                    try:
                        evidence=await asyncio.to_thread(self.inspect,tenant,sid,Inspect(operation='profile',ref=ref))
                        result['evidence'].append(evidence['id'])
                        result['files'].append({'ref':ref.model_dump(exclude_none=True),'status':'complete','evidence_id':evidence['id']})
                    except IntelligenceError as exc:
                        result['files'].append({'ref':ref.model_dump(exclude_none=True),'status':'error','error':str(exc)})
            elif action.kind == 'calibration':
                payload, sources, coverage = await asyncio.to_thread(self.calibration_data,tenant,action)
                if self.gateway is not None:
                    result = await self.gateway.submit(tenant,action,pid,payload,plan['body']['context'])
                elif self.calibration:
                    result = await asyncio.to_thread(self.calibration,payload)
                    if inspect_module.isawaitable(result): result = await result
                else:
                    result = await self.native_post(tenant,'/api/calibration/fit',payload)
                result = {'fit':result,'coverage':coverage,'units':action.observed_unit,'sources':sources}
                evidence = self.store.evidence(tenant,sid,{'operation':{'kind':'calibration'},'sources':sources,'result':result})
                result['evidence_id'] = evidence['id']
            elif action.kind == 'run_job':
                result = await self.gateway.submit(tenant,action,pid,None,plan['body']['context']) if self.gateway is not None else await self.native_post(tenant,f'/api/jobs/{action.job_id}/run',{'force':False})
            else:
                result = await self.gateway.submit(tenant,action,pid,None,plan['body']['context']) if self.gateway is not None else await self.native_post(tenant,f'/api/jobs/{action.job_id}/ensemble',
                    {'tenant_id':tenant,'parameter_grid':action.parameter_grid,'max_members':action.max_members,'retain_member_rasters':action.retain_member_rasters})
            self.store.finish_plan(tenant,pid,'complete',public_metadata(result))
            self.store.event(tenant,sid,'plan_executed',{'plan_id':pid,'kind':action.kind,'result':public_metadata(result)})
        except Exception as exc:
            # Retain uncertain submission for reconciliation, never replay an ensemble blindly.
            native = action.kind in {'run_job','ensemble'} or (action.kind == 'calibration' and self.gateway is not None)
            self.store.finish_plan(tenant,pid,'reconcile' if native else 'failed',
                {'error':str(exc) if isinstance(exc,IntelligenceError) else type(exc).__name__})
            raise
        return self.store.plan(tenant,pid)

    async def reconcile(self, tenant: str, pid: str) -> dict:
        plan = self.store.plan(tenant,pid)
        action = Action.model_validate(plan['body']['action'])
        if plan['status'] == 'complete': return plan
        result = None
        if self.gateway is not None and action.kind != 'analyze_collection':
            result = await self.gateway.reconcile(tenant,pid,action,plan)
            if result is not None:
                self.store.finish_plan(tenant,pid,'complete',public_metadata(result))
            return self.store.plan(tenant,pid)
        if action.kind == 'run_job':
            row = public_metadata(self.repo.row(tenant,'job',action.job_id or ''))
            if digest(row) != plan['body']['sources'][0]['sha256'] and str(row.get('status')).lower() not in {'new','draft','pending'}:
                result = {'job':row,'recovered_from_original_registry':True}
        elif action.kind == 'ensemble':
            keys = sorted(action.parameter_grid)
            expected = [dict(zip(keys,values)) for values in product(*(action.parameter_grid[k] for k in keys))]
            previous = set(plan['body']['context'].get('existing_ensembles',[]))
            candidates = [e for e in self.repo.inventory(tenant)['ensembles'] if e.get('job_id')==action.job_id
                          and e['id'] not in previous and e.get('plan')==expected and e.get('created_at','')>=plan['created']]
            if len(candidates)==1:
                result = {'ensemble':candidates[0],'recovered_from_original_registry':True}
        if result is not None:
            self.store.finish_plan(tenant,pid,'complete',result)
        return self.store.plan(tenant,pid)
