"""Run an existing saved Research delivery through its original paid workflow.

This executable accepts the actual native publication selection, Buyer alias,
budgets and request UUIDs in one private case file. It uses the installed Python
client and the existing two Research workspaces throughout.
"""
from __future__ import annotations

from contextlib import ExitStack
from copy import deepcopy
import argparse
import json
from pathlib import Path
import signal
import threading

from stellar_forge_buyer import ResearchWorkspace, ResearchCommerceArchive
from stellar_forge_buyer.errors import BuyerError, StateError
from stellar_forge_buyer.research_workspace import _file_delivery
from stellar_forge_buyer.research_customer_updates import _retained_json
from stellar_forge_buyer.storage import digest, lock, parse, private_directory, read, write

_SCHEMA = "sf88-research-paid-python-programme/v1"
_RESULT = "sf88-research-paid-python-programme-result/v1"
_LIMIT = 4 * 1024 * 1024
_RESULT_LIMIT = 66 * 1024 * 1024 + 65536


def need(value, code):
    if not value:
        raise StateError(code)


class _BothOwners(threading.Event):
    def __init__(self, sender, receiver):
        super().__init__()
        self.sender, self.receiver = sender, receiver

    def is_set(self):
        return super().is_set() or self.sender.is_set() or self.receiver.is_set()


def _case(root, file, expected_sha256, sender, receiver):
    retained = root / "case.json"
    if retained.exists():
        body = read(retained, _LIMIT)
        if file is not None:
            selected = Path(file).expanduser().absolute()
            if selected.exists() or selected.is_symlink():
                need(read(selected, _LIMIT) == body, "RESEARCH_PAID_PROGRAMME_CASE_CHANGED")
    else:
        need(file is not None, "RESEARCH_PAID_PROGRAMME_CASE_REQUIRED")
        body = read(Path(file).expanduser().absolute(), _LIMIT)
    sha = digest(body)
    need(expected_sha256 is None or sha == expected_sha256, "RESEARCH_PAID_PROGRAMME_CASE_CHANGED")
    value = parse(body)
    need(isinstance(value, dict) and value.get("schema") == _SCHEMA and
         set(value) <= {"schema", "publication", "buyer", "correction"} and
         isinstance(value.get("publication"), dict) and isinstance(value.get("buyer"), dict),
         "RESEARCH_PAID_PROGRAMME_CASE_INVALID")
    buyer = value["buyer"]
    required = {"alias", "intakeRequestId", "prepareRequestId", "executeRequestId",
                "retrieveRequestId", "receiveRequestId", "totalAtomic", "dailyAtomic", "claimEnv"}
    need(required <= set(buyer) <= required | {"sourceActor"} and
         isinstance(value["publication"].get("requestId"), str),
         "RESEARCH_PAID_PROGRAMME_CASE_INVALID")
    identities = [value["publication"]["requestId"], *(buyer[key] for key in
                  ("intakeRequestId", "prepareRequestId", "executeRequestId",
                   "retrieveRequestId", "receiveRequestId"))]
    need(all(isinstance(item, str) for item in identities) and len(set(identities)) == len(identities),
         "RESEARCH_PAID_PROGRAMME_DISTINCT_REQUESTS_REQUIRED")
    correction = value.get("correction")
    if correction is not None:
        need(isinstance(correction, dict) and {"action", "data", "actor", "requestId"} <= set(correction) <=
             {"action", "data", "actor", "requestId", "expectedRevision"},
             "RESEARCH_PAID_PROGRAMME_CORRECTION_INVALID")
    if not retained.exists():
        write(retained, body, exclusive=True)
    selection = {"schema": _SCHEMA, "caseSha256": sha, "caseBytes": len(body),
                 "senderDirectory": str(sender.directory), "receiverDirectory": str(receiver.directory)}
    _retained_json(root / "selection.json", selection)
    return value, selection


def _file(value):
    return _file_delivery({**value, "file": value["path"]})


def _verify(result, root, selection, sender, receiver):
    need(result.get("schema") == _RESULT and result.get("directory") == str(root) and
         result.get("selection") == selection, "RESEARCH_PAID_PROGRAMME_RESULT_CHANGED")
    for selected in (result["publicationExport"], result["archiveExport"]):
        with _file(selected["file"]).open():
            pass
    received = ResearchCommerceArchive(result["localArchive"])
    need(received.handover.manifest_sha256 ==
         result["publication"]["result"]["result"]["publication"]["delivery"]["manifestSha256"],
         "RESEARCH_PAID_PROGRAMME_HANDOVER_CHANGED")
    for client, call_id in ((sender.commerce(), result["calls"]["publication"]),
                            (receiver.commerce(), result["calls"]["receiving"]),
                            (receiver.commerce(), result["calls"]["replay"])):
        need(client.saved(call_id).get("completed") is True,
             "RESEARCH_PAID_PROGRAMME_CALL_MISSING")
    return deepcopy(result)


