"""Receive a complete original buyer-expense project without executing archive code."""
from __future__ import annotations
import argparse
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import zipfile
from store import DDL
from credit_store import CREDIT_TABLES
from accountant_store import ACCOUNTANT_TABLES
from portable import CREDIT_READER_FILES, ACCOUNTANT_READER_FILES
from native_node import READER_FILES as NODE_READER_FILES, FEATURE as NODE_FEATURE
from domain import SCHEMA

FORMAT = "stellar-forge.buyer-expense-private-project.v1"
MAX_BYTES = 256_000_000
APP_PREFIX = "app/sf36-spend-governor/"
REQUIRED_APP = {"native.py", "domain.py", "store.py", "exports.py", "portable.py", "server.py",
                "public/index.html", "public/app.mjs", "public/style.css", "README.md", "cli.mjs"}
REQUIRED = {APP_PREFIX + "expense-workspace/" + n for n in REQUIRED_APP}
REQUIRED.update(APP_PREFIX + n for n in ("statement.py", "governor.py", "STATEMENTS.md"))
REQUIRED.update({"project/workspace.sqlite", "README.md", "prepare_private.py"})
ALLOWED = REQUIRED | {APP_PREFIX + "expense-workspace/receive.py"}
MCP_REQUIRED = {APP_PREFIX + "expense-workspace/native_mcp.py",
    "app/stellar-forge/mcp-paid-agent/expense-statement.mjs",
    "app/stellar-forge/mcp-paid-agent/quote-store.mjs",
    "app/stellar-forge/mcp-paid-agent/remote-mcp.mjs",
    "app/stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/terms.mjs",
    "app/stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/networks.json"}

GOVERNED_REQUIRED = {APP_PREFIX + "expense-workspace/" + n for n in ("native_governed_mcp.py", "GOVERNED_MCP.md")}
GOVERNED_REQUIRED.update("app/stellar-forge/mcp-paid-agent/" + n for n in
    ("expense-governed-statement.mjs", "native-spend-binding.mjs", "native-spend-configuration.mjs"))
GOVERNED_FEATURE = "original-spending-readonly-v1"

NODE_REQUIRED = {APP_PREFIX + "expense-workspace/" + n for n in ("native_node.py", "node_store.py", "NODE_OPERATIONS.md")}
NODE_REQUIRED.update("app/" + n for n in NODE_READER_FILES)

CREDIT_REQUIRED = {APP_PREFIX + "expense-workspace/" + n for n in
    ("native_woo.py", "credits.py", "credit_store.py", "credit-reader-files.json")}
ADJUSTMENT_READER_FILES = {
    "stellar/scf-starforge-20261009/merchant-settlement-accounting/buyer-expense-source.mjs",
    "stellar/scf-starforge-20261009/merchant-settlement-accounting/reconcile.mjs",
}
# Previously issued v1 projects contain the original 53-file Woo closure.
# The additive v2 reader requires both the native Python adapter and its two JS files.
# Current included modules need these original imports. Earlier v1/v2 projects
# retain their previous byte selections and may omit them while opening saved data.
OPTIONAL_CREDIT_READER_FILES = {
    "stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/merchant-erp-client.mjs",
    "stellar/scf-starforge-20261009/merchant-settlement-accounting/recovery.mjs",
    "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-location.mjs",
}
CREDIT_REQUIRED.update("app/" + n for n in CREDIT_READER_FILES
                       if n not in ADJUSTMENT_READER_FILES | OPTIONAL_CREDIT_READER_FILES)
ADJUSTMENT_REQUIRED = {APP_PREFIX + "expense-workspace/native_adjustments.py"}
ADJUSTMENT_REQUIRED.update("app/" + n for n in ADJUSTMENT_READER_FILES)
CREDIT_VERSIONS = ("original-woo-refund-v1", "original-native-refund-v2")
ACCOUNTANT_REQUIRED = {APP_PREFIX + "expense-workspace/" + n for n in ("native_accountant.py", "accountant_store.py", "accountant-reader-files.json")}
ACCOUNTANT_REQUIRED.update("app/" + n for n in ACCOUNTANT_READER_FILES)
ACCOUNTANT_FEATURE = "issued-accountant-return-v1"


