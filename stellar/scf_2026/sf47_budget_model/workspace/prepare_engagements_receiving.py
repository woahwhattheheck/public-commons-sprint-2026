"""Prepare the complete original Contributor Engagements receiving selection.

This companion performs source/file inspection and native HTTP reads only.
It starts no host and makes no planning, contributor, financial or case write.
Run the resulting original input with operations_engagements_receiving.py.
"""
from __future__ import annotations

import argparse
import ast
from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import signal
import stat
import sys

import operations_engagements_receiving as native

PREPARATION_SCHEMA = native.SCHEMA + ".preparation"
AGENT_SCHEMA = "stellar-forge.sf47-engagement-agent-receiving.v1"
AGENT_SOURCE_SCHEMA = "stellar-forge.sf47-engagement-agent-source.v1"
AGENT_RECEIVING_FILES = (
    "engagement-agent-receiving.mjs",
    "ENGAGEMENT_AGENT_RECEIVING.md",
    "engagement-agent-receiving.example.json",
    "agent-client.d.mts",
    "AGENT.md",
)
AGENT_RUNTIME_FILES = (
    "stellar-forge/mcp-merchant-operator/grant-workspace.mjs",
    "stellar-forge/mcp-merchant-operator/catalog/grant-workspace.mjs",
    "stellar-forge/mcp-merchant-operator/host-files.mjs",
    "stellar-forge/mcp-merchant-operator/retained-file-reads.mjs",
    "stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs",
)
RECEIVING_FILES = (
    "operations_engagements_receiving.py",
    "prepare_engagements_receiving.py",
    "ENGAGEMENTS.md",
    "ENGAGEMENTS_RECEIVING.md",
    "engagement-receiving-actual.example.json",
    "engagement-receiving-walkthrough.example.json",
    "engagement-walkthrough-source.example.json",
)


def pin(value, field, actual, label):
    if field in value and value[field] is not None:
        native.need(value[field] == actual, "SELECTION_CHANGED",
                    "The selected original " + label + " differs.")
    value[field] = deepcopy(actual)


def selected_file(value, *, maximum=native.MAX_BUNDLE):
    native.need(isinstance(value, dict), "FILE_SELECTION",
                "Select an original complete file by its absolute path.")
    path = native.absolute(value.get("path"))
    information, raw = native.descriptor(path, maximum=maximum, capture=True)
    for key in ("bytes", "sha256"):
        pin(value, key, information[key], "file " + key)
    value["path"] = str(path)
    return raw


def selected_host(value, override_url=None):
    native.need(isinstance(value, dict), "HOST_SELECTION",
                "Select the existing original native host and private key path.")
    workspace = native.absolute(value.get("workspaceDirectory"), directory=True)
    key = native.absolute(value.get("keyFile"))
    native.need(key.parent == workspace, "HOST_KEY",
                "Select the original access key inside the original workspace.")
    info = native.descriptor(key, maximum=16384)
    native.need(info["mode"] & 0o077 == 0, "HOST_KEY",
                "Retain the original private access-key file.")
    pin(value, "keySha256", info["sha256"], "private access-key identity")
    value["workspaceDirectory"], value["keyFile"] = str(workspace), str(key)
    return native.Host(value, override_url)


def read(host, path):
    status, _, raw = host.request("GET", path, timeout=30)
    value = native.parse(raw)
    native.need(status == 200 and isinstance(value, dict), "NATIVE_READ",
                "The original selected native read did not complete.",
                {"path": path, "status": status, "nativeError": value})
    return value


