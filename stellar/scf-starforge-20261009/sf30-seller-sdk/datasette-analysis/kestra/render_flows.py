#!/usr/bin/env python3
"""Render the complete native Kestra flows for one selected installation.

The checked-in .yaml files use JSON syntax, which is valid YAML. Rendering uses
the standard library and preserves Kestra's original task and property schema.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


ROLES = ("process", "recover", "consume", "realtime", "receive_result", "acknowledge")
JMS_TYPES = {"io.kestra.plugin.jms.Consume", "io.kestra.plugin.jms.Produce",
             "io.kestra.plugin.jms.RealtimeTrigger"}
ROOT = Path(__file__).resolve().parent


def load(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def path(value: Any, name: str) -> str:
    if not isinstance(value, str) or not Path(value).is_absolute() or "\x00" in value:
        raise ValueError(name + " must be an installed absolute path")
    return value


def destination(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("destinationName"), str):
        raise ValueError(name + " needs the original destinationName")
    if not value["destinationName"] or "{{" in value["destinationName"]:
        raise ValueError(name + " must select a concrete installed destination")
    if value.get("destinationType") not in ("QUEUE", "TOPIC"):
        raise ValueError(name + " destinationType must be the concrete QUEUE or TOPIC enum")
    selected = copy.deepcopy(value)
    if selected.get("replyTo"):
        selected.setdefault("replyToType", "QUEUE")
        if selected["replyToType"] not in ("QUEUE", "TOPIC"):
            raise ValueError(name + " replyToType must be QUEUE or TOPIC")
    return selected


def validate(config: Any) -> dict[str, Any]:
    if not isinstance(config, dict) or config.get("schema") != "stellar-forge.kestra-deployment.v1":
        raise ValueError("Select a stellar-forge.kestra-deployment.v1 installation")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]*", config.get("namespace", "")):
        raise ValueError("Select the installed Kestra namespace")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", config.get("flowIdPrefix", "")):
        raise ValueError("flowIdPrefix must contain letters, digits, underscores or hyphens")
    runtime = config.get("runtime", {})
    if runtime.get("schema") != "stellar-forge.kestra-runtime.v1":
        raise ValueError("Select the original source/workspace runtime")
    for key in ("analysisRoot", "workspace", "configuration", "receiverWorkspace"):
        path(runtime.get(key), key)
    if Path(runtime["workspace"]).resolve() == Path(runtime["receiverWorkspace"]).resolve():
        raise ValueError("Select a separate original receiver workspace")
    mode = runtime.get("correlationMode")
    if mode not in ("business-properties", "native-header"):
        raise ValueError("Choose business-properties or native-header correlation explicitly")
    runtime["resultDestination"] = destination(runtime.get("resultDestination"), "resultDestination")
    if mode == "business-properties" and runtime["resultDestination"].get("replyTo"):
        raise ValueError("JMSReplyTo requires native-header mode")
    if mode == "native-header":
        path(runtime.get("nativeHeaderJar"), "nativeHeaderJar")
    factory = config.get("connectionFactoryConfig", {})
    if factory.get("type") == "DIRECT":
        if not factory.get("connectionFactoryClass"):
            raise ValueError("Select the original DIRECT connectionFactoryClass")
    elif factory.get("type") == "JNDI":
        for key in ("jndiInitialContextFactory", "jndiProviderUrl", "jndiConnectionFactoryName"):
            if not factory.get(key):
                raise ValueError("Select the original JNDI " + key)
    else:
        raise ValueError("Select the original DIRECT or JNDI connectionFactoryConfig")
    jars = factory.get("providerJarPaths")
    if not isinstance(jars, (str, list)) or not jars:
        raise ValueError("Select explicit original provider JAR URLs for both publisher routes")
    if isinstance(jars, list) and any(not isinstance(item, str) or not item for item in jars):
        raise ValueError("Provider JAR URLs must be nonempty strings")
    properties = factory.get("connectionProperties", {})
    if not isinstance(properties, dict) or any(not isinstance(value, str) for value in properties.values()):
        raise ValueError("Original connectionProperties values must be strings")
    def require_secret_references(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if re.search(r"password|credential|secret|token", key, re.IGNORECASE) and item:
                    if not isinstance(item, str) or not re.search(r"\{\{\s*secret\s*\(", item):
                        raise ValueError("Use an ordinary Kestra secret reference for connection field " + key)
                require_secret_references(item)
        elif isinstance(value, list):
            for item in value:
                require_secret_references(item)
    require_secret_references(factory)
    intake = config.get("intake", {})
    if intake.get("mode") not in ("manual", "realtime"):
        raise ValueError("Choose manual native Consume or the original RealtimeTrigger")
    intake["destination"] = destination(intake.get("destination"), "intake.destination")
    for key in ("maxMessages", "maxWaitTimeout"):
        if type(intake.get(key)) is not int or intake[key] < 1:
            raise ValueError("Select a positive native intake " + key)
    if type(config.get("receiveTimeoutMilliseconds")) is not int or config["receiveTimeoutMilliseconds"] < 1:
        raise ValueError("Select a positive native receiving timeout in milliseconds")
    return config


def connection_environment(value: Any, values: dict[str, str]) -> Any:
    """Have Kestra render each original string once, then supply JSON over stdin."""
    if isinstance(value, str):
        name = "CONAPI_JMS_" + str(len(values))
        values[name] = value
        return {"$env": name}
    if isinstance(value, list):
        return [connection_environment(item, values) for item in value]
    if isinstance(value, dict):
        return {key: connection_environment(item, values) for key, item in value.items()}
    if value is None or isinstance(value, (bool, int, float)):
        return value
    raise ValueError("Unsupported original connection configuration value")


def native_publisher(config: dict[str, Any]) -> dict[str, Any]:
    environment: dict[str, str] = {}
    shape = connection_environment(config["connectionFactoryConfig"], environment)
    environment["CONAPI_ANALYSIS_ROOT"] = "{{ vars.runtime.analysisRoot }}"
    return {
        "id": "publish_result",
        "type": "io.kestra.plugin.scripts.python.Script",
        "description": "Publish the retained result through real JMSCorrelationID/JMSReplyTo setters.",
        "taskRunner": {"type": "io.kestra.plugin.core.runner.Process"},
        "env": environment,
        "inputFiles": {
            "runtime.json": "{{ vars.runtime | toJson }}",
            "connection-shape.json": json.dumps(shape, ensure_ascii=False, separators=(",", ":")),
            "prepared.json": "{{ outputs.prepare.outputFiles['prepared.json'] }}",
            "jms-message.json": "{{ outputs.prepare.outputFiles['jms-message.json'] }}",
        },
        "outputFiles": ["producer-receipt.json"],
        "script": (
            "import os\nfrom pathlib import Path\nimport sys\n"
            "sys.path.insert(0, str(Path(os.environ['CONAPI_ANALYSIS_ROOT']) / 'kestra'))\n"
            "from flow_driver import main\n"
            "raise SystemExit(main(['publish-native', '--message=jms-message.json']))\n"
        ),
    }


def render(config: dict[str, Any], template_root: Path = ROOT / "flows") -> dict[str, dict[str, Any]]:
    config = validate(copy.deepcopy(config))
    result = {}
    for role in ROLES:
        flow = load(template_root / (role + ".yaml"))
        flow["id"] = config["flowIdPrefix"] + "_" + role
        flow["namespace"] = config["namespace"]
        flow["vars"]["runtime"] = copy.deepcopy(config["runtime"])
        for task in flow["tasks"]:
            if task.get("type") in JMS_TYPES:
                task["connectionFactoryConfig"] = copy.deepcopy(config["connectionFactoryConfig"])
            if task["id"] == "consume_requests":
                task["destination"] = {key: config["intake"]["destination"][key]
                                       for key in ("destinationName", "destinationType")}
                task["maxMessages"] = config["intake"]["maxMessages"]
                task["maxWaitTimeout"] = config["intake"]["maxWaitTimeout"]
                if config["intake"].get("messageSelector"):
                    task["messageSelector"] = config["intake"]["messageSelector"]
                else:
                    task.pop("messageSelector", None)
            if task["id"] in ("publish_result", "consume_result"):
                task["destination"] = {key: config["runtime"]["resultDestination"][key]
                                       for key in ("destinationName", "destinationType")}
            if task["id"] == "consume_result":
                task["maxWaitTimeout"] = config["receiveTimeoutMilliseconds"]
            if task.get("type") in ("io.kestra.plugin.core.flow.Subflow",
                                    "io.kestra.plugin.core.flow.ForEachItem"):
                task["namespace"] = config["namespace"]
                task["flowId"] = config["flowIdPrefix"] + "_process"
        for trigger in flow.get("triggers", []):
            trigger["connectionFactoryConfig"] = copy.deepcopy(config["connectionFactoryConfig"])
            trigger["destination"] = {key: config["intake"]["destination"][key]
                                      for key in ("destinationName", "destinationType")}
            trigger["disabled"] = config["intake"]["mode"] != "realtime"
            if config["intake"].get("messageSelector"):
                trigger["messageSelector"] = config["intake"]["messageSelector"]
            else:
                trigger.pop("messageSelector", None)
        if role in ("process", "recover") and config["runtime"]["correlationMode"] == "native-header":
            flow["tasks"] = [native_publisher(config) if task["id"] == "publish_result" else task
                             for task in flow["tasks"]]
            for task in flow["tasks"]:
                if task["id"] == "record_publication":
                    task["inputFiles"]["producer-receipt.json"] = (
                        "{{ outputs.publish_result.outputFiles['producer-receipt.json'] }}")
        result[role] = flow
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--deployment", help="Selected installation JSON with ordinary secret references")
    selection.add_argument("--receive-delivery", help="Complete original flow-delivery.json to receive unchanged")
    parser.add_argument("--output", required=True, help="Directory for complete native flow YAML")
    args = parser.parse_args(argv)
    try:
        if args.receive_delivery:
            original = load(args.receive_delivery)
            if original.get("schema") != "stellar-forge.kestra-flow-delivery.v1":
                raise ValueError("Select the original complete flow delivery")
            config = validate(original["deployment"])
            flows = {}
            for item in original["flows"]:
                role, flow = item["role"], item["definition"]
                if role not in ROLES or role in flows:
                    raise ValueError("Original flow delivery repeats or changes a role")
                if flow.get("id") != config["flowIdPrefix"] + "_" + role or flow.get("namespace") != config["namespace"]:
                    raise ValueError("Original flow identity differs from its selected installation")
                content = json.dumps(flow, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
                if hashlib.sha256(content.encode("utf-8")).hexdigest() != item["sha256"]:
                    raise ValueError("Original flow differs from its declared SHA-256")
                flows[role] = flow
            if set(flows) != set(ROLES):
                raise ValueError("Receive all six original flow roles")
        else:
            config = validate(load(args.deployment))
            flows = render(config)
        target = Path(args.output).resolve()
        if target == (ROOT / "flows").resolve():
            raise ValueError("Choose an installation output directory separate from the editable source templates")
        target.mkdir(parents=True, exist_ok=True)
        for role, flow in flows.items():
            destination_path = target / (flow["id"] + ".yaml")
            temporary = destination_path.with_suffix(".yaml.tmp")
            temporary.write_text(json.dumps(flow, ensure_ascii=False, allow_nan=False, indent=2) + "\n",
                                 encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(destination_path)
        manifest = {
            "schema": "stellar-forge.kestra-flow-delivery.v1",
            "namespace": config["namespace"],
            "flowIdPrefix": config["flowIdPrefix"],
            "correlationMode": config["runtime"]["correlationMode"],
            "intakeMode": config["intake"]["mode"],
            "sourceVersions": {"kestra": "1.3.39", "plugin-jms": "1.4.11",
                               "plugin-script-python": "1.14.0", "jms-adapter": "1.0.2"},
            "deployment": config,
            "flows": [{"role": role, "id": flow["id"], "file": flow["id"] + ".yaml",
                       "sha256": hashlib.sha256((json.dumps(flow, ensure_ascii=False, allow_nan=False,
                                                          indent=2) + "\n").encode("utf-8")).hexdigest(),
                       "definition": flow}
                      for role, flow in flows.items()],
        }
        manifest_path = target / "flow-delivery.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        manifest_path.chmod(0o600)
        print(json.dumps({"schema": manifest["schema"], "namespace": manifest["namespace"],
                          "correlationMode": manifest["correlationMode"],
                          "flows": len(flows), "delivery": str(manifest_path)}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"error": "KESTRA_DEPLOYMENT", "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
