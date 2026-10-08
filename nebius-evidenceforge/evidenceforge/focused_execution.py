"""Run a released task control or saved plan with actual focused computation."""
from __future__ import annotations
import argparse, difflib, json, re, tempfile, time, multiprocessing as mp
from pathlib import Path
from .core import (EvidenceError,compile_change,verify_receipt,strict_json_loads,
                   canonical_bytes,sha256_hex,_validate_request,_validate_plan)
from .restricted_runner import RestrictedPythonSandbox,execute_checks,admit_source,CHECK_TIMEOUT
from .workloads import TASKS,task_manifest

def _provider_worker(request,model,context,baseline,tokens,timeout,queue):
    try:
        from .provider import generate_plan
        response=generate_plan(json.dumps(request),model=model,source_context=context,
            baseline_evidence=baseline,maximum_output_tokens=tokens,
            timeout_seconds=min(60,timeout))
        queue.put({"plan":strict_json_loads(response.content),"evidence":response.evidence()})
    except Exception as exc:
        queue.put({"error":type(exc).__name__})

def _provider_call(request,model,context,baseline,tokens,remaining):
    ctx=mp.get_context("spawn");queue=ctx.Queue()
    process=ctx.Process(target=_provider_worker,
        args=(request,model,context,baseline,tokens,remaining,queue))
    started=time.monotonic();process.start()
    try:
        response=queue.get(timeout=max(0.001,remaining-(time.monotonic()-started)))
    except Exception:
        raise EvidenceError("provider deadline/effect unknown; inspect journal before retry") from None
    finally:
        if process.is_alive():
            process.join(0.1)
            if process.is_alive():process.terminate()
        process.join(2);queue.close()
    if "error" in response:raise EvidenceError("provider request failed; no automatic retry")
    return response["plan"],response["evidence"]

def policy_for(task_id):
    task=TASKS[task_id]
    return {"request_id":"curated-"+task_id,"goal":task["goal"],"allowed_paths":[task["path"]],
            "required_tests":[task["test"]],"max_writes":1}

def source_plan(task_id,source):
    task=TASKS[task_id]
    return {"summary":"Apply the selected curated source and run its named focused regression",
        "operations":[{"kind":"read","path":task["path"]},
                      {"kind":"write","path":task["path"],"content":source},
                      {"kind":"test","name":task["test"]}]}

def validate_execution_plan(plan,policy):
    validated=_validate_plan(plan,policy)
    tests_started=False
    for operation in validated["operations"]:
        if operation["kind"]=="test":tests_started=True
        elif operation["kind"]=="write":
            if tests_started:raise EvidenceError("writes after checks would launder test evidence")
            admit_source(operation["content"])
    return validated

def verify_run(envelope):
    try:
        body=dict(envelope);digest=body.pop("run_sha256")
        if digest!=sha256_hex(canonical_bytes(body)):return False
        receipt=body["receipt"]
        if not verify_receipt(receipt):return False
        if body["receipt_sha256"]!=receipt["receipt_sha256"]:return False
        tests=[event for event in receipt["events"] if event["kind"]=="test"]
        outputs=body["checks"]
        if len(tests)!=len(outputs):return False
        for event,output in zip(tests,outputs):
            actual=dict(output);name=actual.pop("name")
            if event["name"]!=name or event["exit_code"]!=actual["exit_code"]:return False
            encoded=json.dumps(actual,sort_keys=True,allow_nan=False)
            if event["output_sha256"]!=sha256_hex(encoded.encode()):return False
        if body["qualifying_nebius_runtime_observed"] and body["provider"]["provider"]!="nebius-token-factory":return False
        return True
    except (KeyError,TypeError,ValueError):return False

