"""Complete, source-linked deliverables from a current or frozen report."""
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import zipfile

from delivery import CRITERIA, GOVERNANCE_FIELDS, STREET_FIELDS, delivery_for

LABELS = {
    "traffic": ("Traffico", "Traffic"), "emissions": ("Emissioni", "Emissions"),
    "publicSpace": ("Spazio pubblico", "Public space"), "operatorAcceptance": ("Accettazione degli operatori", "Operator acceptance"),
    "marketReadiness": ("Maturità del mercato", "Market readiness"),
    "accessRules": ("Regole di accesso", "Access rules"), "timeWindows": ("Fasce orarie", "Time windows"),
    "vehicleCriteria": ("Criteri dei veicoli", "Vehicle criteria"), "deliverySpaces": ("Spazi di consegna", "Delivery spaces"),
    "hubLockerConcepts": ("Concetti per microhub e locker", "Microhub and locker concepts"),
    "tramPedestrianIntegration": ("Integrazione con tram e pedoni", "Tram and pedestrian integration"),
    "replicationMethod": ("Metodo di replicazione", "Replication method"), "enforcement": ("Responsabilità di controllo", "Enforcement"),
    "roles": ("Ruoli e coordinamento", "Roles and coordination"), "sumpAlignment": ("Allineamento PUMS 2027", "2027 SUMP alignment"),
    "parkingAlignment": ("Piano della sosta", "Parking Plan alignment"), "tramAlignment": ("Programma tram", "Tram alignment"),
    "evChargingAlignment": ("Piano di ricarica", "EV charging plan alignment"), "monitoring": ("Monitoraggio e riesame", "Monitoring and review"),
}
CSS = """*{box-sizing:border-box}body{font:11pt/1.48 system-ui,-apple-system,sans-serif;color:#191919;max-width:1080px;margin:32px auto;padding:0 24px}h1{font-size:25pt;line-height:1.15}h2{font-size:17pt;border-bottom:1px solid #888;padding:8px 0}h3{font-size:13pt}p{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}th{background:#eee}small,.meta{color:#555;font-size:9pt;overflow-wrap:anywhere}.label{font-size:9pt;font-weight:700;letter-spacing:.05em}.bilingual{display:grid;grid-template-columns:1fr 1fr;gap:18px}section{margin:20px 0}.status{border:1px solid #888;padding:3px 7px;display:inline-block;font-size:9pt}.source{font-size:9pt;overflow-wrap:anywhere}.page{padding:12mm 0;min-height:240mm;break-after:page}.page:last-child{break-after:auto}.empty{font-style:italic;color:#666}.toolbar{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #aaa}button{font:inherit;padding:6px 12px;background:#eee;color:#111;border:1px solid #888;cursor:pointer}@page{size:A4;margin:17mm}@media print{body{max-width:none;margin:0;padding:0;font-size:10pt}.toolbar{display:none}.page{padding:0;min-height:250mm}h2,h3{break-after:avoid}tr{break-inside:avoid}a{color:inherit;text-decoration:none}.bilingual{gap:12px}}@media(max-width:650px){.bilingual{grid-template-columns:1fr}body{padding:0 14px}table{font-size:9pt}}"""


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def esc(value):
    return html.escape(str(value if value is not None else ""), quote=True)


def paragraphs(value):
    return "".join(f"<p>{esc(p)}</p>" for p in str(value or "").split("\n\n")) if value else '<p class="empty">Da compilare / To be completed</p>'


def bilingual(value):
    value = value or {}
    return '<div class="bilingual"><div lang="it"><span class="label">IT</span>' + paragraphs(value.get("it")) + '</div><div lang="en"><span class="label">EN</span>' + paragraphs(value.get("en")) + '</div></div>'


def source_refs(ids, delivery):
    registry = {s["id"]: s for s in delivery["sources"]}
    rendered = []
    for sid in ids:
        source = registry.get(sid)
        if not source:
            rendered.append(f'<span class="source">{esc(sid)}</span>')
            continue
        title = esc(source["title"])
        if source["url"]:
            title = f'<a href="{esc(source["url"])}">{title}</a>'
        rendered.append(f'<span class="source">{title} · {esc(source["locator"])} · {esc(source["observedAt"])}</span>')
    return '<p class="source">' + '<br>'.join(rendered) + '</p>' if rendered else ''


def shell(title, body, report, lang="en", pages=False):
    metadata = f'<p class="meta">Bologna · SGA3-MCCC-029 · revision {esc(report["workspaceRevision"])} · {esc(report.get("snapshotAt", ""))}</p>'
    toolbar = '<div class="toolbar"><button type="button" onclick="window.print()">Stampa / Print</button></div>'
    heading = '' if pages else f'<h1>{esc(title)}</h1>{metadata}'
    return (f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(title)}</title><style>{CSS}</style></head><body>{toolbar}{heading}{body}</body></html>').encode("utf-8")


