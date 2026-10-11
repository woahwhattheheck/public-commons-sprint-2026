"""Run a released task control or saved plan with actual focused computation."""
from __future__ import annotations
import argparse, difflib, inspect, json, os, re, tempfile, time, multiprocessing as mp
from pathlib import Path
from .core import (EvidenceError,compile_change,verify_receipt,strict_json_loads,
                   canonical_bytes,sha256_hex,_validate_request,_validate_plan)
from .restricted_runner import RestrictedPythonSandbox,execute_checks,admit_source,CHECK_TIMEOUT
from .workloads import TASKS,task_manifest,check_functions
from .run_storage import atomic_bytes,atomic_json,json_bytes,utc_now

def _provider_worker(request,model,context,baseline,tokens,timeout,operation,queue):
    try:
        from .provider import generate_plan
        response=generate_plan(json.dumps(request),model=model,source_context=context,
            baseline_evidence=baseline,maximum_output_tokens=tokens,
            timeout_seconds=min(60,timeout),evidence_dir=Path(operation))
        queue.put({"plan":strict_json_loads(response.content),"evidence":response.evidence()})
    except Exception as exc:
        queue.put({"error":type(exc).__name__,
                   "message":str(exc)[:350] if isinstance(exc,EvidenceError) else "Provider operation failed",
                   "code":getattr(exc,"code","provider_plan_rejected")})

def _provider_call(request,model,context,baseline,tokens,remaining,operation):
    ctx=mp.get_context("spawn");queue=ctx.Queue()
    process=ctx.Process(target=_provider_worker,
        args=(request,model,context,baseline,tokens,remaining,str(operation),queue))
    started=time.monotonic();process.start()
    try:
        response=queue.get(timeout=max(0.001,remaining-(time.monotonic()-started)))
    except Exception:
        raise EvidenceError("provider deadline/effect unknown; inspect journal before retry") from None
    finally:
        if process.is_alive():
            process.join(0.1)
            if process.is_alive():process.terminate()
        process.join(2)
        if process.is_alive():
            process.kill();process.join()
        queue.close();queue.join_thread()
    if "error" in response:raise EvidenceError(response.get("message","Provider request failed"))
    return response["plan"],response["evidence"]

def policy_for(task_id):
    if task_id not in TASKS:raise EvidenceError("unknown fixed task")
    task=TASKS[task_id]
    return {"request_id":"curated-"+task_id,"goal":task["goal"],"allowed_paths":[task["path"]],
            "required_tests":[task["test"]],"max_writes":1}

def _checker_snapshot():
    directory=Path(__file__).parent
    return {"evidenceforge/"+name:(directory/name).read_bytes()
            for name in ("workloads.py","restricted_runner.py","core.py")}

def task_contract(task_id,files=None):
    files=_checker_snapshot() if files is None else files
    identities=[{"path":name,"sha256":sha256_hex(data)} for name,data in sorted(files.items())]
    return {"schema":"evidenceforge-task-contract/v1","task_id":task_id,
            "policy_sha256":sha256_hex(canonical_bytes(policy_for(task_id))),
            "source_before_sha256":sha256_hex(TASKS[task_id]["baseline"].encode("utf-8")),
            "checker_sha256":sha256_hex(canonical_bytes(identities)),"checker_files":identities}

def task_detail(task_id):
    policy=policy_for(task_id);task=TASKS[task_id];contract=task_contract(task_id)
    return {"task_id":task_id,"policy":policy,"task_contract":contract,
            "source":{"path":task["path"],"content":task["baseline"],
                      "sha256":contract["source_before_sha256"]},
            "checker":{"sha256":contract["checker_sha256"],"files":contract["checker_files"],
                       "source":inspect.getsource(check_functions)},
            "limits":{"source_bytes":16000,"max_writes":policy["max_writes"],
                      "whole_run_seconds":120,"check_worker_seconds":CHECK_TIMEOUT,
                      "provider_maximum_output_tokens":8192},
            "workload":"released curated benchmark",
            "execution_boundary":"restricted pure-Python fixture computation; not an OS security sandbox"}

def source_plan(task_id,source):
    task=TASKS[task_id]
    return {"summary":"Apply the selected curated source and run its named focused regression",
        "operations":[{"kind":"read","path":task["path"]},
                      {"kind":"write","path":task["path"],"content":source},
                      {"kind":"test","name":task["test"]}]}

