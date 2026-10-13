"""Additive FastAPI integration. Existing maps, training, and model routes remain intact."""
from __future__ import annotations
import asyncio
import inspect
import html
from pathlib import Path
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from .common import IntelligenceError, VERSION, dumps, now
from .repository import Repository
from .store import Store
from .engine import Engine
from .provider import Assistant, ProviderConfig
from .schemas import SessionCreate, Ask, Inspect, Action


from .report import report

def install_intelligence(app, *, db_path=None, data_root=None, state_path=None, tenant_resolver=None,
                         provider=None, provider_transport=None, calibration=None, repository=None, gateway=None):
    """Mount once. tenant_resolver(request) may inherit existing authenticated tenant scope.

    Without a resolver this preserves the original app's tenant_id query convention;
    it is tenant partitioning, not an authentication system. Deploy behind the same
    access controls as the original workbench.
    """
    if getattr(app.state,'eco_intelligence',None):
        return app.state.eco_intelligence
    if repository is None and (db_path is None or data_root is None):
        import settings
        db_path=db_path or settings.DB_PATH
        data_root=data_root or settings.DATA_DIR
    if data_root is None and state_path is None:
        raise ValueError('Pass state_path or data_root for the investigation store.')
    root=Path(data_root) if data_root is not None else Path(state_path).parent
    store=Store(Path(state_path) if state_path else root/'intelligence.sqlite3')
    engine=Engine(repository or Repository(Path(db_path),root),store,native_app=app,calibration=calibration,gateway=gateway)
    assistant=Assistant(engine,provider or ProviderConfig.env(),provider_transport)
    static=Path(__file__).parent/'static'
    router=APIRouter(prefix='/api/intelligence',tags=['intelligence'])

    async def tenant(request):
        result=tenant_resolver(request) if tenant_resolver else request.query_params.get('tenant_id','demo')
        if inspect.isawaitable(result): result=await result
        if not isinstance(result,str) or not result or len(result)>256:
            raise HTTPException(400,'Valid tenant scope is required.')
        return result

    async def invoke(fn,*args):
        try:
            return await asyncio.to_thread(fn,*args)
        except IntelligenceError as exc:
            raise HTTPException(exc.status,str(exc)) from exc
        except (OSError,ValueError,KeyError) as exc:
            raise HTTPException(422,f'Analysis could not read the registered source ({type(exc).__name__}).') from exc

    @router.get('/status')
    async def status(request:Request):
        await tenant(request)
        return {'version':VERSION,'provider_configured':bool(assistant.config.base_url and assistant.config.model),
                'provider_model':assistant.config.model or None,'native_methods':gateway.methods if gateway is not None else {'calibration':'Chronological holdout output correction'},'tenant_mode':'resolver' if tenant_resolver else 'original_query_convention',
                'operations':['inventory','profile','job','ensemble','raster_compare','table_compare'],
                'actions':['analyze_collection',*(gateway.methods.keys() if gateway is not None else ['calibration','run_job','ensemble'])]}

    @router.get('/inventory')
    async def inventory(request:Request):
        return await invoke(engine.repo.inventory,await tenant(request))

    @router.get('/sessions')
    async def sessions(request:Request):
        return await invoke(store.sessions,await tenant(request))

    @router.post('/sessions',status_code=201)
    async def create(request:Request,payload:SessionCreate):
        return await invoke(store.create_session,await tenant(request),payload.title)

    @router.get('/sessions/{sid}')
    async def session(sid:str,request:Request):
        return await invoke(store.session,await tenant(request),sid)

    @router.post('/sessions/{sid}/inspect')
    async def examine(sid:str,request:Request,payload:Inspect):
        return await invoke(engine.inspect,await tenant(request),sid,payload)

    @router.post('/sessions/{sid}/plans',status_code=201)
    async def prepare(sid:str,request:Request,payload:Action):
        return await invoke(engine.prepare,await tenant(request),sid,payload)

    @router.get('/plans/{pid}')
    async def plan(pid:str,request:Request):
        return await invoke(store.plan,await tenant(request),pid)

    @router.post('/plans/{pid}/execute')
    async def execute(pid:str,request:Request):
        try:return await engine.execute(await tenant(request),pid)
        except IntelligenceError as exc:raise HTTPException(exc.status,str(exc)) from exc

    @router.post('/plans/{pid}/reconcile')
    async def reconcile(pid:str,request:Request):
        try:return await engine.reconcile(await tenant(request),pid)
        except IntelligenceError as exc:raise HTTPException(exc.status,str(exc)) from exc

    @router.post('/sessions/{sid}/ask')
    async def ask(sid:str,request:Request,payload:Ask):
        try:return await assistant.ask(await tenant(request),sid,payload.question,payload.request_id)
        except IntelligenceError as exc:raise HTTPException(exc.status,str(exc)) from exc
        except Exception as exc:raise HTTPException(502,'Provider request failed; retained analyses are available in the investigation.') from exc

    @router.get('/sessions/{sid}/export')
    async def export(sid:str,request:Request,format:str=Query(default='json',pattern='^(json|html)$')):
        s=await invoke(store.session,await tenant(request),sid)
        if format=='html':return HTMLResponse(report(s),headers={'Content-Disposition':f'attachment; filename="eco-investigation-{sid}.html"'})
        return JSONResponse({'format':'eco-intelligence-investigation-v1','exported_at':now(),'session':s},
                            headers={'Content-Disposition':f'attachment; filename="eco-investigation-{sid}.json"'})

    @app.get('/intelligence',include_in_schema=False)
    def page():return FileResponse(static/'index.html')

    app.include_router(router)
    app.mount('/intelligence-assets',StaticFiles(directory=static),name='intelligence-assets')
    app.state.eco_intelligence=engine
    return engine
