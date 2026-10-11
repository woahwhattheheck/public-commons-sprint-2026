"""Survey intake and analyst operations for the existing Bologna workspace.

The caller owns locking, revision admission and persistence (model.mutate).
This module never writes another store, sends a survey or contacts a participant.
"""
from __future__ import annotations

import base64
import binascii
import copy
import csv
import hashlib
import html
import io
import json
import re
import statistics
from collections import Counter
from datetime import datetime, timezone

VERSION = "bologna-survey/v1"
MAX_BYTES = 512 * 1024
MAX_ROWS = 1000
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$")
FIELDS = ["respondentId", "questionnaireId", "language", "consent", "complete", "role", "streets",
          "deliveriesPerWeek", "vehicleTypes", "timeWindows", "constraints", "preferredMeasures", "note", "collectedOn"]
MULTI = ["streets", "vehicleTypes", "timeWindows", "constraints", "preferredMeasures"]
OPTIONS = {
    "role": {
        "logistics_operator": ["Operatore logistico", "Logistics operator"],
        "shopkeeper": ["Commerciante", "Shopkeeper"],
        "business_association": ["Associazione di categoria", "Business association"],
        "resident": ["Residente", "Resident"], "public_body": ["Ente pubblico", "Public body"],
        "other": ["Altro", "Other"]},
    "streets": {"VIA SAN FELICE": ["Via San Felice", "Via San Felice"],
                "VIA UGO BASSI": ["Via Ugo Bassi", "Via Ugo Bassi"],
                "VIA INDIPENDENZA": ["Via Indipendenza", "Via Indipendenza"],
                "VIA LAME": ["Via delle Lame", "Via Lame"], "VIA RIVA RENO": ["Via Riva Reno", "Via Riva Reno"], "OTHER_ZTL": ["Altra strada della ZTL", "Other ZTL street"]},
    "vehicleTypes": {"cargo_bike": ["Bici cargo", "Cargo bike"], "van": ["Furgone", "Van"],
                     "truck": ["Autocarro", "Truck"], "car": ["Automobile", "Car"],
                     "walking": ["A piedi", "Walking"], "other": ["Altro", "Other"],
                     "not_applicable": ["Non applicabile", "Not applicable"]},
    "timeWindows": {"before_07": ["Prima delle 07:00", "Before 07:00"],
                    "07_10": ["07:00–10:00", "07:00–10:00"], "10_13": ["10:00–13:00", "10:00–13:00"],
                    "13_16": ["13:00–16:00", "13:00–16:00"], "16_20": ["16:00–20:00", "16:00–20:00"],
                    "after_20": ["Dopo le 20:00", "After 20:00"], "variable": ["Variabile", "Variable"],
                    "not_applicable": ["Non applicabile", "Not applicable"]},
    "constraints": {"loading_space": ["Disponibilità di stalli", "Loading-space availability"],
                    "access_windows": ["Finestre di accesso", "Access windows"],
                    "construction": ["Cantieri", "Construction"], "walking_conflict": ["Conflitti con pedoni", "Pedestrian conflicts"],
                    "cost": ["Costi operativi", "Operating costs"], "reliability": ["Affidabilità", "Reliability"],
                    "none": ["Nessuna difficoltà segnalata", "No difficulty reported"], "other": ["Altro", "Other"]},
    "preferredMeasures": {"loading_management": ["Gestione degli stalli", "Loading-space management"],
                          "access_coordination": ["Coordinamento degli accessi", "Access coordination"],
                          "consolidation": ["Consolidamento delle consegne", "Delivery consolidation"],
                          "cargo_bikes": ["Consegne con bici cargo", "Cargo-bike deliveries"],
                          "lockers": ["Armadietti per pacchi", "Parcel lockers"],
                          "information": ["Informazioni operative", "Operating information"],
                          "none": ["Nessuna misura indicata", "No measure selected"], "other": ["Altro", "Other"]}}
LABELS = {"role": ["Ruolo", "Role"], "streets": ["Strade interessate", "Streets concerned"],
          "deliveriesPerWeek": ["Consegne effettuate o ricevute in una settimana tipica", "Deliveries made or received in a typical week"],
          "vehicleTypes": ["Mezzi utilizzati", "Vehicle types"], "timeWindows": ["Orari abituali delle consegne", "Usual delivery times"],
          "constraints": ["Difficoltà osservate", "Observed difficulties"],
          "preferredMeasures": ["Misure da valutare", "Measures to consider"],
          "note": ["Osservazioni aggiuntive, senza nomi o recapiti", "Additional observations, without names or contact details"]}