def _source_patch(path,before,after):
    lines=difflib.unified_diff(before.splitlines(True),after.splitlines(True),
                               fromfile="a/"+path,tofile="b/"+path)
    # A model may produce valid Python without a final newline. Preserve that
    # exact source and emit the standard unified-diff EOF marker for git apply.
    return "".join(line if line.endswith("\n") else line+"\n\\ No newline at end of file\n"
                   for line in lines)

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
        # Older v1 envelopes remain readable. New retained operations also bind
        # the actual source, policy, checker and downloadable native artifacts.
        if "task_contract" in body:
            contract=body["task_contract"];source=body["task_source"]
            if contract.get("schema")!="evidenceforge-task-contract/v1":return False
            if contract["task_id"]!=body["task_id"]:return False
            if contract["policy_sha256"]!=receipt["request_sha256"]:return False
            if contract["checker_sha256"]!=sha256_hex(canonical_bytes(contract["checker_files"])):return False
            if source["path"] not in receipt["request"]["allowed_paths"]:return False
            if sha256_hex(source["before"].encode("utf-8"))!=body["source_before_sha256"]:return False
            if sha256_hex(source["after"].encode("utf-8"))!=body["source_after_sha256"]:return False
            if contract["source_before_sha256"]!=body["source_before_sha256"]:return False
            if body["baseline"]["source_sha256"]!=body["source_before_sha256"]:return False
            if any(output["source_sha256"]!=body["source_after_sha256"] for output in outputs):return False
            if body["provider"]!=receipt["provider_evidence"]:return False
            patch=_source_patch(source["path"],source["before"],source["after"])
            if patch!=body["patch"]:return False
            if type(body["qualifying_nebius_runtime_observed"]) is not bool:return False
            if body["qualifying_nebius_runtime_observed"]:
                if body["execution_mode"]!="nebius" or not body["provider"].get("api_record_sha256"):return False
            elif body["execution_mode"] in {"baseline","corrected"}:
                if body["provider"].get("control")!=body["execution_mode"]:return False
            artifacts=body["artifacts"]
            if not isinstance(artifacts,list) or len({a["name"] for a in artifacts})!=len(artifacts):return False
            for artifact in artifacts:
                if set(artifact)!={"name","bytes","sha256"}:return False
                if type(artifact["bytes"]) is not int or artifact["bytes"]<0:return False
                if not re.fullmatch(r"[0-9a-f]{64}",artifact["sha256"]):return False
        return True
    except (KeyError,TypeError,ValueError,AttributeError):return False