def run_task(task_id, *, output_root, operation_id, control="corrected", bundle=None,
             live=False,model=None,seconds=60,maximum_output_tokens=4096):
    if task_id not in TASKS:raise EvidenceError("unknown fixed task")
    if not isinstance(operation_id,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}",operation_id):
        raise EvidenceError("stable operation ID required")
    if type(seconds) not in (int,float) or not 5<=seconds<=120:raise EvidenceError("run deadline must be 5–120s")
    if type(maximum_output_tokens) is not int or not 128<=maximum_output_tokens<=8192:
        raise EvidenceError("provider token limit must be 128–8192")
    if live:
        import os
        if not os.environ.get("NEBIUS_API_KEY") or not (model or os.environ.get("NEBIUS_MODEL")):
            raise EvidenceError("live mode requires existing secure NEBIUS_API_KEY and a current model")
    root=Path(output_root).resolve();root.mkdir(parents=True,exist_ok=True)
    operation=root/operation_id
    request_fingerprint=sha256_hex(canonical_bytes({"task":task_id,"control":control,"live":live,
        "model":model,"seconds":seconds,"maximum_output_tokens":maximum_output_tokens,
        "bundle":bundle,"baseline_sha256":sha256_hex(TASKS[task_id]["baseline"].encode())}))
    if operation.exists():
        retained=operation/"run.json"
        if retained.exists():
            previous=strict_json_loads(retained.read_text(encoding="utf-8"))
            if previous.get("request_fingerprint")==request_fingerprint and verify_run(previous):return previous
        raise EvidenceError("operation already exists or conflicts; inspect its journal before retry")
    operation.mkdir()
    started=time.monotonic();deadline=started+seconds
    journal=operation/"journal.json"
    journal.write_text(json.dumps({"operation_id":operation_id,"task":task_id,
             "state":"PREPARING","inference_attempted":False,
             "request_fingerprint":request_fingerprint}),encoding="utf-8")
    task=TASKS[task_id];policy=policy_for(task_id)
    try:
        workspace=Path(tempfile.mkdtemp(prefix="workspace-",dir=operation))
        source=workspace/task["path"];source.parent.mkdir(parents=True)
        source.write_text(task["baseline"],encoding="utf-8",newline="\n")
        baseline=execute_checks(task_id,task["baseline"],min(CHECK_TIMEOUT,deadline-time.monotonic()))
        if live:
            if bundle is not None:raise EvidenceError("live and saved plan are mutually exclusive")
            if deadline-time.monotonic()<1:raise EvidenceError("whole run deadline reached before inference")
            journal.write_text(json.dumps({"operation_id":operation_id,"task":task_id,
                "state":"INFERENCE_DISPATCHING","inference_attempted":True,
                "billing":"Existing free-credit authority must be established outside this runner"}),encoding="utf-8")
            plan,provider=_provider_call(policy,model,{task["path"]:task["baseline"]},
                baseline,maximum_output_tokens,max(0.001,deadline-time.monotonic()))
            (operation/"provider-plan.json").write_text(json.dumps({"request":policy,"plan":plan,
                "provider_evidence":provider},indent=2),encoding="utf-8")
        elif bundle is not None:
            if not isinstance(bundle,dict) or set(bundle)!={"request","plan","provider_evidence"}:
                raise EvidenceError("saved bundle must contain exact request/plan/provider_evidence")
            if bundle["request"]!=policy:raise EvidenceError("saved request does not match the selected task")
            if not isinstance(bundle["provider_evidence"],dict):raise EvidenceError("invalid saved provider evidence")
            plan=bundle["plan"]
            # A saved JSON assertion is not authentication of the provider. Preserve it as
            # a caller-supplied claim, never a qualifying live-runtime observation.
            provider={"provider":"saved-plan","retained_claim":bundle["provider_evidence"]}
        else:
            if control not in {"baseline","corrected"}:raise EvidenceError("unknown curated control")
            plan=source_plan(task_id,task[control]);provider={"provider":"authored-curated-control","control":control}
        validate_execution_plan(plan,policy)
        sandbox=RestrictedPythonSandbox(workspace,task_id,task,deadline)
        receipt=compile_change(json.dumps(policy),json.dumps(plan),sandbox,provider_evidence=provider)
        after=sandbox.read(task["path"])
        patch="".join(difflib.unified_diff(task["baseline"].splitlines(True),after.splitlines(True),
                                          fromfile=task["path"]+" before",tofile=task["path"]+" after"))
        elapsed=time.monotonic()-started
        if elapsed>seconds:raise EvidenceError("whole run deadline exceeded")
        body={"schema":"evidenceforge-focused-run/v1","operation_id":operation_id,"task_id":task_id,
              "request_fingerprint":request_fingerprint,
              "workload":"released curated benchmark","baseline":baseline,"checks":sandbox.check_outputs,
              "provider":provider,"receipt":receipt,"receipt_sha256":receipt["receipt_sha256"],
              "patch":patch,"source_before_sha256":sha256_hex(task["baseline"].encode()),
              "source_after_sha256":sha256_hex(after.encode()),"wall_seconds":elapsed,
              "limits":{"whole_run_seconds":seconds,"check_worker_seconds":CHECK_TIMEOUT,
                        "source_bytes":16000,"provider_maximum_output_tokens":maximum_output_tokens},
              "qualifying_nebius_runtime_observed":live,
              "provider_claim_authenticated_by_envelope":False,
              "envelope_verification_scope":"hash/schema consistency; provider authenticity needs the retained actual API call record",
              "complete_competition_entry":False,
              "execution_boundary":"restricted pure-Python fixture computation; not an OS security sandbox"}
        envelope={**body,"run_sha256":sha256_hex(canonical_bytes(body))}
        if not verify_run(envelope):raise EvidenceError("run envelope does not verify")
        (operation/"run.json").write_text(json.dumps(envelope,indent=2),encoding="utf-8")
        (operation/"receipt.json").write_text(json.dumps(receipt,indent=2),encoding="utf-8")
        (operation/"change.patch").write_text(patch,encoding="utf-8")
        journal.write_text(json.dumps({"operation_id":operation_id,"state":"TERMINAL",
            "tests_green":receipt["required_tests_green"],"run_sha256":envelope["run_sha256"]}),encoding="utf-8")
        return envelope
    except Exception as exc:
        old=json.loads(journal.read_text(encoding="utf-8"))
        old.update(state="FAILED_OR_EFFECT_UNKNOWN",error=type(exc).__name__,
                   elapsed_seconds=time.monotonic()-started)
        journal.write_text(json.dumps(old),encoding="utf-8")
        raise

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task",choices=list(TASKS),default="invoice-import")
    parser.add_argument("--operation-id",required=True)
    parser.add_argument("--out",required=True)
    parser.add_argument("--control",choices=["baseline","corrected"],default="corrected")
    parser.add_argument("--saved-plan")
    parser.add_argument("--live",action="store_true")
    parser.add_argument("--model")
    parser.add_argument("--seconds",type=float,default=60)
    parser.add_argument("--max-tokens",type=int,default=4096)
    args=parser.parse_args(argv)
    try:
        bundle=strict_json_loads(Path(args.saved_plan).read_text(encoding="utf-8")) if args.saved_plan else None
        result=run_task(args.task,output_root=args.out,operation_id=args.operation_id,
            control=args.control,bundle=bundle,live=args.live,model=args.model,
            seconds=args.seconds,maximum_output_tokens=args.max_tokens)
        print(json.dumps({"operation_id":result["operation_id"],"tests_green":result["receipt"]["required_tests_green"],
                          "run_sha256":result["run_sha256"],"nebius_runtime":result["qualifying_nebius_runtime_observed"]}))
        return 0 if result["receipt"]["required_tests_green"] else 1
    except (EvidenceError,OSError,ValueError,KeyError) as exc:
        print(json.dumps({"error":type(exc).__name__,"message":str(exc)[:200]}),file=__import__("sys").stderr)
        return 2

if __name__=="__main__":raise SystemExit(main())

