#!/usr/bin/env python3
"""Compose the pinned Developer Portal source successor for one original kit.
The original materializer still receives source; the original workflow owns
execution. This helper reads original bytes and writes one separate exact kit.
"""
import argparse
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

ADDITION = {
    "bytes": 46410,
    "sha256": "f1890ee59c679d9322dc5e2edaf97eda606c34c7c1921a797215395b5d02e45e"
}

KITS = json.loads(r'''{"citation":{"kind":"citation","packetKind":"citation","originalEnvelope":{"bytes":3670230,"sha256":"4b15d21cf32ba2a0f082209c828f2ba4beca19e98ceb2f8af1eeea7c15268caa","gitBlobSha":"03888169824bcffb2422f51622fcf6d7d4379f4a"},"originalMaterializer":{"bytes":7101,"sha256":"217506524e606c658baf94707d3153b926d6f5c0bda67857ffcdbd9a984399f9"},"sourceFiles":283,"sourceBytes":3527883,"successorEnvelope":{"bytes":3703763,"sha256":"750aaf8416d08dca67f3de27d574859a0d25e96561f7173c82238b2effb6f1b2"},"successorMaterializer":{"bytes":9615,"sha256":"c2587e00f484f4fde86945a8f5f2a6e997aae1e64266ab926585ad1eb65edbae"},"successorSourceFiles":286,"successorSourceBytes":3558658,"predecessor":{"sourceEnvelope":{"bytes":3670230,"sha256":"4b15d21cf32ba2a0f082209c828f2ba4beca19e98ceb2f8af1eeea7c15268caa"},"sourceFiles":283,"sourceBytes":3527883},"marker":".citation-source-materialization.json"},"python":{"kind":"python","packetKind":"python-analysis-citation","originalEnvelope":{"bytes":6690329,"sha256":"4699d7bef9afae7e7b83246600e7add0904403fe829943c32553a3eb63c113ff","gitBlobSha":"5b58fa7625c511d9a677c353b1aedcfb64de31eb"},"originalMaterializer":{"bytes":8026,"sha256":"cdc5c12bc8da875a22b4a98b9450909b6c39b653bf1d690804f88ad929502269"},"sourceFiles":449,"sourceBytes":6363734,"successorEnvelope":{"bytes":6723862,"sha256":"5edf487427cf69152c6ce36bd7031efc840016360c20177a813f8522d96bd3ab"},"successorMaterializer":{"bytes":10540,"sha256":"1179f8910c8d4e62eeb10d6146ed47abf2c3a0c495dc360c974bac9ebcef6f34"},"successorSourceFiles":452,"successorSourceBytes":6394509,"predecessor":{"sourceEnvelope":{"bytes":6690329,"sha256":"4699d7bef9afae7e7b83246600e7add0904403fe829943c32553a3eb63c113ff"},"sourceFiles":449,"sourceBytes":6363734},"marker":".citation-python-source-materialization.json"},"europe-pmc":{"kind":"europe-pmc","packetKind":"europe-pmc","originalEnvelope":{"bytes":7138459,"sha256":"400aebafd847d21bad61cfce6afd40b29c5d005b65213abba0fe9390f61ffa31","gitBlobSha":"bad4c0102ac6e8eb1594ced31ce522ff04d60de1"},"originalMaterializer":{"bytes":8419,"sha256":"90d60e55d1838215c7252cc2a79db5ad8509bf01b44bbbbe79af1dc98fa3635f"},"sourceFiles":473,"sourceBytes":6808118,"successorEnvelope":{"bytes":7171993,"sha256":"6d85434ef1932f00faef9d3ae6be38fcc409d6cd8ed6865c68c5432462265210"},"successorMaterializer":{"bytes":10934,"sha256":"fc46d7214033a4cd5cc7814b6814637350192e5ebb8d7b52b6478eeaf1f21ea5"},"successorSourceFiles":476,"successorSourceBytes":6838893,"predecessor":{"sourceEnvelope":{"bytes":7138459,"sha256":"400aebafd847d21bad61cfce6afd40b29c5d005b65213abba0fe9390f61ffa31"},"sourceFiles":473,"sourceBytes":6808118},"marker":".europe-pmc-source-materialization.json"}}''')

