#!/usr/bin/env python3
"""One native NDJSON source, original managed release and receiving operation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--checkout", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--terms", required=True, help="Original selected publicOrigin/payment JSON")
parser.add_argument("--root-driver", required=True)
parser.add_argument("--node", default="node")
parser.add_argument("--session-first")
parser.add_argument("--session-next")
args = parser.parse_args()
root = Path(args.checkout).resolve(strict=True)
out = Path(args.output).absolute()
out.mkdir(mode=0o700)
sdk = root / "stellar/scf-starforge-20261009/sf30-seller-sdk"
sys.path.insert(0, str(sdk / "ndjson"))
from application import Workspace, load_json
sys.path.insert(0, str(sdk / "ndjson/consumer"))
from receive import restore_release, receive_acquisition, receive_delivery, _buyer

os.environ["SF30_XML_NODE"] = args.node
terms = load_json(Path(args.terms).read_bytes())
query = {"where_id": "9007199254740993"}
versions = out / "versions"
assert not versions.exists()
reviews = []
preparations = []

def original(command):
    run = subprocess.run(command, capture_output=True, text=True, check=False)
    if run.returncode:
        raise RuntimeError(json.dumps({"command": command, "returncode": run.returncode,
                                       "stderr": run.stderr[-8000:], "stdout": run.stdout[-4000:]}))
    return json.loads(run.stdout)

with Workspace(out / "source-workspace", create=True) as workspace:
    plan = workspace.save_plan(load_json((sdk / "ndjson/examples/inventory-mapping.json").read_bytes()))
    for index, name in enumerate(("inventory-first.ndjson", "inventory-next.ndjson")):
        with (sdk / "ndjson/examples" / name).open("rb") as stream:
            source = workspace.add_source(stream, name, name)
        review = workspace.build(source["id"], plan["id"])
        reviews.append(review)
        merchant = out / ("merchant-first" if index == 0 else "merchant-next")
        workspace.prepare_merchant(review["id"], terms["payment"], terms["publicOrigin"],
                                   terms.get("path", "/inventory"), merchant)
        release = out / ("release-first" if index == 0 else "release-next")
        preparations.append(original([args.node, str(sdk / "ndjson/merchant.mjs"), "release-package",
                                      "--prepared", str(merchant), "--dataset-directory", str(versions),
                                      "--out", str(release)]))
        assert preparations[-1]["build"] == review["id"]
        assert preparations[-1]["snapshot"] == review["native"]["snapshot"]
        assert len(preparations[-1]["sourceFiles"]) == 10
        workspace.export_packet(review["id"], out / ("original-first.zip" if index == 0 else "original-next.zip"))
    comparison = workspace.compare(reviews[0]["id"], reviews[1]["id"])
    assert comparison["counts"] == {"added": 1, "removed": 1, "changed": 1, "unchanged": 1}
assert not versions.exists(), "Static release preparation must not initialize the version store"
reopened = original([args.node, str(sdk / "ndjson/merchant.mjs"), "release-package",
                     "--prepared", str(out / "merchant-first"), "--dataset-directory", str(versions),
                     "--out", str(out / "release-first")])
assert reopened["reused"] is True

lifecycle = original([args.node, str(Path(args.root_driver).resolve(strict=True)),
                      str(out / "release-first"), str(out / "release-next"), str(out / "operator")])
receiving = []
sessions = (args.session_first, args.session_next)
assert all(sessions) or not any(sessions), "Supply both original matching SF88 sessions together"
for index, suffix in enumerate(("first", "next")):
    review = reviews[index]
    kwargs = {"expected_build": review["id"], "expected_snapshot": review["native"]["snapshot"],
              "node": args.node, "query": query,
              "compare": reviews[0]["id"] if index else None,
              "project": out / ("received-" + suffix + ".zip")}
    release = out / ("release-" + suffix)
    if sessions[index]:
        buyer, checkout = _buyer(root)
        acquisition = buyer.DatasetAcquisition(checkout=checkout, session=sessions[index], node=args.node)
        result = receive_acquisition(acquisition, out / ("data-room-" + suffix), release,
                                     out / "customer-workspace", checkout=checkout, **kwargs)
    elif lifecycle.get("deliveries", {}).get(suffix):
        record = lifecycle["deliveries"][suffix]
        directory = Path(record["directory"] if isinstance(record, dict) else record)
        observed = hashlib.sha256((directory / "manifest.json").read_bytes()).hexdigest()
        expected = record.get("manifestSha256", observed) if isinstance(record, dict) else observed
        result = receive_delivery(directory, release, out / "customer-workspace",
                                  expected_delivery_sha256=expected, **kwargs)
    else:
        result = restore_release(release, out / "customer-workspace", **kwargs)
    response = result["query"]["response"]
    assert response["status"] == 200
    assert response["body"]["rows"][0]["id"] == "9007199254740993"
    assert response["body"]["rows"][0]["unitPrice"] == (
        "0.123456789012345678901" if index == 0 else "0.123456789012345678902")
    if index:
        assert result["comparison"]["counts"] == comparison["counts"]
    receiving.append(result)

restored = restore_release(out / "release-next", out / "customer-workspace",
                           expected_build=reviews[1]["id"], expected_snapshot=reviews[1]["native"]["snapshot"],
                           node=args.node, query=query, project=out / "received-next.zip")
assert restored["reused"] is True and restored["project"]["reused"] is True
with Workspace(out / "project-reopened", create=True) as workspace:
    project = workspace.import_packet(out / "received-next.zip")
    assert project["build"]["id"] == reviews[1]["id"]
    assert project["build"]["native"]["snapshot"] == reviews[1]["native"]["snapshot"]
    reply = workspace.query(project["build"]["id"], query)
    assert reply["response"]["body"]["rows"][0]["unitPrice"] == "0.123456789012345678902"
result = {"schema": "stellar-forge.ndjson-release-native-operation.v1",
          "preparation": [{"source": item["source"], "plan": item["plan"], "build": item["build"],
                           "snapshot": item["snapshot"], "sourceFiles": item["sourceFiles"],
                           "customer": item["customer"]} for item in preparations],
          "staticPreparationPreservedAbsentStore": True, "packageReopened": reopened["reused"],
          "lifecycle": lifecycle, "receiving": receiving,
          "comparison": comparison["counts"], "workspaceReopened": restored["reused"],
          "projectReopened": project["build"]["id"]}
encoded = json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
destination = out / "native-outcome.json"
with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
    stream.write(encoded)
print(encoded, end="")