def meta(record, delivery):
    return f'<p class="meta">{esc(record.get("status", "DRAFT"))} · {esc(record.get("reviewer", ""))}</p>' + source_refs(record.get("sourceIds", []), delivery)


def method_section(delivery):
    method = delivery["method"]
    content = '<h2>D1 · Metodo concordato / Agreed method</h2>' + bilingual(method["agreedMethod"])
    content += paragraphs(method["cityAgreement"]) + meta(method, delivery)
    for tool in method["tools"]:
        content += f'<h3>{esc(tool["id"])} · {esc(tool["decision"])}</h3>'
        for key, title in (("dataCompatibility", "Compatibilità / Data compatibility"), ("addedValue", "Valore aggiunto / Added value"), ("operatingGuidance", "Istruzioni operative / Operating guidance")):
            content += f'<h4>{title}</h4>' + bilingual(tool[key])
    return content


def scenario_section(report, delivery):
    names = {s["id"]: s["name"] for s in report["scenarios"]}
    content = '<h2>D2 · Matrice degli scenari / Scenario assessment matrix</h2>'
    for assessment in delivery["assessments"]:
        name = names[assessment["id"]]
        content += f'<section><h3>{esc(name["it"])} / {esc(name["en"])}</h3>' + bilingual(assessment["definition"])
        content += '<table><thead><tr><th>Criterio / Criterion</th><th>Valutazione / Assessment</th><th>Motivazione / Rationale</th></tr></thead><tbody>'
        for key in CRITERIA:
            entry = assessment["criteria"][key]
            content += f'<tr><td>{esc(" / ".join(LABELS[key]))}</td><td>{esc(entry["rating"])}</td><td>{bilingual(entry["note"])}</td></tr>'
        content += '</tbody></table>'
        for key, title in (("deliveryOrganisation", "Organizzazione delle consegne / Delivery organisation"), ("vehicleTypes", "Veicoli / Vehicle types"), ("infrastructure", "Infrastrutture / Infrastructure"), ("innovation", "Innovazione / Innovation"), ("bestPractice", "Esperienze comparabili / Comparable European practice")):
            content += f'<h4>{title}</h4>' + bilingual(assessment[key])
        content += meta(assessment, delivery) + '</section>'
    selection = delivery["citySelection"]
    content += '<h3>Scelta del Comune / City scenario selection</h3>'
    content += f'<p class="status">{esc(selection["status"])}</p><p>{esc(", ".join(selection["scenarioIds"]))}</p>' + paragraphs(selection["record"])
    content += f'<p class="meta">{esc(selection["decidedAt"])} · {esc(selection["recordedBy"])}</p>'
    return content


def framework_section(report, delivery):
    content = '<h2>D3 · Quadro delle strade pilota / Pilot street framework</h2>'
    for street in delivery["streets"]:
        baseline = report["baseline"]["streets"][street["streetKey"]]
        content += f'<section><h3>{esc(baseline["it"])} / {esc(baseline["en"])}</h3>'
        content += f'<p class="meta">2022: {baseline["points"]} punti / points; {baseline["spaces"]} stalli registrati / recorded spaces. Scenari / Scenarios: {esc(", ".join(street["scenarioIds"]))}</p>'
        for key in STREET_FIELDS:
            content += f'<h4>{esc(" / ".join(LABELS[key]))}</h4>' + bilingual(street[key])
        content += meta(street, delivery)
        validation = street["cityValidation"]
        if validation["record"]:
            content += '<h4>Validazione comunale / Municipal validation</h4>' + paragraphs(validation["record"])
            content += f'<p class="meta">{esc(validation["date"])} · {esc(validation["recordedBy"])}</p>'
        content += '</section>'
    content += '<h2>Progressione al 2030 / Transition to 2030</h2>'
    for milestone in delivery["milestones"]:
        content += f'<section><h3>{milestone["year"]} · {esc(milestone["title"]["it"])} / {esc(milestone["title"]["en"])}</h3>'
        content += f'<p class="meta">{esc(milestone["scope"])} · {esc(milestone["owner"])} · {esc(", ".join(milestone["scenarioIds"]))}</p>'
        for key, label in (("measure", "Misura / Measure"), ("derogationCriteria", "Deroghe temporanee / Temporary derogation criteria"), ("incentiveConcept", "Incentivi concettuali / Conceptual incentives")):
            content += f'<h4>{label}</h4>' + bilingual(milestone[key])
        content += meta(milestone, delivery) + '</section>'
    content += '<h2>Replicazione e governance / Replication and governance</h2>'
    governance = delivery["governance"]
    for key in GOVERNANCE_FIELDS:
        content += f'<h4>{esc(" / ".join(LABELS[key]))}</h4>' + bilingual(governance[key])
    return content + meta(governance, delivery)