MANIFEST_UPGRADE = r'''
def retain_successor_manifest(path, body):
    """Publish only this pinned successor; keep the exact previous ready manifest."""
    directory(path.parent)
    lock_path = path.with_name(path.name + ".lock")
    lock = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    temporary = None
    try:
        need(stat.S_ISREG(os.fstat(lock).st_mode), "Source manifest lock must be ordinary.")
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            previous = ordinary(path)
        except FileNotFoundError:
            return retain(path, body)
        if previous == body:
            return "reused"
        prior = json.loads(body)
        prior.pop("runtimeClosureAddition")
        prior["sourceEnvelope"] = PREDECESSOR["sourceEnvelope"]
        prior["files"] = prior["files"][:PREDECESSOR["sourceFiles"]]
        prior["sourceFiles"] = PREDECESSOR["sourceFiles"]
        prior["sourceBytes"] = PREDECESSOR["sourceBytes"]
        expected_previous = (json.dumps(prior, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
        need(previous == expected_previous,
             "Existing source manifest is neither the selected predecessor nor its exact successor.")
        backup = path.with_name(path.name + ".predecessor-" + digest(previous) + ".json")
        retain(backup, previous)
        temporary = path.parent / (".receiving-" + uuid.uuid4().hex)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        need(ordinary(path) == previous, "Source manifest changed before successor publication.")
        os.replace(temporary, path)
        temporary = None
        dfd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
        need(ordinary(path) == body, "Published source successor differs.")
        return "advanced"
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        os.close(lock)

'''

READBACK_OLD = r'''    retain(manifest_path, manifest_bytes)
    for name, body, _ in selected:
        need(ordinary(root / name) == body, "Final source readback differs: " + name)
'''
READBACK_NEW = r'''    for name, body, _ in selected:
        need(ordinary(root / name) == body, "Final source readback differs: " + name)
    retain_successor_manifest(manifest_path, manifest_bytes)
'''