def digest_file(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_bytes(path, value):
    pending = path.with_name(path.name + ".receiving-pending")
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(value)
        output.flush()
        os.fsync(output.fileno())
    os.replace(pending, path)
    sync_directory(path.parent)


def trusted_schema():
    db = sqlite3.connect(":memory:")
    try:
        db.executescript(DDL)
        return {row[0]: [(x[1], x[2], x[3], x[5]) for x in db.execute('PRAGMA table_info("' + row[0] + '")')]
                for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        db.close()



def inspect_node_sources(database, manifest):
    """Bind retained original bytes and native projections without running Node."""
    from native_node import original_bytes, project_original, FORMAT
    from domain import canonical
    sources = {row[0]: json.loads(row[1]) for row in database.execute("SELECT id,body FROM sources")
               if json.loads(row[1]).get("kind") == "node_operation"}
    retained = {}
    for source_id, source in sources.items():
        identity = source.get("identity")
        if (source.get("id") != source_id or not isinstance(identity, dict) or
                set(identity) != {"kind", "sha256"} or identity.get("kind") != "node_operation" or
                source.get("path") != "node-operation:" + str(identity.get("sha256")) or
                not source.get("immutable_intake")):
            raise ValueError("An original Node source differs from its retained identity.")
        for ident, parent, status, created, body in database.execute(
                "SELECT id,parent_id,status,created_at,body FROM captures WHERE source_id=?", (source_id,)):
            value = json.loads(body)
            snapshot = value.get("snapshot", {})
            original = original_bytes(snapshot)
            inspected = snapshot.get("inspection", {})
            carrier = json.loads(original)
            if (value.get("id") != ident or value.get("source_id") != source_id or value.get("parent_id") != parent or
                    value.get("status") != status or value.get("created_at") != created or
                    value.get("identity") != identity or value.get("path") != source["path"] or
                    snapshot.get("schema") != NODE_FEATURE or len(original) != snapshot.get("source_bytes") or
                    inspected.get("schema") != FORMAT or inspected.get("sourceSha256") != snapshot["source_sha256"] or
                    inspected.get("sourceBytes") != len(original) or inspected.get("sourceIdentitySha256") != identity["sha256"] or
                    carrier.get("schema") != "stellar-forge.node-operation-accounting-export.v1" or
                    carrier.get("intentId") != inspected.get("intentId") or carrier.get("commandId") != inspected.get("commandId") or
                    carrier.get("contextSha256") != inspected.get("contextSha256") or
                    carrier.get("result", {}).get("native") != inspected.get("native") or
                    carrier.get("authority") != inspected.get("authority") or
                    value.get("node_intake", {}).get("data_context") != source.get("data_context")):
                raise ValueError("A retained Node capture lost its exact original source/result binding.")
            projected = project_original(inspected, source["data_context"])
            if canonical(projected) != canonical(value.get("report")):
                raise ValueError("A Node source projection differs from its retained native result.")
            retained[ident] = value
        current = source.get("current_capture")
        if current is not None and (current not in retained or retained[current]["source_id"] != source_id or
                                    retained[current]["status"] != "ACCEPTED"):
            raise ValueError("An original Node source is missing its current accepted capture.")
    for ident, source_id, request_id, capture_id, body in database.execute(
            "SELECT id,source_id,request_id,capture_id,body FROM items"):
        if source_id not in sources:
            continue
        captured = retained.get(capture_id)
        if (captured is None or captured["source_id"] != source_id or captured["status"] != "ACCEPTED" or
                captured["report"]["rows"][0]["request_id"] != request_id or
                canonical(captured["report"]["rows"][0]) != canonical(json.loads(body))):
            raise ValueError("A current Node item lost its accepted original row.")
    for body, in database.execute("SELECT body FROM closes"):
        for frozen in json.loads(body).get("native_captures", []):
            if frozen.get("source_id") not in sources:
                continue
            original = retained.get(frozen.get("id"))
            if original is None or any(canonical(frozen.get(key)) != canonical(original.get(key))
                                       for key in ("source_id", "snapshot", "report", "identity")):
                raise ValueError("An issued Node source differs from its original frozen capture.")
    counts = {"node_operation_count": len(sources), "node_capture_count": len(retained)}
    if any(type(manifest.get(key)) is not int or manifest[key] != value for key, value in counts.items()):
        raise ValueError("The complete project is missing original Node source or capture history.")
    return counts


def inspect_database(path, manifest):
    database = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    try:
        database.execute("PRAGMA trusted_schema=OFF")
        if database.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("The retained native database is not complete.")
        if database.execute("SELECT name FROM sqlite_master WHERE type IN ('view','trigger')").fetchall():
            raise ValueError("The project contains objects outside the original trusted native schema.")
        tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        expected = trusted_schema()
        legacy = manifest.get("request_recovery") is None
        credit_feature = manifest.get("buyer_credit_capture")
        if credit_feature not in (None, *CREDIT_VERSIONS):
            raise ValueError("The project advertises an unsupported buyer refund source version.")
        bookkeeping = manifest.get("buyer_bookkeeping")
        if bookkeeping not in (None, ACCOUNTANT_FEATURE):
            raise ValueError("The project advertises an unsupported accountant return version.")
        missing_features = (CREDIT_TABLES if credit_feature is None else set()) | (ACCOUNTANT_TABLES if bookkeeping is None else set())
        required = set(expected) - ({"api_requests"} if legacy else set()) - missing_features
        allowed_tables = set(expected) - missing_features
        if not required <= tables <= allowed_tables:
            raise ValueError("The archive does not retain the complete supported expense schema.")
        for name in tables:
            actual = [(x[1], x[2], x[3], x[5]) for x in database.execute('PRAGMA table_info("' + name + '")')]
            if actual != expected[name]:
                raise ValueError("A native table differs from the trusted expense application schema.")
        meta = dict(database.execute("SELECT key,value FROM meta"))
        if meta.get("schema") != SCHEMA:
            raise ValueError("The original workspace schema does not match this application.")
        revision = int(meta["revision"])
        count = database.execute("SELECT COUNT(*) FROM api_requests").fetchone()[0] if "api_requests" in tables else 0
        if not legacy and (manifest.get("request_recovery") != "sqlite-transaction-v1" or manifest.get("request_count") != count):
            raise ValueError("The retained request-recovery history is incomplete.")
        if "workspace" in manifest and manifest["workspace"] != meta["id"] or "revision" in manifest and manifest["revision"] != revision:
            raise ValueError("The project manifest does not match its original native workspace revision.")
        source_kinds = sorted({json.loads(row[0]).get("kind", "sf36_ledger") for row in
                               database.execute("SELECT body FROM sources")})
        if any(kind not in ("sf36_ledger", "mcp_quote", "governed_mcp", "woo_refund", "merchant_adjustments", "node_operation") for kind in source_kinds):
            raise ValueError("The retained source kind is not supported by this original receiver.")
        node_feature = manifest.get("node_operation_capture")
        if node_feature not in (None, NODE_FEATURE) or "node_operation" in source_kinds and node_feature != NODE_FEATURE:
            raise ValueError("The original Node source requires its complete supported reader and intake history.")
        node_counts = inspect_node_sources(database, manifest) if node_feature else {"node_operation_count": 0, "node_capture_count": 0}
        if "governed_mcp" in source_kinds and manifest.get("governed_mcp_capture") != GOVERNED_FEATURE:
            raise ValueError("The governed MCP source requires its original binding and spending readers.")
        if any(kind in source_kinds for kind in ("mcp_quote", "governed_mcp")) and manifest.get("mcp_quote_capture") != "native-readonly-v1":
            raise ValueError("The complete MCP expense source requires its original included reader.")
        if manifest.get("mcp_quote_capture") is not None and manifest.get("source_kinds") != source_kinds:
            raise ValueError("The original source kinds do not match the complete project manifest.")
        if "woo_refund" in source_kinds and credit_feature not in CREDIT_VERSIONS:
            raise ValueError("The original buyer credit source requires its complete included receiver.")
        if "merchant_adjustments" in source_kinds and credit_feature != "original-native-refund-v2":
            raise ValueError("The original accounting source requires its complete native adjustment reader.")
        credit_count = database.execute("SELECT COUNT(*) FROM credits").fetchone()[0] if "credits" in tables else 0
        packet_count = database.execute("SELECT COUNT(*) FROM refund_packets").fetchone()[0] if "refund_packets" in tables else 0
        context = meta.get("data_context", "operational" if source_kinds else "")
        if credit_feature and (manifest.get("credit_count") != credit_count or manifest.get("refund_packet_count") != packet_count or
                               manifest.get("data_context") != context or context not in ("", "operational", "development")):
            raise ValueError("The complete buyer credits, original packets or operation context do not match their native state.")
        accountant_count = 0
        if bookkeeping:
            from domain import canonical
            accountant_count = database.execute("SELECT COUNT(*) FROM accountant_returns").fetchone()[0]
            if manifest.get("accountant_return_count") != accountant_count:
                raise ValueError("The complete project is missing its original accountant return history.")
            retained = {}
            for ident,close_id,handoff_id,body,packet in database.execute("SELECT id,close_id,handoff_id,body,packet_base64 FROM accountant_returns"):
                value = json.loads(body)
                original = database.execute("SELECT body FROM closes WHERE id=?", (close_id,)).fetchone()
                if not original or value["id"] != ident or value["close_id"] != close_id or value["handoff_id"] != handoff_id:
                    raise ValueError("A bookkeeping return differs from its native issued identity.")
                source = (canonical({"schema":"stellar-forge.buyer-accountant-source.v1","workspaceId":meta["id"],"issued":json.loads(original[0])})+"\n").encode()
                if hashlib.sha256(source).hexdigest() != value["source_sha256"] or hashlib.sha256(base64.b64decode(packet,validate=True)).hexdigest() != value["packet_sha256"]:
                    raise ValueError("An original returned packet or its issued source changed.")
                retained[ident] = handoff_id
            for handoff_id,return_id in database.execute("SELECT handoff_id,return_id FROM accountant_heads"):
                if retained.get(return_id) != handoff_id:
                    raise ValueError("A current bookkeeping head is missing its exact accepted return.")
        return {"workspace": meta["id"], "revision": revision, "successful_requests": count,
                "accountant_return_count": accountant_count,
                "credit_count": credit_count, "refund_packet_count": packet_count, "data_context": context,
                "source_kinds": source_kinds, **node_counts,
                "legacy_request_history": legacy, "tables": len(tables)}
    finally:
        database.close()


def receive(archive, directory, expected_sha256):
    archive = Path(archive).expanduser().resolve(strict=True)
    st = archive.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_BYTES:
        raise ValueError("Choose a complete private expense ZIP within 256 MB.")
    if not isinstance(expected_sha256, str) or len(expected_sha256) != 64 or digest_file(archive) != expected_sha256:
        raise ValueError("The complete project differs from its reviewed SHA-256.")
    raw_directory = Path(directory).expanduser()
    if not raw_directory.is_absolute():
        raise ValueError("Choose an absolute private receiving directory.")
    root = raw_directory.parent.resolve(strict=True) / raw_directory.name
    try:
        root.mkdir(mode=0o700)
    except FileExistsError:
        pass
    st = root.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_mode & 0o077 or st.st_uid != os.getuid():
        raise ValueError("Use an owned private receiving directory without symlinks.")
    lock = os.open(root / ".receiving.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        marker = root / ".receiving.json"
        identity = {"schema": "stellar-forge.buyer-expense-receiving.v1", "archive_sha256": expected_sha256}
        if marker.exists():
            if marker.is_symlink() or json.loads(marker.read_text()) != identity:
                raise ValueError("This receiving folder belongs to another complete project.")
        elif any(p.name != ".receiving.lock" for p in root.iterdir()):
            raise ValueError("Choose an empty receiving folder or resume its exact original archive.")
        else:
            atomic_bytes(marker, (json.dumps(identity) + "\n").encode())
        with zipfile.ZipFile(archive) as z:
            infos = z.infolist()
            names = [v.filename for v in infos]
            if len(names) != len(set(names)) or "manifest.json" not in names:
                raise ValueError("The archive has missing or duplicate native members.")
            if z.getinfo("manifest.json").file_size > 65000:
                raise ValueError("The project manifest exceeds its native limit.")
            manifest = json.loads(z.read("manifest.json"))
            if manifest.get("schema") != FORMAT or not isinstance(manifest.get("files"), list):
                raise ValueError("Choose the original buyer-expense complete project format.")
            descriptions = manifest["files"]
            entries = {row["path"]: row for row in descriptions}
            feature = manifest.get("mcp_quote_capture")
            if feature not in (None, "native-readonly-v1"):
                raise ValueError("The archive advertises an unsupported original MCP reader version.")
            credit_feature = manifest.get("buyer_credit_capture")
            if credit_feature not in (None, *CREDIT_VERSIONS) or credit_feature and not feature:
                raise ValueError("The original refund feature requires its complete native reader closure.")
            extra = ADJUSTMENT_REQUIRED if credit_feature == "original-native-refund-v2" else set()
            bookkeeping = manifest.get("buyer_bookkeeping")
            if bookkeeping not in (None, ACCOUNTANT_FEATURE) or bookkeeping and not credit_feature:
                raise ValueError("The accountant return feature requires its original typed source closure.")
            if bookkeeping:
                extra = extra | ACCOUNTANT_REQUIRED
            governed = manifest.get("governed_mcp_capture")
            if governed not in (None, GOVERNED_FEATURE) or governed and not feature:
                raise ValueError("The governed MCP feature requires its original complete quote/spending source closure.")
            if governed:
                extra = extra | GOVERNED_REQUIRED
            node_feature = manifest.get("node_operation_capture")
            if node_feature not in (None, NODE_FEATURE) or node_feature and not feature:
                raise ValueError("The Node source feature requires its original native application closure.")
            if node_feature:
                extra = extra | NODE_REQUIRED
            required = REQUIRED | (MCP_REQUIRED if feature else set()) | (CREDIT_REQUIRED if credit_feature else set()) | extra
            allowed = ALLOWED | (MCP_REQUIRED if feature else set()) | (CREDIT_REQUIRED if credit_feature else set()) | extra
            # Earlier accountant-enabled editions omitted this guide; current complete exports include it.
            if bookkeeping:
                allowed = allowed | {APP_PREFIX + "expense-workspace/BOOKKEEPING.md"}
            if credit_feature:
                allowed = allowed | {"app/" + path for path in OPTIONAL_CREDIT_READER_FILES}
            if len(entries) != len(descriptions) or not required <= set(entries) <= allowed or set(names) != set(entries) | {"manifest.json"}:
                raise ValueError("The complete project must retain the exact original application and workspace members.")
            if sum(i.file_size for i in infos) > MAX_BYTES:
                raise ValueError("The expanded project exceeds the native receiving limit.")
            for name, row in entries.items():
                info = z.getinfo(name)
                if info.file_size != row["bytes"] or info.is_dir() or stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG):
                    raise ValueError("An original archive member has changed type or size.")
                target = root / name
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                for p in target.parents:
                    if p == root.parent:
                        break
                    if p.is_symlink():
                        raise ValueError("A receiving directory is linked.")
                    os.chmod(p, 0o700)
                if target.exists():
                    if target.is_symlink() or not target.is_file() or target.stat().st_size != row["bytes"] or digest_file(target) != row["sha256"]:
                        raise ValueError("A previously received file changed; keep it and choose a new destination.")
                    continue
                pending = target.with_name(target.name + ".receiving-pending")
                if pending.exists():
                    if pending.is_symlink() or not pending.is_file():
                        raise ValueError("The pending native receiving file is not regular.")
                    pending.unlink()
                count, digest = 0, hashlib.sha256()
                with z.open(name) as source, pending.open("xb") as output:
                    os.chmod(pending, 0o600)
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        count += len(chunk)
                        if count > row["bytes"]:
                            raise ValueError("The original member grew beyond its recorded size.")
                        digest.update(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if count != row["bytes"] or digest.hexdigest() != row["sha256"]:
                    raise ValueError("An original member differs from its retained digest.")
                os.replace(pending, target)
                sync_directory(target.parent)
            atomic_bytes(root / "manifest.json", z.read("manifest.json"))
        result = inspect_database(root / "project/workspace.sqlite", manifest)
        result.update(state="RECEIVED", directory=str(root), archive_sha256=expected_sha256,
                      files=len(entries), source_captures_replayed=0, original_ledger_copied=False,
                      original_quote_store_copied=False, purchased_result_bodies_copied=False,
                      retained_original_refund_packets=result["refund_packet_count"],
                      application=str(root / (APP_PREFIX + "expense-workspace/server.py")))
        atomic_bytes(root / "RECEIVED.json", (json.dumps(result, indent=2) + "\n").encode())
        return result
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(lock, fcntl.LOCK_UN)
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    print(json.dumps(receive(args.archive, args.directory, args.expected_sha256)))


if __name__ == "__main__":
    main()
