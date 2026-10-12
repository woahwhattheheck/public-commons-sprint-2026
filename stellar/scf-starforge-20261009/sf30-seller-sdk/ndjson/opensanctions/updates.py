"""MIT. Ordered original OpenSanctions deltas and full-edition reconciliation."""
from __future__ import annotations

from collections import Counter
import hashlib
import io
import time
from urllib.parse import urlsplit
import urllib.request

from model import (InputError, MAX_SOURCE, VERSION, json_bytes, sha, stable, text,
                   ftm_entity, ndjson_source)

DELTA_CONTRACT = {
    "repository": "opensanctions/opensanctions",
    "commit": "123b66267ac39a6b9e840566c5bb5a3eb680bfef",
    "path": "zavod/zavod/runtime/delta.py",
    "blob": "781829722deb1c2e70de3e8e58bc6fe7712b9649",
    "method": "HashDelta.feed",
    "fields": ["id", "schema", "properties"],
    "ordering": "property names and each property's string values sorted; UTF-8 concatenation without separators",
}

def publisher_hash(entity):
    """Exact original HashDelta.feed content projection; full source stays retained."""
    if entity is None:
        return None
    h = hashlib.sha1()
    h.update(entity["id"].encode("utf-8")); h.update(entity["schema"].encode("utf-8"))
    for prop, values in sorted(entity["properties"].items()):
        h.update(prop.encode("utf-8"))
        for value in sorted(values):
            h.update(value.encode("utf-8"))
    return h.hexdigest()


def published_url(url):
    p = urlsplit(text(url, "Original publisher URL", 4000))
    if not p.hostname or p.username or p.password or p.fragment:
        raise InputError("Use the selected original HTTP source URL without embedded credentials or fragments")
    if p.scheme != "https" and not (p.scheme == "http" and p.hostname in {"127.0.0.1", "localhost", "::1"}):
        raise InputError("Use HTTPS for the selected source, or HTTP for a local original-file receiver")
    return url

class PublisherRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        published_url(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)

def fetch_original(url, maximum=MAX_SOURCE):
    """One explicit publisher request, retaining actual URL and response metadata."""
    published_url(url)
    opener = urllib.request.build_opener(PublisherRedirects())
    request = urllib.request.Request(url, headers={"Accept": "application/json,application/octet-stream",
                                                  "User-Agent": "Starforge OpenSanctions operator/1.0"})
    with opener.open(request, timeout=60) as response:
        data = response.read(maximum + 1)
        if len(data) > maximum:
            raise InputError("Original source exceeds the selected intake size")
        receipt = {"url": url, "finalUrl": response.url, "status": response.status,
                   "headers": {k: v for k, v in response.headers.items()
                               if k.lower() in {"content-type", "etag", "last-modified", "content-length"}},
                   "bytes": len(data), "sha256": sha(data), "receivedAt": time.time()}
    return data, receipt

def receive_published(domain, metadata_url, entitlement=None):
    metadata_bytes, receipt = fetch_original(metadata_url, 2 * 1024 * 1024)
    from model import load_json
    metadata = load_json(metadata_bytes)
    resources = [r for r in metadata.get("resources", []) if r.get("name") == "entities.ftm.json"]
    if len(resources) != 1:
        raise InputError("This original index must advertise one flat FtM entity resource")
    entities, entity_receipt = fetch_original(resources[0]["url"])
    edition = domain.accept_edition(io.BytesIO(metadata_bytes), io.BytesIO(entities),
                                   metadata_url=receipt["finalUrl"], entitlement=entitlement)
    return {"edition": edition, "metadataResponse": receipt, "entityResponse": entity_receipt}

def update_plan(domain, before_id, after_id, index_object):
    before, after = domain._one("editions", before_id), domain._one("editions", after_id)
    if before["dataset"] != after["dataset"] or before["version"] >= after["version"]:
        raise InputError("Select an earlier and a later edition of the same original dataset")
    index = domain.original_json(index_object)
    versions = index.get("versions")
    if not isinstance(versions, dict) or any(not VERSION.fullmatch(v) or not isinstance(u, str) for v, u in versions.items()):
        raise InputError("Use the original delta index with its versions-to-URLs mapping")
    retained = sorted(versions)
    required = [{"version": v, "url": versions[v]} for v in retained if before["version"] < v <= after["version"]]
    return {"before": before_id, "after": after_id, "dataset": before["dataset"],
            "beforeVersion": before["version"], "afterVersion": after["version"], "index": index_object,
            "oldestRetainedVersion": retained[0] if retained else None,
            "requiresFullReload": not retained or before["version"] < retained[0],
            "required": required,
            "unchangedVersionPolicy": "A version absent from the original delta index has no published change file"}

