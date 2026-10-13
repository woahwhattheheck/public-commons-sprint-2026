"""Read-through adapters for the original store and current workspace job API.

Nothing in this module writes a second model/job registry. Native operation payloads
are built by the host's existing validated builders, not guessed by the assistant.
"""
from __future__ import annotations
import asyncio
import inspect
import json
from pathlib import Path, PurePosixPath
from typing import Callable, Any
from urllib.parse import quote
import httpx
from .common import IntelligenceError, public_metadata, digest, file_digest
from .repository import Repository, TABLES


class StoreBackedRepository(Repository):
    """Read current records/files through three original-store callables.

    records(tenant, kind): iterable of normalized records carrying id and tenant_id.
    artifacts(tenant, job_id): iterable of {member, path, metadata?, sha256?}.
    tenant_root(tenant): server-controlled filesystem root; not a browser argument.
    Dataset records require path. Job output files must be explicitly registered.
    Preserve the original full manifest under metadata, including model/evidence type.
    Callbacks are synchronous, executed on the application's analysis worker thread.
    """
    def __init__(self, records: Callable, artifacts: Callable, tenant_root: Callable):
        self.read_records, self.read_artifacts, self.tenant_root = records, artifacts, tenant_root

    def _records(self, tenant, kind):
        if kind not in TABLES:
            raise IntelligenceError('Unknown registered object kind.')
        seen=set(); result=[]
        for item in self.read_records(tenant,kind):
            row=dict(item)
            if row.get('tenant_id') != tenant or not isinstance(row.get('id'),str) or not row['id']:
                raise IntelligenceError('Original-store adapter returned an invalid tenant/ID binding.',409)
            if row['id'] in seen:
                raise IntelligenceError('Original-store adapter returned duplicate IDs.',409)
            seen.add(row['id']); result.append(row)
        return result

    def row(self, tenant, kind, object_id):
        for row in self._records(tenant,kind):
            if row['id'] == object_id: return row
        raise IntelligenceError('Registered object not found for tenant.',404)

    def inventory(self, tenant):
        result={'tenant_id':tenant,'counts':{}}
        for kind,table in TABLES.items():
            result[table]=[public_metadata(r) for r in self._records(tenant,kind)]
            result['counts'][table]=len(result[table])
        return result

    def _artifact_rows(self, tenant, job_id):
        self.row(tenant,'job',job_id)
        seen=set(); rows=[]
        for original in self.read_artifacts(tenant,job_id):
            item=dict(original); member=PurePosixPath(str(item.get('member','')))
            if member.is_absolute() or not member.parts or '..' in member.parts or '\\' in str(member):
                raise IntelligenceError('Original-store adapter returned an invalid artifact member.',409)
            if str(member) in seen:
                raise IntelligenceError('Original-store adapter returned duplicate artifact members.',409)
            seen.add(str(member)); item['member']=str(member); rows.append(item)
        return rows

    def path(self, tenant, ref):
        if ref.get('kind') == 'dataset':
            row=self.row(tenant,'dataset',str(ref.get('id','')))
        elif ref.get('kind') == 'artifact':
            row=next((r for r in self._artifact_rows(tenant,str(ref.get('id',''))) if r['member']==ref.get('member')),None)
            if row is None: raise IntelligenceError('Artifact is not registered in this job.',404)
        else:
            raise IntelligenceError('Select a registered dataset or artifact.')
        root=Path(self.tenant_root(tenant)).resolve()
        path=Path(row['path'])
        if not path.is_absolute(): path=root/path
        path=path.resolve()
        if not path.is_relative_to(root):
            raise IntelligenceError('Registered file leaves the original tenant storage root.',403)
        if not path.is_file(): raise IntelligenceError('Registered file is absent on this runtime.',404)
        if row.get('sha256') and file_digest(path) != row['sha256']:
            raise IntelligenceError('Registered file differs from its native content hash.',409)
        return path, public_metadata(row.get('metadata') or {})

    def artifacts(self, tenant, job_id):
        row=public_metadata(self.row(tenant,'job',job_id))
        files=[]
        for item in self._artifact_rows(tenant,job_id):
            ref={'kind':'artifact','id':job_id,'member':item['member']}
            path,_=self.path(tenant,ref)
            files.append(ref | {'bytes':path.stat().st_size,'metadata':public_metadata(item.get('metadata') or {})})
        return {'job':row,'files':files,'record_sha256':digest(row)}


