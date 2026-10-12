#!/usr/bin/env python3
"""MIT. Operate both complete retained SCVO funds through HTTP and cold receiving."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import threading
import time
from urllib.request import Request, urlopen

from publisher_workspace import PublisherWorkspace, PROFILE, publisher, encoded, immutable, atomic, file_info, load_json
from operator_server import OperatorServer


FUNDS = (
    ("digital-ethics-fund-2022", "Digital Ethics Fund 2022", 5,
     "50c77b94091f5c642b7da04973335dde39d2334780b2716ee57e378cdd6eaf34"),
    ("connecting-to-care-fund-2024", "Connecting to Care Fund 2024", 7,
     "9ff39c6391a1ba484e9a25ece3f08c3b20151ad443901c84098a3e1ca6d42d9d"),
)


class Console:
    def __init__(self, root):
        self.workspace = PublisherWorkspace(root, create=not Path(root).exists())
        try:
            self.server = OperatorServer(self.workspace)
            self.thread = threading.Thread(target=self.server.serve_forever, daemon=False)
            self.thread.start()
        except BaseException:
            self.workspace.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.workspace.close()

    def read(self, path, data=None, binary=False):
        headers = {"Authorization": "Bearer " + self.server.token}
        if data is not None:
            headers["Content-Type"] = "application/octet-stream" if isinstance(data, bytes) else "application/json"
            data = data if isinstance(data, bytes) else encoded(data)
        request = Request(self.server.origin + path, data=data, headers=headers)
        with urlopen(request, timeout=180) as response:
            raw = response.read()
        return raw if binary else load_json(raw)

    def upload(self, raw):
        return self.read("/api/upload", raw)["id"]

    def work(self, request_id, action, body):
        self.read("/api/requests", {"id": request_id, "action": action, "input": body})
        while True:
            request = self.read("/api/request?id=" + request_id)
            if request["status"] == "complete":
                return request["result"]
            if request["status"] == "interrupted":
                raise RuntimeError(request["error"]["message"])
            time.sleep(0.05)

    def rows(self, dataset, build):
        query, result = {"limit": "2"}, []
        while True:
            answer = self.read("/api/query", {"dataset": dataset, "build": build, "query": query})
            if answer["response"]["status"] != 200:
                raise RuntimeError(publisher.exact(answer))
            page = answer["response"]["body"]
            result.extend(page["rows"])
            cursor = page["page"]["nextCursor"]
            if cursor is None:
                if len(result) != page["page"]["total"]:
                    raise RuntimeError("The complete native page sequence differs from its original total")
                return result
            query = {**query, "cursor": cursor}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare and receive both complete retained SCVO funds")
    parser.add_argument("--out", required=True, help="One retained whole-workflow directory; reuse it to continue")
    parser.add_argument("--reviewer", required=True, help="The operator preserving the original grants for publisher review")
    args = parser.parse_args(argv)
    root = Path(args.out).expanduser().absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    reviewer = args.reviewer.strip()
    if not reviewer:
        raise ValueError("Name the original reviewing operator")
    immutable(root / "workflow-input.json", encoded({
        "schema": "stellar-forge.360giving-complete-workflow.v1", "reviewer": reviewer,
        "funds": [{"key": key, "count": count, "sourceSha256": digest} for key, _, count, digest in FUNDS]}))
    handoffs = root / "handoffs"
    handoffs.mkdir(mode=0o700, exist_ok=True)
    reviews = root / "reviews"
    reviews.mkdir(mode=0o700, exist_ok=True)
    results = []
    with Console(root / "publisher-workspace") as source:
        for key, label, expected_count, expected_sha in FUNDS:
            original = PROFILE / "examples" / (key + ".json")
            if file_info(original)["sha256"] != expected_sha:
                raise RuntimeError("The retained original SCVO source bytes changed: " + key)
            capture = load_json((PROFILE / "examples" / (key + "-capture.json")).read_bytes())
            inputs = {"dataset": key, "label": label, "sourceUrl": capture["sourceUrl"], "transport": None}
            for kind, suffix in (("source", ".json"), ("registry", "-registry.json"), ("capture", "-capture.json")):
                inputs[kind] = source.upload((PROFILE / "examples" / (key + suffix)).read_bytes())
            edition = source.work(key + "-intake", "intake", inputs)
            if edition["grantCount"] != expected_count or edition["sourceSha256"] != expected_sha:
                raise RuntimeError("The complete retained publisher edition differs: " + key)
            report = source.read("/api/review?edition=" + edition["id"])
            # Inspect the actual private review route and installed assets.
            review_html = source.read("/review.html?edition=" + edition["id"], binary=True)
            if b"__PUBLISHER_" in review_html or b"/review-bridge.js" not in review_html:
                raise RuntimeError("The installed original review page was not connected")
            for asset in ("/", "/app.js", "/style.css", "/review.js", "/review.css", "/review-bridge.js"):
                if not source.read(asset, binary=True):
                    raise RuntimeError("An installed operator asset is empty: " + asset)
            decision_file = reviews / (key + ".json")
            if not decision_file.exists():
                decisions = report["template"]
                decisions.update(reviewer=reviewer, reviewedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
                decisions["reviews"] = [{"findingId": item["id"], "status": "retain_source",
                    "notes": "Original grant values retained for publisher review."} for item in report["report"]["findings"]]
                decisions["metadataFromRegistry"] = list(report["report"]["registryMetadata"])
                decisions["changes"] = []
                immutable(decision_file, encoded(decisions))
            decision = source.work(key + "-decisions", "decisions", {
                "edition": edition["id"], "object": source.upload(decision_file.read_bytes())})
            candidate = source.work(key + "-candidate", "candidate", {
                "edition": edition["id"], "decision": decision["id"]})
            before = source.work(key + "-original-build", "build", {"edition": edition["id"], "candidate": None})
            after = source.work(key + "-candidate-build", "build", {"edition": edition["id"], "candidate": candidate["id"]})
            before_rows = source.rows(key, before["build"]["id"])
            after_rows = source.rows(key, after["build"]["id"])
            if len(before_rows) != expected_count or before_rows != after_rows:
                raise RuntimeError("Registry metadata selection changed an original grant value")
            comparison = source.work(key + "-comparison", "compare", {
                "dataset": key, "before": before["build"]["id"], "after": after["build"]["id"]})
            if comparison["comparison"]["counts"] != {"added": 0, "removed": 0, "changed": 0, "unchanged": expected_count}:
                raise RuntimeError("The original full grant comparison differs")
            selected = source.read("/api/query", {"dataset": key, "build": after["build"]["id"],
                "query": {"limit": "25", "where_grant_id": after_rows[0]["grant_id"]}})
            if selected["response"]["body"]["page"]["total"] != 1:
                raise RuntimeError("The original native keyed filter did not reopen")
            request_id = key + "-handoff"
            delivery = source.work(request_id, "export", {
                "edition": edition["id"], "decision": decision["id"], "candidate": candidate["id"]})
            raw = source.read("/api/download?request=" + request_id, binary=True)
            if hashlib.sha256(raw).hexdigest() != delivery["sha256"] or len(raw) != delivery["bytes"]:
                raise RuntimeError("The full HTTP handoff differs from its saved original delivery")
            archive = handoffs / (key + ".zip")
            immutable(archive, raw)
            results.append({"dataset": key, "sourceSha256": expected_sha, "editionId": edition["id"],
                "decisionId": decision["id"], "candidateId": candidate["id"],
                "originalBuild": before["build"]["id"], "candidateBuild": after["build"]["id"],
                "grantCount": expected_count, "comparison": comparison["comparison"],
                "handoff": {"file": str(archive), **file_info(archive)}, "rows": after_rows})
    with Console(root / "receiving-workspace") as receiver:
        for item in results:
            key = item["dataset"]
            raw = Path(item["handoff"]["file"]).read_bytes()
            received = receiver.work(key + "-receive", "receive", {"object": receiver.upload(raw)})
            if (received["editionId"] != item["editionId"]
                    or received["builds"]["original"]["id"] != item["originalBuild"]
                    or received["builds"]["candidate"]["id"] != item["candidateBuild"]
                    or receiver.rows(key, item["candidateBuild"]) != item["rows"]):
                raise RuntimeError("Independent receiving changed the original source or native grants")
            reopened = receiver.work(key + "-reopen-candidate", "candidate", {
                "edition": item["editionId"], "decision": item["decisionId"]})
            if reopened["id"] != item["candidateId"]:
                raise RuntimeError("The saved incoming candidate did not reopen with its original identity")
            item["receiving"] = received
    # Reopen both complete workspaces after their original server/Node processes close.
    for name in ("publisher-workspace", "receiving-workspace"):
        with Console(root / name) as reopened:
            if len(reopened.read("/api/state")["datasets"]) != len(FUNDS):
                raise RuntimeError("The two original fund datasets were not preserved")
            for item in results:
                if reopened.rows(item["dataset"], item["candidateBuild"]) != item["rows"]:
                    raise RuntimeError("Cold native workspace reopening changed complete grant rows")
    result = {"schema": "stellar-forge.360giving-complete-workflow.v1", "status": "complete",
        "reviewer": reviewer, "completedAt": time.time(), "funds": [
            {key: value for key, value in item.items() if key != "rows"} for item in results],
        "grants": sum(item["grantCount"] for item in results),
        "publisherWorkspace": str(root / "publisher-workspace"),
        "receivingWorkspace": str(root / "receiving-workspace")}
    atomic(root / "workflow-result.json", encoded(result))
    print(publisher.exact(result), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