def consultation_section(report, delivery):
    content = '<h2>Consultazione / Consultation</h2>'
    count = report["survey"]["responses"]
    content += f'<p>{count} risposte registrate / supplied responses · obiettivo / target {report["survey"]["targetMin"]}–{report["survey"]["targetMax"]}</p>'
    for interview in delivery["interviews"]:
        content += f'<h3>{esc(interview["title"])}</h3><h4>Risultato / Finding</h4>' + bilingual(interview["finding"])
        content += '<h4>Implicazione / Implication</h4>' + bilingual(interview["implication"])
        content += f'<p class="meta">{esc(interview["reviewer"])} · {esc(", ".join(interview["streetKeys"]))}</p>' + source_refs(interview["sourceIds"], delivery)
    plan = delivery["surveyPlan"]
    for key, title in (("audience", "Destinatari / Audience"), ("municipalCoordinator", "Coordinamento comunale / Municipal coordinator"), ("distributionPlan", "Distribuzione / Distribution"), ("reminderPlan", "Unico promemoria coordinato / Single coordinated reminder"), ("municipalityReference", "Riferimento comunale / Municipal reference")):
        content += f'<h4>{title}</h4>' + paragraphs(plan[key])
    content += f'<p class="meta">Promemoria registrato / Reminder recorded: {esc(plan["reminderRecordedAt"])}</p>'
    return content


def baseline_section(report):
    rows = ''.join(f'<tr><td>{esc(s["it"])}</td><td>{s["points"]}</td><td>{s["spaces"]}</td></tr>' for s in report["baseline"]["streets"].values())
    content = '<h2>D1 · Baseline datato / Dated baseline</h2><table><tr><th>Strada / Street</th><th>Punti / Points</th><th>Stalli registrati / Recorded spaces</th></tr>' + rows + '</table>'
    content += f'<p class="meta">{esc(report["source"]["processedAt"])} · {esc(report["source"]["license"])} · SHA-256 {esc(report["source"]["compressedSha256"])}</p>'
    content += '<h3>Osservazioni datate / Dated observations</h3>'
    for observation in report["datedObservations"]:
        content += f'<p>{esc(observation["observedAt"])} · {esc(observation["street"])} {esc(observation["civic"])} · {esc(observation["description"])}</p>'
    content += '<h3>Decisioni / Decisions</h3>'
    for decision in report["decisions"]:
        content += f'<p><strong>{esc(decision["subject"])}</strong> · {esc(decision["relationship"])}</p>' + paragraphs(decision["note"])
    for assumption in report["assumptions"]:
        content += f'<h4>{esc(assumption["title"])}</h4>' + paragraphs(assumption["statement"]) + f'<p class="source">{esc(assumption["source"])} · {esc(assumption["owner"])}</p>'
    return content


def delivery_of(report):
    return report.get("delivery") or delivery_for(report)


def full_report(report):
    d = delivery_of(report)
    body = baseline_section(report) + method_section(d) + scenario_section(report, d) + framework_section(report, d) + consultation_section(report, d)
    body += '<h2>Fonti / Sources</h2>' + source_refs([s["id"] for s in d["sources"]], d)
    return shell("Bologna · D1–D3 analyst delivery", body, report, "it")


def paged_document(report, kind):
    d = delivery_of(report)
    doc = d["documents"][kind]
    title = "Transferability and learning note" if kind == "learning" else "Bologna replication factsheet"
    rendered = []
    for index, page in enumerate(doc["pages"]):
        rendered.append(f'<section class="page"><p class="label">{esc(title)} · {esc(doc["status"])} · {index + 1}/{len(doc["pages"])}</p><h1>{esc(page["title"])}</h1>' + paragraphs(page["body"]) + source_refs(page["sourceIds"], d) + f'<p class="meta">Revision {esc(report["workspaceRevision"])} · {esc(doc["reviewer"])}</p></section>')
    if not rendered:
        rendered.append(f'<h1>{esc(title)}</h1><p>Author the English pages in the retained delivery workspace.</p>')
    return shell(title, ''.join(rendered), report, pages=True)


def cesf_document(report):
    d = delivery_of(report)
    cesf = d["documents"]["cesf"]
    template = cesf["template"]
    if template is None:
        body = '<p>Register the CESF template supplied by NetZeroCities to map the final delivery report.</p>'
    else:
        body = f'<h2>{esc(template["title"])}</h2><p class="meta">Template received {esc(template["receivedAt"])} · SHA-256 {esc(template["sha256"])}</p>'
        answers = {a["sectionId"]: a for a in cesf["answers"]}
        for section in template["sections"]:
            answer = answers.get(section["id"], {"body": "", "sourceIds": []})
            body += f'<h2>{esc(section["title"])}</h2>' + paragraphs(answer["body"]) + source_refs(answer["sourceIds"], d)
        body += f'<p class="meta">{esc(cesf["status"])} · {esc(cesf["reviewer"])}</p>'
    return shell("CESF final delivery report", body, report)