def run_task(task_id, *, output_root, operation_id, control="corrected", bundle=None,
             live=False,model=None,seconds=60,maximum_output_tokens=4096):
    if task_id not in TASKS:raise EvidenceError("unknown fixed task")
    if not isinstance(operation_id,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}",operation_id):
        raise EvidenceError("stable operation ID required")
    if type(seconds) not in (int,float) or not 5<=seconds<=120:raise EvidenceError("run deadline must be 5–120s")
    if type(maximum_output_tokens) is not int or not 128<=maximum_output_tokens<=8192:
        raise EvidenceError("provider token limit must be 128–8192")
    if type(live) is not bool:raise EvidenceError("live must be a boolean")
    if live and bundle is not None:raise EvidenceError("live and saved plan are mutually exclusive")
    if not live and bundle is None and control not in {"baseline","corrected"}:
        raise EvidenceError("unknown curated control")
    chosen_model=(model or os.environ.get("NEBIUS_MODEL")) if live else None
    if live and (not isinstance(chosen_model,str) or not chosen_model.strip() or len(chosen_model)>256):
        raise EvidenceError("live mode requires a current NVIDIA model")
    mode="nebius" if live else "saved-plan" if bundle is not None else control
    checker_files=_checker_snapshot();contract=task_contract(task_id,checker_files)
    root=Path(output_root).resolve();root.mkdir(parents=True,exist_ok=True)
    operation=root/operation_id
    request_fingerprint=sha256_hex(canonical_bytes({"task":task_id,"control":control,"live":live,
        "model":chosen_model,"seconds":seconds,"maximum_output_tokens":maximum_output_tokens,
        "bundle":bundle,"task_contract":contract,
        "control_source_sha256":sha256_hex(TASKS[task_id][control].encode()) if mode in {"baseline","corrected"} else None}))
    if operation.exists():
        from .retained_runs import read_operation
        retained=read_operation(root,operation_id)
        previous=retained.get("run")
        if retained["result_verified"] and previous.get("request_fingerprint")==request_fingerprint:return previous
        raise EvidenceError("operation already exists or conflicts; inspect its journal before retry")
    if live and not os.environ.get("NEBIUS_API_KEY"):
        raise EvidenceError("live mode requires the existing server-side NEBIUS_API_KEY")
    operation.mkdir()
    started=time.monotonic();deadline=started+seconds
    journal=operation/"journal.json"
    metadata={"operation_id":operation_id,"task":task_id,"execution_mode":mode,
              "model":chosen_model,"state":"PREPARING","phase":"source",
              "inference_attempted":False,"request_fingerprint":request_fingerprint,
              "created_at":utc_now(),"updated_at":utc_now()}
    atomic_json(journal,metadata)
    task=TASKS[task_id];policy=policy_for(task_id)
    artifacts={};envelope=None
    def retain(name,data):
        atomic_bytes(operation/name,data)
        artifacts[name]={"name":name,"bytes":len(data),"sha256":sha256_hex(data)}
    def progress(**fields):
        metadata.update(fields,updated_at=utc_now());atomic_json(journal,metadata)
    try:
        retain("task-contract.json",json_bytes(contract));retain("policy.json",json_bytes(policy))
        retain("source-before.py",task["baseline"].encode("utf-8"))
        for filename,data in checker_files.items():retain("checker/"+Path(filename).name,data)
        workspace=Path(tempfile.mkdtemp(prefix="workspace-",dir=operation))
        source=workspace/task["path"];source.parent.mkdir(parents=True)
        source.write_text(task["baseline"],encoding="utf-8",newline="\n")
        progress(phase="baseline_checks")
        baseline=execute_checks(task_id,task["baseline"],min(CHECK_TIMEOUT,deadline-time.monotonic()))
        retain("baseline.json",json_bytes(baseline))
        if live:
            if deadline-time.monotonic()<1:raise EvidenceError("whole run deadline reached before inference")
            progress(state="INFERENCE_DISPATCHING",phase="provider_inventory_and_request")
            plan,provider=_provider_call(policy,chosen_model,{task["path"]:task["baseline"]},
                baseline,maximum_output_tokens,max(0.001,deadline-time.monotonic()),operation)
            progress(inference_attempted=True,provider_response_id=provider.get("response_id"),
                     provider_request_id=provider.get("request_id"),phase="plan_admission")
            retain("provider-plan.json",json_bytes({"request":policy,"plan":plan,"provider_evidence":provider}))
        elif bundle is not None:
            if not isinstance(bundle,dict) or set(bundle)!={"request","plan","provider_evidence"}:
                raise EvidenceError("saved bundle must contain exact request/plan/provider_evidence")
            if bundle["request"]!=policy:raise EvidenceError("saved request does not match the selected task")
            if not isinstance(bundle["provider_evidence"],dict):raise EvidenceError("invalid saved provider evidence")
            plan=bundle["plan"]
            # A saved JSON assertion is not authentication of the provider. Preserve it as
            # a caller-supplied claim, never a qualifying live-runtime observation.
            provider={"provider":"saved-plan","retained_claim":bundle["provider_evidence"]}
            retain("provider-plan.json",json_bytes(bundle))
        else:
            if control not in {"baseline","corrected"}:raise EvidenceError("unknown curated control")
            plan=source_plan(task_id,task[control]);provider={"provider":"authored-curated-control","control":control}
        validate_execution_plan(plan,policy)
        retain("plan.json",json_bytes(plan));progress(phase="source_and_declared_checks")
        sandbox=RestrictedPythonSandbox(workspace,task_id,task,deadline)
        receipt=compile_change(json.dumps(policy),json.dumps(plan),sandbox,provider_evidence=provider)
        after=sandbox.read(task["path"])
        patch=_source_patch(task["path"],task["baseline"],after)
        elapsed=time.monotonic()-started
        if elapsed>seconds:raise EvidenceError("whole run deadline exceeded")
        if _checker_snapshot()!=checker_files:
            raise EvidenceError("checker source changed during the operation; retained computation is not published as the original contract")
        retain("source-after.py",after.encode("utf-8"));retain("checks.json",json_bytes(sandbox.check_outputs))
        retain("receipt.json",json_bytes(receipt));retain("change.patch",patch.encode("utf-8"))
        for name in ("provider-inventory.json","provider-api.json"):
            if (operation/name).exists():
                data=(operation/name).read_bytes()
                artifacts[name]={"name":name,"bytes":len(data),"sha256":sha256_hex(data)}
        body={"schema":"evidenceforge-focused-run/v1","operation_id":operation_id,"task_id":task_id,
              "request_fingerprint":request_fingerprint,
              "execution_mode":mode,"created_at":metadata["created_at"],"finished_at":utc_now(),
              "task_contract":contract,"task_source":{"path":task["path"],"before":task["baseline"],"after":after},
              "artifacts":[artifacts[key] for key in sorted(artifacts)],
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
        # Every downloadable artifact is durable before run.json commits the
        # complete result. A disconnected browser never changes this sequence.
        atomic_json(operation/"run.json",envelope)
        progress(state="TERMINAL",phase="complete",tests_green=receipt["required_tests_green"],
                 run_sha256=envelope["run_sha256"],finished_at=body["finished_at"])
        return envelope
    except Exception as exc:
        if envelope is not None and (operation/"run.json").is_file():
            try:
                if strict_json_loads((operation/"run.json").read_text(encoding="utf-8"))==envelope:
                    return envelope
            except (ValueError,OSError):pass
        progress(state="FAILED_OR_EFFECT_UNKNOWN",error=type(exc).__name__,
                 message=str(exc)[:350] if isinstance(exc,EvidenceError) else "Operation failed; retained files are available for inspection",
                 inference_attempted=(operation/"provider-api.json").exists(),
                 elapsed_seconds=time.monotonic()-started,finished_at=utc_now())
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