def need(value, message):
    if not value:
        raise ValueError(message)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def pinned_file(path, expected, label):
    need(path.is_absolute(), "Use an absolute " + label + " path.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        need(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), label + " must be ordinary.")
        body = stream.read(expected["bytes"] + 1)
    check(body, expected, label)
    return body


def check(body, expected, label):
    need(len(body) == expected["bytes"] and digest(body) == expected["sha256"],
         label + " byte identity differs.")


def compact(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def pretty(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def replace_once(source, old, new):
    need(source.count(old) == 1, "Original materializer source seam differs.")
    return source.replace(old, new, 1)


def validate_rows(rows, relative):
    need(isinstance(rows, list), "Complete source rows are required.")
    seen, total = {}, 0
    for row in rows:
        name = str(relative(row["path"]))
        need(name not in seen, "Duplicate selected source member.")
        need(row.get("mode") in ("100644", "100755"), "Unsupported source mode.")
        need(isinstance(row.get("content"), str), "Source must contain exact UTF-8 text.")
        body = row["content"].encode("utf-8")
        check(body, row, "Source " + name)
        git_blob = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
        need(git_blob == row["gitBlobSha"], "Source Git identity differs: " + name)
        total += len(body)
        seen[name] = row
    return seen, total


def materializer_successor(original, selected):
    source = original.decode("utf-8", errors="strict")
    match = re.search(r"EXPECTED = (\{[\s\S]*?\n\})", source)
    need(match is not None, "Original materializer selection is absent.")
    expected = ast.literal_eval(match.group(1))
    need(expected["bytes"] == selected["originalEnvelope"]["bytes"]
         and expected["sha256"] == selected["originalEnvelope"]["sha256"]
         and expected["files"] == selected["sourceFiles"]
         and expected["sourceBytes"] == selected["sourceBytes"],
         "Original materializer and original envelope disagree.")
    expected.update({
        "bytes": selected["successorEnvelope"]["bytes"],
        "sha256": selected["successorEnvelope"]["sha256"],
        "files": selected["successorSourceFiles"],
        "sourceBytes": selected["successorSourceBytes"],
    })
    source = replace_once(source, "import argparse\n", "import argparse\nimport fcntl\n")
    source = replace_once(source, match.group(0),
        "EXPECTED = " + json.dumps(expected, ensure_ascii=False, indent=4) +
        "\n\nPREDECESSOR = " + json.dumps(selected["predecessor"], ensure_ascii=False, indent=4))
    source = replace_once(source, "\ndef main():\n", MANIFEST_UPGRADE + "\ndef main():\n")
    source = replace_once(source,
        '        "sourceEnvelope": {"bytes": len(raw), "sha256": digest(raw)},\n',
        '        "sourceEnvelope": {"bytes": len(raw), "sha256": digest(raw)},\n' +
        '        "runtimeClosureAddition": envelope["runtimeClosureAddition"],\n')
    source = replace_once(source, READBACK_OLD, READBACK_NEW)
    body = source.encode("utf-8")
    check(body, selected["successorMaterializer"], "Composed materializer")
    compile(source, "materialize-source.py", "exec")
    return body


def compose(args):
    selected = KITS[args.kit]
    original_materializer = pinned_file(args.source_materializer,
        selected["originalMaterializer"], "original materializer")
    # Execute only the independently pinned original module definitions.
    # __name__ excludes its command entrypoint; no source/product run occurs here.
    receiver = {"__name__": "pinned_original_source_receiver",
                "__file__": str(args.source_materializer)}
    exec(compile(original_materializer, str(args.source_materializer), "exec"), receiver)
    original_raw = pinned_file(args.source_envelope, selected["originalEnvelope"],
                              "original source envelope")
    packet_raw = pinned_file(args.addition_packet, ADDITION, "addition packet")
    original, packet = json.loads(original_raw), json.loads(packet_raw)
    need(packet["schema"] == "commons.exact-source-additions.v1"
         and packet["operation"] == "research-developer-portal-original-assets-396c-20261012",
         "Selected original addition packet differs.")
    need(len(original["files"]) == original["sourceFiles"] == selected["sourceFiles"]
         and original["sourceBytes"] == selected["sourceBytes"],
         "Original source closure totals differ.")
    need("runtimeClosureAddition" not in original, "Expected the original unmodified envelope.")
    seen, total = validate_rows(original["files"], receiver["relative"])
    need(total == selected["sourceBytes"], "Original source byte total differs.")
    for required in packet["requiredExisting"]:
        row = seen.get(required["path"])
        need(row is not None and all(row.get(key) == value for key, value in required.items()),
             "Original Developer Portal dependency differs: " + required["path"])
    baseline = [row for row in packet["baselines"] if row["kind"] == selected["packetKind"]]
    need(len(baseline) == 1, "Selected original kit baseline is absent.")
    base = baseline[0]
    need(base["envelopeBytes"] == len(original_raw)
         and base["envelopeSha256"] == digest(original_raw)
         and base["sourceFiles"] == selected["sourceFiles"]
         and base["sourceBytes"] == selected["sourceBytes"]
         and base["resultingSourceFiles"] == selected["successorSourceFiles"]
         and base["resultingSourceBytes"] == selected["successorSourceBytes"],
         "Addition packet baseline differs.")

    additions, metadata = [], []
    for row in packet["files"]:
        name = str(receiver["relative"](row["path"]))
        need(name not in seen, "An addition would overwrite an original source member.")
        body = base64.b64decode(row["contentBase64"], validate=True)
        check(body, row, "Added source " + name)
        additions.append({
            "path": name, "gitBlobSha": row["gitBlobSha"], "bytes": row["bytes"],
            "sha256": row["sha256"], "mode": row["mode"],
            "content": body.decode("utf-8", errors="strict"),
        })
        metadata.append({key: row[key] for key in
                         ("path", "gitBlobSha", "bytes", "sha256", "mode", "sourceUrl")})
    _, added_bytes = validate_rows(additions, receiver["relative"])
    need(len(additions) == packet["sourceFiles"] == 3
         and added_bytes == packet["sourceBytes"] == 30775,
         "Complete original three-asset closure is required.")

    original["files"].extend(additions)
    original["sourceFiles"] = selected["successorSourceFiles"]
    original["sourceBytes"] = selected["successorSourceBytes"]
    original["runtimeClosureAddition"] = {
        "schema": "sf88.developer-portal.source-successor.v1",
        "operation": packet["operation"],
        "packet": ADDITION,
        "repository": packet["repository"],
        "sourceRef": packet["sourceRef"],
        "predecessor": selected["predecessor"],
        "addedFiles": metadata,
        "bodyChanges": 0,
    }
    successor = compact(original)
    check(successor, selected["successorEnvelope"], "Composed complete source envelope")
    materializer = materializer_successor(original_materializer, selected)
    receipt = {
        "schema": "sf88.developer-portal.kit-successor.v1",
        "operation": packet["operation"], "kit": args.kit, "state": "COMPLETE",
        "originalEnvelope": selected["originalEnvelope"],
        "originalMaterializer": selected["originalMaterializer"],
        "additionPacket": ADDITION,
        "sourceEnvelope": {"filename": "source-envelope.json", **selected["successorEnvelope"]},
        "materializer": {"filename": "materialize-source.py", **selected["successorMaterializer"]},
        "sourceFiles": selected["successorSourceFiles"],
        "sourceBytes": selected["successorSourceBytes"],
        "originalSourceBodiesPreserved": selected["sourceFiles"],
        "addedSourceFiles": metadata,
        "materializationManifest": selected["marker"],
        "receiving": {
            "sameDirectory": "Exact predecessor manifest is retained before atomic successor publication.",
            "reopen": "Original selected bodies and all three additions must match their full hashes.",
            "repeat": "An identical successor and original manifest backup are reused.",
            "differentExistingBytes": "Preserve the existing file and report the mismatch.",
        },
    }
    output = receiver["directory"](args.output)
    writes = {
        "source-envelope.json": successor,
        "materialize-source.py": materializer,
        "KIT_SUCCESSOR.json": pretty(receipt),
    }
    counts = {"written": 0, "reused": 0}
    for name, body in writes.items():
        counts[receiver["retain"](output / name, body, name.endswith(".py"))] += 1
    for name, body in writes.items():
        need(receiver["ordinary"](output / name) == body,
             "Completed successor kit readback differs: " + name)
    return {
        "schema": receipt["schema"], "state": "COMPLETE", "kit": args.kit,
        **counts, "directory": str(output),
        "sourceEnvelope": receipt["sourceEnvelope"],
        "materializer": receipt["materializer"],
        "sourceFiles": receipt["sourceFiles"], "sourceBytes": receipt["sourceBytes"],
        "receipt": str(output / "KIT_SUCCESSOR.json"),
        "receiptSha256": digest(writes["KIT_SUCCESSOR.json"]),
        "nativeDispatched": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kit", required=True, choices=tuple(KITS))
    parser.add_argument("--addition-packet", required=True, type=Path)
    parser.add_argument("--source-envelope", required=True, type=Path)
    parser.add_argument("--source-materializer", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    print(json.dumps(compose(parser.parse_args()), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, SyntaxError) as error:
        print(json.dumps({"error": "DEVELOPER_SOURCE_SUCCESSOR_FAILED",
                          "message": str(error)}), file=sys.stderr)
        sys.exit(1)
