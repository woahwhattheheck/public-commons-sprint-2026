#!/usr/bin/env python3
"""MIT. Bitquery Parquet intake and exact derived datasets for the original SF30 SDK."""
import argparse
import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
from fractions import Fraction
from urllib.request import urlopen

SOURCE_SCHEMA = "stellar-forge.bitquery-source.v1"
RELEASE_SCHEMA = "stellar-forge.bitquery-release.v1"
TABLES = ("blocks", "transactions", "operations_tx", "payments_tx", "transfers_tx",
          "effects_tx", "effect_arguments_tx", "balance_effects_tx", "trade_effects_tx",
          "claimable_balance_effects", "liquidity_pool_effects", "liquidity_pool_trade_effects")
REQUIRED = ("blocks", "transactions", "operations_tx", "effects_tx", "payments_tx", "balance_effects_tx")
ADDRESS = re.compile(r"G[A-Z2-7]{55}")
HEX = re.compile(r"[a-f0-9]{64}")
FRACTION = re.compile(r"-?[0-9]{1,100}/[1-9][0-9]{0,99}")
DECIMAL = re.compile(r"-?[0-9]{1,100}(?:\.[0-9]{1,30})?")
DATASETS = {
    "ledger_activity": {
        "name": "Bitquery Stellar ledger activity",
        "columns": {**dict.fromkeys(["date", "closed_at", "fee_numerator", "fee_denominator", "fee_decimal"], "string"),
                    **dict.fromkeys(["ledger", "protocol_version", "transactions", "successful_transactions",
                                     "failed_transactions", "operations", "payment_operations", "successful_payments",
                                     "failed_payments"], "integer")},
        "filters": ["date", "protocol_version"], "ranges": ["ledger", "closed_at"], "sorts": ["ledger", "transactions"]},
    "payment_flows": {
        "name": "Bitquery Stellar payment flows by asset pair",
        "columns": {**dict.fromkeys(["date", "operation", "from_asset_type", "from_asset_code", "from_issuer",
                                     "to_asset_type", "to_asset_code", "to_issuer", "amount_from_numerator",
                                     "amount_from_denominator", "amount_from_decimal", "amount_to_numerator",
                                     "amount_to_denominator", "amount_to_decimal"], "string"),
                    **dict.fromkeys(["attempts", "successful_payments", "failed_payments", "source_amount_disagreements"], "integer")},
        "filters": ["date", "operation", "from_asset_code", "from_issuer", "to_asset_code", "to_issuer"],
        "ranges": ["date"], "sorts": ["date", "successful_payments"]},
    "balance_changes": {
        "name": "Bitquery Stellar balance effects by date and asset",
        "columns": {**dict.fromkeys(["date", "asset_type", "asset_code", "issuer", "credited_stroops", "debited_stroops",
                                     "net_stroops", "credited_decimal", "debited_decimal", "net_decimal"], "string"),
                    **dict.fromkeys(["credit_effects", "debit_effects"], "integer")},
        "filters": ["date", "asset_code", "issuer"], "ranges": ["date"], "sorts": ["date", "credit_effects"]},
}