class CatalogRepository(StoreBackedRepository):
    """Read a host-produced, replaceable manifest projection; no registration writes.

    Exact schema: {format:'eco-intelligence-catalog-v1', tenants:{TENANT:{
      root:PATH, datasets:[], jobs:[{id,tenant_id,artifacts:[]}], aois:[], ensembles:[]}}}
    Relative tenant roots resolve below the operator-supplied allowed_root. The
    catalog is supplied by the host, never uploaded or edited through the browser.
    """
    def __init__(self, catalog_path: Path, allowed_root: Path):
        self.catalog_path=Path(catalog_path).resolve()
        self.allowed_root=Path(allowed_root).resolve()
        super().__init__(self._read_records,self._read_artifacts,self._tenant_root)

    def _tenant(self, tenant):
        with self.catalog_path.open(encoding='utf-8') as f: data=json.load(f)
        if data.get('format') != 'eco-intelligence-catalog-v1':
            raise IntelligenceError('Unrecognized intelligence catalog format.',409)
        row=data.get('tenants',{}).get(tenant)
        if row is None: raise IntelligenceError('Tenant is not in this original-store catalog.',404)
        return row

    def _read_records(self, tenant, kind):
        return self._tenant(tenant).get(TABLES[kind],[])

    def _read_artifacts(self, tenant, job_id):
        return self.row(tenant,'job',job_id).get('artifacts',[])

    def _tenant_root(self, tenant):
        root=Path(self._tenant(tenant)['root'])
        if not root.is_absolute(): root=self.allowed_root/root
        root=root.resolve()
        if not root.is_relative_to(self.allowed_root):
            raise IntelligenceError('Catalog tenant root leaves the configured original storage.',403)
        return root


async def _call(callback, *args):
    if inspect.iscoroutinefunction(callback): return await callback(*args)
    value=await asyncio.to_thread(callback,*args)
    return await value if inspect.isawaitable(value) else value


class CallbackGateway:
    """Reuse native Python submit/recovery functions, with original tenant validation.

    submit(tenant, action, plan_id, paired_payload_or_none, context) -> native receipt.
    lookup(tenant, plan_id, action, plan) -> matching original receipt or None.
    A lookup must match the persisted plan ID, not just similar parameters/status.
    """
    def __init__(self, submit: Callable | None, lookup: Callable | None = None,
                 methods: dict[str,str] | None = None):
        self._submit,self._lookup=submit,lookup
        self.methods=methods or {}

    def check(self, kind):
        if self._submit is None or kind not in self.methods:
            raise IntelligenceError('This native operation is not connected by the host adapter.',503)

    def method(self, kind):
        self.check(kind); return self.methods[kind]

    async def submit(self, tenant, action, plan_id, payload, context):
        self.check(action.kind)
        value=await _call(self._submit,tenant,action,plan_id,payload,context)
        if not isinstance(value,dict):
            raise IntelligenceError('Native adapter must return a structured receipt.',502)
        return value

    async def reconcile(self, tenant, plan_id, action, plan):
        if self._lookup is None: return None
        value=await _call(self._lookup,tenant,plan_id,action,plan)
        if value is not None and not isinstance(value,dict):
            raise IntelligenceError('Native lookup returned an invalid receipt.',502)
        return value


class WorkspaceGateway(CallbackGateway):
    """Use the current /api/workspaces/{tenant}/jobs/launch route, without guessing bodies.

    build_request receives the same arguments as CallbackGateway.submit. It must use
    the original workspace's validated request model and persist plan_id in its
    supported correlation field. lookup reads that field in the original job store.
    auth_headers is optional and server-controlled; browser/provider values cannot
    select routes, credentials, or native payload builders.
    """
    def __init__(self, app, build_request: Callable, lookup: Callable | None,
                 methods: dict[str,str], auth_headers: Callable | None = None):
        self.app,self.build_request,self.auth_headers=app,build_request,auth_headers
        super().__init__(self._launch,lookup,methods)

    async def _launch(self, tenant, action, plan_id, payload, context):
        body=await _call(self.build_request,tenant,action,plan_id,payload,context)
        if not isinstance(body,dict):
            raise IntelligenceError('Native request builder must return its validated request body.',422)
        headers=await _call(self.auth_headers,tenant) if self.auth_headers else {}
        headers=dict(headers); headers['X-Eco-Intelligence-Plan-ID']=plan_id
        path='/api/workspaces/'+quote(tenant,safe='')+'/jobs/launch'
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='http://eco.internal',timeout=None) as client:
            response=await client.post(path,json=body,headers=headers)
        if response.status_code >= 400:
            raise IntelligenceError(f'Original workspace launch returned HTTP {response.status_code}; inspect its native job diagnostics.',response.status_code)
        result=response.json()
        if not isinstance(result,dict): raise IntelligenceError('Original workspace returned an invalid receipt.',502)
        return {'receipt_type':'native_job_submission','native':result,'plan_id':plan_id,
                'note':'Submission accepted; the native job status determines model completion.'}
