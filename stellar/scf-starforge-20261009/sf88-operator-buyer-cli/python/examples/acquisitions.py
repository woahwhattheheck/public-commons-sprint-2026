#!/usr/bin/env python3
"""Run one explicitly selected original acquisition command."""
from dataclasses import asdict
import json
from pathlib import Path
import signal
import sys
import threading

from stellar_forge_buyer import AcquisitionWorkspace, AcquisitionError

if len(sys.argv) != 3:
    raise SystemExit("Usage: python acquisitions.py /absolute/sdk-settings.json /absolute/command.json")
workspace = AcquisitionWorkspace(**json.loads(Path(sys.argv[1]).read_text()))
request = json.loads(Path(sys.argv[2]).read_text())
command, p = request["command"], request.get("parameters", {})
cancel = threading.Event()
interrupted_exit = None


def interrupted(signum, _frame):
    global interrupted_exit
    interrupted_exit = interrupted_exit or 128 + signum
    cancel.set()


options = {"cancel_event": cancel}
actions = {
    "state": lambda: workspace.state(**options),
    "attach": lambda: workspace.attach_run(p["run"], **options),
    "request": lambda: workspace.request(p["id"], **options),
    "receive": lambda: workspace.receive_request(p["file"], filename=p.get("filename"), **options),
    "review-request": lambda: workspace.review_request(p["id"], accept_index=p["acceptIndex"],
        total_atomic=p["totalAtomic"], daily_atomic=p["dailyAtomic"], **options),
    "prepare-request": lambda: workspace.prepare_request(p["id"], review_sha256=p["reviewSha256"], **options),
    "paid-file": lambda: workspace.paid_file(p["id"], **options),
    "receive-paid-file": lambda: workspace.receive_paid_file(p["file"], filename=p.get("filename"), **options),
    "review-paid-file": lambda: workspace.review_paid_file(p["id"], expected_revision=p["expectedRevision"],
        total_atomic=p["totalAtomic"], daily_atomic=p["dailyAtomic"], filename=p["filename"],
        claim_env=p["claimEnv"], **options),
    "prepare-paid-file": lambda: workspace.prepare_paid_file(p["id"], review_sha256=p["reviewSha256"], **options),
    "retrieve-paid-file": lambda: workspace.retrieve_paid_file(p["id"], only=p["only"],
        config_sha256=p["configSha256"], handoff_sha256=p["handoffSha256"], **options),
    "reset-paid-file": lambda: workspace.reset_paid_file(p["id"], only=p["only"],
        config_sha256=p["configSha256"], handoff_sha256=p["handoffSha256"], **options),
    "download-paid-file": lambda: workspace.download_paid_file(p["id"], p["operationId"], p["destination"], **options),
    "export-paid-file": lambda: workspace.export_paid_file(p["id"], destination=p["destination"], **options),
    "draft": lambda: workspace.draft(p["id"], revision=p.get("revision"), **options),
    "save": lambda: workspace.save(p["manifest"], acquisition_id=p.get("id"),
        expected_revision=p.get("expectedRevision", 0), **options),
    "initialize": lambda: workspace.initialize(p["id"], expected_revision=p["expectedRevision"],
        review_sha256=p["reviewSha256"], **options),
    "inspect": lambda: workspace.inspect(p["id"], **options),
    "execute": lambda: workspace.execute(p["id"], expected_plan_sha256=p["expectedPlanSha256"],
        only=p.get("only"), **options),
    "recover": lambda: workspace.recover(p["id"], **options),
    "unlock": lambda: workspace.unlock(p["id"], owner_pid=p["ownerPid"], **options),
    "finalize": lambda: workspace.finalize(p["id"], only=p.get("only"), **options),
    "bind-accounting": lambda: workspace.bind_accounting(p["id"], only=p["only"],
        workspace=p["workspace"], **options),
    "preview": lambda: workspace.preview(p["id"], p["operationId"], **options),
    "download": lambda: workspace.download(p["id"], p["operationId"], p["destination"], **options),
    "export": lambda: workspace.export(p["id"], format=p["format"], destination=p["destination"], **options),
    "export-request": lambda: workspace.export_request(p["id"], kind=p["kind"],
        destination=p["destination"], **options),
    "backup-review": lambda: workspace.backup_review(state_root=p["stateRoot"], **options),
    "backup": lambda: workspace.backup(state_root=p["stateRoot"], output=p["output"],
        review_sha256=p["reviewSha256"], quiesced=p["quiesced"],
        passphrase_env=p.get("passphraseEnv"), **options),
    "verify": lambda: workspace.verify(bundle=p["bundle"],
        expected_record_sha256=p.get("expectedRecordSha256"), passphrase_env=p.get("passphraseEnv"),
        python=p.get("python"), **options),
    "restore": lambda: workspace.restore(bundle=p["bundle"],
        expected_record_sha256=p.get("expectedRecordSha256"), passphrase_env=p.get("passphraseEnv"),
        python=p.get("python"), **options),
}
if command not in actions:
    raise SystemExit("Choose one command: " + ", ".join(actions))
previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
try:
    result = actions[command]()
    print(json.dumps(asdict(result), indent=2))
except AcquisitionError as error:
    print(json.dumps({"code": error.code, "result": asdict(error.result)}, indent=2))
    raise SystemExit(interrupted_exit or 2)
finally:
    for sig, handler in previous.items():
        signal.signal(sig, handler)