def survey_document(report):
    d = delivery_of(report)
    plan = d["surveyPlan"]
    body = paragraphs(plan["audience"]) + '<ol>'
    for q in plan["questions"]:
        body += f'<li><p>{esc(q["prompt"])}</p>'
        if q["type"] == "single":
            body += '<ul>' + ''.join(f'<li>□ {esc(option)}</li>' for option in q["options"]) + '</ul>'
        else:
            body += '<p>________________________________________________________</p>'
        body += '</li>'
    body += '</ol><p class="meta">Coordinamento: ' + esc(plan["municipalCoordinator"]) + '</p>'
    return shell("Bologna · Questionario sulla logistica urbana", body, report, "it")


def csv_bytes(headers, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(headers)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def delivery_files(report):
    d = delivery_of(report)
    files = {
        "delivery.json": canonical(d), "report.html": full_report(report),
        "framework.html": shell("Bologna · Pilot street framework and 2030 roadmap", framework_section(report, d), report, "it"),
        "learning.html": paged_document(report, "learning"), "factsheet.html": paged_document(report, "factsheet"),
        "cesf.html": cesf_document(report), "cesf.json": canonical(d["documents"]["cesf"]),
        "survey-it.html": survey_document(report), "consultation.json": canonical({"interviews": d["interviews"], "surveyPlan": d["surveyPlan"], "meetings": d["meetings"], "suppliedSurveySummary": report["survey"]}),
    }
    rows = []
    for a in d["assessments"]:
        for criterion in CRITERIA:
            e = a["criteria"][criterion]
            rows.append([a["id"], criterion, e["rating"], e["note"]["it"], e["note"]["en"], a["status"], a["reviewer"], ';'.join(a["sourceIds"])])
    files["scenario-matrix.csv"] = csv_bytes(["scenario_id", "criterion", "rating", "note_it", "note_en", "review_status", "reviewer", "source_ids"], rows)
    street_headers = ["street", "scenario_ids", "review_status", "reviewer"] + [f"{k}_{lang}" for k in STREET_FIELDS for lang in ("it", "en")] + ["source_ids", "city_validation_record", "city_validation_date", "city_validation_recorded_by"]
    street_rows = [[s["streetKey"], ';'.join(s["scenarioIds"]), s["status"], s["reviewer"]] + [s[k][lang] for k in STREET_FIELDS for lang in ("it", "en")] + [';'.join(s["sourceIds"]), s["cityValidation"]["record"], s["cityValidation"]["date"], s["cityValidation"]["recordedBy"]] for s in d["streets"]]
    files["street-framework.csv"] = csv_bytes(street_headers, street_rows)
    milestone_headers = ["milestone_id", "year", "scope", "owner", "scenario_ids", "review_status"] + [f"{k}_{lang}" for k in ("title", "measure", "derogationCriteria", "incentiveConcept") for lang in ("it", "en")] + ["source_ids"]
    milestone_rows = [[m["id"], m["year"], m["scope"], m["owner"], ';'.join(m["scenarioIds"]), m["status"]] + [m[k][lang] for k in ("title", "measure", "derogationCriteria", "incentiveConcept") for lang in ("it", "en")] + [';'.join(m["sourceIds"])] for m in d["milestones"]]
    files["roadmap-2030.csv"] = csv_bytes(milestone_headers, milestone_rows)
    files["sources.csv"] = csv_bytes(["id", "title", "url", "locator", "observed_at", "license", "note"], [[s.get(k, "") for k in ("id", "title", "url", "locator", "observedAt", "license", "note")] for s in d["sources"]])
    for index, meeting in enumerate(d["meetings"]):
        body = f'<p>{esc(meeting["audience"])}</p>' + paragraphs(meeting["body"]) + source_refs(meeting["sourceIds"], d) + f'<p class="meta">{esc(meeting["cityReference"])}</p>'
        files[f"meeting-{index + 1}-it.html"] = shell(meeting["title"], body, report, "it")
    if d["documents"]["cesf"]["template"]:
        files["cesf-template.txt"] = d["documents"]["cesf"]["template"]["content"].encode("utf-8")
    return files


def file_manifest(report, files, publication_id=None):
    return {"schema": "bologna-urban-logistics-export/v2", "snapshotAt": report.get("snapshotAt"),
            "workspaceRevision": report["workspaceRevision"], "publicationId": publication_id,
            "sourceSha256": report["source"]["compressedSha256"],
            "files": [{"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())]}


def zip_bytes(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            archive.writestr(info, data)
    return out.getvalue()
