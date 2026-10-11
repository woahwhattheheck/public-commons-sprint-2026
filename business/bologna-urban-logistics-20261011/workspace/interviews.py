"""Municipal interview analysis and validation within the Bologna workspace.

All mutation runs on the host's draft inside model.mutate. This module owns no
database, server, source collector, survey, or external communication route.
"""
from __future__ import annotations

import base64
import copy
import csv
import hashlib
import html
import io
import json
import re
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

SCHEMA = "bologna-municipal-interviews/v1"
RFP = "https://netzerocities.eu/wp-content/uploads/2026/10/NZC-CESF-Procurement-RFP-SGA3-MCCC-029-Bologna-Urban-Logistic.pdf"
GROUPS = {
    "LOGISTICS_OPERATOR": {"it": "Operatore logistico", "en": "Logistics operator"},
    "SHOPKEEPER": {"it": "Esercente", "en": "Shopkeeper"},
    "MUNICIPAL_STAFF": {"it": "Ufficio comunale", "en": "Municipal staff"},
    "OTHER": {"it": "Altro interlocutore concordato", "en": "Other agreed stakeholder"},
    "MIXED": {"it": "Verbale con più gruppi", "en": "Notes covering multiple groups"},
}
THEMES = {
    "DELIVERY_PATTERN": {"it": "Organizzazione delle consegne", "en": "Delivery organization"},
    "TIME_WINDOW": {"it": "Finestre temporali", "en": "Delivery time windows"},
    "LOADING_SPACE": {"it": "Carico, scarico e spazio pubblico", "en": "Loading and public space"},
    "VEHICLE_ACCESS": {"it": "Veicoli, permessi e accesso", "en": "Vehicles, permits and access"},
    "TRAM_PEDESTRIAN": {"it": "Tram e pedonalizzazione", "en": "Tram and pedestrianization"},
    "ZERO_EMISSION": {"it": "Passaggio a veicoli a zero emissioni", "en": "Zero-emission transition"},
    "CONSOLIDATION": {"it": "Consolidamento, microhub e locker", "en": "Consolidation, microhubs and lockers"},
    "MARKET_READINESS": {"it": "Fattibilità e disponibilità degli operatori", "en": "Feasibility and operator readiness"},
    "ENFORCEMENT": {"it": "Responsabilità e applicazione delle regole", "en": "Responsibilities and enforcement"},
    "DATA_GAP": {"it": "Informazione da verificare", "en": "Information to verify"},
}
KINDS = {"OBSERVATION", "CONTRADICTION", "UNKNOWN", "PROPOSAL"}
DISPOSITIONS = {"ACCEPT", "REVISE", "DEFER", "REJECT"}
ACTIONS = {"interviews.import", "interviews.excerpt", "interviews.finding", "interviews.validation", "interviews.meeting", "interviews.sourceReview"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _text(value, label, maximum=4000, required=True, preserve=False):
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    value = value if preserve else value.strip()
    if required and not value.strip():
        raise ValueError(f"{label} is required")
    if len(value) > maximum or "\x00" in value:
        raise ValueError(f"{label} exceeds its size limit or contains a null character")
    return value


def _choice(value, choices, label):
    if value not in choices:
        raise ValueError(f"Unknown {label}")
    return value


def _list(value, choices, label, required=False):
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        raise ValueError(f"{label} must be an array")
    result = list(dict.fromkeys(value))
    if len(result) > 100 or any(x not in choices for x in result) or (required and not result):
        raise ValueError(f"Invalid {label}")
    return result


def _date(value, label, required=False):
    value = _text(value, label, 10, required)
    if value:
        try:
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError()
        except ValueError:
            raise ValueError(f"{label} must use YYYY-MM-DD") from None
    return value


def _section(state):
    _read(state)
    return state.setdefault("interviews", {"schema": SCHEMA, "sources": [], "excerpts": [], "findings": [], "validations": [], "meetings": [], "sourceReviews": {}, "operations": {}})


def _read(state):
    section = state.get("interviews")
    if section is not None and section.get("schema") != SCHEMA:
        raise ValueError("Unsupported interview workspace schema")
    return section or {"schema": SCHEMA, "sources": [], "excerpts": [], "findings": [], "validations": [], "meetings": [], "sourceReviews": {}, "operations": {}}


def _lookup(rows, identifier, label):
    result = next((row for row in rows if row["id"] == identifier), None)
    if result is None:
        raise ValueError(f"Unknown {label}")
    return result


def _current(section):
    current = {}
    for source in section["sources"]:
        current[source["sourceKey"]] = source
    return current


def _scope(state, payload):
    streets = list(state["baseline"]["streets"]) + ["WIDER_ZTL", "UNSPECIFIED"]
    scenarios = [s["id"] for s in state["scenarios"]]
    return {"streetIds": _list(payload.get("streetIds", []), streets, "streets"),
            "scenarioIds": _list(payload.get("scenarioIds", []), scenarios, "scenarios")}


def schema(state=None):
    return {"schema": SCHEMA, "groups": GROUPS, "themes": THEMES,
            "kinds": sorted(KINDS), "dispositions": sorted(DISPOSITIONS),
            "sourceMaxBytes": 250000, "sourceTextMaxCharacters": 150000,
            "scope": _scope(state, {}) if state else None,
            "source": {"url": RFP, "pages": [12, 13], "tasks": ["1.2", "3.4(i)", "3.4(iii)", "3.4(iv)"]}}


def prepare_source(state, payload):
    """Pure source import preview. Binary bytes and review text stay separate."""
    section = _read(state)
    key = _text(payload.get("sourceKey"), "Source code", 100)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", key):
        raise ValueError("Source code uses letters, numbers, dots, hyphens and underscores")
    source_text = _text(payload.get("text"), "Notes / extracted text", 150000, preserve=True)
    encoded = payload.get("originalBase64")
    if encoded:
        try:
            original = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            raise ValueError("Original file is not valid base64") from None
    else:
        original = source_text.encode("utf-8")
    if not original or len(original) > 250000:
        raise ValueError("Original file must contain 1–250000 bytes")
    filename = _text(payload.get("filename", key + ".txt"), "Filename", 200)
    if "/" in filename or "\\" in filename or filename in {".", ".."}:
        raise ValueError("Use a filename without a directory")
    media = _text(payload.get("mime", "text/plain"), "Media type", 100)
    row = {"sourceKey": key, "publicLabel": _text(payload.get("publicLabel", key), "Report label", 160),
           "title": _text(payload.get("title"), "Source title", 240),
           "group": _choice(payload.get("group"), GROUPS, "stakeholder group"),
           "interviewDate": _date(payload.get("interviewDate", ""), "Interview date"),
           "receivedDate": _date(payload.get("receivedDate"), "Received date", True),
           "reference": _text(payload.get("reference"), "Municipality source reference", 1000),
           "providedBy": _text(payload.get("providedBy"), "Source custodian", 160),
           "filename": filename, "mime": media, "originalBase64": base64.b64encode(original).decode("ascii"),
           "originalBytes": len(original), "originalSha256": _sha(original),
           "text": source_text, "textSha256": _sha(source_text.encode("utf-8")), **_scope(state, payload)}
    fingerprint = _sha(_bytes(row))
    row["fingerprint"] = fingerprint
    previous = _current(section).get(key)
    identical = next((x for x in section["sources"] if x["fingerprint"] == fingerprint), None)
    row.update(id="source-" + fingerprint[:24], version=(previous["version"] + 1 if previous else 1),
               supersedes=previous["id"] if previous else None)
    return {"status": "IDENTICAL" if identical else ("CORRECTION" if previous else "NEW"),
            "existingId": identical["id"] if identical else None,
            "expectedSourceId": previous["id"] if previous else None, "source": row}


def _versioned(rows, payload, record, kind, actor):
    identifier = payload.get("id")
    current = _lookup(rows, identifier, kind) if identifier else None
    expected = payload.get("expectedVersion", 0)
    if type(expected) is not int or expected != (current["version"] if current else 0):
        raise ValueError(f"{kind} changed; reopen its current version")
    history = (current.get("history", []) + [{k: v for k, v in current.items() if k != "history"}]) if current else []
    identifier = current["id"] if current else kind + "-" + _sha(_bytes(record) + payload["operationId"].encode())[:24]
    record.update(id=identifier, version=expected + 1, history=history, actor=actor, updatedAt=_now())
    if current:
        rows[rows.index(current)] = record
    else:
        rows.append(record)
    return identifier


def apply_interview_action(state, payload):
    """Mutate only the original host's draft; return its normal event result."""
    action = _choice(payload.get("action"), ACTIONS, "interview action")
    operation_id = _text(payload.get("operationId"), "Operation ID", 160)
    actor = _text(payload.get("actor"), "Analyst / recorder", 160)
    section = _section(state)
    request_hash = _sha(_bytes({k: v for k, v in payload.items() if k != "expectedRevision"}))
    previous = section["operations"].get(operation_id)
    if previous:
        if previous["requestSha256"] != request_hash:
            raise ValueError("Operation ID already describes a different request")
        return {**previous["result"], "replayed": True}
    result = {"event": action.upper().replace(".", "_")}
    if action == "interviews.import":
        preview = prepare_source(state, payload)
        if preview["status"] == "IDENTICAL":
            result.update(id=preview["existingId"], duplicate=True)
        else:
            if payload.get("expectedSourceId") != preview["expectedSourceId"]:
                raise ValueError("Source code already exists; review its current version before applying a correction")
            source = preview["source"]
            source.update(importedAt=_now(), importedBy=actor)
            section["sources"].append(source)
            result.update(id=source["id"], version=source["version"])
    elif action == "interviews.excerpt":
        source = _lookup(section["sources"], payload.get("sourceId"), "source edition")
        quote = _text(payload.get("quote"), "Exact excerpt", 3000, preserve=True)
        occurrence = payload.get("occurrence", 1)
        if type(occurrence) is not int or occurrence < 1 or occurrence > 1000:
            raise ValueError("Occurrence must be a positive integer")
        start = -1
        for _ in range(occurrence):
            start = source["text"].find(quote, start + 1)
            if start < 0:
                raise ValueError("The selected exact excerpt occurrence is absent from this retained source")
        row = {"sourceId": source["id"], "quote": quote, "start": start, "end": start + len(quote),
               "lineStart": source["text"].count("\n", 0, start) + 1,
               "lineEnd": source["text"].count("\n", 0, start + len(quote)) + 1,
               "pageLabel": _text(payload.get("pageLabel", ""), "Original page / section", 160, False),
               "themes": _list(payload.get("themes", []), THEMES, "themes", True),
               "interpretation": _text(payload.get("interpretation"), "Analyst interpretation", 3000),
               "visibility": _choice(payload.get("visibility", "INTERNAL"), {"INTERNAL", "SUMMARY", "PUBLIC_QUOTE"}, "excerpt publication use"),
               **_scope(state, payload)}
        row["id"] = "excerpt-" + _sha(_bytes(row))[:24]
        if not any(x["id"] == row["id"] for x in section["excerpts"]):
            row.update(actor=actor, createdAt=_now())
            section["excerpts"].append(row)
        result["id"] = row["id"]
    elif action == "interviews.finding":
        evidence = payload.get("evidence", [])
        if not isinstance(evidence, list) or not evidence or len(evidence) > 100:
            raise ValueError("A finding needs at least one exact excerpt reference")
        refs = []
        for entry in evidence:
            excerpt = _lookup(section["excerpts"], entry.get("excerptId"), "excerpt")
            ref = {"excerptId": excerpt["id"], "relationship": _choice(entry.get("relationship"), {"SUPPORT", "CHALLENGE", "CONTEXT"}, "evidence relationship")}
            if ref["excerptId"] in [x["excerptId"] for x in refs]:
                raise ValueError("Select each excerpt only once per finding")
            refs.append(ref)
        row = {"kind": _choice(payload.get("kind"), KINDS, "finding kind"),
               "status": _choice(payload.get("status", "DRAFT"), {"DRAFT", "READY", "WITHDRAWN"}, "finding status"),
               "title": _text(payload.get("title"), "Finding title", 240),
               "statement": {"it": _text(payload.get("statementIt"), "Italian finding", 5000),
                             "en": _text(payload.get("statementEn"), "English finding", 5000)},
               "evidence": refs, "methodNote": _text(payload.get("methodNote", ""), "Method / uncertainty note", 3000, False),
               **_scope(state, payload)}
        result["id"] = _versioned(section["findings"], payload, row, "finding", actor)
    elif action == "interviews.validation":
        finding = _lookup(section["findings"], payload.get("findingId"), "finding")
        status = _choice(payload.get("status"), {"PROPOSED", "MUNICIPAL_RECORD"}, "validation status")
        basis = payload.get("decisionSourceId") or None
        if basis:
            _lookup(section["sources"], basis, "decision source")
        if status == "MUNICIPAL_RECORD" and not basis:
            raise ValueError("A recorded municipal decision needs its retained decision note")
        row = {"findingId": finding["id"], "findingVersion": finding["version"], "status": status,
               "disposition": _choice(payload.get("disposition"), DISPOSITIONS, "disposition"),
               "response": {"it": _text(payload.get("responseIt"), "Italian disposition", 4000),
                            "en": _text(payload.get("responseEn"), "English disposition", 4000)},
               "owner": _text(payload.get("owner"), "Responsible role", 200),
               "decisionDate": _date(payload.get("decisionDate", ""), "Decision date", status == "MUNICIPAL_RECORD"),
               "dueDate": _date(payload.get("dueDate", ""), "Target date"),
               "decisionSourceId": basis, "reference": _text(payload.get("reference", ""), "Decision reference", 1000, status == "MUNICIPAL_RECORD")}
        result["id"] = _versioned(section["validations"], payload, row, "validation", actor)
    elif action == "interviews.meeting":
        number = payload.get("number")
        if type(number) is not int or number not in {1, 2}:
            raise ValueError("The RfP provides up to two public-meeting material sets")
        selected = _list(payload.get("findingIds", []), [x["id"] for x in section["findings"]], "meeting findings")
        prompts = payload.get("prompts", [])
        if not isinstance(prompts, list) or len(prompts) > 8:
            raise ValueError("Use up to eight discussion prompts")
        row = {"number": number, "title": _text(payload.get("title"), "Italian meeting title", 240),
               "purpose": _text(payload.get("purpose"), "Italian meeting purpose", 2000),
               "audience": _text(payload.get("audience"), "Intended audience", 240),
               "findingIds": selected, "prompts": [_text(x, "Discussion prompt", 600) for x in prompts],
               "nextDecision": _text(payload.get("nextDecision"), "Decision requested from Municipality", 2000),
               **_scope(state, payload)}
        current = next((x for x in section["meetings"] if x["number"] == number), None)
        actual_payload = {**payload, "id": current["id"] if current else None}
        result["id"] = _versioned(section["meetings"], actual_payload, row, "meeting", actor)
    elif action == "interviews.sourceReview":
        source = _lookup(section["sources"], payload.get("sourceId"), "source edition")
        excluded = payload.get("excluded")
        if not isinstance(excluded, bool):
            raise ValueError("Excluded must be true or false")
        previous_review = section["sourceReviews"].get(source["id"])
        section["sourceReviews"][source["id"]] = {"excluded": excluded,
            "reason": _text(payload.get("reason"), "Source disposition reason", 2000),
            "actor": actor, "at": _now(), "previous": previous_review}
        result["id"] = source["id"]
    section["operations"][operation_id] = {"requestSha256": request_hash, "result": copy.deepcopy(result), "at": _now()}
    return result


def analyze(state):
    section = _read(state)
    current = _current(section)
    latest_ids = {x["id"] for x in current.values()}
    active = [x for x in current.values() if not section["sourceReviews"].get(x["id"], {}).get("excluded")]
    active_ids = {x["id"] for x in active}
    source_map = {x["id"]: x for x in section["sources"]}
    excerpt_map = {x["id"]: x for x in section["excerpts"]}
    themes = []
    for code, labels in THEMES.items():
        excerpts = [x for x in section["excerpts"] if x["sourceId"] in active_ids and code in x["themes"]]
        themes.append({"code": code, "label": labels, "documents": len({x["sourceId"] for x in excerpts}),
                       "excerpts": len(excerpts), "denominatorDocuments": len(active),
                       "sourceIds": sorted({x["sourceId"] for x in excerpts})})
    def source_ref(source):
        return {"id": source["id"], "sourceKey": source["sourceKey"], "label": source["publicLabel"],
                "version": source["version"], "current": source["id"] in latest_ids,
                "excluded": bool(section["sourceReviews"].get(source["id"], {}).get("excluded")),
                "originalSha256": source["originalSha256"], "textSha256": source["textSha256"]}
    findings = []
    for finding in section["findings"]:
        row = {k: copy.deepcopy(v) for k, v in finding.items() if k not in {"history", "evidence"}}
        row["evidence"] = []
        for ref in finding["evidence"]:
            excerpt = excerpt_map[ref["excerptId"]]
            evidence = {"excerptId": excerpt["id"], "relationship": ref["relationship"],
                        "source": source_ref(source_map[excerpt["sourceId"]]),
                        "lineStart": excerpt["lineStart"], "lineEnd": excerpt["lineEnd"],
                        "pageLabel": excerpt["pageLabel"], "themes": excerpt["themes"], "visibility": excerpt["visibility"]}
            if excerpt["visibility"] == "PUBLIC_QUOTE":
                evidence["quote"] = excerpt["quote"]
            row["evidence"].append(evidence)
        row["historicalEvidence"] = any(not e["source"]["current"] or e["source"]["excluded"] for e in row["evidence"])
        findings.append(row)
    validations = [{k: copy.deepcopy(v) for k, v in x.items() if k != "history"} for x in section["validations"]]
    versions = {x["id"]: x["version"] for x in section["findings"]}
    for row in validations:
        row["findingChanged"] = row["findingVersion"] != versions[row["findingId"]]
        if row["decisionSourceId"]:
            row["decisionSource"] = source_ref(source_map[row["decisionSourceId"]])
    by_group = [{"code": k, "label": v, "documents": sum(x["group"] == k for x in active)} for k, v in GROUPS.items()]
    by_street = [{"id": key, "label": val, "documents": sum(key in x["streetIds"] for x in active)} for key, val in state["baseline"]["streets"].items()]
    return {"schema": "bologna-interview-analysis/v1", "workspaceRevision": state["revision"],
            "method": {"source": RFP, "pages": [12, 13], "unit": "retained source document",
                       "denominator": "current, included source documents; several notes can concern one stakeholder and one note can concern several people",
                       "interpretation": "Document and theme counts describe the retained qualitative corpus. They are not population estimates, unique participant counts or scenario scores."},
            "coverage": {"currentDocuments": len(active), "allEditions": len(section["sources"]),
                         "excludedCurrentDocuments": len(current) - len(active), "codedExcerpts": len(section["excerpts"]),
                         "currentCodedDocuments": len({x["sourceId"] for x in section["excerpts"] if x["sourceId"] in active_ids}),
                         "findings": len(findings), "readyFindings": sum(x["status"] == "READY" for x in findings),
                         "recordedDecisions": sum(x["status"] == "MUNICIPAL_RECORD" for x in validations),
                         "proposedDispositions": sum(x["status"] == "PROPOSED" for x in validations)},
            "sources": [source_ref(x) for x in section["sources"]], "groups": by_group, "streets": by_street,
            "themes": themes, "findings": findings, "validations": validations,
            "meetings": [{k: copy.deepcopy(v) for k, v in x.items() if k != "history"} for x in section["meetings"]]}


def _esc(value):
    return html.escape(str(value if value is not None else ""), quote=True)


def _citation(ref):
    source = ref["source"]
    return f"{_esc(source['label'])} v{source['version']}, {_esc(ref['pageLabel'])} · L{ref['lineStart']}–{ref['lineEnd']}" + (" · edizione storica / historical edition" if not source["current"] else "") + (" · fonte esclusa / excluded source" if source["excluded"] else "")


CSS = """body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;max-width:1080px;margin:32px auto;padding:0 24px}h1{font-size:30px;line-height:1.15}h2{font-size:23px;margin-top:30px}h3{font-size:18px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #aaa;padding:9px;vertical-align:top;text-align:left}th{background:#eee}small,.muted{color:#555}.note{border-left:4px solid #777;padding:10px 16px;background:#f5f5f5}.finding{border:1px solid #aaa;padding:16px;margin:14px 0;break-inside:avoid}.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}code{overflow-wrap:anywhere;font-size:11px}blockquote{margin:8px 0;padding:8px 16px;border-left:2px solid #aaa}.slide{min-height:520px;padding:30px;border-bottom:2px solid #222;break-after:page}.slide h2{margin-top:0}.slide:last-child{break-after:auto}@media(max-width:650px){body{padding:0 12px}.cols{display:block}table{font-size:13px}.slide{padding:16px;min-height:0}}@media print{body{margin:0;max-width:none;font-size:11pt;padding:0}a{color:inherit}.slide{min-height:167mm;height:auto;box-sizing:border-box;padding:12mm}.controls{display:none}}"""


def render_report(analysis):
    coverage = analysis["coverage"]
    theme_rows = "".join(f"<tr><td>{_esc(t['label']['it'])}<br><small lang='en'>{_esc(t['label']['en'])}</small></td><td>{t['documents']} / {t['denominatorDocuments']}</td><td>{t['excerpts']}</td></tr>" for t in analysis["themes"])
    findings = []
    for f in analysis["findings"]:
        evidence = "".join(f"<li>{_esc(e['relationship'])} · {_citation(e)}" + (f"<blockquote>{_esc(e['quote'])}</blockquote>" if "quote" in e else "") + "</li>" for e in f["evidence"])
        findings.append(f"<article class='finding'><small>{_esc(f['id'])} v{f['version']} · {_esc(f['kind'])} · {_esc(f['status'])}</small><h3>{_esc(f['title'])}</h3><div class='cols'><p lang='it'>{_esc(f['statement']['it'])}</p><p lang='en'>{_esc(f['statement']['en'])}</p></div><p class='muted'>{_esc(f['methodNote'])}</p><ul>{evidence}</ul></article>")
    decisions = "".join(f"<tr><td>{_esc(v['findingId'])} v{v['findingVersion']}" + ("<br>Revisione successiva da riconciliare / Later finding revision" if v['findingChanged'] else "") + f"</td><td>{_esc(v['status'])}<br>{_esc(v['disposition'])}</td><td lang='it'>{_esc(v['response']['it'])}</td><td lang='en'>{_esc(v['response']['en'])}</td><td>{_esc(v['owner'])}<br>{_esc(v['dueDate'])}</td><td>{_esc(v['reference'])}</td></tr>" for v in analysis["validations"])
    sources = "".join(f"<tr><td>{_esc(s['label'])} v{s['version']}</td><td>{_esc(s['id'])}</td><td><code>{s['originalSha256']}</code><br><code>{s['textSha256']}</code></td></tr>" for s in analysis["sources"])
    return f"""<!doctype html><html lang='it'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Bologna · Analisi delle interviste / Interview analysis</title><style>{CSS}</style></head><body><h1>Bologna · Analisi delle interviste</h1><p lang='en'>Municipal interview analysis and validation · workspace revision {analysis['workspaceRevision']}</p><p class='note'>Documenti correnti inclusi: <strong>{coverage['currentDocuments']}</strong>; documenti codificati: <strong>{coverage['currentCodedDocuments']}</strong>; risultati pronti: <strong>{coverage['readyFindings']}</strong>; decisioni comunali registrate: <strong>{coverage['recordedDecisions']}</strong>.</p><p>Il denominatore è il numero di documenti correnti inclusi. Più documenti possono riferirsi allo stesso interlocutore; un documento può includere più persone. Le frequenze descrivono questo corpus qualitativo e non la popolazione, le risposte al questionario o i punteggi degli scenari.</p><p lang='en'>{_esc(analysis['method']['interpretation'])}</p><h2>Temi / Themes</h2><table><thead><tr><th>Tema / Theme</th><th>Documenti / Included documents</th><th>Estratti / Excerpts</th></tr></thead><tbody>{theme_rows}</tbody></table><h2>Risultati e fonti / Findings and evidence</h2>{''.join(findings) or '<p>Nessun risultato registrato / No findings recorded.</p>'}<h2>Risposte e validazione / Dispositions and validation</h2><table><thead><tr><th>Risultato / Finding</th><th>Stato / Status</th><th>Italiano</th><th>English</th><th>Responsabile e termine / Owner and target</th><th>Riferimento / Reference</th></tr></thead><tbody>{decisions}</tbody></table><h2>Registro delle fonti / Source register</h2><p>Le note originali e gli estratti per solo uso interno restano nel workspace. Qui sono mantenuti i riferimenti alle versioni utilizzate.</p><table><thead><tr><th>Etichetta / Label</th><th>ID edizione / Edition ID</th><th>SHA-256 originale e testo / Original and text SHA-256</th></tr></thead><tbody>{sources}</tbody></table><p>Metodo predisposto per <a href='{RFP}'>RfP SGA3-MCCC-029</a>, pp. 12–13, attività 1.2 e 3.4(i), (iii), (iv).</p></body></html>""".encode("utf-8")


def render_meeting(state, number, analysis=None):
    analysis = analyze(state) if analysis is None else analysis
    meeting = next((x for x in analysis["meetings"] if x["number"] == number), None)
    if not meeting:
        raise ValueError("Save this meeting material set before downloading it")
    selected = [x for x in analysis["findings"] if x["id"] in meeting["findingIds"]]
    coverage = analysis["coverage"]
    findings = "".join(f"<article class='finding'><h3>{_esc(f['title'])}</h3><p>{_esc(f['statement']['it'])}</p><small>{_esc(f['kind'])} · {_esc(f['status'])} · v{f['version']}</small><ul>" + "".join(f"<li>{_citation(e)}</li>" for e in f["evidence"]) + "</ul></article>" for f in selected)
    scenarios = [s for s in state["scenarios"] if s["id"] in meeting["scenarioIds"]]
    scenario_html = "".join(f"<article class='finding'><h3>{_esc(s['name']['it'])}</h3><p>Stato registrato: {_esc(s['status'])}.</p><p>Da discutere: organizzazione delle consegne, veicoli, spazi, condizioni operative e informazioni necessarie per la scelta comunale.</p></article>" for s in scenarios)
    validations = [v for v in analysis["validations"] if v["findingId"] in meeting["findingIds"]]
    responses = "".join(f"<li><strong>{_esc(v['disposition'])} · {_esc(v['status'])}</strong>: {_esc(v['response']['it'])}<br>{_esc(v['owner'])} · {_esc(v['dueDate'])}" + (" · Il risultato è stato successivamente modificato." if v["findingChanged"] else "") + "</li>" for v in validations)
    prompts = "".join(f"<li>{_esc(x)}</li>" for x in meeting["prompts"])
    streets = ", ".join(state["baseline"]["streets"].get(x, {"it": x})["it"] for x in meeting["streetIds"])
    return f"""<!doctype html><html lang='it'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{_esc(meeting['title'])}</title><style>{CSS}</style></head><body><div class='controls'><button onclick='window.print()'>Stampa / Salva PDF</button></div><section class='slide'><p>BOLOGNA · LOGISTICA URBANA · MATERIALI {_esc(number)}/2</p><h1>{_esc(meeting['title'])}</h1><p>{_esc(meeting['purpose'])}</p><p><strong>Destinatari:</strong> {_esc(meeting['audience'])}</p><p><strong>Strade:</strong> {_esc(streets)}</p><small>Materiali per la presentazione del Comune · revisione workspace {state['revision']} · versione {meeting['version']}</small></section><section class='slide'><h2>Da quali evidenze partiamo</h2><p>{coverage['currentDocuments']} documenti correnti inclusi; {coverage['currentCodedDocuments']} documenti con estratti codificati. I conteggi si riferiscono ai documenti disponibili, non al numero di persone o alla rappresentatività della popolazione.</p><p>Il dataset comunale di partenza è datato 30 giugno 2022: 264 punti e 570 stalli registrati nell'intero dataset. Il confronto con le condizioni attuali resta collegato alle fonti aggiornate e alla validazione comunale.</p><p>Le risposte al questionario mantengono il proprio campione e il proprio periodo di raccolta nel modulo dedicato.</p></section><section class='slide'><h2>Che cosa emerge dalle note</h2>{findings or '<p>Selezionare i risultati da presentare dopo la revisione delle fonti.</p>'}</section><section class='slide'><h2>Alternative da discutere</h2>{scenario_html or '<p>Selezionare gli scenari del workspace da discutere con il Comune.</p>'}</section><section class='slide'><h2>Punti da verificare insieme</h2><ol>{prompts}</ol><p class='note'>{_esc(meeting['nextDecision'])}</p></section><section class='slide'><h2>Risposte, responsabilità e prossime decisioni</h2><ul>{responses or '<li>Nessuna disposizione registrata per i risultati selezionati.</li>'}</ul><p>Distinguere le proposte da discutere dai verbali e dalle decisioni comunali già acquisiti. Riportare modifiche e conferme nel medesimo registro di validazione.</p><small>Riferimento: <a href='{RFP}'>SGA3-MCCC-029</a>, p. 13, attività 3.4. Il Comune guida la consultazione e presenta i materiali.</small></section></body></html>""".encode("utf-8")


def _csv(rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    for row in rows:
        writer.writerow(["'" + str(x) if isinstance(x, str) and x.startswith(("=", "+", "-", "@", "\t", "\r")) else x for x in row])
    return out.getvalue().encode("utf-8-sig")


def export_files(state, analysis=None):
    """Public report files. Full original bytes already live in native backup."""
    analysis = analyze(state) if analysis is None else analysis
    theme_rows = [["theme", "label_it", "label_en", "documents", "included_document_denominator", "coded_excerpts"]]
    theme_rows += [[t["code"], t["label"]["it"], t["label"]["en"], t["documents"], t["denominatorDocuments"], t["excerpts"]] for t in analysis["themes"]]
    finding_rows = [["id", "version", "kind", "status", "title", "statement_it", "statement_en", "street_ids", "scenario_ids", "exact_evidence_refs", "historical_evidence", "method_note"]]
    finding_rows += [[f["id"], f["version"], f["kind"], f["status"], f["title"], f["statement"]["it"], f["statement"]["en"], ";".join(f["streetIds"]), ";".join(f["scenarioIds"]), json.dumps(f["evidence"], ensure_ascii=False, sort_keys=True), f["historicalEvidence"], f["methodNote"]] for f in analysis["findings"]]
    files = {"interviews-report.json": _bytes(analysis), "interviews-report.html": render_report(analysis),
             "interviews-themes.csv": _csv(theme_rows), "interviews-findings.csv": _csv(finding_rows)}
    for meeting in analysis["meetings"]:
        files[f"interviews-meeting-{meeting['number']}.html"] = render_meeting(state, meeting["number"], analysis)
    return files


def get_resource(state, path):
    """Return (content_type, bytes) for the original server's narrow GET hook."""
    if path == "/api/interviews":
        return "application/json; charset=utf-8", _bytes({"schema": schema(state), "analysis": analyze(state)})
    if path == "/api/interviews/report":
        return "text/html; charset=utf-8", render_report(analyze(state))
    if path in {"/api/interviews/meeting/1", "/api/interviews/meeting/2"}:
        return "text/html; charset=utf-8", render_meeting(state, int(path[-1]))
    if path == "/api/interviews/export":
        return "application/zip", _archive(export_files(state), state["revision"])
    if path.startswith("/api/interviews/publication/"):
        parts = path.split("/")
        if len(parts) != 6 or parts[5] not in {"report", "export"}:
            raise ValueError("Unknown interview publication resource")
        publication = _lookup(state["publications"], parts[4], "publication")
        report = publication["report"]
        analysis = report.get("interviews")
        if not analysis:
            raise ValueError("This older publication predates the interview analysis")
        if parts[5] == "report":
            return "text/html; charset=utf-8", render_report(analysis)
        frozen_state = {"revision": analysis["workspaceRevision"], "baseline": report["baseline"], "scenarios": report["scenarios"]}
        return "application/zip", _archive(export_files(frozen_state, analysis), analysis["workspaceRevision"])
    if path.startswith("/api/interviews/source/"):
        identifier = path.rsplit("/", 1)[-1]
        source = _lookup(_read(state)["sources"], identifier, "source")
        original = base64.b64decode(source["originalBase64"], validate=True)
        if _sha(original) != source["originalSha256"]:
            raise ValueError("Retained original file checksum differs")
        return "application/octet-stream", original
    raise ValueError("Unknown interview resource")


def _archive(files, revision):
    stream = io.BytesIO()
    manifest = {"workspaceRevision": revision, "files": [{"path": n, "bytes": len(b), "sha256": _sha(b)} for n, b in files.items()]}
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            info = zipfile.ZipInfo(name, (2000, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
        archive.writestr(zipfile.ZipInfo("interviews-manifest.json", (2000, 1, 1, 0, 0, 0)), _bytes(manifest))
    return stream.getvalue()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Bologna interview and validation report exporter")
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    state = json.loads((args.state / "workspace.json").read_text("utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, content in export_files(state).items():
        path = args.out / name
        path.write_bytes(content)
        manifest.append({"path": name, "bytes": len(content), "sha256": _sha(content)})
    (args.out / "interviews-manifest.json").write_bytes(_bytes({"workspaceRevision": state["revision"], "files": manifest}))
    print(json.dumps({"workspaceRevision": state["revision"], "files": manifest}, ensure_ascii=False))


if __name__ == "__main__":
    main()