def source_manifest(root, selection_sha, repository_root=None, additional_files=()):
    """Consume the whole maintained selector under its explicit original path base."""
    root = native.absolute(root, directory=True)
    source_root, prefix = native.source_layout(root, repository_root)
    workspace = native.absolute(root / "workspace", directory=True)
    selector = workspace / "managed_launch.py"
    selector_information, raw = native.descriptor(selector, maximum=1024 * 1024, capture=True)
    tree = ast.parse(raw.decode("utf-8"), filename=str(selector))
    declarations = [node for node in tree.body if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == "BOOT_FILES" for target in node.targets)]
    inventory_information = None
    if declarations:
        native.need(len(declarations) == 1, "ORIGINAL_SELECTOR",
                    "Use the complete original managed BOOT_FILES declaration.")
        original = ast.literal_eval(declarations[0].value)
    else:
        from managed_source import manifest_selector
        def read_inventory():
            nonlocal inventory_information
            inventory_information, body = native.descriptor(workspace / "managed-source.json",
                maximum=1024 * 1024, capture=True)
            return body
        original, _inventory_raw = manifest_selector(raw, read_inventory)
    native.need(isinstance(original, (list, tuple)) and original
                and all(isinstance(value, str) for value in original)
                and len(original) == len(set(original)), "ORIGINAL_SELECTOR",
                "Retain each original selected runtime member once.")
    selected = {prefix + "workspace/managed_launch.py"}
    for name in (*original, *RECEIVING_FILES):
        native.need(name and "\\" not in name and "\0" not in name and not Path(name).is_absolute(),
                    "SOURCE_MEMBER", "The original selector must retain relative source paths.")
        path = Path(os.path.normpath(str(workspace / name)))
        native.need(path != source_root and source_root in path.parents, "SOURCE_BOUNDARY",
                    "Select the original repositoryRoot containing every maintained runtime member.",
                    {"member": name})
        relative = native.relative(path.relative_to(source_root).as_posix())
        native.absolute(path)
        selected.add(relative)
    for name in additional_files:
        selected.add(native.relative(name))
    native.need(prefix + "budget.py" in selected, "ORIGINAL_BUDGET",
                "Retain the original parent budget.py selected by the maintained host.")
    files, total = [], 0
    for name in sorted(selected):
        native.check()
        information = native.descriptor(source_root / name, maximum=native.MAX_SOURCE)
        if name == prefix + "workspace/managed_launch.py":
            native.need(all(information[key] == selector_information[key]
                            for key in ("bytes", "sha256", "mode")),
                        "ORIGINAL_SELECTOR_CHANGED",
                        "Retain the exact original selector bytes and mode used for this source selection.")
        if inventory_information is not None and name == prefix + "workspace/managed-source.json":
            native.need(all(information[key] == inventory_information[key]
                            for key in ("bytes", "sha256", "mode")),
                        "ORIGINAL_SELECTOR_CHANGED",
                        "Retain the exact manifest bytes used for this source selection.")
        total += information["bytes"]
        native.need(total <= native.MAX_SOURCE and len(files) < 8192, "SOURCE_SIZE",
                    "The complete selected runtime and receiving source exceeds its original bound.")
        files.append({"path": name, **information})
    return {"schema": native.SOURCE_SCHEMA,
            "selectionSourceSha256": selection_sha,
            "pathBase": "repository" if repository_root is not None else "product",
            "productPath": prefix[:-1] if prefix else "",
            "selector": {"path": prefix + "workspace/managed_launch.py", **selector_information,
                         "sourceFiles": list(original)},
            "receivingFiles": [prefix + "workspace/" + name for name in RECEIVING_FILES],
            "files": files}