def run_paid_delivery(*, sender, receiver, directory, case_file=None,
                      expected_case_sha256=None, stage="complete", cancel_event=None):
    """Continue the same complete programme; keep the original client owners."""
    need(stage in {"prepare", "complete"}, "RESEARCH_PAID_PROGRAMME_STAGE_INVALID")
    root = private_directory(Path(directory))
    need(root not in {sender.directory, receiver.directory},
         "RESEARCH_PAID_PROGRAMME_DIRECTORY_COLLISION")
    with sender._operation(cancel_event) as sender_owner, receiver._operation(cancel_event) as receiver_owner:
        event = _BothOwners(sender_owner, receiver_owner)
        with lock(root):
            case, selected = _case(root, case_file, expected_case_sha256, sender, receiver)
            output = root / "result.json"
            if output.exists():
                return _verify(parse(read(output, _RESULT_LIMIT)), root, selected, sender, receiver)
            prefix = "paid:" + selected["caseSha256"][:24] + ":"
            seller, customer = sender.commerce(), receiver.commerce()
            forms = private_directory(root / "forms")
            calls = {}

            def form(name, make):
                path = forms / (name + ".json")
                if path.exists():
                    return parse(read(path, _LIMIT))
                return _retained_json(path, make(), limit=_LIMIT)

            def phase(client, name, make):
                if event.is_set():
                    raise StateError("RESEARCH_PAID_PROGRAMME_CANCELLED")
                call_id = prefix + name
                calls[name] = call_id
                directory = client.workspace._directory_for_call(call_id, create=True)
                if (directory / "request.json").exists():
                    return client.recover(call_id, cancel_event=event)
                return make(call_id)

            publication_request = case["publication"]
            review = phase(seller, "review", lambda call: seller.prepare_publication(
                publication_request, call_id=call, resume=True, cancel_event=event))
            review_value = review["result"]["review"]
            publication = phase(seller, "publication", lambda call: seller.enroll_publication(
                {"id": publication_request["requestId"], "reviewSha256": review_value["reviewSha256"]},
                call_id=call, resume=True, cancel_event=event))
            offer = publication["result"]["result"]["publication"]
            publication_export = phase(seller, "publication-file", lambda call: seller.export(
                "publications", publication_request["requestId"], "publication", call_id=call,
                expected_sha256=publication["result"]["result"]["publicationSha256"],
                resume=True, cancel_event=event))
            buyer = case["buyer"]
            intake = phase(customer, "intake", lambda call: customer.receive_publication_file(
                publication_export["file"]["path"], buyer=buyer["alias"],
                request_id=buyer["intakeRequestId"], call_id=call,
                expected_sha256=publication_export["file"]["sha256"], resume=True, cancel_event=event))

            def preparation():
                current = customer.purchase(buyer["intakeRequestId"], refresh=True, cancel_event=event)
                paid_file = current.get("paidFile")
                need(isinstance(paid_file, dict) and type(paid_file.get("revision")) is int,
                     "RESEARCH_PAID_PROGRAMME_NATIVE_REVISION_REQUIRED")
                return {"id": buyer["intakeRequestId"], "requestId": buyer["prepareRequestId"],
                        "expectedRevision": paid_file["revision"], "totalAtomic": buyer["totalAtomic"],
                        "dailyAtomic": buyer["dailyAtomic"], "claimEnv": buyer["claimEnv"]}

            prepared = phase(customer, "prepare", lambda call: customer.prepare_purchase(
                form("purchase-preparation", preparation), call_id=call,
                resume=True, cancel_event=event))
            native_prepared = prepared["result"]["prepared"]
            prepared_result = {"schema": "sf88-research-paid-python-prepared/v1",
                "selection": selected, "publication": publication, "intake": intake,
                "prepared": prepared, "calls": deepcopy(calls)}
            _retained_json(root / "prepared.json", prepared_result, limit=_RESULT_LIMIT)
            if stage == "prepare":
                return prepared_result

            def action_input(request_id):
                return {"id": buyer["intakeRequestId"], "requestId": request_id,
                        "preparedSha256": native_prepared["preparedSha256"]}

            executed = phase(customer, "execute", lambda call: customer.execute(
                action_input(buyer["executeRequestId"]), call_id=call,
                resume=True, cancel_event=event))
            retrieved = phase(customer, "retrieve", lambda call: customer.retrieve(
                action_input(buyer["retrieveRequestId"]), call_id=call,
                resume=True, cancel_event=event))
            receiving_input = action_input(buyer["receiveRequestId"])
            if buyer.get("sourceActor") is not None:
                receiving_input["sourceActor"] = buyer["sourceActor"]
            receiving = phase(customer, "receiving", lambda call: customer.receive_dossier(
                receiving_input, call_id=call, resume=True, cancel_event=event))
            native_receiving = receiving["result"]["received"]["nativeReceiving"]
            need(native_receiving["dossierId"] == offer["delivery"]["dossierId"] and
                 native_receiving["deliveryId"] == offer["delivery"]["deliveryId"],
                 "RESEARCH_PAID_PROGRAMME_RECEIVED_SELECTION_CHANGED")
            archive_export = phase(customer, "archive", lambda call: customer.export(
                "purchases", buyer["intakeRequestId"], "archive", call_id=call,
                expected_sha256=offer["archive"]["sha256"], resume=True, cancel_event=event))
            local_archive = phase(customer, "archive-receive", lambda call: customer.receive_archive(
                path=archive_export["file"]["path"], expected_sha256=offer["archive"]["sha256"],
                expected_bytes=offer["archive"]["bytes"],
                manifest_sha256=offer["delivery"]["manifestSha256"],
                call_id=call, resume=True, cancel_event=event))
            complete_archive = ResearchCommerceArchive(local_archive)

            correction_result = None
            correction = case.get("correction")
            if correction is not None:
                updates = receiver.customer_updates(native_receiving["dossierId"])
                correction_id = correction["requestId"]
                original = receiver._directory_for_call(correction_id, create=True)
                if (original / "request.json").exists():
                    correction_result = updates.recover(correction_id, cancel_event=event)
                else:
                    correction_file = forms / "customer-correction.json"
                    if not correction_file.exists():
                        value = updates.prepare(correction["action"], correction["data"],
                            request_id=correction_id, actor=correction["actor"],
                            expected_revision=correction.get("expectedRevision"), cancel_event=event)
                        updates.save_prepared(value, correction_file)
                    correction_result = updates.submit_prepared(correction_file,
                                                                resume=True, cancel_event=event)

            replay_id = prefix + "receiving-replay"
            replay = customer.replay(calls["receiving"], replay_id=replay_id, cancel_event=event)
            calls["replay"] = replay_id
            replayed = replay["result"]["received"]["nativeReceiving"]
            need(all(replayed[key] == native_receiving[key] for key in
                 ("workspaceId", "dossierId", "deliveryId", "manifestSha256", "revision")),
                 "RESEARCH_PAID_PROGRAMME_ORIGINAL_RECEIVING_CHANGED")
            complete_archive.verify()
            final = {"schema": _RESULT, "directory": str(root), "selection": selected,
                     "calls": calls, "publicationReview": review, "publication": publication,
                     "publicationExport": publication_export, "intake": intake,
                     "prepared": prepared, "executed": executed, "retrieved": retrieved,
                     "receiving": receiving, "archiveExport": archive_export,
                     "localArchive": local_archive, "correction": correction_result, "replay": replay}
            _retained_json(output, final, limit=_RESULT_LIMIT)
            return _verify(final, root, selected, sender, receiver)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--sender-connection")
    parser.add_argument("--receiver-connection")
    parser.add_argument("--sender-directory", required=True)
    parser.add_argument("--receiver-directory", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--case")
    parser.add_argument("--case-sha256")
    parser.add_argument("--stage", choices=("prepare", "complete"), default="prepare")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--request-timeout-ms", type=int, default=900000)
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    event, previous = threading.Event(), {}
    for kind in (signal.SIGINT, signal.SIGTERM):
        previous[kind] = signal.signal(kind, lambda *_: event.set())
    try:
        with ExitStack() as owners:
            options = {"checkout": args.checkout, "node": args.node, "timeout": args.timeout,
                       "request_timeout_ms": args.request_timeout_ms}
            sender = owners.enter_context(ResearchWorkspace(**options,
                connection_file=args.sender_connection, directory=args.sender_directory))
            receiver = owners.enter_context(ResearchWorkspace(**options,
                connection_file=args.receiver_connection, directory=args.receiver_directory))
            result = run_paid_delivery(sender=sender, receiver=receiver, directory=args.directory,
                case_file=args.case, expected_case_sha256=args.case_sha256,
                stage=args.stage, cancel_event=event)
            if args.output:
                path = Path(args.output).expanduser().absolute()
                _retained_json(path, result, limit=_RESULT_LIMIT)
                result = {"schema": result["schema"], "file": str(path)}
            print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
        return 0
    except (BuyerError, OSError, ValueError) as error:
        import sys
        detail = {"error": getattr(error, "code", type(error).__name__), "detail": str(error)}
        if hasattr(error, "record"):
            detail["record"] = error.record
        print(json.dumps(detail, ensure_ascii=False, allow_nan=False), file=sys.stderr)
        return 2
    finally:
        for kind, previous_handler in previous.items():
            signal.signal(kind, previous_handler)


if __name__ == "__main__":
    raise SystemExit(main())
