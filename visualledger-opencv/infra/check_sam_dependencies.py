"""Transform the real SAM template and check this S3/Lambda dependency regression.

No credentials, clients, stack creation or AWS requests are used. The managed
policy lookup is a fixed ARN fixture; the actual AWS SAM translator expands the
function, its role, S3 notification and Lambda invocation permission.
"""
from __future__ import annotations

import copy
from graphlib import CycleError, TopologicalSorter
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
from typing import Any

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ["AWS_EC2_METADATA_DISABLED"] = "true"


class OfflineManagedPolicies:
    def load(self) -> dict[str, str]:
        return {"AWSLambdaBasicExecutionRole":
                "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"}


def references(value: Any, names: set[str]) -> set[str]:
    if isinstance(value, list):
        return set().union(*(references(item, names) for item in value))
    if not isinstance(value, dict):
        return set()
    found: set[str] = set()
    if "Ref" in value and value["Ref"] in names:
        found.add(value["Ref"])
    if "Fn::GetAtt" in value:
        target = value["Fn::GetAtt"]
        target = target[0] if isinstance(target, list) else target.split(".", 1)[0]
        if target in names:
            found.add(target)
    if "Fn::Sub" in value:
        sub = value["Fn::Sub"]
        text, variables = (sub, {}) if isinstance(sub, str) else sub
        for token in re.findall(r"\$\{([^}]+)\}", text):
            if not token.startswith("!") and token not in variables:
                target = token.split(".", 1)[0]
                if target in names:
                    found.add(target)
        found |= references(variables, names)
    for key, item in value.items():
        if key != "Fn::Sub":
            found |= references(item, names)
    return found


def graph(template: dict[str, Any]) -> dict[str, set[str]]:
    resources = template["Resources"]
    names = set(resources)
    out: dict[str, set[str]] = {}
    for name, resource in resources.items():
        explicit = resource.get("DependsOn", [])
        if isinstance(explicit, str):
            explicit = [explicit]
        out[name] = references(resource.get("Properties", {}), names) | (set(explicit) & names)
    return out


def main() -> int:
    from samtranslator.translator.transform import transform
    from samtranslator.yaml_helper import yaml_parse

    path = Path(__file__).with_name("template.yaml")
    raw = path.read_bytes()
    fixed = yaml_parse(raw.decode("utf-8"))
    bucket_ref = {"Ref": "EvidenceBucketName"}
    bucket = fixed["Resources"]["EvidenceBucket"]["Properties"]
    worker = fixed["Resources"]["VisionWorker"]["Properties"]
    if (bucket.get("BucketName") != bucket_ref or
            worker["Policies"][0]["S3ReadPolicy"]["BucketName"] != bucket_ref):
        raise ValueError("bucket and S3 policy must share the deployment-name parameter")
    if worker["Events"]["ImageCreated"]["Properties"]["Bucket"] != {"Ref": "EvidenceBucket"}:
        raise ValueError("S3 event must still reference the actual same-template bucket")

    # Restore exactly the previous dependency pattern, not a hand-written graph.
    before = copy.deepcopy(fixed)
    before["Parameters"].pop("EvidenceBucketName")
    before["Resources"]["EvidenceBucket"]["Properties"].pop("BucketName")
    before["Resources"]["VisionWorker"]["Properties"]["Policies"][0]["S3ReadPolicy"]["BucketName"] = {"Ref": "EvidenceBucket"}
    parameters = {
        "ContainerImageUri": "000000000000.dkr.ecr.us-east-1.amazonaws.com/visualledger@sha256:" + "0" * 64,
        "RecordHmacKey": "SYNTHETIC-VALIDATION-NOT-A-SECRET-000000",
    }
    broken_graph = graph(transform(before, dict(parameters), OfflineManagedPolicies()))
    try:
        tuple(TopologicalSorter(broken_graph).static_order())
    except CycleError as exc:
        cycle = exc.args[1]
    else:
        raise ValueError("negative control failed: previous template no longer reproduces the cycle")
    parameters["EvidenceBucketName"] = "visualledger-000000000000-validation"
    fixed_graph = graph(transform(copy.deepcopy(fixed), parameters, OfflineManagedPolicies()))
    order = list(TopologicalSorter(fixed_graph).static_order())
    print(json.dumps({
        "status": "PASS",
        "check": "actual SAM transform, previous cycle reproduced, repaired graph acyclic",
        "sam_translator_version": version("aws-sam-translator"),
        "template_sha256": hashlib.sha256(raw).hexdigest(),
        "before_cycle": cycle,
        "after_graph": {name: sorted(deps) for name, deps in sorted(fixed_graph.items())},
        "after_creation_order": order,
        "managed_policy_lookup": "offline ARN fixture",
        "deployment_values": "synthetic fixtures; not deployment settings",
        "aws_deployed": False,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
