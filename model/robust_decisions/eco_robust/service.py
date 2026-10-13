"""Private local service; router can be mounted by the existing operator host."""
from __future__ import annotations
import json
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import Field, ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .schema import Strict, Study, Objective
from .store import Conflict
from .operations import DecisionWorkspace


class RevisionRequest(Strict):
    study: Study
    expected_revision: int = Field(ge=1)


class NativeRequest(Strict):
    summary: dict
    configuration: dict


class StoredSolve(Strict):
    revision: int = Field(ge=1)
    objective: Objective = "worst_case"
    time_limit: float = Field(default=30, gt=0, le=3600)
    mip_rel_gap: float = Field(default=0, ge=0, le=.1)


class StoredFrontier(Strict):
    revision: int = Field(ge=1)
    budgets: list[float] = Field(min_length=1)
    objective: Objective = "worst_case"
    time_limit: float = Field(default=60, gt=0, le=3600)


class DecisionRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def route(request):
            try:
                return await original(request)
            except Conflict as exc:
                return JSONResponse({"error": str(exc)}, status_code=409)
            except KeyError:
                return JSONResponse({"error": "Study or revision not found"}, status_code=404)
            except ValueError as exc:
                return JSONResponse({"error": str(exc)}, status_code=422)
        return route


def make_router(workspace) -> APIRouter:
    """Mount under /api/robust (default prefix); reuse original Workspace root."""
    engine = workspace if isinstance(workspace, DecisionWorkspace) else DecisionWorkspace(workspace)
    router = APIRouter(prefix="/api/robust", route_class=DecisionRoute)

    @router.get("/studies")
    def studies():
        engine.recover()
        return {"studies": engine.store.list()}

    @router.post("/studies", status_code=201)
    def create(study: Study):
        return engine.store.create(study)

    @router.post("/native", status_code=201)
    def native(request: NativeRequest):
        return engine.import_summary(request.summary, request.configuration)

    @router.post("/receive", status_code=201)
    def receive(bundle: dict):
        return engine.store.receive(bundle)

    @router.get("/studies/{sid}")
    def read(sid: str, revision: int | None = None):
        engine.recover(sid)
        return engine.store.read(sid, revision)

    @router.put("/studies/{sid}")
    def revise(sid: str, request: RevisionRequest):
        return engine.store.revise(sid, request.study, request.expected_revision)

    @router.post("/studies/{sid}/solve")
    def run(sid: str, request: StoredSolve):
        return engine.solve(sid, **request.model_dump())

    @router.post("/studies/{sid}/frontier")
    def budget_frontier(sid: str, request: StoredFrontier):
        return engine.frontier(sid, **request.model_dump())

    @router.get("/studies/{sid}/export")
    def export(sid: str):
        content = json.dumps(engine.store.export(sid), ensure_ascii=False, allow_nan=False)
        return Response(content, media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="decision-project.json"'})
    @router.get("/studies/{sid}/report")
    def report(sid: str, run_id: str, format: str = "html"):
        from .reports import html_report, csv_report
        run = engine.store.read_run(sid, run_id)
        if run["result"] is None:
            raise ValueError("This calculation has no retained result")
        study = engine.store.read(sid, run["revision"])["study"]
        if format == "html":
            content, media = html_report(study, run["result"]), "text/html"
        elif format == "csv":
            content, media = csv_report(study, run["result"]), "text/csv"
        else:
            raise ValueError("Choose html or csv")
        return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="decision-report.{format}"'})

    @router.get("/studies/{sid}/selection")
    def selection(sid: str, run_id: str):
        from .integration import selection_packet
        run = engine.store.read_run(sid, run_id)
        if run["result"] is None:
            raise ValueError("This calculation has no retained result")
        study = engine.store.read(sid, run["revision"])["study"]
        return selection_packet(study, run["result"])

    return router


def panel_html() -> str:
    return (Path(__file__).with_name("panel.html")).read_text(encoding="utf-8")


def create_app(workspace) -> FastAPI:
    app = FastAPI(title="Ecosystem decision studies", version="0.1.0")
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])

    @app.middleware("http")
    async def same_origin(request: Request, call_next):
        # Native clients may omit Origin. Browser writes must originate at this host.
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            foreign = origin is not None and urlsplit(origin).netloc != request.headers.get("host")
            if foreign or request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"error": "Use the local decision workspace to change this study"}, status_code=403)
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                return JSONResponse({"error": "Send application/json"}, status_code=415)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(Conflict)
    async def conflict(_request, exc):
        return JSONResponse({"error": str(exc)}, status_code=409)

    @app.exception_handler(KeyError)
    async def missing(_request, _exc):
        return JSONResponse({"error": "Study or revision not found"}, status_code=404)

    @app.exception_handler(ValueError)
    async def invalid(_request, exc):
        return JSONResponse({"error": str(exc)}, status_code=422)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, exc):
        errors = [{"path": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse({"error": "Check the supplied decision inputs", "details": errors}, status_code=422)

    @app.get("/", response_class=HTMLResponse)
    @app.get("/robust", response_class=HTMLResponse)
    def panel():
        return panel_html()

    app.include_router(make_router(workspace))
    return app
