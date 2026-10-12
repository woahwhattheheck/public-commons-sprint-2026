#!/usr/bin/env python3
"""Assemble the complete source and operated private institutional receiving case."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import zipfile

SOURCE_ROOT = Path(__file__).resolve().parents[1]
PHASES = (
    "provider-registration-metadata-and-owner-review",
    "reviewed-mapping-and-eight-original-role-assignments",
    "actual-code-flow-and-original-audience-projections",
    "delegated-unit-administration-and-corrected-assignment",
    "pending-account-review-and-device-session-lifecycle",
    "overlapping-mapping-review-and-signed-response-recovery",
    "named-access-review-history-and-complete-operator-views",
    "same-service-restart-and-original-audit-retention",
    "original-encrypted-backup-and-fresh-owner-receiving",
    "receiving-registration-renewal-and-complete-final-export",
)
OPERATED_FILES = (
    "UMICH_Institutional_Receiving_Result.json", "institutional-browser-result.json",
    "original-audit-basis.json", "Institutional_Access_Review_Before_Receiving.json",
    "Institutional_Access_Complete_Review.json", "Audit_Institutional_Before_Receiving.cab",
    "Audit_Institutional_Complete_Workspace.cab", "institutional-unit-observations.png",
    "institutional-delegated-administration.png", "institutional-accounts-desktop.png",
    "institutional-accounts-mobile.png", "institutional-fresh-receiving.png",
    "institutional-reopened-delegate-mobile.png",
)
PROVIDER_SHA = "1cde024aebaf92050d35a8d20f015755ecb587bfbf79728689fec1da5f998b37"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def read(path, maximum=64 * 1024 * 1024):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Choose an original regular file: " + str(path))
    info = path.stat()
    if info.st_size > maximum:
        raise ValueError("The receiving file exceeds its declared size.")
    body = path.read_bytes()
    if len(body) != info.st_size:
        raise ValueError("The file changed while it was being read.")
    return body


def parse(body):
    def pairs(values):
        answer = {}
        for key, value in values:
            if key in answer:
                raise ValueError("A retained JSON object repeats a field.")
            answer[key] = value
        return answer
    return json.loads(body.decode(), object_pairs_hook=pairs,
                      parse_constant=lambda item: (_ for _ in ()).throw(ValueError(item)))


def file_entry(name, body):
    return {"path": name, "bytes": len(body), "sha256": sha(body)}


def saved_identities(value):
    found = []
    if isinstance(value, dict):
        if isinstance(value.get("path"), str) and isinstance(value.get("bytes"), int) and isinstance(value.get("sha256"), str):
            found.append(value)
        for item in value.values():
            found.extend(saved_identities(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(saved_identities(item))
    return found


def add(files, name, body):
    if name in files:
        raise ValueError("A receiving member was selected twice.")
    if name.startswith("/") or ".." in Path(name).parts:
        raise ValueError("Use portable relative archive paths.")
    files[name] = body


def build(args):
    root = Path(args.operation).resolve()
    result = parse(read(root / OPERATED_FILES[0]))
    browser = parse(read(root / OPERATED_FILES[1]))
    if (result.get("schema") != "commons-audit-institutional-receiving/1"
            or result.get("status") != "COMPLETE" or result.get("native_child_exit_code") != 0
            or not result.get("native_closed_at") or browser.get("status") != "COMPLETE"
            or browser.get("browser_errors")):
        raise ValueError("Receive the completed, closed original native/browser operation.")
    if any(name not in browser.get("phases", {}) for name in PHASES):
        raise ValueError("The complete original institutional workflow has remaining phases.")
    final = browser["phases"][PHASES[-1]]
    audiences = browser["phases"]["actual-code-flow-and-original-audience-projections"]["audiences"]
    if {item["role"] for item in audiences} != {
            "auditor", "unit_leadership", "executive", "it_leadership",
            "medicine_it_leadership", "board_regents", "faic", "advisory"}:
        raise ValueError("Receive all eight original role projections.")
    if result["original_audit"]["domain_sha256"] != final["original_audit"]["domain_sha256"]:
        raise ValueError("The final operated case differs from its original audit record basis.")
    source_pins = result["source"]["files"]
    for item in source_pins:
        name = item["path"]
        if name.startswith("/") or ".." in Path(name).parts:
            raise ValueError("Use the original application-relative source selection.")
        body = read(SOURCE_ROOT / name)
        if len(body) != item["bytes"] or sha(body) != item["sha256"]:
            raise ValueError("The complete operated source has changed: " + name)
    spec = importlib.util.spec_from_file_location("audit_source_release", SOURCE_ROOT / "build_release.py")
    release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release)
    source_files = release.collect_sources(SOURCE_ROOT)
    if set(source_files) != {item["path"] for item in source_pins}:
        raise ValueError("The operated source and complete enumerated release must select the same files.")
    source_manifest = release.make_manifest(source_files, args.source_reference)
    source_zip = release.archive_bytes(source_files, source_manifest)
    release.inspect_release(source_zip)
    files = {}
    add(files, "Source/Audit_Institutional_Application_Source.zip", source_zip)
    add(files, "Source/SOURCE_MANIFEST.json", encoded(source_manifest) + b"\n")
    claims = saved_identities(result) + saved_identities(browser)
    by_name = {}
    for item in claims:
        by_name.setdefault(Path(item["path"]).name, []).append(item)
    for name in OPERATED_FILES:
        body = read(root / name)
        if name not in {"UMICH_Institutional_Receiving_Result.json", "institutional-browser-result.json", "original-audit-basis.json"}:
            candidates = by_name.get(name, [])
            if not any(item["bytes"] == len(body) and item["sha256"] == sha(body) for item in candidates):
                raise ValueError("The operated file lacks its matching original result identity: " + name)
        add(files, "Operated/" + name, body)
    if sha(files["Operated/institutional-browser-result.json"]) != result["browser_result"]["sha256"]:
        raise ValueError("The browser result differs from the native owner's completion.")
    final_review = parse(files["Operated/Institutional_Access_Complete_Review.json"])
    if (final_review.get("schema") != "commons-audit-institutional-access-review/1"
            or len(final_review["state"]["accounts"]) != final["accounts"]
            or final_review["workspace_id"] != result["original_audit"]["workspace_id"]):
        raise ValueError("The complete review belongs to another saved workspace.")
    provider = read(Path(args.provider_file).resolve(), 1024 * 1024)
    if sha(provider) != PROVIDER_SHA or result["provider_source"]["sha256"] != PROVIDER_SHA:
        raise ValueError("Use the original maintained HTTPS provider source.")
    add(files, "Native/maintained_https_provider.py", provider)
    original = read(root / "Original_Completed_Audit_Backup.cab")
    if (sha(original) != result["original_backup"]["sha256"]
            or len(original) != result["original_backup"]["bytes"]):
        raise ValueError("The original audit input backup changed.")
    add(files, "Original_Case/Original_Completed_Audit_Backup.cab", original)
    private = parse(read(root / "private-receiving-state.json", 65536))
    phrase = private["backup_passphrase"]
    if not isinstance(phrase, str) or len(phrase) < 12:
        raise ValueError("The operated receiving key is unavailable.")
    source_phrase = read(root / "private-original-case-recovery-key.txt", 4096).decode().rstrip("\r\n")
    if len(source_phrase) < 12:
        raise ValueError("The original case receiving key is unavailable.")
    add(files, "Private_Receiving/Operated_Case_Recovery_Key.txt", (phrase + "\n").encode())
    add(files, "Private_Receiving/Original_Case_Recovery_Key.txt", (source_phrase + "\n").encode())
    add(files, "Guides/INSTITUTIONAL_ACCESS.md", read(SOURCE_ROOT / "INSTITUTIONAL_ACCESS.md"))
    add(files, "Guides/README.md", read(SOURCE_ROOT / "README.md"))
    guide = (
        "# Audit institutional access: complete operated workspace\n\n"
        "This internal receiving package contains the complete audit application, its original completed practice case, "
        "the operated institutional extension, and the private recovery keys for those practice archives.\n\n"
        "## Open the final case\n\n"
        "Extract Source/Audit_Institutional_Application_Source.zip into a source directory. "
        "Use the declared Python dependencies and follow Guides/INSTITUTIONAL_ACCESS.md. "
        "Restore Operated/Audit_Institutional_Complete_Workspace.cab into a new private directory using "
        "Private_Receiving/Operated_Case_Recovery_Key.txt with the original run.py restore --passphrase-file option. "
        "Open the receiving workspace with its newly generated operator.key, configure its actual HTTPS registration, "
        "then review and reactivate the retained provider and delegated administration.\n\n"
        "The final case preserves the original " + str(result["original_audit"]["domain_records"]) + " audit records, "
        + str(result["original_audit"]["domain_revisions"]) + " audit revisions, and original source bytes. "
        "It contains " + str(final["accounts"]) + " operated institutional accounts and the original eight audience roles. "
        "Both saved access reviews and their exact configuration editions are available in the application.\n\n"
        "## Reproduce the connected receiving operation\n\n"
        "The application source includes examples/INSTITUTIONAL_RECEIVING.py and .mjs. "
        "Use Original_Case/Original_Completed_Audit_Backup.cab, its corresponding private key, "
        "Source/SOURCE_MANIFEST.json, Native/maintained_https_provider.py, and the receiving environment's installed "
        "Node/Playwright/Chromium and Python dependencies with the full command in the guide. "
        "The source is verified before the original case is restored. Reuse the same operation directory after an interruption.\n\n"
        "## Inspect the delivered work\n\n"
        "Operated/UMICH_Institutional_Receiving_Result.json is the native owner's closed result; "
        "institutional-browser-result.json identifies each completed phase and source edition. "
        "The two access-review JSON exports contain the actual saved identities, mappings, reviews, and retained editions. "
        "The screenshots show the actual desktop, unit, delegated, mobile, and fresh receiving workflows. "
        "DELIVERY_MANIFEST.json identifies every complete archive member by bytes and SHA-256.\n\n"
        "Source reference: " + args.source_reference + "\n"
        "Original audit workspace: " + result["original_audit"]["workspace_id"] + "\n"
        "Original complete input backup SHA-256: " + result["original_backup"]["sha256"] + "\n"
        "Final operated backup SHA-256: " + final["complete_backup"]["sha256"] + "\n"
    ).encode()
    add(files, "READ_ME.md", guide)
    manifest = {
        "schema": "commons-audit-institutional-complete-delivery/1",
        "source_reference": args.source_reference,
        "operation_id": result["operation_id"], "workspace_id": result["original_audit"]["workspace_id"],
        "native_result_sha256": sha(files["Operated/UMICH_Institutional_Receiving_Result.json"]),
        "source_manifest_sha256": sha(files["Source/SOURCE_MANIFEST.json"]),
        "files": [file_entry(name, body) for name, body in sorted(files.items())],
    }
    add(files, "DELIVERY_MANIFEST.json", encoded(manifest) + b"\n")
    output = Path(args.output).resolve()
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if output.exists():
        raise ValueError("Choose a new delivery archive path.")
    fd, temporary = tempfile.mkstemp(prefix=".institutional-delivery-", dir=output.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name, body in sorted(files.items()):
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = 0o100600 << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, body)
            stream.flush()
            os.fsync(stream.fileno())
        with zipfile.ZipFile(temporary) as archive:
            if archive.namelist() != sorted(files):
                raise ValueError("The archive changed its selected member set.")
            for name, body in files.items():
                if archive.read(name) != body:
                    raise ValueError("A complete receiving member failed readback.")
        os.link(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    result_body = read(output)
    return {"path": str(output), "bytes": len(result_body), "sha256": sha(result_body),
            "members": len(files), "source_files": len(source_files), "accounts": final["accounts"],
            "domain_records": result["original_audit"]["domain_records"],
            "domain_revisions": result["original_audit"]["domain_revisions"], "complete_readback": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--source-reference", required=True)
    parser.add_argument("--provider-file", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(build(args), indent=2))


if __name__ == "__main__":
    main()