METHOD = {
    "en": "Descriptive results for supplied, included, completed responses. Category percentages use respondents answering that question; unanswered questions remain missing. Multiple selections and overlapping street groups are non-additive. Delivery frequency is self-reported and is not a count of unique trips. These records do not establish population prevalence, traffic demand or causal effects.",
    "it": "Risultati descrittivi delle risposte fornite, incluse e complete. Le percentuali per categoria utilizzano i rispondenti alla relativa domanda; le domande senza risposta restano mancanti. Selezioni multiple e gruppi di strade sovrapposti non sono additivi. La frequenza delle consegne è autodichiarata e non conta viaggi unici. I dati non determinano prevalenza nella popolazione, domanda di traffico o effetti causali."}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def _hash(value):
    return hashlib.sha256(value if isinstance(value, bytes) else _bytes(value)).hexdigest()


def _text(value, name, limit=2000, required=True):
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text")
    value = value.strip()
    if (required and not value) or len(value) > limit or "\x00" in value:
        raise ValueError(f"{name} must contain {'1' if required else '0'}–{limit} characters")
    return value


def _id(value, name="ID"):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError(f"{name} must be a pseudonymous identifier using letters, digits, _, ., : or -")
    return value


def _bool(value, name):
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower().strip() in {"true", "false", "1", "0"}:
        return value.lower().strip() in {"true", "1"}
    raise ValueError(f"{name} must be true or false")


def _surface(state):
    s = state["survey"]
    for name in ["questionnaires", "imports", "history", "themes", "findings"]:
        s.setdefault(name, [])
    s.setdefault("campaign", {})
    return s


def schema():
    return {"schema": VERSION, "columns": FIELDS, "multiSelectDelimiter": "|", "options": OPTIONS,
            "labels": LABELS, "maxBytes": MAX_BYTES, "maxRows": MAX_ROWS,
            "questionnaireId": "proposed-v1", "languages": ["it", "en"],
            "requiredHeaders": FIELDS[:6], "methods": METHOD,
            "instructions": "UTF-8 CSV. One row per pseudonymous respondent. Use true/false for consent and complete. Empty numeric fields are missing, not zero. Separate multiple codes with |. A completed response needs role and at least one street."}


def template_csv():
    out = io.StringIO(newline="")
    csv.writer(out).writerow(FIELDS)
    return out.getvalue().encode("utf-8")


def _current_questionnaire(state):
    values = state["survey"].get("questionnaires", [])
    if values:
        return copy.deepcopy(values[-1])
    return {"id": "proposed-v1", "title": "Logistica urbana nelle quattro strade pilota di Bologna",
            "introduction": "Descriva le attività e le difficoltà osservate nelle strade interessate. Non inserisca nomi, indirizzi precisi, recapiti o informazioni commerciali riservate. Le domande non pertinenti possono restare vuote.",
            "privacyNotice": "", "cohortId": "current", "sourceReference": "", "reviewer": "", "municipalityReference": "", "status": "PROPOSED",
            "questions": {key: labels[0] for key, labels in LABELS.items()}, "createdAt": None}


def _raw_csv(payload):
    encoded = payload.get("csvBase64")
    if not isinstance(encoded, str) or len(encoded) > MAX_BYTES * 4 // 3 + 8:
        raise ValueError("Provide csvBase64 for a CSV of at most 512 KiB")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Invalid CSV base64") from exc
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("CSV must contain 1–524288 bytes")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError as exc:
        raise ValueError("CSV must be UTF-8") from exc
    if "\x00" in text:
        raise ValueError("CSV contains a NUL character")
    return raw, text


