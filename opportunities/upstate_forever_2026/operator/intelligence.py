
"""Science Investigations transport for the original Upper Savannah Operator.

A66A owns this registry feature and browser. The integration object is E258's
original Workspace repository/native gateway and ES26's diagnostic source join.
The original Operator supplies authentication, workspace resolution, task
admission/execution/recovery and verified file tickets.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import asyncio
import json
from pathlib import Path
import re

from pydantic import ValidationError
from model.common import (
    atomic_bytes, atomic_json, canonical, describe_file, digest, identifier,
    read_json, verify_file, _native_fs_path,
)
from eco_intelligence.common import IntelligenceError, dumps, loads, now, digest as ask_digest
from eco_intelligence.schemas import Action, Inspect, SessionCreate
from eco_intelligence.report import report as investigation_html
from intelligence_collections import CollectionExports
from intelligence_lineage import InvestigationLineage, OPERATIONS as LINEAGE_READS

ACTIONS = frozenset({
    "intelligence.session.create", "intelligence.diagnostic.open",
    "intelligence.inspect", "intelligence.prepare",
    "intelligence.execute", "intelligence.continue", "intelligence.ask", "intelligence.export",
    "intelligence.collection.export",
})
ASK_CHECKPOINT = "eco-intelligence-ask-checkpoint/v1"

READS = frozenset({"catalog", "session", "evidence", "plan", "export",
                   "native-task", "diagnostic", "experiment",
                   "collection_sources", "collection", *LINEAGE_READS})
SESSION_ID = re.compile(r"^(?:[0-9a-f]{32}|[0-9a-f]{64})$")
EVIDENCE_ID = re.compile(r"^E[0-9a-f]{24}$")
RECEIPT_SCHEMA = "upstate.intelligence-operator-receipt/v1"


def _session_id(value):
    if not isinstance(value, str) or not SESSION_ID.fullmatch(value):
        raise IntelligenceError("Choose an existing retained investigation.", 422)
    return value


class OperationStore:
    """Preserve deterministic session/plan creation in the original INTEL13 Store.

    The original serial task is the request identity. Other Store operations are
    delegated unchanged. A resumed original task finds the same session or plan,
    including a plan created just before an interrupted queue-result write.
    """
    def __init__(self, original, task):
        self.original, self.task = original, task
        self._captured_events = ContextVar('eco_intelligence_operation_events', default=None)

    def __getattr__(self, name):
        return getattr(self.original, name)

    def create_session(self, tenant, title):
        key = digest({"kind": "intelligence-session", "task_id": self.task["id"]})
        value = {"id": key, "tenant": tenant, "title": title,
                 "created": self.task["created_at"]}
        # Use the maintained Store's tenant normalization when supplied by the
        # original Workspace adapter. The default INTEL13 Store uses tenant as-is.
        normalize = getattr(self.original, "storage_tenant", None)
        stored_tenant = normalize(tenant) if callable(normalize) else tenant
        with self.original.db() as db:
            row = db.execute("SELECT * FROM sessions WHERE id=?", (key,)).fetchone()
            if row is not None:
                if row["tenant"] != stored_tenant or row["title"] != title:
                    raise IntelligenceError("The retained creation belongs to another selection.", 409)
            else:
                db.execute("INSERT INTO sessions(id,tenant,title,created) VALUES (?,?,?,?)",
                           (key, stored_tenant, title, value["created"]))
        self.original.authorize(tenant, key)
        # The original adapter supplies the public scope in its session read.
        session = self.original.session(tenant, key)
        return {name: session[name] for name in ("id", "tenant", "title", "created")}

    def direct_plan_id(self, sid):
        return digest({"kind": "intelligence-direct-plan", "task_id": self.task["id"],
                       "session_id": sid})

    def preparation_request(self):
        # Preserve the submitted selection before the native engine enriches it
        # with the complete saved programme, original baseline and case counts.
        return {"schema": "upstate.intelligence-preparation-request/v1",
                "task_id": self.task["id"], "action": self.task["payload"]["action"]}

    def prepared_plan(self, tenant, sid, action):
        """Reopen this direct operation before reading mutable native context."""
        key = self.direct_plan_id(sid)
        try:
            plan = self.original.plan(tenant, key)
        except IntelligenceError as error:
            if error.status == 404:
                return None
            raise
        body = plan["body"]
        request = body.get("operator_request")
        if request is not None:
            # Retain the current host's exact original task/request identity.
            same_action = request == self.preparation_request()
        else:
            requested = action.model_dump(exclude_none=True)
            retained = body.get("request_action")
            if retained is not None:
                same_action = Action.model_validate(retained).model_dump(exclude_none=True) == requested
            else:
                # ECD1: preceding plans retained the execution action expanded
                # from their frozen saved experiment. Reopen without reprepare.
                expected = dict(requested)
                same_action = True
                if action.native_experiment_id is not None:
                    context = body.get("context", {}).get("native_experiment")
                    if not isinstance(context, dict) or context.get("id") != action.native_experiment_id:
                        same_action = False
                    else:
                        native = context["plan"]
                        baseline = native["baseline"]["run_id"]
                        grid = {axis["path"]: axis["values"] for axis in native["selection"]["axes"]}
                        count = native["counts"]["cases"]
                        same_action = (
                            action.job_id in (None, baseline)
                            and (not action.parameter_grid or action.parameter_grid == grid)
                            and action.retain_member_rasters
                        )
                        expected.update(job_id=baseline, parameter_grid=grid,
                                        max_members=count, retain_member_rasters=True)
                same_action = same_action and (
                    Action.model_validate(body["action"]).model_dump(exclude_none=True) == expected
                )
        if plan["session"] != sid or not same_action:
            raise IntelligenceError("The original prepared action has a different selection.", 409)
        return plan

    def put_plan(self, tenant, sid, body):
        self.original.authorize(tenant, sid)
        if self.task["action"] == "intelligence.prepare":
            requested = Action.model_validate(self.task["payload"].get("action"))
            body = {**body, "operator_request": self.preparation_request(),
                    "request_action": requested.model_dump(exclude_none=True)}
        # A direct queued prepare has exactly one selected action. The assistant
        # may legitimately prepare several distinct actions in its single task.
        captured = self.ask_tool_identity(tenant, sid)
        if captured is not None and captured["request_id"] != self.task["operation_id"]:
            raise IntelligenceError("The prepared action belongs to another original request.", 409)
        if captured is not None:
            action = self._captured_events.get().get("action")
            if action is None:
                raise IntelligenceError("The original Assistant tool selection is missing.", 409)
            body = {**body, "assistant_request": {**captured, "task_id": self.task["id"], "action": action}}
        key = (self.direct_plan_id(sid) if self.task["action"] == "intelligence.prepare"
               else digest({"kind": "intelligence-plan", "task_id": self.task["id"],
                            "session_id": sid, **({"tool_call": captured["call_id"]}
                            if captured is not None else {"body": body})}))
        normalize = getattr(self.original, "storage_tenant", None)
        stored_tenant = normalize(tenant) if callable(normalize) else tenant
        serialized = json.dumps(body, sort_keys=True, separators=(",", ":"),
                                ensure_ascii=False, allow_nan=False)
        with self.original.db() as db:
            row = db.execute("SELECT tenant,session,body FROM plans WHERE id=?", (key,)).fetchone()
            if row is not None:
                if (row["tenant"] != stored_tenant or row["session"] != sid
                        or json.loads(row["body"]) != body):
                    raise IntelligenceError("The retained plan belongs to another selection.", 409)
            else:
                db.execute(
                    "INSERT INTO plans(id,tenant,session,body,status,result,created,updated) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (key, stored_tenant, sid, serialized, "ready", None,
                     self.task["created_at"], self.task["created_at"]))
        return self.original.plan(tenant, key)


    def event(self, tenant: str, sid: str, kind: str, body: dict):
        self.authorize(tenant,sid)
        captured = self._captured_events.get()
        if (captured is not None and captured['tenant'] == self._ask_tenant(tenant)
                and captured['session'] == sid):
            captured['events'].append({'kind':kind,'body':loads(dumps(body)),'created':now()})
            return
        with self.db() as db:
            db.execute('INSERT INTO events(session,kind,body,created) VALUES (?,?,?,?)',(sid,kind,dumps(body),now()))

    def retained_ask_question(self, tenant, sid, rid):
        self.original.authorize(tenant, sid)
        questions = []
        with self.original.db() as db:
            for row in db.execute("SELECT body FROM events WHERE session=? AND kind='question' ORDER BY seq", (sid,)):
                body = loads(row["body"])
                if isinstance(body, dict) and body.get("request_id") == rid:
                    questions.append(body.get("text"))
        if not questions:
            return None
        if not isinstance(questions[0], str) or any(value != questions[0] for value in questions):
            raise IntelligenceError("The original question history has conflicting text.", 409)
        return questions[0]

    def retained_ask_plan(self, tenant, sid, action):
        captured = self.ask_tool_identity(tenant, sid)
        if captured is None or captured["request_id"] != self.task["operation_id"]:
            raise IntelligenceError("Prepare the action inside its original Assistant tool call.", 409)
        selected = action.model_dump(exclude_none=True)
        self._captured_events.get()["action"] = selected
        key = digest({"kind": "intelligence-plan", "task_id": self.task["id"],
                      "session_id": sid, "tool_call": captured["call_id"]})
        try:
            plan = self.original.plan(tenant, key)
        except IntelligenceError as error:
            if error.status == 404:
                return None
            raise
        expected = {**captured, "task_id": self.task["id"], "action": selected}
        if plan["session"] != sid or plan["body"].get("assistant_request") != expected:
            raise IntelligenceError("The retained Assistant plan has another original tool selection.", 409)
        return plan

    def _ask_tenant(self, tenant):
        # Native scope accepts both its workspace key and stable project namespace.
        normalize = getattr(self, 'storage_tenant', None)
        return normalize(tenant) if callable(normalize) else tenant

    def ask_tool_identity(self, tenant, sid):
        captured = self._captured_events.get()
        if (captured is not None and captured['tenant'] == self._ask_tenant(tenant)
                and captured['session'] == sid):
            return {'request_id':captured['request_id'],'call_id':captured['call_id']}
        return None

    @contextmanager
    def capture_ask_events(self, tenant, sid, request_id, call_id):
        captured = {'tenant':self._ask_tenant(tenant),'session':sid,
                    'request_id':request_id,'call_id':call_id,'events':[]}
        token = self._captured_events.set(captured)
        try:
            yield captured['events']
        finally:
            self._captured_events.reset(token)

    def _legacy_ask_state(self, db, sid, rid, request, prior, provider_model):
        """Retain the previous public pending completion inside this same task."""
        if not isinstance(prior, dict):
            return {}
        continuation = prior.get('continuation')
        if continuation is not None:
            if (not isinstance(continuation, dict)
                    or continuation.get('question') != request['question']
                    or continuation.get('focus_ref') != request.get('focus_ref')
                    or continuation.get('model') != provider_model):
                raise IntelligenceError('The retained completion has another original question, source or provider model.',409)
            messages = continuation.get('messages')
            context = continuation.get('focused_context')
            used = continuation.get('used_ids')
            usage = continuation.get('usage')
            turn = continuation.get('turn')
            def conversation(value):
                return (isinstance(value,list) and bool(value)
                        and all(isinstance(item,dict)
                            and item.get('role') in {'system','user','assistant','tool'}
                            for item in value))
            if (not conversation(messages) or not conversation(context)
                    or len(context) < 2 or context[0].get('role') != 'system'
                    or context[1].get('role') != 'user' or context[1].get('content') != request['question']
                    or messages[:2] != context[:2]
                    or type(turn) is not int or turn < 0
                    or not isinstance(usage,list) or not isinstance(used,list)
                    or any(not isinstance(key,str) or not EVIDENCE_ID.fullmatch(key) for key in used)):
                raise IntelligenceError('The complete original pending completion is required to resume this request.',409)
            return {'prepared':True,'messages':loads(dumps(messages)),
                    'original_context':loads(dumps(context)),'round':turn,
                    'usage':loads(dumps(usage)),'used_ids':list(used),
                    'legacy_mode':'retained_pending_completion'}
        # Older failures retained completed tools in the original event stream.
        # Stop at the next question so another request's tools cannot be adopted.
        active, tools, evidence_ids = False, [], []
        for event in db.execute('SELECT kind,body FROM events WHERE session=? ORDER BY seq',(sid,)):
            body = loads(event['body'])
            if event['kind'] == 'question':
                active = isinstance(body,dict) and body.get('request_id') == rid
            elif active and isinstance(body,dict):
                if event['kind'] == 'tool':
                    tools.append(body)
                elif (event['kind'] == 'inspection' and isinstance(body.get('evidence_id'),str)
                        and EVIDENCE_ID.fullmatch(body['evidence_id'])):
                    evidence_ids.append(body['evidence_id'])
        return ({'legacy_tools':tools,'legacy_evidence_ids':evidence_ids,
                 'legacy_mode':'retained_completed_tools'} if tools or evidence_ids else {})

    def begin_ask(self, tenant, sid, rid, request, *, resume=False, provider_model=''):
        """Bind one original request and explicitly continue its retained work."""
        tenant = self._ask_tenant(tenant)
        self.authorize(tenant,sid)
        if self.task['action'] != 'intelligence.ask' or rid != self.task['operation_id']:
            raise IntelligenceError('The continuation belongs to another original operation.',409)
        request = loads(dumps({**request, 'task_id':self.task['id'],
            'operation_id':self.task['operation_id'], 'payload_sha256':ask_digest(self.task['payload'])}))
        request_sha = ask_digest(request)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT status,body FROM requests WHERE tenant=? AND session=? AND id=?',
                             (tenant,sid,rid)).fetchone()
            prior = loads(row['body']) if row and row['body'] is not None else None
            checkpoint = prior if isinstance(prior,dict) and prior.get('format') == ASK_CHECKPOINT else None
            if checkpoint is not None:
                if (checkpoint.get('request_sha256') != request_sha
                        or checkpoint.get('request_id') != rid
                        or checkpoint.get('session_id') != sid
                        or checkpoint.get('tenant') != tenant):
                    raise IntelligenceError('Resume the original request with its retained question, source and session.',409)
                if row['status'] == 'complete':
                    return {'complete':checkpoint['result']}
            elif row and row['status'] == 'complete':
                return {'complete':prior}
            if row and not resume:
                raise IntelligenceError('This original request is already retained. Use its existing Resume control.',409)
            questions = []
            answered = None
            for event in db.execute("SELECT kind,body FROM events WHERE session=? AND kind IN ('question','answer') ORDER BY seq",(sid,)):
                body = loads(event['body'])
                if not isinstance(body,dict) or body.get('request_id') != rid:
                    continue
                if event['kind'] == 'question':
                    questions.append(body.get('text'))
                else:
                    answered = body
            if questions and any(text != request['question'] for text in questions):
                raise IntelligenceError('The retained request has a different original question.',409)
            if answered is not None:
                if row is None:
                    db.execute('INSERT INTO requests VALUES (?,?,?,?,?)',(tenant,sid,rid,'complete',dumps(answered)))
                else:
                    db.execute("UPDATE requests SET status='complete',body=? WHERE tenant=? AND session=? AND id=?",
                               (dumps(answered),tenant,sid,rid))
                return {'complete':answered}
            if checkpoint is None:
                checkpoint = {'format':ASK_CHECKPOINT,'tenant':tenant,'session_id':sid,
                    'request_id':rid,'request':request,'request_sha256':request_sha,
                    'revision':0,'attempt':0,'attempts':[],'phase':'preparing',
                    'prepared':False,'initial_results':[],'messages':[],'original_context':[],
                    'pending_response':None,'next_call':0,'round':0,'usage':[],'used_ids':[]}
                if row is not None:
                    checkpoint['legacy_request'] = {'status':row['status'],'body':prior}
                    checkpoint.update(self._legacy_ask_state(db,sid,rid,request,prior,provider_model))
            previous_phase = checkpoint.get('phase')
            if checkpoint['attempts'] and not checkpoint['attempts'][-1].get('ended_at'):
                checkpoint['attempts'][-1].update(ended_at=now(),
                    outcome='interrupted_before_explicit_resume',last_phase=previous_phase)
            for previous_http in checkpoint.get('http_attempts',[]):
                if previous_http.get('state') == 'in_flight':
                    previous_http.update(state='outcome_unknown',ended_at=now())
            checkpoint['attempt'] += 1
            checkpoint['revision'] += 1
            checkpoint['attempts'].append({'number':checkpoint['attempt'],'started_at':now(),
                'provider_model':provider_model,'authorization':'explicit_resume' if row else 'new_request',
                'previous_phase':previous_phase})
            checkpoint['phase'] = 'preparing'
            checkpoint.pop('error',None)
            if not questions:
                db.execute('INSERT INTO events(session,kind,body,created) VALUES (?,?,?,?)',
                           (sid,'question',dumps({'text':request['question'],'request_id':rid}),now()))
            elif row:
                db.execute('INSERT INTO events(session,kind,body,created) VALUES (?,?,?,?)',
                           (sid,'request_resumed',dumps({'request_id':rid,'attempt':checkpoint['attempt'],
                            'previous_phase':previous_phase}),now()))
            if row is None:
                db.execute('INSERT INTO requests VALUES (?,?,?,?,?)',(tenant,sid,rid,'running',dumps(checkpoint)))
            else:
                db.execute("UPDATE requests SET status='running',body=? WHERE tenant=? AND session=? AND id=?",
                           (dumps(checkpoint),tenant,sid,rid))
        return {'checkpoint':checkpoint}

    def save_ask(self, tenant, sid, rid, checkpoint, *, events=(), status='running'):
        """Commit continuation and its public events together under the same row."""
        if status not in {'running','failed','complete'}:
            raise IntelligenceError('Choose a supported retained request state.',409)
        tenant = self._ask_tenant(tenant)
        self.authorize(tenant,sid)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT status,body FROM requests WHERE tenant=? AND session=? AND id=?',
                             (tenant,sid,rid)).fetchone()
            prior = loads(row['body']) if row and row['body'] is not None else None
            if (not isinstance(prior,dict) or prior.get('format') != ASK_CHECKPOINT
                    or prior.get('request_sha256') != checkpoint.get('request_sha256')
                    or prior.get('attempt') != checkpoint.get('attempt')
                    or prior.get('revision') != checkpoint.get('revision')
                    or prior.get('tenant') != tenant or prior.get('session_id') != sid
                    or prior.get('request_id') != rid or row['status'] == 'complete'):
                raise IntelligenceError('The original request continuation changed; reopen its current task.',409)
            saved = loads(dumps(checkpoint))
            saved['revision'] += 1
            saved['updated_at'] = now()
            for event in events:
                db.execute('INSERT INTO events(session,kind,body,created) VALUES (?,?,?,?)',
                           (sid,event['kind'],dumps(event['body']),event.get('created') or now()))
            db.execute('UPDATE requests SET status=?,body=? WHERE tenant=? AND session=? AND id=?',
                       (status,dumps(saved),tenant,sid,rid))
        checkpoint['revision'] = saved['revision']
        checkpoint['updated_at'] = saved['updated_at']


def _original_integration(operator):
    """Mount E258's original Workspace binding and the installed ES26 provider."""
    existing = getattr(operator, "science_investigations", None)
    if existing is not None:
        return existing
    from importlib.util import find_spec
    from eco_intelligence.upstate import UpstateInvestigations

    providers = []
    # The existing operator adds its installed operator/ directory to sys.path.
    # Register the exact ES26 adapter when that component is installed.
    if find_spec("intelligence_diagnostics") is not None:
        from intelligence_diagnostics import DiagnosticsDatasets
        diagnostic = DiagnosticsDatasets(operator)
        providers.append(lambda workspace_key, workspace:
                         diagnostic.records(workspace_key, "dataset"))
        operator.science_investigation_diagnostics = diagnostic
    if find_spec("science_catalog") is not None:
        from science_catalog import WorkspaceScienceCatalog
        catalog = WorkspaceScienceCatalog(operator)
        providers.append(catalog)
        operator.science_investigation_catalog = catalog
    original_experiments = getattr(operator, "experiments", None)
    experiments_installed = original_experiments is not None and all(
        callable(getattr(original_experiments, name, None))
        for name in ("catalog", "read", "invoke", "preview"))
    integration = UpstateInvestigations(
        operator, dataset_providers=tuple(providers),
        native_experiments=experiments_installed)
    operator.science_investigations = integration
    return integration