def stage_update(domain, before_id, after_id, index_object, delta_objects):
    """Apply the complete original chronological chain before resolving removed IDs.

    The published full edition is independently retained. This routine preserves
    any difference between that edition and incremental entities, including
    observation timestamps; an operator can select the complete verified edition.
    """
    plan = update_plan(domain, before_id, after_id, index_object)
    if not isinstance(delta_objects, list) or any(not isinstance(x, dict) or set(x) != {"version", "object"} for x in delta_objects):
        raise InputError("Select original delta objects with their exact published version")
    provided = {x["version"]: x["object"] for x in delta_objects}
    if len(provided) != len(delta_objects):
        raise InputError("Each published delta version must occur once")
    required = {x["version"] for x in plan["required"]}
    if not plan["requiresFullReload"] and set(provided) != required:
        raise InputError("Select every original delta in the required chronological chain")
    if plan["requiresFullReload"] and provided:
        raise InputError("This original index requires a full reload; select the retained complete later edition")
    spec = {"schema": "starforge.opensanctions-update.v1", "plan": plan,
            "deltas": [{"version": v, "object": provided[v]} for v in sorted(provided)]}
    ident = sha(json_bytes(spec))
    with domain.mutex:
        old = domain.db.execute("SELECT body FROM os_updates WHERE id=?", (ident,)).fetchone()
        if old:
            from model import load_json
            return load_json(old[0])
        before = domain._one("editions", before_id); after = domain._one("editions", after_id)
        if plan["requiresFullReload"]:
            body = {"id": ident, **spec, "state": "FULL_EDITION_READY", "targetEdition": after_id,
                    "operationCounts": {}, "deltaEntities": None, "reconciliation": None,
                    "selection": None, "createdAt": time.time()}
            with domain.db:
                domain._put("updates", body)
            return body
        indexed = domain._scope_entities(before_id)
        current = {k: v["entity"] for k, v in indexed.items()}
        changes, counts, lineage = [], Counter(), []
        for selected in plan["required"]:
            version, object_id = selected["version"], provided[selected["version"]]
            original = domain._one("objects", object_id)
            received_url = original.get("provenance", {}).get("url")
            if received_url and received_url != selected["url"]:
                raise InputError("Selected original delta URL differs from the published index")
            local_counts = Counter()
            with domain.object_path(object_id).open("rb") as stream:
                for line, envelope in ndjson_source.records(stream):
                    if envelope.get("op") not in {"ADD", "MOD", "DEL"} or not isinstance(envelope.get("entity"), dict):
                        raise InputError(f"Delta {version}, line {line}: expected original ADD/MOD/DEL envelope")
                    op, entity = envelope["op"], envelope["entity"]
                    entity_id = text(entity.get("id"), "Delta entity id", 512)
                    prior = current.get(entity_id)
                    if op == "ADD":
                        if prior is not None:
                            raise InputError(f"Delta {version}, line {line}: ADD identity already exists in the selected base")
                        current[entity_id] = ftm_entity(entity, line)
                    elif op == "MOD":
                        if prior is None:
                            raise InputError(f"Delta {version}, line {line}: MOD identity is absent from the selected base")
                        current[entity_id] = ftm_entity(entity, line)
                    else:
                        if set(entity) != {"id"}:
                            raise InputError(f"Delta {version}, line {line}: DEL contains more than its original id")
                        if prior is None:
                            raise InputError(f"Delta {version}, line {line}: DEL identity is absent from the selected base")
                        del current[entity_id]
                    event = {"version": version, "original": object_id, "physicalLine": line,
                             "op": op, "entityId": entity_id,
                             "beforeSha256": sha(stable(prior)) if prior is not None else None,
                             "afterSha256": sha(stable(current[entity_id])) if entity_id in current else None}
                    changes.append(event); counts[op] += 1; local_counts[op] += 1
            lineage.append({**selected, "object": object_id, "operations": dict(local_counts)})
        # Preserve every incremental record exactly as supplied, with deterministic ordering.
        stream = io.BytesIO(b"".join(ndjson_source.exact_json(current[k]).encode() + b"\n" for k in sorted(current)))
        derived = domain.put_object(stream, "delta-applied.ftm.json", "application/json+ftm",
                                    {"kind": "ordered-provider-deltas", "before": before_id, "after": after_id})
        native_log = domain.put_object(io.BytesIO(b"".join(json_bytes(e) for e in changes)),
                                       "original-delta-operations.jsonl", "application/x-ndjson",
                                       {"kind": "original-operation-lineage", "update": ident})
        target = domain._scope_entities(after_id)
        differences, matched, publisher_matched, publisher_differences = [], 0, 0, []
        for entity_id in sorted(set(current) | set(target)):
            previous, published = current.get(entity_id), target.get(entity_id, {}).get("entity")
            incremental_hash, full_hash = publisher_hash(previous), publisher_hash(published)
            if incremental_hash == full_hash:
                publisher_matched += 1
            else:
                publisher_differences.append({"entityId": entity_id, "incrementalHash": incremental_hash, "publishedHash": full_hash})
            if stable(previous) == stable(published):
                matched += 1; continue
            fields = [key for key in sorted(set(previous or {}) | set(published or {}))
                      if stable((previous or {}).get(key)) != stable((published or {}).get(key))]
            differences.append({"entityId": entity_id, "fields": fields,
                                "incremental": previous, "published": published, "publisherHashEqual": incremental_hash == full_hash})
        reconciliation_file = domain.put_object(io.BytesIO(b"".join(json_bytes(d) for d in differences)),
                  "delta-versus-published.jsonl", "application/x-ndjson", {"kind": "full-published-edition-comparison"})
        field_counts = Counter(key for d in differences for key in d["fields"])
        body = {"id": ident, **spec, "state": "FULL_EDITION_READY",
                "targetEdition": after_id, "deltaEntities": derived["id"], "operationLog": native_log["id"],
                "lineage": lineage, "operationCounts": dict(counts), "selection": None,
                "reconciliation": {"incrementalRecords": len(current), "publishedRecords": len(target),
                                   "exactlyEqualEntities": matched, "differentEntities": len(differences),
                                   "differentFields": dict(field_counts), "differences": reconciliation_file["id"],
                                   "publisherContract": DELTA_CONTRACT, "publisherContentEqualEntities": publisher_matched,
                                   "publisherContentDifferences": publisher_differences,
                                   "publisherContentEquivalent": not publisher_differences,
                                   "incrementalOnlyIds": sorted(set(current) - set(target)),
                                   "publishedOnlyIds": sorted(set(target) - set(current))},
                "createdAt": time.time()}
        with domain.db:
            domain._put("updates", body)
        return body