def verify_manifest(root, selected, repository_root=None):
    _, raw = native.selected_file(selected, maximum=16 * 1024 * 1024)
    manifest = native.parse(raw)
    native.need(manifest.get("schema") == native.SOURCE_SCHEMA, "SOURCE_MANIFEST",
                "Retain the original complete prepared source selection.")
    source_root, prefix = native.source_layout(root, repository_root, manifest)
    for row in manifest["files"]:
        info = native.descriptor(source_root / native.relative(row["path"]), maximum=native.MAX_SOURCE)
        native.need(all(info[key] == row[key] for key in ("bytes", "sha256", "mode")),
                    "SOURCE_CHANGED", "The complete selected original source changed.", {"path": row["path"]})
    selector_rows = [row for row in manifest["files"] if row["path"] == prefix + "workspace/managed_launch.py"]
    native.need(len(selector_rows) == 1 and manifest.get("selector", {}).get("path") == selector_rows[0]["path"]
                and all(selector_rows[0][key] == manifest["selector"].get(key)
                        for key in ("bytes", "sha256", "mode")),
                "ORIGINAL_SELECTOR_CHANGED", "Reopen the exact original captured selector and its selected file.")
    selected_preparer = next(row for row in manifest["files"]
                             if row["path"] == prefix + "workspace/prepare_engagements_receiving.py")
    executed = native.descriptor(Path(__file__).absolute(), maximum=native.MAX_SOURCE)
    native.need(all(executed[key] == selected_preparer[key] for key in ("bytes", "sha256")),
                "EXECUTED_SOURCE_CHANGED", "Reopen preparation through its complete original source edition.")
    return manifest


