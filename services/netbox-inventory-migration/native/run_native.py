#!/usr/bin/env python3
"""Complete the retained native NetBox receiving operation against its actual API."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlencode
import uuid

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
from inventory_migration import InventoryError, SOURCE_COMMIT
from prepare_inventory import json_bytes, load_workspace, now, prepare, read_json, workspace_lock, write_atomic
from operate_inventory import (
    ApiFault, NativeApi, bind, current_attempt, dispatch, handover, inspect, read_native_receipt,
    recover, restore, wait_for_result,
)

OPERATION = "NETBOX-INVENTORY-RECEIVING-20261012-B9D2"


def require(value, message):
    if not value:
        raise InventoryError(message)


def parse_output(raw):
    decoder = json.JSONDecoder()
    text, values = raw.decode("utf-8"), []
    while text.strip():
        text = text.lstrip()
        try:
            value, end = decoder.raw_decode(text)
        except ValueError:
            text = text.split("\n", 1)[1] if "\n" in text else ""
            continue
        values.append(value)
        text = text[end:]
    if not values or not isinstance(values[-1], dict):
        raise InventoryError("The original operator returned no readable final result.")
    return values[-1]


class Journey:
    def __init__(self, root, config, fixture):
        self.root, self.config, self.fixture = root, config, fixture
        self.api = NativeApi(read_json(config))
        require(self.api.base == fixture["netbox_url"], "The original fixture and API select different NetBox servers.")
        self.steps = root / "steps"
        self.steps.mkdir(mode=0o700, exist_ok=True)
        self.first = root / "edition-001"
        self.second = root / "edition-002"

    def stage(self, name, action):
        path = self.steps / (name + ".json")
        if path.exists():
            return read_json(path)
        print(json.dumps({"operation_id": OPERATION, "stage": name, "started_at": now()}), flush=True)
        result = action()
        write_atomic(path, json_bytes(result), immutable=True)
        print(json.dumps({"operation_id": OPERATION, "stage": name, "state": result.get("state", "COMPLETE")}), flush=True)
        return result

    def operator(self, action, workspace, *extra):
        call_id = action + "-" + uuid.uuid4().hex
        log = self.root / "operator-calls" / (call_id + ".log")
        log.parent.mkdir(mode=0o700, exist_ok=True)
        argv = [sys.executable, "-B", str(SOURCE / "operate_inventory.py"), action,
                "--workspace", str(workspace)]
        if action in ("review", "apply", "recover"):
            argv.extend(("--config", str(self.config), "--wait", "120"))
        argv.extend(extra)
        with log.open("xb") as output:
            completed = subprocess.run(argv, stdout=output, stderr=subprocess.STDOUT, timeout=180)
        raw = log.read_bytes()
        result = parse_output(raw)
        result["operator_exit_code"] = completed.returncode
        result["operator_log"] = str(log.relative_to(self.root))
        return result

    def devices(self):
        rows, pages = self.api.pages("/api/dcim/devices/?" + urlencode(
            {"tenant_id": self.fixture["tenant_id"], "limit": 100}))
        return {"ids": sorted(row["id"] for row in rows), "records": rows, "pages": pages}

    def actual_baseline(self):
        devices = self.devices()
        require(devices["ids"] == self.fixture["baseline_device_ids"], "The native receiving tenant has unexpected initial devices.")
        for name, identity in (("parent", self.fixture["parent_id"]), ("child", self.fixture["child_id"])):
            obj = next(row for row in devices["records"] if row["id"] == identity)
            for field in ("site", "rack", "location"):
                require(obj[field]["id"] == self.fixture["baseline"][field + "_id"],
                        "The actual original " + name + " is outside its retained baseline.")
        return {"state": "CAPTURED", "devices": devices}

    def assert_rollback(self):
        baseline = read_json(self.steps / "01-baseline.json")
        actual = self.devices()
        require(actual["ids"] == baseline["devices"]["ids"], "The native dry-run left a created device.")
        for identity in (self.fixture["parent_id"], self.fixture["child_id"]):
            obj = next(row for row in actual["records"] if row["id"] == identity)
            for field in ("site", "rack", "location"):
                require(obj[field]["id"] == self.fixture["baseline"][field + "_id"],
                        "The native dry-run retained a moved parent or child.")
        _, manifest, _, _ = load_workspace(self.first)
        receipt, source = read_native_receipt(self.api, manifest)
        require(receipt is None, "The rolled-back review produced an applied journal receipt.")
        ips, pages = self.api.pages("/api/ipam/ip-addresses/?" + urlencode(
            {"tenant_id": self.fixture["tenant_id"], "vrf_id": self.fixture["vrf_id"], "limit": 100}))
        require(not ips, "The native dry-run retained an IP assignment.")
        return {"state": "ROLLED_BACK", "devices": actual, "ip_pages": pages, "journal": source}

    def review(self, refresh=False):
        directory, request = current_attempt(self.first)
        previous = read_json(self.first / "review.json") if (self.first / "review.json").exists() else None
        prior_stage = self.steps / "02-review.json"
        already_refreshed = (refresh and previous and request and request["phase"] == "REVIEW"
                             and read_json(directory / "state.json").get("state") == "REVIEWED"
                             and prior_stage.exists()
                             and previous["review_digest"] != read_json(prior_stage)["review_digest"])
        result = inspect(self.first) if already_refreshed else self.operator(
            "review", self.first, *(("--refresh",) if refresh else ()))
        require(result.get("state") == "REVIEWED", "The original native review is still pending or needs its recorded correction.")
        review = read_json(self.first / "review.json")
        require(review["netbox_version"] == "4.7.2", "The actual ScriptJob ran another NetBox version.")
        generated = review["generated_components"]
        require(len(generated) == 1 and generated[0]["device_key"] == "new-switch",
                "The native new-device component projection is missing.")
        components = generated[0]["components"]
        require(any(row["family"] == "modulebays" and
                    row["many_to_many"].get("module_bay_types") for row in components),
                "The original generated module bay types are missing.")
        inventory = [row for row in components if row["family"] == "inventoryitems"]
        require(len(inventory) == 2 and any(row["fields"].get("parent") for row in inventory),
                "The original InventoryItem hierarchy is missing.")
        require(any(row["fields"].get("component") for row in inventory),
                "The original generated InventoryItem component reference is missing.")
        require(all("path" not in row["fields"] and "component_id" not in row["fields"] for row in components),
                "A generated database identity leaked into the reviewed logical projection.")
        expected = "revised-native-default" if refresh else "original-native-default"
        require(any(row["fields"].get("custom_field_data", {}).get(self.fixture["custom_field_name"]) == expected
                    for row in components), "The actual native component default is absent.")
        return {"state": "REVIEWED", "review_digest": review["review_digest"],
                "counts": review["counts"], "generated": generated, "operator": result}

    def drift_default(self):
        path = "/api/extras/custom-fields/" + str(self.fixture["custom_field_id"]) + "/"
        original, _ = self.api.request(path)
        wanted = "revised-native-default"
        if original.get("default") != wanted:
            request = {"default": wanted}
            write_atomic(self.root / "default-change-request.json", json_bytes(request), immutable=True)
            changed, meta = self.api.request(path, method="PATCH", body=json_bytes(request), content_type="application/json")
            write_atomic(self.root / "default-change-response.json", json_bytes({"result": changed, "meta": meta}), immutable=True)
        actual, meta = self.api.request(path)
        require(actual.get("default") == wanted, "The actual native custom-field default did not change.")
        return {"state": "CHANGED", "custom_field_id": actual["id"], "default": actual["default"], "meta": meta}

    def stale_apply(self):
        review = read_json(self.steps / "02-review.json")
        directory, request = current_attempt(self.first)
        retained = (read_json(directory / "result.json") if directory and (directory / "result.json").exists() else None)
        same_failed = (request and request["phase"] == "APPLY" and request["review_digest"] == review["review_digest"]
                       and retained and retained.get("state") == "CORRECTION_REQUIRED")
        result = retained if same_failed else self.operator("apply", self.first, "--review-digest", review["review_digest"])
        require(result.get("state") == "CORRECTION_REQUIRED",
                "The native changed-default apply must retain its original correction instead of committing.")
        return {"state": "CORRECTION_REQUIRED", "operator": result}

    def lost_reply_apply(self):
        root = self.root
        class LostReplyApi(NativeApi):
            def request(self, value, *, method="GET", body=None, content_type=None):
                response, meta = super().request(value, method=method, body=body, content_type=content_type)
                if method == "POST" and "/api/extras/scripts/" in value:
                    candidate = response.get("result", {}) if isinstance(response, dict) else {}
                    write_atomic(root / "actual-response-discarded.json", json_bytes({
                        "operation_id": OPERATION, "received_at": now(), "provider_meta": meta,
                        "candidate_job_id": candidate.get("id") if isinstance(candidate, dict) else None,
                        "fault": "Discarded the returned response after the actual native HTTP submission"}), immutable=True)
                    raise ApiFault("Receiving fault: actual successful HTTP response discarded.", status=0)
                return response, meta
        api = LostReplyApi(read_json(self.config))
        with workspace_lock(self.first) as directory:
            _, manifest, _, packet = load_workspace(directory)
            bind(directory, api, manifest)
            applied, _ = read_native_receipt(api, manifest)
            if applied:
                result = recover(directory, api, manifest)
            else:
                _, previous = current_attempt(directory)
                if previous and previous["phase"] == "APPLY":
                    result = wait_for_result(directory, api, manifest, 120)
                else:
                    review = read_json(directory / "review.json")
                    result = dispatch(directory, api, manifest, packet, "APPLY", review["review_digest"], 120)
        require(result.get("state") == "APPLIED", "The original lost-response apply remains available for same-request recovery.")
        attempt_dir, attempt = current_attempt(self.first)
        require(attempt and attempt["phase"] == "APPLY"
                and attempt["operation_id"] == result["operation_id"]
                and attempt["review_digest"] == result["review_digest"],
                "The recovered native apply must retain its exact reviewed original attempt.")
        marker = self.root / "actual-response-discarded.json"
        discarded = read_json(marker) if marker.exists() else None
        if discarded:
            require(discarded.get("operation_id") == OPERATION,
                    "The retained response-discard receipt belongs to another receiving operation.")
        original_job = (read_json(attempt_dir / "job.json")
                        if (attempt_dir / "job.json").exists() else None)
        transport = {
            "outcome": ("ACTUAL_RESPONSE_DISCARDED" if discarded
                        else "ORIGINAL_APPLY_RECOVERED_WITHOUT_DISCARD_RECEIPT"),
            "response_discard_receipt": discarded,
            "execution_reference": attempt["execution_reference"],
            "attempt": str(attempt_dir.relative_to(self.first)),
            "native_job_id": original_job.get("id") if original_job else None,
            "journal": result["journal"],
            "detail": ("The returned native HTTP response was deliberately discarded."
                       if discarded else
                       "The original applied transaction was recovered before a response-discard receipt was retained.")
        }
        return {"state": "APPLIED", "journal": result["journal"], "receipt_sha256": result["receipt_sha256"],
                "review_digest": result["review_digest"], "resolved": result["resolved"],
                "counts": result["counts"], "transport_recovery": transport}

    def verify_applied(self):
        actual = self.devices()
        baseline = self.fixture["baseline_device_ids"]
        require(len(actual["ids"]) == len(baseline) + 1 and set(baseline).issubset(actual["ids"]),
                "The reviewed native apply must create exactly its one original new device.")
        for identity in (self.fixture["parent_id"], self.fixture["child_id"]):
            obj = next(row for row in actual["records"] if row["id"] == identity)
            for field in ("site", "rack", "location"):
                require(obj[field]["id"] == self.fixture["target"][field + "_id"],
                        "The actual original parent/child move differs from the review.")
        applied = read_json(self.first / "applied.json")
        new_id = next(row["id"] for row in applied["resolved"] if row["kind"] == "devices" and row["key"] == "new-switch")
        new = next(row for row in actual["records"] if row["id"] == new_id)
        require(new.get("primary_ip4") and new.get("primary_ip6"), "Both original primary IP assignments must exist.")
        _, manifest, _, _ = load_workspace(self.first)
        receipt, source = read_native_receipt(self.api, manifest)
        require(receipt["receipt_sha256"] == applied["receipt_sha256"] and source["matching_entries"] == 1,
                "The actual original transaction must have one stable journal receipt.")
        attempts_before = sorted(path.name for path in (self.first / "attempts").iterdir() if path.is_dir())
        recovered = self.operator("recover", self.first)
        attempts_after = sorted(path.name for path in (self.first / "attempts").iterdir() if path.is_dir())
        require(recovered.get("state") == "APPLIED" and attempts_after == attempts_before,
                "Same-operation recovery created another native submission.")
        return {"state": "APPLIED", "devices": actual, "journal": source,
                "receipt_sha256": receipt["receipt_sha256"], "same_attempts": attempts_after}

    def corrected_input(self):
        applied = read_json(self.first / "applied.json")
        ids = {(row["kind"], row["key"]): row["id"] for row in applied["resolved"]}
        source = self.root / "input"
        target = self.root / "corrected-input"
        target.mkdir(mode=0o700, exist_ok=True)
        mapping = read_json(source / "mapping.json")
        mapping["source_notes"] += " Corrected edition retains every original resolved object ID."
        for definition in mapping["sources"]:
            path = source / definition["file"]
            records = list(csv.DictReader(path.read_text(encoding="utf-8").splitlines(keepends=True)))
            for row in records:
                row["match_id"] = str(ids[(definition["kind"], row["source_key"])])
                if definition["kind"] == "devices" and row["source_key"] == "new-switch":
                    row["description"] = "Corrected original source edition"
            content = io.StringIO(newline="")
            writer = csv.DictWriter(content, fieldnames=list(records[0]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(records)
            write_atomic(target / definition["file"], content.getvalue().encode("utf-8"), immutable=True)
        write_atomic(target / "mapping.json", json_bytes(mapping), immutable=True)
        result = prepare(target / "mapping.json", self.second, OPERATION + "-edition2")
        require(result["state"] == "PREPARED", "The corrected original CSV edition needs its recorded corrections.")
        return result

    def corrected_apply(self):
        result = self.operator("review", self.second)
        require(result.get("state") in ("REVIEWED", "APPLIED"), "The corrected original review remains pending.")
        if result["state"] != "APPLIED":
            review = read_json(self.second / "review.json")
            result = self.operator("apply", self.second, "--review-digest", review["review_digest"])
        require(result.get("state") == "APPLIED", "The corrected original apply remains pending.")
        first, second = read_json(self.first / "applied.json"), read_json(self.second / "applied.json")
        keys = lambda receipt: {(row["kind"], row["key"]): row["id"] for row in receipt["resolved"]}
        require(keys(first) == keys(second), "The corrected original feed created replacement objects.")
        require(second["counts"]["CREATE"] == 0, "The corrected native source edition unexpectedly created an object.")
        return {"state": "APPLIED", "journal": second["journal"], "receipt_sha256": second["receipt_sha256"],
                "resolved": second["resolved"], "counts": second["counts"]}

    def deliver(self):
        with workspace_lock(self.second) as directory:
            saved = directory / "delivery.json"
            delivery = read_json(saved) if saved.exists() else handover(directory)
            archive = Path(delivery["archive"])
            require(archive.is_file() and archive.stat().st_size == delivery["bytes"]
                    and hashlib.sha256(archive.read_bytes()).hexdigest() == delivery["sha256"],
                    "The retained original customer handover bytes changed.")
        reopened = restore(delivery["archive"], self.root / "customer-restored")
        expected = inspect(self.second)
        require(reopened["operation_id"] == expected["operation_id"] and
                reopened["receipt_sha256"] == expected["receipt_sha256"],
                "The restored customer workspace does not reopen the original committed edition.")
        actual = self.operator("recover", self.root / "customer-restored")
        require(actual["state"] == "APPLIED" and actual["receipt_sha256"] == expected["receipt_sha256"],
                "The restored original customer could not recover the same native journal receipt.")
        return {"state": "APPLIED", "delivery": delivery, "restored": reopened, "native_reopen": actual}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, help="Exact retained native fixture/output directory.")
    parser.add_argument("--config", help="Original private connection; defaults to directory/connection.json.")
    args = parser.parse_args()
    root = Path(args.directory).resolve()
    try:
        fixture = read_json(root / "fixture.json")
        require(fixture["operation_id"] == OPERATION, "Use the same original receiving fixture.")
        config = Path(args.config).resolve() if args.config else root / "connection.json"
        with workspace_lock(root / "receiving-lock"):
            if (root / "native-result.json").exists():
                completed = read_json(root / "native-result.json")
                require(completed["operation_id"] == OPERATION and completed["state"] == "COMPLETE",
                        "The retained receiving result belongs to another operation.")
                for name, expected in completed["source_sha256"].items():
                    require(hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() == expected,
                            "The completed native receiving source changed.")
                print(json.dumps(completed, ensure_ascii=False, indent=2), flush=True)
                return 0
            journey = Journey(root, config, fixture)
            journey.stage("01-baseline", journey.actual_baseline)
            prepared = prepare(root / "input" / "mapping.json", journey.first, OPERATION + "-edition1")
            require(prepared["state"] == "PREPARED", "The original native fixture source needs a recorded correction.")
            journey.stage("02-review", journey.review)
            journey.stage("03-native-rollback", journey.assert_rollback)
            journey.stage("04-native-default-change", journey.drift_default)
            journey.stage("05-stale-review-rollback", journey.stale_apply)
            journey.stage("06-stale-apply-rollback", journey.assert_rollback)
            refreshed = journey.stage("07-refreshed-review", lambda: journey.review(True))
            require(refreshed["review_digest"] != read_json(journey.steps / "02-review.json")["review_digest"],
                    "The actual changed component default did not change its native review identity.")
            lost_reply = journey.stage("08-apply-lost-reply", journey.lost_reply_apply)
            journey.stage("09-native-commit-and-recovery", journey.verify_applied)
            journey.stage("10-corrected-source", journey.corrected_input)
            journey.stage("11-corrected-native-apply", journey.corrected_apply)
            delivery = journey.stage("12-customer-handover-and-native-reopen", journey.deliver)
            files = ("inventory_migration.py", "prepare_inventory.py", "operate_inventory.py", "native/native_fixture.py", "native/run_native.py")
            source_hashes = {name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() for name in files}
            result = {"schema": "tjlabs.netbox.native-receiving/v1", "operation_id": OPERATION,
                      "state": "COMPLETE", "completed_at": now(), "actual_netbox_version": fixture["actual_netbox_version"],
                      "contract_source_commit": SOURCE_COMMIT, "source_sha256": source_hashes,
                      "transport_recovery": lost_reply.get("transport_recovery"),
                      "steps": [path.name for path in sorted(journey.steps.glob("*.json"))], "customer_delivery": delivery}
            write_atomic(root / "native-result.json", json_bytes(result), immutable=True)
            print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
            return 0
    except (InventoryError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"operation_id": OPERATION, "state": "RECEIVING_CONTINUATION_REQUIRED",
                          "error": str(exc), "directory": str(root)}, indent=2), flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