class IntelligenceFeature:
    def __init__(self, operator, fault, integration=None):
        self.operator, self.Fault = operator, fault
        # Reuse the current native integration when preconfigured; otherwise
        # instantiate the exact published E258 factory inside this registry mount.
        if integration is None:
            integration = _original_integration(operator)
        for method in ("engine", "assistant"):
            if not callable(getattr(integration, method, None)):
                raise fault("INTELLIGENCE_BINDING",
                            "The Workspace binding must expose " + method + "(workspace_key).", 503)
        self.integration = integration
        self.collections = CollectionExports(operator)
        self.lineage = InvestigationLineage(operator)

    def _engine(self, workspace):
        self.operator.ws(workspace)
        return self.integration.engine(workspace)

    def _error(self, error):
        if isinstance(error, self.Fault):
            raise error
        if isinstance(error, IntelligenceError):
            raise self.Fault("INTELLIGENCE_INPUT", str(error), error.status) from error
        if isinstance(error, ValidationError):
            raise self.Fault("INTELLIGENCE_SELECTION",
                             "Check the selected operation fields: " + str(error), 422) from error
        raise error

    def _diagnostics(self):
        existing = getattr(self.operator, "science_investigation_diagnostics", None)
        if existing is not None:
            return existing
        from importlib.util import find_spec
        if find_spec("intelligence_diagnostics") is None:
            return None
        from intelligence_diagnostics import DiagnosticsDatasets
        diagnostic = DiagnosticsDatasets(self.operator)
        self.operator.science_investigation_diagnostics = diagnostic
        return diagnostic

    def _diagnostic_view(self, workspace, diagnostic_id, report_sha256=None):
        diagnostic = self._diagnostics()
        if diagnostic is None:
            raise IntelligenceError("Install the current Scientific interpretation source.", 503)
        result = dict(diagnostic.report_revision(workspace, diagnostic_id, report_sha256)
                      if report_sha256 is not None
                      else diagnostic.operator_report(workspace, diagnostic_id))
        dataset_id = "es26:" + diagnostic_id + ":report_json"
        descriptor = result.get("artifacts", {}).get("report_json") or {}
        source_sha256 = descriptor.get("sha256")
        revision_id = ("es26:" + diagnostic_id + ":report_revision_" + source_sha256
                       if source_sha256 else None)
        matches = []
        if source_sha256:
            store = self._engine(workspace).store
            normalize = getattr(store, "storage_tenant", None)
            tenant = normalize(workspace) if callable(normalize) else workspace
            # Filter exact source-ID candidates in one original Store read. Parse
            # only matching records, then require the original source digest.
            with store.db() as db:
                rows = db.execute(
                    "SELECT s.id AS session_id,s.title,s.created AS session_created_at,"
                    "e.id AS evidence_id,e.created AS evidence_created_at,e.body "
                    "FROM evidence e JOIN sessions s ON s.id=e.session AND s.tenant=e.tenant "
                    "WHERE e.tenant=? AND (e.body LIKE ? OR e.body LIKE ?) "
                    "ORDER BY e.created DESC,e.id DESC,s.id",
                    (tenant, '%"' + dataset_id + '"%', '%"' + revision_id + '"%')).fetchall()
            for row in rows:
                body = json.loads(row["body"])
                original = next((source for source in body.get("sources", [])
                                 if isinstance(source, dict)
                                 and source.get("ref") in (
                                     {"kind": "dataset", "id": dataset_id},
                                     {"kind": "dataset", "id": revision_id},
                                 )
                                 and source.get("sha256") == source_sha256), None)
                if original is not None:
                    matches.append({
                        key: row[key] for key in ("session_id", "title", "session_created_at",
                                                 "evidence_id", "evidence_created_at")
                    } | {"source_sha256": source_sha256,
                         "report_dataset_id": original["ref"]["id"]})
        result["_investigation"] = {
            "workspace_key": workspace, "diagnostic_id": diagnostic_id,
            "dataset_id": dataset_id, "source_sha256": source_sha256, "matches": matches,
            "report_dataset_id": revision_id,
        }
        return result

    def _open_diagnostic(self, engine, task):
        # Keep the current controller's evidence result while the original entry
        # pins this conversation to an immutable saved report revision.
        from intelligence_diagnostic_entry import open_diagnostic
        return {**open_diagnostic(self.operator, engine, task), "kind": "evidence"}

    def _native_tasks(self, workspace, plan, bindings=()):
        found = {}
        def scan(value):
            if isinstance(value, dict):
                candidate = value.get("native_task_id")
                if isinstance(candidate, str):
                    inspect(candidate)
                if (isinstance(value.get("action"), str)
                        and isinstance(value.get("workspace"), str)
                        and isinstance(value.get("id"), str)):
                    inspect(value["id"])
                for name in ("native", "native_task", "task", "fit", "result", "receipt"):
                    if name in value:
                        scan(value[name])
            elif isinstance(value, list):
                for row in value:
                    scan(row)
        def inspect(key):
            if key in found:
                return
            try:
                identifier(key)
                native_read = getattr(self.integration, "native_task", None)
                if callable(native_read):
                    task = native_read(workspace, key)
                else:
                    task = self.operator.task(key)
                    if task.get("workspace") != workspace:
                        return
            except IntelligenceError as error:
                if error.status == 404:
                    return
                raise
            except (ValueError, OSError, KeyError):
                return
            entry = {name: task.get(name) for name in
                     ("id", "operation_id", "workspace", "action", "state",
                      "created_at", "started_at", "ended_at", "error",
                      "_intelligence_origin")}
            entry["current_workspace"] = workspace
            origin = task.get("_intelligence_origin") or "original_operator"
            entry["_intelligence_origin"] = origin
            entry["open_task"] = (origin == "original_operator"
                                  and task.get("workspace") == workspace)
            if task.get("action") == "run.start":
                entry["run_id"] = task.get("payload", {}).get("run_id")
            if task.get("action") == "experiment.run":
                entry["experiment_id"] = task.get("payload", {}).get("experiment_id")
            found[key] = entry
        scan(plan.get("result"))
        for binding in bindings:
            if binding.get("plan_id") == plan["id"]:
                inspect(binding["task_id"])
        return list(found.values())

    def _plan_view(self, workspace, plan, bindings=None):
        if bindings is None:
            native_list = getattr(self.integration, "native_tasks", None)
            bindings = native_list(workspace) if callable(native_list) else []
        plan["_native_bindings"] = [
            row for row in bindings if row.get("plan_id") == plan["id"]]
        plan["_native_tasks"] = self._native_tasks(
            workspace, plan, plan["_native_bindings"])
        plan["_can_continue_submission"] = (
            plan.get("status") in {"executing", "reconcile"}
            and plan.get("body", {}).get("action", {}).get("kind")
                in {"run_job", "ensemble", "calibration"}
            and callable(getattr(self.integration, "continue_submission", None)))
        return plan

    def _session(self, workspace, sid):
        session = self._engine(workspace).store.session(workspace, _session_id(sid))
        native_list = getattr(self.integration, "native_tasks", None)
        bindings = native_list(workspace) if callable(native_list) else []
        session["plans"] = [self._plan_view(workspace, plan, bindings)
                            for plan in session["plans"]]
        folder = self.operator.ws(workspace).root / "intelligence" / "operator-exports"
        exports = []
        for path in sorted(folder.glob("*/manifest.json")):
            record = read_json(path)
            if record.get("session_id") == sid:
                exports.append({key: record[key] for key in
                                ("id", "session_id", "title", "created_at", "snapshot_sha256")})
        session["_exports"] = exports
        session["_source_collections"] = self.collections.summaries(workspace, sid)
        return session

    def summaries(self, workspace):
        return self._engine(workspace).store.sessions(workspace)

    def read(self, workspace, operation, payload=None):
        value = payload or {}
        try:
            engine = self._engine(workspace)
            if operation == "catalog":
                assistant = self.integration.assistant(workspace)
                methods = dict(getattr(engine.gateway, "methods", {}) or {})
                diagnostics = self._diagnostics()
                return {
                    "schema": "upstate.intelligence-catalog/v1",
                    "workspace_key": workspace,
                    "project": self.operator.ws(workspace).project,
                    "inventory": engine.repo.inventory(workspace),
                    "sessions": engine.store.sessions(workspace),
                    "provider_configured": bool(assistant.config.base_url and assistant.config.model),
                    "provider_model": assistant.config.model or None,
                    "native_methods": methods,
                    "native_experiments": getattr(self.integration, "experiments", None) is not None,
                    "diagnostic_issues": diagnostics.warnings(workspace) if diagnostics else [],
                    "diagnostic_report_route": "/api/intelligence/diagnostic" if diagnostics else None,
                    "actions": ["analyze_collection", *(
                        name for name in ("run_job", "ensemble", "calibration") if name in methods)],
                }
            if operation in LINEAGE_READS:
                return self.lineage.read(workspace, engine.repo, operation, value)
            if operation == "collection_sources":
                return self.collections.sources(workspace, engine.repo)
            if operation == "collection":
                sid = _session_id(value.get("session_id"))
                engine.store.authorize(workspace, sid)
                return self.collections.view(workspace, sid, identifier(value.get("collection_id")))
            if operation == "session":
                return self._session(workspace, value.get("session_id"))
            if operation == "evidence":
                eid = value.get("evidence_id")
                if not isinstance(eid, str) or not EVIDENCE_ID.fullmatch(eid):
                    raise IntelligenceError("Choose a retained source analysis.", 422)
                return engine.store.get_evidence(workspace, _session_id(value.get("session_id")), eid)
            if operation == "plan":
                plan = engine.store.plan(workspace, _session_id(value.get("plan_id")))
                return self._plan_view(workspace, plan)
            if operation == "native-task":
                task = self.integration.native_task(workspace, identifier(value.get("task_id")))
                payload = task.get("payload") or {}
                return {"workspace_key": workspace, "task": task,
                        "origin": task.get("_intelligence_origin"),
                        "run_id": payload.get("run_id") if task.get("action") == "run.start" else None,
                        "experiment_id": payload.get("experiment_id")
                            if task.get("action") == "experiment.run" else None}
            if operation == "diagnostic":
                return self._diagnostic_view(
                    workspace, identifier(value.get("diagnostic_id")),
                    report_sha256=value.get("report_sha256"),
                )
            if operation == "experiment":
                def page_number(name, default, minimum, maximum=None):
                    supplied = value.get(name, default)
                    if type(supplied) is int:
                        number = supplied
                    elif isinstance(supplied, str) and re.fullmatch(r"[0-9]+", supplied):
                        number = int(supplied)
                    else:
                        raise IntelligenceError("Choose an integer " + name + ".", 422)
                    if number < minimum or (maximum is not None and number > maximum):
                        raise IntelligenceError("Choose a valid " + name + ".", 422)
                    return number
                return self.integration.experiment_results(
                    workspace, identifier(value.get("experiment_id")),
                    offset=page_number("offset", 0, 0), limit=page_number("limit", 100, 1, 1000))
            if operation == "export":
                return self.export_view(workspace, _session_id(value.get("session_id")),
                                        identifier(value.get("export_id")))
            raise self.Fault("INTELLIGENCE_ROUTE", "Choose an installed investigation view.", 404)
        except Exception as error:
            self._error(error)

    @contextmanager
    def _operation(self, engine, task):
        # All writes enter through the original serial queue and workspace gate.
        # Read routes remain delegated to this same Store while work is in flight.
        original = engine.store
        engine.store = OperationStore(original, task)
        try:
            yield
        finally:
            engine.store = original

    def _receipt_path(self, workspace, task_id):
        return (self.operator.ws(workspace).root / "intelligence" /
                "operator-receipts" / (identifier(task_id) + ".json"))

    def invoke(self, task):
        workspace, action, value = task["workspace"], task["action"], task["payload"]
        if action not in ACTIONS:
            raise self.Fault("INTELLIGENCE_ACTION", "Choose an investigation operation.", 404)
        engine = self._engine(workspace)
        request_sha = digest({"action": action, "payload": value,
                              "operation_id": task["operation_id"]})
        receipt_path = self._receipt_path(workspace, task["id"])
        if receipt_path.is_file():
            receipt = read_json(receipt_path)
            if receipt.get("schema") != RECEIPT_SCHEMA or receipt.get("request_sha256") != request_sha:
                raise self.Fault("INTELLIGENCE_RECEIPT",
                                 "The retained operation belongs to another request.", 409)
            return receipt["result"]
        try:
            with self._operation(engine, task):
                result = self._invoke(engine, task)
            atomic_json(receipt_path, {
                "schema": RECEIPT_SCHEMA, "id": task["id"],
                "project_id": self.operator.ws(workspace).project["id"],
                "operation_id": task["operation_id"], "request_sha256": request_sha,
                "action": action, "created_at": task["created_at"], "result": result,
            }, immutable=True)
            return result
        except Exception as error:
            self._error(error)

    def _invoke(self, engine, task):
        workspace, action, value = task["workspace"], task["action"], task["payload"]
        if action == "intelligence.diagnostic.open":
            return self._open_diagnostic(engine, task)
        if action == "intelligence.session.create":
            selected = SessionCreate.model_validate(value)
            session = engine.store.create_session(workspace, selected.title)
            return {"kind": "session", "session_id": session["id"]}
        if action in {"intelligence.execute", "intelligence.continue"}:
            plan_id = _session_id(value.get("plan_id"))
            if action == "intelligence.continue":
                self.integration.continue_submission(workspace, plan_id)
                plan = asyncio.run(engine.reconcile(workspace, plan_id))
            else:
                plan = asyncio.run(engine.execute(workspace, plan_id))
            return {"kind": "plan", "session_id": plan["session"], "plan_id": plan["id"],
                    "plan_status": plan["status"]}
        sid = _session_id(value.get("session_id"))
        engine.store.authorize(workspace, sid)
        if action == "intelligence.inspect":
            evidence = engine.inspect(workspace, sid, Inspect.model_validate(value.get("request")))
            return {"kind": "evidence", "session_id": sid, "evidence_id": evidence["id"]}
        if action == "intelligence.prepare":
            selected = Action.model_validate(value.get("action"))
            plan = engine.store.prepared_plan(workspace, sid, selected)
            if plan is None:
                plan = engine.prepare(workspace, sid, selected)
            return {"kind": "plan", "session_id": sid, "plan_id": plan["id"],
                    "plan_status": plan["status"]}
        if action == "intelligence.ask":
            question = value.get("question")
            if not isinstance(question, str) or not question.strip() or len(question) > 24000:
                raise IntelligenceError("Enter a question of up to 24,000 characters.", 422)
            from intelligence_diagnostic_entry import contextualize_diagnostic_question
            retained_question = (engine.store.retained_ask_question(workspace, sid, task['operation_id'])
                                 if len(task.get('attempts', [])) > 1 else None)
            question = (retained_question if retained_question is not None else
                        contextualize_diagnostic_question(engine, workspace, sid, question))
            assistant = self.integration.assistant(workspace)
            if assistant.engine is not engine:
                raise IntelligenceError("The assistant must share the original investigation engine.", 503)
            focus_ref = value.get("focus_ref")
            if focus_ref is not None:
                if (not isinstance(focus_ref, dict) or set(focus_ref) - {"kind", "id", "member"}
                        or focus_ref.get("kind") not in {"dataset", "artifact", "job", "ensemble"}
                        or not isinstance(focus_ref.get("id"), str) or not focus_ref["id"]):
                    raise IntelligenceError("Choose an original registered source or native result for this question.", 422)
            # Both controls and progress use the original operator task lock.
            # An old attempt may not update a resumed task's current state.
            def original_task():
                current = self.operator.task(task["id"])
                if (current.get("workspace") != workspace
                        or current.get("action") != "intelligence.ask"
                        or current.get("operation_id") != task["operation_id"]
                        or current.get("payload") != value
                        or len(current.get("attempts", [])) != len(task.get("attempts", []))
                        or current.get("state") != "running"):
                    raise IntelligenceError("The original Assistant task changed; reopen its current retained state.",409)
                return current

            def cancelled():
                with self.operator.lock:
                    return bool(original_task().get("cancel_requested"))

            def progress(status):
                with self.operator.lock:
                    current = original_task()
                    current["provider_wait"] = dict(status)
                    atomic_json(self.operator.root / "tasks" / (task["id"] + ".json"), current)

            asyncio.run(assistant.ask(workspace, sid, question, task["operation_id"],
                focus_ref=focus_ref, resume=len(task.get("attempts", [])) > 1,
                cancelled=cancelled, progress=progress))
            return {"kind": "answer", "session_id": sid, "request_id": task["operation_id"]}
        if action == "intelligence.collection.export":
            record = self.collections.export(engine, task, sid)
            return {"kind": "source_collection", "session_id": sid, "collection_id": record["id"],
                    "catalog_sha256": record["catalog_sha256"]}
        if action == "intelligence.export":
            record = self._export(engine, task, sid)
            return {"kind": "export", "session_id": sid, "export_id": record["id"],
                    "snapshot_sha256": record["snapshot_sha256"]}
        raise self.Fault("INTELLIGENCE_ACTION", "Choose a supported investigation action.", 404)

    def _export(self, engine, task, sid):
        ws = self.operator.ws(task["workspace"])
        directory = ws.root / "intelligence" / "operator-exports" / identifier(task["id"])
        snapshot_path = directory / "investigation.json"
        manifest_path = directory / "manifest.json"
        if manifest_path.is_file():
            record = read_json(manifest_path)
            self._verify_export(ws, sid, task["id"], record)
            return record
        if snapshot_path.is_file():
            snapshot = read_json(snapshot_path)
            if (snapshot.get("format") != "eco-intelligence-investigation-v1"
                    or snapshot.get("operation_id") != task["operation_id"]
                    or snapshot.get("project", {}).get("id") != ws.project["id"]
                    or snapshot.get("session", {}).get("id") != sid):
                raise IntelligenceError("The original export belongs to another investigation.", 409)
        else:
            snapshot = {
                "format": "eco-intelligence-investigation-v1",
                "exported_at": task["created_at"], "operation_id": task["operation_id"],
                "project": ws.project, "session": engine.store.session(task["workspace"], sid),
            }
            atomic_bytes(snapshot_path, canonical(snapshot) + b"\n", immutable=True)
        html_path = directory / "investigation.html"
        if not html_path.is_file():
            atomic_bytes(html_path, investigation_html(snapshot["session"]).encode("utf-8"),
                         immutable=True)
        record = {
            "schema": "upstate.intelligence-export/v1", "id": task["id"],
            "session_id": sid, "title": snapshot["session"]["title"],
            "created_at": snapshot["exported_at"],
            "snapshot_sha256": describe_file(ws.root, snapshot_path)["sha256"],
            "files": {
                "json": describe_file(ws.root, snapshot_path),
                "html": describe_file(ws.root, html_path),
            },
        }
        atomic_json(manifest_path, record, immutable=True)
        return record

    @staticmethod
    def _verify_export(ws, sid, export_id, record):
        if (record.get("schema") != "upstate.intelligence-export/v1"
                or record.get("id") != export_id or record.get("session_id") != sid
                or set(record.get("files", {})) != {"json", "html"}
                or record.get("snapshot_sha256") != record["files"]["json"].get("sha256")):
            raise IntelligenceError("Choose this investigation's complete retained export.", 404)
        directory = ws.root / "intelligence" / "operator-exports" / identifier(export_id)
        verified = {}
        for format_name, expected in record["files"].items():
            path = verify_file(ws.root, expected)
            if path.resolve() != _native_fs_path(directory / ("investigation." + format_name)).resolve():
                raise IntelligenceError("The export member does not match its original operation.", 409)
            verified[format_name] = path
        return verified

    def export_view(self, workspace, sid, export_id):
        engine = self._engine(workspace)
        engine.store.authorize(workspace, sid)
        ws = self.operator.ws(workspace)
        record = read_json(ws.root / "intelligence" / "operator-exports" /
                           identifier(export_id) / "manifest.json")
        verified = self._verify_export(ws, sid, export_id, record)
        files = []
        for format_name, expected in record["files"].items():
            path = verified[format_name]
            files.append({
                **self.operator._ticket(
                    workspace, path, {**expected, "filename": "investigation-" + sid + "." + format_name},
                    "Complete source JSON" if format_name == "json" else "Readable investigation report"),
                "format": format_name,
            })
        return {key: record[key] for key in
                ("id", "session_id", "title", "created_at", "snapshot_sha256")} | {"files": files}

    def decorate_task(self, task):
        result = task.get("result") or {}
        if task.get("action") in ACTIONS and task.get("state") == "complete":
            task["_investigation"] = {
                key: result[key] for key in ("session_id", "evidence_id", "plan_id", "export_id", "collection_id")
                if key in result
            }
            if result.get("export_id"):
                task["_downloads"] = self.export_view(
                    task["workspace"], result["session_id"], result["export_id"])["files"]
            if result.get("collection_id"):
                task["_downloads"] = self.collections.view(
                    task["workspace"], result["session_id"], result["collection_id"])["files"]
        return task