def pin_agent(config, host):
    """Select the existing managed provider and the complete original Node source."""
    if "agent" not in config:
        return ()
    value = config["agent"]
    native.need(isinstance(value, dict) and set(value).issubset({
        "nodeExecutable", "nodeIdentity", "repository", "revision", "providerConfiguration",
        "workspace", "sourceManifest"}), "AGENT_SELECTION",
        "Retain one complete agent receiving selection and its existing provider.")
    native.need(config.get("repositoryRoot") is not None, "AGENT_SOURCE_ROOT",
                "Select the original repositoryRoot for the complete native and agent source.")
    source_root, prefix = native.source_layout(config["sourceDirectory"], config["repositoryRoot"])
    native.need(isinstance(value.get("repository"), str)
                and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value["repository"])
                and isinstance(value.get("revision"), str)
                and re.fullmatch(r"[a-f0-9]{40}", value["revision"]), "AGENT_SOURCE_REVISION",
                "Retain the actual original repository and full selected source commit.")
    alias = value.get("workspace")
    native.need(isinstance(alias, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", alias),
                "AGENT_WORKSPACE", "Select the existing managed workspace alias.")
    executable = native.absolute(value.get("nodeExecutable"))
    information = native.descriptor(executable, maximum=native.MAX_DELIVERY)
    native.need(information["mode"] & 0o111, "NODE_EXECUTABLE",
                "Select the actual existing regular executable used for the Node receiving phase.")
    pin(value, "nodeIdentity", information, "Node executable bytes and mode")
    value["nodeExecutable"] = str(executable)
    provider_raw = selected_file(value.get("providerConfiguration"), maximum=16 * 1024 * 1024)
    provider_file = native.absolute(value["providerConfiguration"]["path"])
    provider_information = native.descriptor(provider_file, maximum=16 * 1024 * 1024)
    native.need(provider_information["mode"] & 0o077 == 0, "PRIVATE_PROVIDER",
                "Retain the original private managed provider configuration.")
    provider = native.parse(provider_raw)
    native.need(isinstance(provider, dict)
                and provider.get("schema") == "stellar-forge.sf47-workspace-connection.v1"
                and isinstance(provider.get("workspaces"), dict)
                and isinstance(provider["workspaces"].get(alias), dict), "AGENT_PROVIDER",
                "Use the original grant workspace provider configuration and selected alias.")
    binding = provider["workspaces"][alias]
    native.need(binding.get("allowStart") is False
                and native.absolute(binding.get("directory"), directory=True) == host.workspace,
                "AGENT_NATIVE_HOST",
                "Borrow this same original managed workspace with allowStart false.")
    return tuple(AGENT_RUNTIME_FILES) + tuple(prefix + "workspace/" + name
                                             for name in AGENT_RECEIVING_FILES)


def agent_source_document(config, manifest):
    value = config["agent"]
    _, prefix = native.source_layout(config["sourceDirectory"], config["repositoryRoot"], manifest)
    return {"schema": AGENT_SOURCE_SCHEMA, "repository": value["repository"],
            "revision": value["revision"], "pathBase": "repository",
            "productPath": prefix[:-1] if prefix else "",
            "files": deepcopy(manifest["files"])}


def prepare_agent_manifest(config, manifest, output):
    if "agent" not in config:
        return
    raw = native.encoded(agent_source_document(config, manifest))
    path = output / "ENGAGEMENT_AGENT_SOURCE.json"
    native.atomic(path, raw)
    selected = {"path": str(path), "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest()}
    pin(config["agent"], "sourceManifest", selected, "complete agent source manifest")


def verify_agent_manifest(config, manifest, host):
    if "agent" not in config:
        return
    pin_agent(config, host)
    _, raw = native.selected_file(config["agent"].get("sourceManifest"),
                                  maximum=16 * 1024 * 1024)
    native.need(native.parse(raw) == agent_source_document(config, manifest),
                "AGENT_SOURCE_CHANGED",
                "Reopen the same complete original source for native and agent receiving.")


def pin_native_input(config, host):
    mode = config.get("mode")
    native.need(mode in ("ACTUAL", "WALKTHROUGH"), "MODE",
                "Select supplied original data or the explicit walkthrough course.")
    native.safe_id(config.get("operationId"), "the stable original receiving operation")
    native.need(isinstance(config.get("actor"), str) and config["actor"].strip(),
                "ACTOR", "Select the original recording operator.")
    native.need(isinstance(config.get("reviewNote"), str) and config["reviewNote"].strip(),
                "REVIEW_NOTE", "Retain a nonempty original review note.")
    native.need(isinstance(config.get("importedCaseName"), str) and config["importedCaseName"].strip(),
                "RECEIVING_NAME", "Name the distinct complete receiving case explicitly.")
    if mode == "WALKTHROUGH":
        selected = config.get("walkthrough")
        native.need(isinstance(selected, dict) and "actual" not in config,
                    "WALKTHROUGH_INPUT", "Retain only the selected original walkthrough input.")
        revision = selected.get("revision")
        native.need(isinstance(revision, int) and not isinstance(revision, bool) and revision > 0,
                    "PLAN_REVISION", "Select an existing original immutable plan revision.")
        plan_id = native.safe_id(selected.get("planId"), "the original plan ID")
        plan = read(host, "/api/plans/" + plan_id + "/revision/" + str(revision))
        native.need(plan["id"] == plan_id and plan["revision"] == revision,
                    "PLAN_SELECTION", "The original host returned another plan selection.")
        pin(selected, "planContentSha256", plan["contentSha256"], "immutable planning content")
        pin(selected, "planSourceSha256", plan["source"]["sha256"], "original planning source")
        date.fromisoformat(selected["calendarStart"])
        as_of = date.fromisoformat(selected["asOfDate"])
        confirmed = datetime.fromisoformat(selected["confirmedAt"].replace("Z", "+00:00"))
        native.need(confirmed.tzinfo is not None and confirmed.astimezone(timezone.utc).date() <= as_of,
                    "EXAMPLE_DATE", "Select the explicit fictional confirmation through the chosen as-of date.")
        source = native.parse(selected_file(selected["exampleSource"], maximum=8 * 1024 * 1024))
        native.need(source.get("schema") == native.EXAMPLE_SCHEMA and source.get("fictional") is True,
                    "EXAMPLE_SOURCE", "Use the complete explicitly fictional example source.")
    else:
        selected = config.get("actual")
        native.need(isinstance(selected, dict) and "walkthrough" not in config,
                    "ACTUAL_INPUT", "Retain only the supplied actual case and agreements.")
        identifier = native.safe_id(selected.get("caseId"), "the original case ID")
        expected = selected.get("expectedVersion")
        native.need(isinstance(expected, int) and not isinstance(expected, bool) and expected >= 1,
                    "CASE_VERSION", "Select the reviewed original case version explicitly.")
        case = read(host, "/api/operations/" + identifier)
        native.need(case["program"]["id"] == identifier and case["program"]["version"] == expected
                    and case["program"]["state"] == "OPEN", "CASE_SELECTION",
                    "The original selected case changed; review its current version before a new preparation.")
        pin(selected, "planContentSha256", case["plan"]["contentSha256"], "pinned original plan")
        pin(selected, "planSourceSha256", case["plan"]["source"]["sha256"], "pinned original plan source")
        forecast_id = native.safe_id(selected.get("baseForecastId"), "the selected original base Forecast")
        forecast = read(host, "/api/operations/" + identifier + "/forecasts/" + forecast_id)
        native.complete_hash(native.immutable_saved(forecast), "selected baseline Forecast")
        native.need(forecast["id"] == forecast_id and forecast["current"]["sourceChanged"] is False,
                    "BASELINE_SOURCE", "Use the saved original baseline for the selected current case facts.")
        pin(selected, "baseForecastSha256", forecast["sha256"], "complete original base Forecast")
        native.need(("document" in selected) != ("reviewId" in selected), "AGREEMENT_SELECTION",
                    "Select either the supplied complete agreement document or an existing original book.")
        if "document" in selected:
            document = native.parse(selected_file(selected["document"]))
            native.need(document.get("schema") == native.BOOK_SCHEMA, "AGREEMENT_DOCUMENT",
                        "Use the complete original engagement document.")
        else:
            review_id = native.safe_id(selected["reviewId"], "the original agreement review")
            book = read(host, "/api/operations/" + identifier + "/engagements/" + review_id)
            native.complete_hash(book["review"], "selected original engagement review")
            pin(selected, "reviewSha256", book["review"]["sha256"], "complete original agreement review")
        native.need(isinstance(selected.get("agreementIds"), list) and selected["agreementIds"],
                    "AGREEMENT_SELECTION", "Select the actual confirmed original agreement IDs explicitly.")
        native.need(isinstance(selected.get("portfolioSelection"), dict)
                    and isinstance(selected["portfolioSelection"].get("resourceMap"), list),
                    "RESOURCE_SELECTION", "Retain the reviewed original contributor/resource mapping.")
        if "portfolioInputs" in selected:
            native.parse(selected_file(selected["portfolioInputs"]))
    return config


def prepare(selection_file, output_directory, *, host_url=None, receiving_url=None):
    selected_path = native.absolute(selection_file)
    information, selection_raw = native.descriptor(selected_path, maximum=16 * 1024 * 1024, capture=True)
    original = native.parse(selection_raw)
    native.need(isinstance(original, dict) and original.get("schema") == native.SCHEMA,
                "INPUT_SCHEMA", "Use the complete original native receiving selection.")
    config = deepcopy(original)
    source = native.absolute(config.get("sourceDirectory"), directory=True)
    source_root, source_prefix = native.source_layout(source, config.get("repositoryRoot"))
    output = native.absolute(output_directory, directory=True, exists=False)
    native.need(native.separate(output, source_root) and native.separate(output, selected_path),
                "PATH_OVERLAP", "Keep preparation separate from its selected source and original input.")
    parent = native.absolute(output.parent, directory=True)
    native.need(stat.S_IMODE(parent.lstat().st_mode) & 0o077 == 0, "PRIVATE_DIRECTORY",
                "Select an existing owned private preparation parent.")
    host = selected_host(config.get("host"), host_url)
    agent_files = pin_agent(config, host)
    receiving_host = selected_host(config["receivingHost"], receiving_url) if "receivingHost" in config else host
    native.need("receivingHost" in config or receiving_url is None, "RECEIVING_HOST",
                "Override only a separately selected original receiving host.")
    receiving_output = native.absolute(config.get("outputDirectory"), directory=True, exists=False)
    native.need(all(native.separate(receiving_output, directory) for directory in
                    (source_root, output, host.workspace, receiving_host.workspace))
                and native.separate(output, receiving_output)
                and native.separate(output, host.workspace)
                and native.separate(output, receiving_host.workspace),
                "PATH_OVERLAP", "Keep preparation and receiving output separate from source and both native workspaces.")
    native.need(stat.S_IMODE(receiving_output.parent.lstat().st_mode) & 0o077 == 0,
                "PRIVATE_DIRECTORY", "Select an existing owned private receiving parent.")
    if "agent" in config:
        provider_path = native.absolute(config["agent"]["providerConfiguration"]["path"])
        native.need(native.separate(output, provider_path)
                    and native.separate(receiving_output, provider_path), "PATH_OVERLAP",
                    "Keep the original provider input outside preparation and receiving output.")
    native.private_directory(output)
    guard = native.Guard(output)
    original_error = None
    try:
        native.atomic(output / "selection-input.json", selection_raw)
        receipt_path = output / "PREPARED_NATIVE_RECEIVING.json"
        input_path = output / "engagement-receiving.json"
        if receipt_path.exists():
            _, receipt_raw = native.descriptor(receipt_path, capture=True)
            receipt = native.parse(receipt_raw)
            native.need(receipt.get("schema") == PREPARATION_SCHEMA and receipt.get("state") == "PREPARED"
                        and receipt.get("selectionSha256") == information["sha256"],
                        "PREPARATION_CHANGED", "Resume the original complete prepared receiving selection.")
            _, config_raw = native.selected_file(receipt["input"], maximum=16 * 1024 * 1024)
            completed = native.parse(config_raw)
            native.need(completed["host"]["keySha256"] == config["host"]["keySha256"]
                        and completed.get("receivingHost", completed["host"])["keySha256"] ==
                            config.get("receivingHost", config["host"])["keySha256"],
                        "HOST_KEY_CHANGED", "Retain the original selected native workspace keys.")
            manifest = verify_manifest(source, completed["sourceManifest"], completed.get("repositoryRoot"))
            native.need(completed.get("repositoryRoot") == config.get("repositoryRoot")
                        and ("agent" in completed) == ("agent" in config), "SOURCE_ROOT_CHANGED",
                        "Retain the same complete repository and agent phase selection.")
            if "agent" in config:
                native.need(all(completed["agent"].get(key) == value
                                for key, value in config["agent"].items()),
                            "AGENT_SELECTION_CHANGED", "Retain the original agent runtime, provider and source selection.")
                verify_agent_manifest(completed, manifest, host)
            native.selected_file(completed["preparationSource"], maximum=16 * 1024 * 1024)
            selected = completed.get("actual", completed.get("walkthrough", {}))
            for key in ("document", "portfolioInputs", "exampleSource"):
                if key in selected:
                    native.selected_file(selected[key])
            for path in (output, output.parent):
                native.sync_dir(path)
            return receipt

        manifest = source_manifest(source, information["sha256"], config.get("repositoryRoot"), agent_files)
        current_preparer = native.descriptor(Path(__file__).absolute(), maximum=native.MAX_SOURCE)
        selected_preparer = next(row for row in manifest["files"]
                                 if row["path"] == source_prefix + "workspace/prepare_engagements_receiving.py")
        native.need(all(current_preparer[key] == selected_preparer[key] for key in ("bytes", "sha256")),
                    "EXECUTED_SOURCE_CHANGED", "Execute the original preparer from the selected complete source.")
        manifest_raw = native.encoded(manifest)
        manifest_path = output / "ENGAGEMENT_SOURCE.json"
        native.atomic(manifest_path, manifest_raw)
        selected_manifest = {"path": str(manifest_path), "bytes": len(manifest_raw),
                             "sha256": hashlib.sha256(manifest_raw).hexdigest()}
        if "sourceManifest" in config:
            native.need(config["sourceManifest"] == selected_manifest, "SOURCE_MANIFEST_CHANGED",
                        "Keep the previously selected original complete source manifest.")
        config["sourceManifest"] = selected_manifest
        prepare_agent_manifest(config, manifest, output)
        verify_agent_manifest(config, manifest, host)
        config["preparationSource"] = {"path": str(output / "selection-input.json"),
                                      "bytes": information["bytes"], "sha256": information["sha256"]}
        if input_path.exists():
            # The first complete pinned input may precede its final preparation receipt.
            # Reopen that exact publication before any new native discovery read.
            _, config_raw = native.descriptor(input_path, maximum=16 * 1024 * 1024, capture=True)
            completed = native.parse(config_raw)
            native.need(completed.get("schema") == native.SCHEMA
                        and completed.get("operationId") == original["operationId"]
                        and completed.get("sourceManifest") == selected_manifest
                        and completed.get("preparationSource") == config["preparationSource"]
                        and completed.get("host") == config["host"]
                        and completed.get("receivingHost") == config.get("receivingHost")
                        and completed.get("outputDirectory") == config["outputDirectory"]
                        and completed.get("repositoryRoot") == config.get("repositoryRoot")
                        and completed.get("agent") == config.get("agent"),
                        "PREPARED_INPUT_CHANGED", "Retain the first complete original pinned receiving input.")
            config = completed
        else:
            config = pin_native_input(config, host)
            config_raw = native.encoded(config)
            native.atomic(input_path, config_raw)
        # Source and every prepared parent are durable before PREPARED is visible.
        native.sync_dir(output)
        native.sync_dir(output.parent)
        guard.assert_owned()
        receipt = {"schema": PREPARATION_SCHEMA, "state": "PREPARED",
                   "operationId": config["operationId"], "mode": config["mode"],
                   "selectionSha256": information["sha256"],
                   "sourceManifest": selected_manifest,
                   "sourceFiles": len(manifest["files"]),
                   "sourceBytes": sum(row["bytes"] for row in manifest["files"]),
                   "input": {"path": str(input_path), "bytes": len(config_raw),
                             "sha256": hashlib.sha256(config_raw).hexdigest()},
                   "nativeWrites": 0,
                   **({"agent": {"schema": AGENT_SCHEMA,
                                 "workspace": config["agent"]["workspace"],
                                 "sourceManifest": deepcopy(config["agent"]["sourceManifest"])}}
                      if "agent" in config else {})}
        native.atomic(receipt_path, native.encoded(receipt))
        native.sync_dir(output)
        return receipt
    except BaseException as error:
        original_error = error
        raise
    finally:
        try:
            guard.close()
        except BaseException as error:
            if original_error is None:
                raise
            original_error.receiving_cleanup_error = native.failure(error)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", required=True, help="Original private complete receiving selection JSON.")
    parser.add_argument("--output-directory", required=True, help="Private preparation directory under an existing owned parent.")
    parser.add_argument("--host-url", help="Current origin of the same original native host.")
    parser.add_argument("--receiving-url", help="Current origin of the separately selected receiving host.")
    args = parser.parse_args(argv)
    previous = {value: signal.signal(value, native.stopped) for value in (signal.SIGINT, signal.SIGTERM)}
    try:
        result = prepare(args.selection, args.output_directory,
                         host_url=args.host_url, receiving_url=args.receiving_url)
        sys.stdout.write(native.canonical(result) + "\n")
        sys.stdout.flush()
        return 0
    except BaseException as error:
        try:
            sys.stderr.write(native.canonical({"state": "INTERRUPTED", "error": native.failure(error)}) + "\n")
            sys.stderr.flush()
        except BaseException:
            pass
        return 130 if native.STOP is not None else 1
    finally:
        for value, handler in previous.items():
            signal.signal(value, handler)


if __name__ == "__main__":
    raise SystemExit(main())