def fail(message):
    raise ValueError(message)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for data in iter(lambda: f.read(1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()


def private_json(path, value):
    with open(path, "x", encoding="utf-8") as f:
        os.chmod(path, 0o600)
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write("\n")


def read_json(path):
    if Path(path).stat().st_size > 8 * 1024 * 1024:
        fail("Configuration or manifest exceeds 8 MiB")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def whole(value, field):
    if type(value) is not int or not 0 <= value <= 9007199254740991:
        fail("Invalid nonnegative exact integer: " + field)
    return value


def ratio(value):
    if not isinstance(value, str) or not FRACTION.fullmatch(value):
        fail("Expected the source rational amount string")
    return Fraction(value)


def decimal_ratio(value):
    if not isinstance(value, str) or not DECIMAL.fullmatch(value):
        fail("Expected an operation/effect decimal amount string")
    return Fraction(value)


def rational_text(value):
    return str(value.numerator) + "/" + str(value.denominator)


def exact_decimal(value):
    """No floating point or rounding; nonterminating fractions retain their rational fields."""
    n, d = value.numerator, value.denominator
    twos = fives = 0
    while d % 2 == 0:
        twos += 1
        d //= 2
    while d % 5 == 0:
        fives += 1
        d //= 5
    if d != 1:
        return ""
    places = max(twos, fives)
    scaled = abs(n) * (2 ** (places - twos)) * (5 ** (places - fives))
    digits = str(scaled).rjust(places + 1, "0")
    text = digits if not places else digits[:-places] + "." + digits[-places:]
    if places:
        text = text.rstrip("0").rstrip(".")
    return ("-" if n < 0 else "") + text


def amounts(prefix, value):
    return {prefix + "numerator": str(value.numerator), prefix + "denominator": str(value.denominator),
            prefix + "decimal": exact_decimal(value)}


def date_value(value):
    if isinstance(value, dt.datetime):
        return utc_value(value).date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if type(value) is int:
        return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).date().isoformat()
    fail("Expected logical Parquet date or documented epoch milliseconds")


def utc_value(value):
    if isinstance(value, dt.datetime):
        return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value.astimezone(dt.timezone.utc)
    if type(value) is int:
        return dt.datetime.fromtimestamp(value, dt.timezone.utc)
    fail("Expected logical Parquet timestamp or documented epoch seconds")


def asset(kind, code, issuer):
    if kind == "native" or kind == "-" and code == "XLM" and issuer == "":
        if issuer not in ("", None):
            fail("Native asset unexpectedly has an issuer")
        return ("native", "XLM", "")
    if kind not in ("credit_alphanum4", "credit_alphanum12") or not isinstance(code, str) or not code or len(code) > 12:
        fail("Asset identity is incomplete in both primary and enrichment fields")
    if not isinstance(issuer, str) or not ADDRESS.fullmatch(issuer):
        fail("Issued asset requires its exact issuer")
    return (kind, code, issuer)


def detail_asset(details):
    return asset(details.get("asset_type"), details.get("asset_code", "XLM"), details.get("asset_issuer", ""))


def payment_asset(row, side):
    prefix = "currency_" + side + "_"
    return asset(row[prefix + "tokenType"], row[prefix + "symbol"], row["issuer_" + side])


def source_files(path):
    path = Path(path).resolve()
    config = read_json(path)
    if config.get("schema") != SOURCE_SCHEMA or not isinstance(config.get("files"), list) or not config["files"]:
        fail("Expected a Bitquery source manifest with explicit files and SHA-256 values")
    result, seen = [], set()
    for entry in config["files"]:
        if not isinstance(entry, dict) or entry.get("table") not in TABLES or not HEX.fullmatch(str(entry.get("sha256", ""))):
            fail("Unknown table or missing source hash")
        local = (path.parent / entry["file"]).resolve()
        if local in seen or not local.is_file():
            fail("Duplicate or missing source file")
        if digest(local) != entry["sha256"]:
            fail("Source file SHA-256 mismatch: " + entry["table"])
        seen.add(local)
        result.append({"table": entry["table"], "path": local, "sha256": entry["sha256"]})
    return config, sorted(result, key=lambda x: (TABLES.index(x["table"]), str(x["path"])))


def catalog(files):
    import pyarrow.parquet as pq
    result = []
    for entry in files:
        p = pq.ParquetFile(entry["path"])
        if len(set(p.schema_arrow.names)) != len(p.schema_arrow.names):
            fail("Duplicate source column names")
        result.append({"table": entry["table"], "sha256": entry["sha256"], "bytes": entry["path"].stat().st_size,
                       "rows": p.metadata.num_rows, "rowGroups": p.metadata.num_row_groups,
                       "columns": [{"name": f.name, "type": str(f.type)} for f in p.schema_arrow]})
    return result


def records(files, table, columns):
    import pyarrow.parquet as pq
    for entry in files:
        if entry["table"] != table:
            continue
        reader = pq.ParquetFile(entry["path"])
        if not set(columns).issubset(reader.schema_arrow.names):
            fail("Missing required source columns in " + table)
        for batch in reader.iter_batches(batch_size=8192, columns=columns):
            yield from batch.to_pylist()


def identity(row):
    block = whole(row["block"], "ledger")
    if not isinstance(row["tx_hash"], str) or not HEX.fullmatch(row["tx_hash"]):
        fail("Invalid source transaction identity")
    return block, row["tx_hash"]


def flag(value):
    if type(value) is not int or value not in (0, 1):
        fail("Invalid source success flag")
    return value


def database(path):
    conn = sqlite3.connect(path)
    os.chmod(path, 0o600)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.create_function("fraction_add", 2, lambda a, b: rational_text(Fraction(a) + Fraction(b)))
    conn.create_function("integer_add", 2, lambda a, b: str(int(a) + int(b)))
    conn.executescript("""
        CREATE TABLE ledger(block INTEGER PRIMARY KEY, day TEXT, closed TEXT, protocol INTEGER,
          tx INTEGER DEFAULT 0, ok INTEGER DEFAULT 0, ops INTEGER DEFAULT 0,
          pay INTEGER DEFAULT 0, pay_ok INTEGER DEFAULT 0, fee TEXT DEFAULT '0/1');
        CREATE TABLE tx(block INTEGER, hash TEXT, success INTEGER, expected_ops INTEGER, seen_ops INTEGER DEFAULT 0,
          PRIMARY KEY(block,hash), FOREIGN KEY(block) REFERENCES ledger(block));
        CREATE TABLE op(block INTEGER, hash TEXT, idx INTEGER, kind TEXT, details TEXT,
          PRIMARY KEY(block,hash,idx), FOREIGN KEY(block,hash) REFERENCES tx(block,hash));
        CREATE TABLE effect(block INTEGER, hash TEXT, idx INTEGER, effect_idx INTEGER, address TEXT, kind TEXT, details TEXT,
          PRIMARY KEY(block,hash,idx,effect_idx,address), FOREIGN KEY(block,hash,idx) REFERENCES op(block,hash,idx));
        CREATE TABLE payment_identity(block INTEGER, hash TEXT, idx INTEGER, PRIMARY KEY(block,hash,idx));
        CREATE TABLE balance_identity(block INTEGER, hash TEXT, idx INTEGER, effect_idx INTEGER, address TEXT,
          PRIMARY KEY(block,hash,idx,effect_idx,address));
        CREATE TABLE flow(k TEXT PRIMARY KEY, dimensions TEXT, attempts INTEGER, ok INTEGER, corrected INTEGER,
          amount_from TEXT, amount_to TEXT);
        CREATE TABLE balance(k TEXT PRIMARY KEY, dimensions TEXT, credits INTEGER, debits INTEGER,
          credited TEXT, debited TEXT);
    """)
    return conn


def build(source, output):
    config, files = source_files(source)
    if set(REQUIRED) - {f["table"] for f in files}:
        fail("Build requires blocks, transactions, operations, effects, payments and balance effects")
    output = Path(output).resolve()
    output.mkdir(mode=0o700)
    conn = None
    try:
        source_catalog = catalog(files)
        conn = database(output / ".build.sqlite")
        counts = {"simplePaymentRows": 0, "pathPaymentRows": 0, "resolvedSimplePaymentAmountDisagreements": 0,
                  "successfulResolvedAmountDisagreements": 0, "effectAmountComparisons": 0}
        for r in records(files, "blocks", ["block", "tx_date", "tx_time", "protocol_version"]):
            day = date_value(r["tx_date"])
            closed = utc_value(r["tx_time"])
            if day != closed.date().isoformat():
                fail("Ledger date disagrees with its close timestamp")
            conn.execute("INSERT INTO ledger(block,day,closed,protocol) VALUES(?,?,?,?)",
                         (whole(r["block"], "ledger"), day, closed.isoformat().replace("+00:00", "Z"),
                          whole(r["protocol_version"], "protocol")))
        for r in records(files, "transactions", ["block", "tx_hash", "success", "operation_count", "fee"]):
            block, tx_hash = identity(r)
            success, fee = flag(r["success"]), ratio(r["fee"])
            if fee < 0:
                fail("Negative transaction fee")
            conn.execute("INSERT INTO tx(block,hash,success,expected_ops) VALUES(?,?,?,?)",
                         (block, tx_hash, success, whole(r["operation_count"], "operation_count")))
            conn.execute("UPDATE ledger SET tx=tx+1,ok=ok+?,fee=fraction_add(fee,?) WHERE block=?",
                         (success, rational_text(fee), block))
        detail_keys = ("asset_type", "asset_code", "asset_issuer", "amount")
        for r in records(files, "operations_tx", ["block", "tx_hash", "op_index", "operation", "details"]):
            block, tx_hash = identity(r)
            details = json.loads(r["details"])
            if not isinstance(details, dict) or not isinstance(r["operation"], str):
                fail("Invalid operation detail object")
            retained = {key: details[key] for key in detail_keys if key in details}
            conn.execute("INSERT INTO op VALUES(?,?,?,?,?)", (block, tx_hash, whole(r["op_index"], "op_index"),
                                                              r["operation"], encoded(retained)))
            conn.execute("UPDATE tx SET seen_ops=seen_ops+1 WHERE block=? AND hash=?", (block, tx_hash))
            conn.execute("UPDATE ledger SET ops=ops+1 WHERE block=?", (block,))
        if conn.execute("SELECT COUNT(*) FROM tx WHERE seen_ops!=expected_ops").fetchone()[0]:
            fail("Transaction operation counts do not match selected operation files")
        for r in records(files, "effects_tx", ["block", "tx_hash", "op_index", "effect_index", "address", "effect", "details"]):
            block, tx_hash = identity(r)
            details = json.loads(r["details"])
            if not isinstance(details, dict):
                fail("Invalid effect detail object")
            retained = {key: details[key] for key in detail_keys if key in details}
            conn.execute("INSERT INTO effect VALUES(?,?,?,?,?,?,?)",
                         (block, tx_hash, whole(r["op_index"], "op_index"), whole(r["effect_index"], "effect_index"),
                          r["address"], r["effect"], encoded(retained)))
        pay_columns = ["block", "tx_hash", "op_index", "operation_index", "operation", "success", "amount_from", "amount_to",
                       "currency_from_tokenType", "currency_from_symbol", "issuer_from", "currency_to_tokenType", "currency_to_symbol", "issuer_to"]
        for r in records(files, "payments_tx", pay_columns):
            block, tx_hash = identity(r)
            idx, success = whole(r["op_index"], "op_index"), flag(r["success"])
            if whole(r["operation_index"], "operation_index") != idx:
                fail("Payment operation indices disagree")
            conn.execute("INSERT INTO payment_identity VALUES(?,?,?)", (block, tx_hash, idx))
            parent = conn.execute("SELECT op.kind,op.details,tx.success,ledger.day FROM op JOIN tx USING(block,hash) "
                                  "JOIN ledger USING(block) WHERE op.block=? AND op.hash=? AND op.idx=?",
                                  (block, tx_hash, idx)).fetchone()
            if not parent or parent[0] != r["operation"] or success != parent[2]:
                fail("Payment does not match its original transaction and operation")
            quoted_from, quoted_to = ratio(r["amount_from"]), ratio(r["amount_to"])
            corrected = 0
            if r["operation"] == "payment":
                details = json.loads(parent[1])
                source_asset = target_asset = detail_asset(details)
                value_from = value_to = decimal_ratio(details.get("amount"))
                corrected = int(quoted_from != value_from or quoted_to != value_to)
                counts["simplePaymentRows"] += 1
                counts["resolvedSimplePaymentAmountDisagreements"] += corrected
                counts["successfulResolvedAmountDisagreements"] += corrected * success
            elif r["operation"] in ("path_payment_strict_send", "path_payment_strict_receive"):
                source_asset, target_asset = payment_asset(r, "from"), payment_asset(r, "to")
                value_from, value_to = quoted_from, quoted_to
                counts["pathPaymentRows"] += 1
            else:
                fail("Unexpected operation in payments table")
            if min(value_from, value_to) < 0:
                fail("Negative payment amount")
            dimensions = {"date": parent[3], "operation": r["operation"],
                          **dict(zip(("from_asset_type", "from_asset_code", "from_issuer"), source_asset)),
                          **dict(zip(("to_asset_type", "to_asset_code", "to_issuer"), target_asset))}
            key = encoded(dimensions)
            conn.execute("INSERT INTO flow VALUES(?,?,1,?,?,?,?) ON CONFLICT(k) DO UPDATE SET attempts=attempts+1,"
                         "ok=ok+excluded.ok,corrected=corrected+excluded.corrected,"
                         "amount_from=fraction_add(amount_from,excluded.amount_from),"
                         "amount_to=fraction_add(amount_to,excluded.amount_to)",
                         (key, key, success, corrected, rational_text(value_from if success else Fraction(0)),
                          rational_text(value_to if success else Fraction(0))))
            conn.execute("UPDATE ledger SET pay=pay+1,pay_ok=pay_ok+? WHERE block=?", (success, block))
        balance_columns = ["block", "tx_hash", "op_index", "effect_index", "address", "amount"]
        for r in records(files, "balance_effects_tx", balance_columns):
            block, tx_hash = identity(r)
            key = (block, tx_hash, whole(r["op_index"], "op_index"), whole(r["effect_index"], "effect_index"), r["address"])
            conn.execute("INSERT INTO balance_identity VALUES(?,?,?,?,?)", key)
            source_effect = conn.execute("SELECT effect.kind,effect.details,ledger.day,tx.success FROM effect "
                                         "JOIN ledger USING(block) JOIN tx USING(block,hash) "
                                         "WHERE effect.block=? AND effect.hash=? AND effect.idx=? AND effect.effect_idx=? AND effect.address=?", key).fetchone()
            if not source_effect or source_effect[0] not in ("account_credited", "account_debited") or not source_effect[3]:
                fail("Balance row has no matching successful account credit/debit effect")
            details = json.loads(source_effect[1])
            asset_id = detail_asset(details)
            if not isinstance(r["amount"], str) or not re.fullmatch(r"-?[0-9]{1,100}", r["amount"]):
                fail("Balance amount must be an integer stroop string")
            signed = int(r["amount"])
            credit = source_effect[0] == "account_credited"
            expected = decimal_ratio(details.get("amount")) * 10_000_000 * (1 if credit else -1)
            if expected.denominator != 1 or signed != expected.numerator:
                fail("Raw balance stroops disagree with the original signed effect amount")
            counts["effectAmountComparisons"] += 1
            dimensions = {"date": source_effect[2], **dict(zip(("asset_type", "asset_code", "issuer"), asset_id))}
            key_text = encoded(dimensions)
            conn.execute("INSERT INTO balance VALUES(?,?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET "
                         "credits=credits+excluded.credits,debits=debits+excluded.debits,"
                         "credited=integer_add(credited,excluded.credited),debited=integer_add(debited,excluded.debited)",
                         (key_text, key_text, int(credit), int(not credit), str(signed if credit else 0), str(-signed if not credit else 0)))
        missing_payments = conn.execute("SELECT COUNT(*) FROM op LEFT JOIN payment_identity p USING(block,hash,idx) "
                                        "WHERE op.kind IN ('payment','path_payment_strict_send','path_payment_strict_receive') "
                                        "AND p.hash IS NULL").fetchone()[0]
        missing_balances = conn.execute("SELECT COUNT(*) FROM effect LEFT JOIN balance_identity b "
                                        "USING(block,hash,idx,effect_idx,address) "
                                        "WHERE effect.kind IN ('account_credited','account_debited') AND b.hash IS NULL").fetchone()[0]
        if missing_payments or missing_balances:
            fail(f"Selected files omit {missing_payments} payment operations and {missing_balances} balance effects; include their matching source shards")
        counts["missingPaymentChildren"] = missing_payments
        counts["missingBalanceChildren"] = missing_balances
        conn.commit()
        coverage = conn.execute("SELECT MIN(block),MAX(block),COUNT(*),MIN(day),MAX(day),SUM(tx),SUM(ops),SUM(pay),SUM(pay_ok) FROM ledger").fetchone()
        if not coverage[2]:
            fail("Source contains no ledger coverage")
        for entry in files:
            if digest(entry["path"]) != entry["sha256"]:
                fail("Source changed during intake: " + entry["table"])
        def ledger_rows():
            for r in conn.execute("SELECT block,day,closed,protocol,tx,ok,ops,pay,pay_ok,fee FROM ledger ORDER BY block"):
                yield {"ledger": r[0], "date": r[1], "closed_at": r[2], "protocol_version": r[3], "transactions": r[4],
                       "successful_transactions": r[5], "failed_transactions": r[4]-r[5], "operations": r[6],
                       "payment_operations": r[7], "successful_payments": r[8], "failed_payments": r[7]-r[8],
                       **amounts("fee_", Fraction(r[9]))}
        def flow_rows():
            for dimensions, attempted, ok, corrected, a, b in conn.execute("SELECT dimensions,attempts,ok,corrected,amount_from,amount_to FROM flow ORDER BY k"):
                yield {**json.loads(dimensions), "attempts": attempted, "successful_payments": ok,
                       "failed_payments": attempted-ok, "source_amount_disagreements": corrected,
                       **amounts("amount_from_", Fraction(a)), **amounts("amount_to_", Fraction(b))}
        def balance_rows():
            for dimensions, credits, debits, a, b in conn.execute("SELECT dimensions,credits,debits,credited,debited FROM balance ORDER BY k"):
                a, b = int(a), int(b)
                yield {**json.loads(dimensions), "credit_effects": credits, "debit_effects": debits,
                       "credited_stroops": str(a), "debited_stroops": str(b), "net_stroops": str(a-b),
                       "credited_decimal": exact_decimal(Fraction(a,10_000_000)), "debited_decimal": exact_decimal(Fraction(b,10_000_000)),
                       "net_decimal": exact_decimal(Fraction(a-b,10_000_000))}
        releases = {}
        for name, generator in (("ledger_activity", ledger_rows), ("payment_flows", flow_rows), ("balance_changes", balance_rows)):
            spec = DATASETS[name]
            csv_path = output / (name + ".csv")
            row_count = 0
            with open(csv_path, "x", encoding="utf-8", newline="") as f:
                os.chmod(csv_path, 0o600)
                writer = csv.DictWriter(f, fieldnames=list(spec["columns"]), lineterminator="\n")
                writer.writeheader()
                for row in generator():
                    writer.writerow(row)
                    row_count += 1
            dataset = {"schema": "stellar-forge.csv-dataset.v1", "file": csv_path.name, **spec,
                       "defaultLimit": 25, "maxLimit": 250, "maxRows": max(1, row_count),
                       "maxBytes": max(1024, csv_path.stat().st_size)}
            if row_count > 1_000_000 or dataset["maxBytes"] > 256*1024*1024:
                fail("Derived product exceeds original SF30 snapshot capacity; select a smaller actual source window")
            spec_path = output / (name + ".json")
            private_json(spec_path, dataset)
            releases[name] = {"dataset": spec_path.name, "csv": csv_path.name, "rows": row_count,
                              "datasetSha256": digest(spec_path), "csvSha256": digest(csv_path), "bytes": csv_path.stat().st_size}
        manifest = {"schema": RELEASE_SCHEMA, "provider": "Bitquery", "sourceManifestSha256": digest(source),
                    "builtAt": dt.datetime.now(dt.timezone.utc).isoformat(), "sourceFiles": source_catalog,
                    "coverage": dict(zip(("firstLedger", "lastLedger", "ledgerCount", "firstDate", "lastDate", "transactions",
                                          "operations", "paymentAttempts", "successfulPayments"), coverage)),
                    "quality": counts, "datasets": releases,
                    "amountPolicy": "Simple payments: original operation decimal amount and asset. Path payments: provider rational amounts. Balance effects: signed raw stroops checked against original effect. Successful payment totals only.",
                    "coveragePolicy": "Only explicitly supplied files and retained ledger rows. Missing ledgers are not inferred. Parent joins and operation counts are exact. Transfers and trade effects are catalogued, not added to payment totals."}
        manifest["coverage"]["missingLedgersWithinRange"] = coverage[1]-coverage[0]+1-coverage[2]
        private_json(output / "manifest.json", manifest)
        return {"release": str(output), "sourceRows": sum(r["rows"] for r in source_catalog),
                "coverage": manifest["coverage"], "quality": counts,
                "datasets": {k: {"rows": v["rows"], "sha256": v["csvSha256"]} for k,v in releases.items()}}
    except Exception:
        if conn:
            conn.close()
            conn = None
        shutil.rmtree(output)
        raise
    finally:
        if conn:
            conn.close()
        for suffix in ("", "-journal", "-wal", "-shm"):
            (output / (".build.sqlite" + suffix)).unlink(missing_ok=True)


def verify(output):
    output = Path(output).resolve()
    manifest = read_json(output / "manifest.json")
    if manifest.get("schema") != RELEASE_SCHEMA or set(manifest.get("datasets", {})) != set(DATASETS):
        fail("Invalid derived release manifest")
    for name, spec in manifest["datasets"].items():
        for file_key, hash_key, suffix in (("dataset", "datasetSha256", ".json"), ("csv", "csvSha256", ".csv")):
            if spec[file_key] != name + suffix or digest(output / spec[file_key]) != spec[hash_key]:
                fail("Derived release identity changed: " + name)
    return {"verified": True, "coverage": manifest["coverage"], "datasets": {k:v["rows"] for k,v in manifest["datasets"].items()}}


def fetch_samples(output):
    output = Path(output).resolve()
    output.mkdir(mode=0o700)
    try:
        pinned = read_json(Path(__file__).with_name("samples.json"))
        files = []
        for entry in pinned["files"]:
            url = entry["url"]
            expected = "https://bitquery-blockchain-dataset.s3.us-east-1.amazonaws.com/stellar/" + entry["table"] + "/55080300_55080349.parquet"
            if url != expected or entry["table"] not in TABLES:
                fail("Sample URL is outside the pinned official public sample set")
            path = output / (entry["table"] + ".parquet")
            with urlopen(url, timeout=60) as response, open(path, "xb") as f:
                os.chmod(path, 0o600)
                if response.url != url:
                    fail("Unexpected sample redirect")
                size = 0
                while chunk := response.read(1024*1024):
                    size += len(chunk)
                    if size > 32*1024*1024:
                        fail("Sample exceeds the published pilot file budget")
                    f.write(chunk)
            if digest(path) != entry["sha256"]:
                fail("Pinned public sample bytes changed")
            files.append({"table": entry["table"], "file": path.name, "sha256": entry["sha256"]})
        private_json(output / "source.json", {"schema": SOURCE_SCHEMA, "files": files})
        return {"source": str(output / "source.json"), "files": len(files)}
    except Exception:
        shutil.rmtree(output)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("inspect"); p.add_argument("--source", required=True)
    p = commands.add_parser("build"); p.add_argument("--source", required=True); p.add_argument("--out", required=True)
    p = commands.add_parser("verify"); p.add_argument("--release", required=True)
    p = commands.add_parser("fetch-samples"); p.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command == "inspect":
        _, files = source_files(args.source)
        result = {"tables": catalog(files)}
    elif args.command == "build":
        result = build(args.source, args.out)
    elif args.command == "verify":
        result = verify(args.release)
    else:
        result = fetch_samples(args.out)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        print("Bitquery intake: " + str(error), file=sys.stderr)
        sys.exit(1)