def select_update(domain, update_id, *, reviewer, reason, expected=None):
    """Select the independently checksum-verified full edition; retain delta history."""
    text(reviewer, "Reviewer", 160); text(reason, "Update selection reason", 8000)
    with domain.mutex:
        body = domain._one("updates", update_id)
        current = (body.get("selection") or {}).get("revision")
        if current != expected:
            raise InputError("This update selection changed; refresh the original operation")
        after = domain._one("editions", body["targetEdition"])
        # Revalidate the complete original source before recording its selection.
        domain._source_path(after["source"])
        selection = {"edition": after["id"], "version": after["version"], "source": after["source"],
                     "build": after["build"], "mode": "verified_published_full_edition",
                     "reviewer": reviewer, "reason": reason, "previous": current, "at": time.time()}
        selection["revision"] = sha(json_bytes(selection))
        body["selectionHistory"] = [*body.get("selectionHistory", []), selection]
        body["selection"], body["state"] = selection, "SELECTED"
        with domain.db:
            domain._put("updates", body, mutable=True)
        return body

def fetch_update(domain, before_id, after_id):
    after = domain._one("editions", after_id)
    metadata = domain.original_json(after["metadata"])
    url = metadata.get("delta_url")
    raw, receipt = fetch_original(url, 4 * 1024 * 1024)
    original = domain.put_object(io.BytesIO(raw), "delta.json", "application/json", receipt)
    plan = update_plan(domain, before_id, after_id, original["id"])
    selected = []
    if not plan["requiresFullReload"]:
        for item in plan["required"]:
            raw, received = fetch_original(item["url"])
            original_delta = domain.put_object(io.BytesIO(raw), item["version"] + ".delta.json",
                                               "application/x-ndjson", received)
            selected.append({"version": item["version"], "object": original_delta["id"]})
    return stage_update(domain, before_id, after_id, original["id"], selected)