def _normalized(row, known_questionnaires):
    rid = _id(row.get("respondentId"), "respondentId")
    qid = _id(row.get("questionnaireId"), "questionnaireId")
    if qid not in known_questionnaires:
        raise ValueError("Unknown questionnaireId; retain the questionnaire before importing its responses")
    language = row.get("language", "").strip()
    if language not in {"it", "en"}:
        raise ValueError("language must be it or en")
    if not _bool(row.get("consent"), "consent"):
        raise ValueError("Recorded consent is required by this workspace")
    complete = _bool(row.get("complete"), "complete")
    role = row.get("role", "").strip()
    if role not in OPTIONS["role"] and (role or complete):
        raise ValueError("Choose a declared role code")
    value = {"respondentId": rid, "questionnaireId": qid, "language": language, "consent": True,
             "complete": complete, "role": role}
    for field in MULTI:
        raw = row.get(field, "")
        items = raw.split("|") if isinstance(raw, str) else raw
        if not isinstance(items, list) or any(not isinstance(x, str) for x in items):
            raise ValueError(f"{field} must be a | separated list")
        items = list(dict.fromkeys(x.strip() for x in items if x.strip()))
        if any(x not in OPTIONS[field] for x in items):
            raise ValueError(f"Unknown {field} code")
        if len(items) > 1 and any(x in {"none", "not_applicable"} for x in items):
            raise ValueError(f"{field}: none/not_applicable cannot accompany another selection")
        value[field] = items
    if complete and not value["streets"]:
        raise ValueError("A completed response needs at least one street")
    number = row.get("deliveriesPerWeek", "")
    if number is None or (isinstance(number, str) and not number.strip()):
        value["deliveriesPerWeek"] = None
    else:
        if isinstance(number, bool) or not re.fullmatch(r"\d{1,5}", str(number).strip()):
            raise ValueError("deliveriesPerWeek must be an integer or empty")
        number = int(number)
        if not 0 <= number <= 10000:
            raise ValueError("deliveriesPerWeek must be from 0 to 10000")
        value["deliveriesPerWeek"] = number
    collected = row.get("collectedOn", "").strip()
    if collected:
        try:
            datetime.strptime(collected, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("collectedOn must be YYYY-MM-DD or empty") from exc
    value["collectedOn"] = collected
    value["note"] = _text(row.get("note", ""), "note", 2000, False)
    # Keep the original workspace's single-response field for older readers.
    value["constraint"] = " | ".join(value["constraints"])
    return value


def _content(row):
    return {field: row.get(field) for field in FIELDS} | {"constraint": row.get("constraint", ""), "cohortId": row.get("cohortId", "current")}


def preview_import(state, payload):
    raw, text = _raw_csv(payload)
    filename = _text(payload.get("filename", "survey.csv"), "filename", 160)
    if "/" in filename or "\\" in filename:
        raise ValueError("Use a filename without a directory")
    qids = {"proposed-v1": {"cohortId": "current"}} | {x["id"]: x for x in state["survey"].get("questionnaires", [])}
    existing = {x["respondentId"]: x for x in state["survey"]["responses"]}
    reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
    try:
        headers = reader.fieldnames
        if not headers or len(set(headers)) != len(headers):
            raise ValueError("CSV needs unique headers")
        if set(headers) - set(FIELDS):
            raise ValueError("Unknown headers (names/contact columns are not accepted): " + ", ".join(sorted(set(headers) - set(FIELDS))))
        if set(FIELDS[:6]) - set(headers):
            raise ValueError("Missing required headers: " + ", ".join(sorted(set(FIELDS[:6]) - set(headers))))
        rows = []
        seen = set()
        for index, supplied in enumerate(reader, 1):
            if index > MAX_ROWS:
                raise ValueError("At most 1000 rows per reviewed import")
            item = {"row": index, "endLine": reader.line_num, "status": "INVALID", "errors": []}
            try:
                if None in supplied or any(x is None for x in supplied.values()):
                    raise ValueError("Row width differs from header")
                value = _normalized(supplied, qids)
                value["cohortId"] = qids[value["questionnaireId"]].get("cohortId", "current")
                rid = value["respondentId"]
                if rid in seen:
                    raise ValueError("Duplicate respondentId inside the same file")
                seen.add(rid)
                before = existing.get(rid)
                if before and before.get("cohortId", "current") != value["cohortId"]:
                    raise ValueError("Respondent ID belongs to a different cohort; use a cohort-prefixed pseudonym to retain both observations")
                item.update(response=value, before=copy.deepcopy(before), beforeSha256=_hash(before) if before else None,
                            status="NEW" if before is None else "SAME" if _content(before) == _content(value) else "CORRECTION")
            except ValueError as exc:
                item["errors"].append(str(exc))
                item["respondentId"] = str(supplied.get("respondentId", ""))[:100]
            rows.append(item)
    except csv.Error as exc:
        raise ValueError(f"Malformed CSV near physical line {reader.line_num}: {exc}") from exc
    if not rows:
        raise ValueError("The CSV contains a header but no response rows")
    digest = _hash(raw)
    review = {"schema": VERSION, "workspaceRevision": state["revision"], "filename": filename,
              "sourceSha256": digest, "sourceBytes": len(raw), "rows": rows}
    review["reviewToken"] = _hash(review)
    review["counts"] = dict(Counter(x["status"] for x in rows))
    review["alreadyImported"] = [x["id"] for x in state["survey"].get("imports", []) if x["sourceSha256"] == digest]
    return review


def _respondent(survey, rid):
    return next((x for x in survey["responses"] if x["respondentId"] == rid), None)


def apply(state, payload):
    """Apply one survey action within the original workspace's atomic mutation."""
    s = _surface(state)
    action = payload.get("action")
    reviewer = _text(payload.get("reviewer", ""), "reviewer", 160)
    now = _now()
    if action == "survey.questionnaire":
        questions = payload.get("questions", {})
        if not isinstance(questions, dict) or set(questions) - set(LABELS):
            raise ValueError("Only the declared question wording can be edited")
        q = {"id": f"q-{len(s['questionnaires']) + 1}-{state['revision'] + 1}",
             "title": _text(payload.get("title", ""), "title", 240),
             "introduction": _text(payload.get("introduction", ""), "introduction", 3000),
             "privacyNotice": _text(payload.get("privacyNotice", ""), "privacyNotice", 4000, False),
             "municipalityReference": _text(payload.get("municipalityReference", ""), "municipalityReference", 1000, False),
             "cohortId": _id(payload.get("cohortId", "current"), "cohortId"),
             "sourceReference": _text(payload.get("sourceReference", ""), "sourceReference", 2000, False),
             "status": payload.get("status", "PROPOSED"), "reviewer": reviewer, "createdAt": now,
             "questions": {key: _text(questions.get(key, labels[0]), key, 500) for key, labels in LABELS.items()}}
        if q["status"] not in {"PROPOSED", "REVIEWED"}:
            raise ValueError("Questionnaire status must be PROPOSED or REVIEWED")
        s["questionnaires"].append(q)
        return {"event": "SURVEY_QUESTIONNAIRE_RETAINED", "id": q["id"]}
    if action == "survey.import":
        review = preview_import(state, payload)
        if payload.get("reviewToken") != review["reviewToken"]:
            raise ValueError("Import source or preview changed; preview and review the exact file again")
        if payload.get("nonIdentifyingReviewed") is not True:
            raise ValueError("Review the file for names, contact details and identifying free text before retention")
        choices = payload.get("choices")
        if not isinstance(choices, dict) or set(choices) != {str(x["row"]) for x in review["rows"]}:
            raise ValueError("Choose add, replace or skip explicitly for every preview row")
        reason = _text(payload.get("reason", ""), "import/correction reason", 2000)
        capture_id = f"import-{state['revision'] + 1}-{review['sourceSha256'][:12]}"
        totals = Counter()
        for item in review["rows"]:
            choice = choices[str(item["row"])]
            allowed = {"NEW": {"add", "skip"}, "CORRECTION": {"replace", "skip"}, "SAME": {"skip"}, "INVALID": {"skip"}}[item["status"]]
            if choice not in allowed:
                raise ValueError(f"Row {item['row']}: choose from {', '.join(sorted(allowed))}")
            totals[choice] += 1
            if choice == "skip":
                continue
            value = copy.deepcopy(item["response"])
            before = _respondent(s, value["respondentId"])
            value.update(recordedAt=before.get("recordedAt", now) if before else now, updatedAt=now,
                         included=before.get("included", True) if before else True,
                         exclusion=copy.deepcopy(before.get("exclusion")) if before else None,
                         source={"importId": capture_id, "sourceSha256": review["sourceSha256"], "row": item["row"], "endLine": item["endLine"]},
                         responseRevision=(before.get("responseRevision", 0) + 1) if before else 1,
                         coding=copy.deepcopy(before.get("coding", {})) if before else {})
            s["history"].append({"at": now, "reviewer": reviewer, "reason": reason, "kind": choice.upper(),
                                 "respondentId": value["respondentId"], "before": copy.deepcopy(before), "after": copy.deepcopy(value)})
            if before is not None:
                s["responses"][s["responses"].index(before)] = value
            else:
                s["responses"].append(value)
        s["imports"].append({"id": capture_id, "filename": review["filename"], "sourceSha256": review["sourceSha256"],
                             "sourceBytes": review["sourceBytes"], "csvBase64": payload["csvBase64"], "importedAt": now,
                             "reviewer": reviewer, "reason": reason, "choices": copy.deepcopy(choices), "counts": dict(totals),
                             "previewToken": review["reviewToken"], "nonIdentifyingReviewed": True})
        return {"event": "SURVEY_IMPORT_REVIEWED", "id": capture_id, "counts": dict(totals)}
    if action == "survey.inclusion":
        row = _respondent(s, payload.get("respondentId"))
        if row is None or not isinstance(payload.get("included"), bool):
            raise ValueError("Choose an existing response and boolean included")
        if payload.get("expectedResponseSha256") and payload["expectedResponseSha256"] != _hash(_content(row)):
            raise ValueError("Response changed; reopen it before deciding inclusion")
        reason = _text(payload.get("reason", ""), "reason", 2000)
        before = copy.deepcopy(row)
        row.update(included=payload["included"], exclusion={"reason": reason, "reviewer": reviewer, "at": now}, updatedAt=now)
        s["history"].append({"at": now, "reviewer": reviewer, "reason": reason, "kind": "INCLUSION",
                             "respondentId": row["respondentId"], "before": before, "after": copy.deepcopy(row)})
        return {"event": "SURVEY_INCLUSION_REVIEWED", "id": row["respondentId"]}
    if action == "survey.theme":
        code = _id(payload.get("id"), "theme id")
        theme = {"id": code, "it": _text(payload.get("it", ""), "Italian theme", 240),
                 "en": _text(payload.get("en", ""), "English theme", 240), "reviewer": reviewer, "updatedAt": now}
        old = next((x for x in s["themes"] if x["id"] == code), None)
        s["history"].append({"kind": "THEME", "at": now, "reviewer": reviewer, "before": copy.deepcopy(old), "after": theme})
        if old:
            s["themes"][s["themes"].index(old)] = theme
        else:
            s["themes"].append(theme)
        return {"event": "SURVEY_THEME_SAVED", "id": code}
    if action == "survey.code":
        row = _respondent(s, payload.get("respondentId"))
        if row is None:
            raise ValueError("Unknown response")
        if payload.get("expectedResponseSha256") and payload["expectedResponseSha256"] != _hash(_content(row)):
            raise ValueError("Response changed; reopen it before coding")
        codes = payload.get("themes", [])
        if not isinstance(codes, list) or any(x not in {t['id'] for t in s['themes']} for x in codes):
            raise ValueError("Choose declared theme IDs")
        before = copy.deepcopy(row.get("coding", {}))
        row["coding"] = {"themes": list(dict.fromkeys(codes)), "note": _text(payload.get("note", ""), "coding note", 2000, False),
                         "reviewer": reviewer, "at": now, "responseSha256": _hash(_content(row))}
        s["history"].append({"kind": "CODING", "at": now, "reviewer": reviewer, "respondentId": row["respondentId"],
                             "before": before, "after": copy.deepcopy(row["coding"])})
        return {"event": "SURVEY_RESPONSE_CODED", "id": row["respondentId"]}
    if action == "survey.finding":
        selected = payload.get("respondentIds", [])
        if not isinstance(selected, list) or not selected or any(not isinstance(x, str) for x in selected):
            raise ValueError("Select at least one response for the finding")
        rows = [_respondent(s, rid) for rid in dict.fromkeys(selected)]
        if any(row is None or not row.get("included", True) or row.get("consent") is not True for row in rows):
            raise ValueError("Finding references must be current included responses")
        expected = payload.get("expectedEvidence")
        if expected is not None:
            if not isinstance(expected, dict) or set(expected) != {r["respondentId"] for r in rows}:
                raise ValueError("Evidence review must bind every selected response")
            if any(expected[r["respondentId"]] != _hash(_content(r)) for r in rows):
                raise ValueError("Evidence changed; reopen and reselect the changed responses")
        scenario_ids, decision_ids = payload.get("scenarioIds", []), payload.get("decisionIds", [])
        for ids, collection, name in [(scenario_ids, state.get("scenarios", []), "scenario"), (decision_ids, state.get("decisions", []), "decision")]:
            if not isinstance(ids, list) or any(x not in {r["id"] for r in collection} for x in ids):
                raise ValueError(f"Unknown {name} reference")
        fid = payload.get("id") or f"finding-{state['revision'] + 1}"
        _id(fid, "finding id")
        old = next((x for x in s["findings"] if x["id"] == fid), None)
        finding = {"id": fid, "revision": old["revision"] + 1 if old else 1,
                   "it": _text(payload.get("it", ""), "Italian finding", 4000),
                   "en": _text(payload.get("en", ""), "English finding", 4000),
                   "evidence": [{"respondentId": r["respondentId"], "responseSha256": _hash(_content(r))} for r in rows],
                   "scenarioIds": list(dict.fromkeys(scenario_ids)), "decisionIds": list(dict.fromkeys(decision_ids)),
                   "reviewer": reviewer, "at": now}
        s["history"].append({"kind": "FINDING", "at": now, "reviewer": reviewer, "before": copy.deepcopy(old), "after": finding})
        if old:
            s["findings"][s["findings"].index(old)] = finding
        else:
            s["findings"].append(finding)
        return {"event": "SURVEY_FINDING_SAVED", "id": fid}
    if action == "survey.campaign":
        campaign = {key: _text(payload.get(key, ""), key, 2000, False) for key in
                    ["population", "municipalityReference", "openedOn", "closedOn", "reminderDate", "reminderReference", "notes"]}
        for key in ["openedOn", "closedOn", "reminderDate"]:
            if campaign[key]:
                try:
                    datetime.strptime(campaign[key], "%Y-%m-%d")
                except ValueError as exc:
                    raise ValueError(f"{key} must be YYYY-MM-DD") from exc
        if campaign["openedOn"] and campaign["closedOn"] and campaign["openedOn"] > campaign["closedOn"]:
            raise ValueError("Collection close precedes its start")
        if campaign["reminderDate"] and not campaign["reminderReference"]:
            raise ValueError("Record the Municipality-coordinated reminder reference")
        cohort = _id(payload.get("targetCohort", "current"), "targetCohort")
        if cohort not in {"current"} | {q.get("cohortId", "current") for q in s["questionnaires"]}:
            raise ValueError("Choose a retained questionnaire cohort")
        campaign["targetCohort"] = cohort
        campaign.update(reviewer=reviewer, updatedAt=now, reminderRounds=1 if campaign["reminderDate"] else 0)
        s["history"].append({"kind": "CAMPAIGN", "at": now, "reviewer": reviewer, "before": copy.deepcopy(s["campaign"]), "after": campaign})
        s["campaign"] = campaign
        return {"event": "SURVEY_CAMPAIGN_RETAINED"}
    raise ValueError("Unknown survey action")


def _eligible(row):
    # Legacy single-entry responses were complete in the original questionnaire.
    return row.get("consent") is True and row.get("included", True) and row.get("complete", True)


def analyze(state, filters=None):
    filters = filters or {}
    if set(filters) - {"street", "role", "cohort"}:
        raise ValueError("Only street, role and cohort filters are supported")
    for key, field in [("street", "streets"), ("role", "role")]:
        if filters.get(key) and filters[key] not in OPTIONS[field]:
            raise ValueError(f"Unknown {key} filter")
    survey = state["survey"]
    all_rows = survey["responses"]
    eligible = [r for r in all_rows if _eligible(r)]
    target_cohort = survey.get("campaign", {}).get("targetCohort", "current")
    cohort = filters.get("cohort") or target_cohort
    cohorts = {"current"} | {q.get("cohortId", "current") for q in survey.get("questionnaires", [])}
    if cohort != "all" and cohort not in cohorts:
        raise ValueError("Unknown cohort filter")
    selected = [r for r in eligible if (cohort == "all" or r.get("cohortId", "current") == cohort) and (not filters.get("role") or r.get("role") == filters["role"]) and
                (not filters.get("street") or filters["street"] in r.get("streets", []))]
    tables = {}
    for field, options in OPTIONS.items():
        values = [([r.get(field)] if r.get(field) else []) if field == "role" else r.get(field, []) for r in selected]
        answered = sum(bool(v) for v in values)
        counts = Counter(code for choices in values for code in set(choices))
        all_options = dict(options)
        for code in counts:
            all_options.setdefault(code, [code, code])  # legacy free-text role is retained as its own category
        tables[field] = {"eligible": len(selected), "answered": answered, "missing": len(selected) - answered,
                         "multiSelect": field != "role", "rows": [{"code": code, "it": labels[0], "en": labels[1],
                         "count": counts[code], "percentOfAnswered": round(100 * counts[code] / answered, 2) if answered else None}
                         for code, labels in all_options.items()]}
    numbers = [r.get("deliveriesPerWeek") for r in selected if type(r.get("deliveriesPerWeek")) is int]
    delivery = {"eligible": len(selected), "answered": len(numbers), "missing": len(selected) - len(numbers),
                "sumReportedFrequencies": sum(numbers) if numbers else None,
                "mean": round(statistics.mean(numbers), 3) if numbers else None,
                "median": statistics.median(numbers) if numbers else None, "min": min(numbers) if numbers else None,
                "max": max(numbers) if numbers else None}
    themes = []
    coded = [r for r in selected if r.get("coding", {}).get("responseSha256") == _hash(_content(r))]
    for theme in survey.get("themes", []):
        count = sum(theme["id"] in r.get("coding", {}).get("themes", []) for r in coded)
        themes.append({"id": theme["id"], "it": theme["it"], "en": theme["en"], "count": count,
                       "codedResponses": len(coded), "eligible": len(selected),
                       "percentOfCoded": round(100 * count / len(coded), 2) if coded else None})
    findings = []
    for original in survey.get("findings", []):
        problems = 0
        for reference in original["evidence"]:
            row = _respondent(survey, reference["respondentId"])
            if row is None or not row.get("included", True) or row.get("consent") is not True or _hash(_content(row)) != reference["responseSha256"]:
                problems += 1
        findings.append({k: original[k] for k in ["id", "revision", "it", "en", "scenarioIds", "decisionIds", "at"]} |
                        {"evidenceCount": len(original["evidence"]), "changedReferences": problems,
                         "status": "REVIEW_REQUIRED" if problems else "CURRENT", "scope": "unfiltered reviewed source evidence; incomplete responses may contribute qualitative observations"})
    n = sum(r.get("cohortId", "current") == target_cohort for r in eligible)
    minimum, maximum = survey.get("targetMin", 30), survey.get("targetMax", 50)
    return {"schema": VERSION, "workspaceRevision": state["revision"], "filters": dict(filters) | {"cohort": cohort},
            "received": len(all_rows), "includedCompleted": n, "allCohortsCompleted": len(eligible), "targetCohort": target_cohort,
            "cohorts": [{"id": c, "completed": sum(r.get("cohortId", "current") == c for r in eligible)} for c in sorted(cohorts)],
            "includedIncomplete": sum(r.get("included", True) and r.get("complete", True) is False for r in all_rows),
            "excluded": sum(not r.get("included", True) for r in all_rows),
            "withoutRecordedConsent": sum(r.get("consent") is not True for r in all_rows),
            "targetMin": minimum, "targetMax": maximum, "targetReached": n >= minimum,
            "targetStatus": "BELOW_TARGET" if n < minimum else "WITHIN_TARGET" if n <= maximum else "ABOVE_TARGET",
            "remainingToMinimum": max(0, minimum - n), "selectedCompleted": len(selected),
            "tables": tables, "deliveries": delivery, "themes": themes,
            "coding": {"current": len(coded), "needsReview": sum(bool(r.get("coding")) and r not in coded for r in selected),
                       "uncoded": sum(not r.get("coding") for r in selected)},
            "findings": findings, "questionnaires": [{k: q.get(k) for k in ["id", "title", "status", "createdAt", "cohortId", "sourceReference"]} for q in survey.get("questionnaires", [])],
            "sourceImports": [{k: x[k] for k in ["id", "sourceSha256", "sourceBytes", "importedAt", "counts"]} for x in survey.get("imports", [])],
            "campaign": {k: survey.get("campaign", {}).get(k, "") for k in ["population", "openedOn", "closedOn", "reminderDate", "reminderRounds", "targetCohort"]},
            "methods": METHOD}


def view(state, filters=None):
    s = state["survey"]
    responses = copy.deepcopy(s["responses"])
    for row in responses:
        row["contentSha256"] = _hash(_content(row))
        row["codingCurrent"] = bool(row.get("coding")) and row["coding"].get("responseSha256") == _hash(_content(row))
    return {"revision": state["revision"], "workspaceId": _hash({"createdAt": state.get("createdAt"), "source": state.get("source", {})}), "schema": schema(), "questionnaire": _current_questionnaire(state),
            "campaign": s.get("campaign", {}), "responses": responses, "themes": s.get("themes", []),
            "findings": s.get("findings", []), "history": s.get("history", []),
            "imports": [{k: v for k, v in x.items() if k != "csvBase64"} for x in s.get("imports", [])],
            "analysis": analyze(state, filters), "scenarios": [{"id": x["id"], "name": x["name"]} for x in state.get("scenarios", [])],
            "decisions": [{"id": x["id"], "subject": x["subject"]} for x in state.get("decisions", [])],
            "publications": [{k: p[k] for k in ["id", "name", "workspaceRevision", "createdAt"]} for p in state.get("publications", [])]}


def source_bytes(state, import_id):
    item = next((x for x in state["survey"].get("imports", []) if x["id"] == import_id), None)
    if item is None:
        raise ValueError("Unknown source import")
    raw = base64.b64decode(item["csvBase64"], validate=True)
    if _hash(raw) != item["sourceSha256"] or len(raw) != item["sourceBytes"]:
        raise ValueError("Retained source digest mismatch")
    return raw


def publication_analysis(state, publication_id):
    item = next((x for x in state.get("publications", []) if x["id"] == publication_id), None)
    if not item:
        raise ValueError("Unknown publication")
    if _hash(item["report"]) != item["reportSha256"]:
        raise ValueError("Publication digest mismatch")
    analysis = item["report"].get("survey", {}).get("analysis")
    if not analysis:
        raise ValueError("This earlier publication has no survey analysis snapshot")
    return copy.deepcopy(analysis)


def _csv(rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    for row in rows:
        safe = []
        for value in row:
            if value is None:
                value = ""
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                value = "'" + value
            safe.append(value)
        writer.writerow(safe)
    return out.getvalue().encode("utf-8")


def export_tables(analysis):
    files = {}
    for name, table in analysis["tables"].items():
        rows = [["code", "label_it", "label_en", "count", "answered_denominator", "eligible", "missing", "percent_of_answered", "multiple_selection"]]
        rows.extend([r["code"], r["it"], r["en"], r["count"], table["answered"], table["eligible"], table["missing"],
                     r["percentOfAnswered"], str(table["multiSelect"]).lower()] for r in table["rows"])
        files[f"survey-{name}.csv"] = _csv(rows)
    files["survey-deliveries.csv"] = _csv([list(analysis["deliveries"]), list(analysis["deliveries"].values())])
    files["survey-themes.csv"] = _csv([["id", "label_it", "label_en", "count", "coded_denominator", "eligible", "percent_of_coded"]] +
                                     [[x["id"], x["it"], x["en"], x["count"], x["codedResponses"], x["eligible"], x["percentOfCoded"]] for x in analysis["themes"]])
    files["survey-findings.csv"] = _csv([["id", "revision", "finding_it", "finding_en", "evidence_count", "changed_references", "status", "scenario_ids", "decision_ids"]] +
                                       [[x["id"], x["revision"], x["it"], x["en"], x["evidenceCount"], x["changedReferences"], x["status"],
                                         "|".join(x["scenarioIds"]), "|".join(x["decisionIds"])] for x in analysis["findings"]])
    files["survey-analysis.json"] = _bytes(analysis)
    files["survey-report-it.html"] = render_report(analysis, "it")
    files["survey-report-en.html"] = render_report(analysis, "en")
    return files


STYLE = "body{font:15px system-ui;color:#222;background:white;max-width:980px;margin:32px auto;padding:0 20px;line-height:1.5}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{border:1px solid #aaa;padding:8px;text-align:left}small{color:#555}h2{margin-top:32px}@media print{body{margin:0;max-width:none}section{break-inside:avoid}}"


def render_report(analysis, language="it"):
    if language not in {"it", "en"}:
        raise ValueError("Language must be it or en")
    it = language == "it"
    esc = lambda v: html.escape(str(v))
    title = "Consultazione sulla logistica urbana" if it else "Urban logistics consultation"
    blocks = []
    for field, table in analysis["tables"].items():
        name = LABELS[field][0 if it else 1]
        rows = "".join(f"<tr><td>{esc(r[language])}</td><td>{r['count']}</td><td>{r['percentOfAnswered'] if r['percentOfAnswered'] is not None else '—'}</td></tr>" for r in table["rows"])
        counts = (f"Rispondenti alla domanda: {table['answered']}; eleggibili: {table['eligible']}; mancanti: {table['missing']}." if it else
                  f"Answered: {table['answered']}; eligible: {table['eligible']}; missing: {table['missing']}.")
        blocks.append(f"<section><h2>{esc(name)}</h2><p>{counts}</p><table><tr><th>{'Categoria' if it else 'Category'}</th><th>n</th><th>%</th></tr>{rows}</table></section>")
    delivery = analysis["deliveries"]
    blocks.append(f"<h2>{esc(LABELS['deliveriesPerWeek'][0 if it else 1])}</h2><p>n={delivery['answered']}; {'mancanti' if it else 'missing'}={delivery['missing']}; {'mediana' if it else 'median'}={delivery['median'] if delivery['median'] is not None else '—'}; {'media' if it else 'mean'}={delivery['mean'] if delivery['mean'] is not None else '—'}.</p>")
    if analysis["themes"]:
        blocks.append(f"<h2>{'Codifica tematica' if it else 'Thematic coding'}</h2><table><tr><th>{'Tema' if it else 'Theme'}</th><th>n</th><th>{'Risposte codificate' if it else 'Coded denominator'}</th></tr>" +
                      "".join(f"<tr><td>{esc(t[language])}</td><td>{t['count']}</td><td>{t['codedResponses']}</td></tr>" for t in analysis["themes"]) + "</table>")
    blocks.append(f"<h2>{'Risultati interpretati dall’analista' if it else 'Analyst-reviewed findings'}</h2>")
    for finding in analysis["findings"]:
        blocks.append(f"<section><h3>{esc(finding['id'])} · {esc(finding['status'])}</h3><p>{esc(finding[language])}</p><small>{'Riferimenti' if it else 'References'}: {finding['evidenceCount']}; {'da rivedere' if it else 'changed'}: {finding['changedReferences']}. {esc(', '.join(finding['scenarioIds'] + finding['decisionIds']))}</small></section>")
    sources = "".join(f"<li>{esc(x['id'])}: <code>{esc(x['sourceSha256'])}</code></li>" for x in analysis["sourceImports"])
    return (f"<!doctype html><html lang='{language}'><meta charset='utf-8'><title>{title}</title><style>{STYLE}</style>"
            f"<h1>{title}</h1><p>{'Revisione' if it else 'Revision'} {analysis['workspaceRevision']} · n={analysis['selectedCompleted']} · "
            f"{'totale completo incluso' if it else 'total included completed'} {analysis['includedCompleted']} · "
            f"{'obiettivo' if it else 'target'} {analysis['targetMin']}–{analysis['targetMax']}</p><p>{esc(METHOD[language])}</p>"
            f"<p>{'Filtri' if it else 'Filters'}: {esc(json.dumps(analysis['filters'], ensure_ascii=False))}</p>" + "".join(blocks) +
            f"<h2>{'Provenienza' if it else 'Provenance'}</h2><ul>{sources}</ul></html>").encode()


def questionnaire_html(state):
    q = _current_questionnaire(state)
    esc = lambda x: html.escape(str(x))
    questions = []
    for field in LABELS:
        text = q["questions"][field]
        if field in OPTIONS:
            answers = " · ".join(f"□ {esc(labels[0])} ({esc(code)})" for code, labels in OPTIONS[field].items())
        elif field == "deliveriesPerWeek":
            answers = "Numero: __________  □ Non pertinente / senza risposta"
        else:
            answers = "<p>________________________________________________________________</p>" * 3
        questions.append(f"<section><h2>{esc(text)}</h2><p>{answers}</p></section>")
    return (f"<!doctype html><html lang='it'><meta charset='utf-8'><title>{esc(q['title'])}</title><style>{STYLE}</style>"
            f"<h1>{esc(q['title'])}</h1><p>Questionario {esc(q['id'])} · {esc(q['status'])} · coorte {esc(q.get('cohortId', 'current'))}</p><p>{esc(q['introduction'])}</p>"
            f"<h2>Informativa fornita dall’organizzazione</h2><p>{esc(q['privacyNotice']) if q['privacyNotice'] else 'Informativa da inserire prima della distribuzione.'}</p>"
            "<p>Codice pseudonimo del rispondente: __________</p><p>□ Consenso registrato secondo l’informativa fornita</p>" + "".join(questions) +
            "<p>□ Risposta completa · Lingua: it / en</p><p>Le selezioni multiple sono consentite. Non aggiungere nomi o recapiti personali.</p></html>").encode()
