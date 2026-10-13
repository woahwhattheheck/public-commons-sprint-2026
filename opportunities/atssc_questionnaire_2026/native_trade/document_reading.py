"""Reading context for the existing retained-edition Word/PDF renderer.

This module reads only the edition passed to document_exports.  It does not
open a workspace, fetch a predecessor, change answers, or calculate statistics.
Public reading metadata uses the same selected public projection.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone


LABELS = {
    "en": {
        "contents": "Contents", "references": "Edition and source references", "reference": "Reference",
        "selected_sources": "Selected response sources",
        "public": "Public", "protected": "Protected", "edition": "edition",
        "questionnaire_edition": "{edition} questionnaire edition",
        "page": "Page", "report": "Report", "preview": "Report preview",
        "frozen": "Saved report", "draft": "Saved draft",
        "submitted": "Submitted revision", "empty": "Empty questionnaire",
        "response": "Response", "question": "Question", "column": "Column",
        "answer": "Answer", "answer_row": "Answer row",
        "not_answered": "Not answered", "no_rows": "No answer rows",
        "withheld": "Protected answer withheld", "alternative": "Public alternative",
        "yes": "Yes", "no": "No", "not_available": "Not available",
        "no_public_answers": "No public answers", "unit": "Unit",
        "summary": "Summary statistics", "statistic": "Statistic", "value": "Value",
        "count": "Count", "percentage": "Percentage", "sum": "Sum", "average": "Mean",
        "minimum": "Minimum", "maximum": "Maximum", "ratio": "Ratio",
        "group": "Group", "year": "Year", "by_year": "{metric} by year",
        "by_group": "{metric} by group", "visible_answers": "Visible answers",
        "observations": "{answered} visible answers from {observations} observations.",
        "intro": "This document contains {responses} response {response_noun} and {questions} {question_noun} in the saved order.",
        "response_one": "record", "response_many": "records",
        "question_one": "question", "question_many": "questions",
        "report_id": "Report identifier", "publication_id": "Questionnaire publication",
        "questionnaire_id": "Questionnaire identifier", "definition_version": "Definition version",
        "template_id": "Report template", "template_version": "Template version",
        "view_id": "Saved view", "view_version": "View version",
        "respondent_id": "Respondent identifier", "revision_id": "Revision identifier",
        "accepted_number": "Accepted revision", "revision_number": "Current revision",
        "draft_version": "Draft version", "sealed_revision": "Submitted revision",
        "created": "Report saved", "generated": "Document generated",
        "updated": "Response saved", "source_workbook": "Original workbook",
        "workbook_sha256": "Workbook SHA-256", "source_question": "Original question",
        "source_location": "Original worksheet location", "source_columns": "Original columns",
        "source_rows": "Original rows", "questionnaire": "Questionnaire",
        "original_wording": "Original question wording",
        "original_french": "Original French wording", "original_english": "Original English wording",
        "scope_public": "Answers and explanatory alternatives follow this saved public edition. A public alternative is text; it does not enter numerical statistics.",
        "scope_protected": "This edition contains the complete selected response values. Its question and worksheet references identify the retained source used by the application.",
        "state_frozen": "The selected questions, accepted response revisions, report views and saved layout belong to this report. Later application edits appear in a new report.",
        "state_preview": "This is the current report preview. Save the report in the application to retain an immutable edition.",
        "state_draft": "This document follows the current saved draft. Continue editing or submit the response in the application.",
        "state_submitted": "This document follows the latest submitted response. Earlier revisions remain in the application's history.",
        "state_empty": "This document contains the published questions before a response has been saved.",
        "source_note": "References below are copied from the selected edition. Worksheet coordinates preserve the original ordered physical rows and column bindings.",
        "word_note": "Word headings, paragraphs, tables and charts remain editable. To change the application's retained answers, save the changes in the application and download again.",
    },
    "fr": {
        "contents": "Table des matières", "references": "Références de l’édition et des sources", "reference": "Référence",
        "selected_sources": "Sources des réponses sélectionnées",
        "public": "Publique", "protected": "Protégée", "edition": "édition",
        "questionnaire_edition": "Édition {edition} du questionnaire",
        "page": "Page", "report": "Rapport", "preview": "Aperçu du rapport",
        "frozen": "Rapport enregistré", "draft": "Brouillon enregistré",
        "submitted": "Révision soumise", "empty": "Questionnaire sans réponse",
        "response": "Réponse", "question": "Question", "column": "Colonne",
        "answer": "Réponse", "answer_row": "Ligne de réponse",
        "not_answered": "Sans réponse", "no_rows": "Aucune ligne de réponse",
        "withheld": "Réponse protégée non divulguée", "alternative": "Texte de remplacement public",
        "yes": "Oui", "no": "Non", "not_available": "Non disponible",
        "no_public_answers": "Aucune réponse publique", "unit": "Unité",
        "summary": "Statistiques sommaires", "statistic": "Statistique", "value": "Valeur",
        "count": "Nombre", "percentage": "Pourcentage", "sum": "Somme", "average": "Moyenne",
        "minimum": "Minimum", "maximum": "Maximum", "ratio": "Ratio",
        "group": "Groupe", "year": "Année", "by_year": "{metric} par année",
        "by_group": "{metric} par groupe", "visible_answers": "Réponses visibles",
        "observations": "{answered} réponses visibles sur {observations} observations.",
        "intro": "Ce document contient {responses} {response_noun} et {questions} {question_noun}, dans l’ordre enregistré.",
        "response_one": "réponse", "response_many": "réponses",
        "question_one": "question", "question_many": "questions",
        "report_id": "Identifiant du rapport", "publication_id": "Publication du questionnaire",
        "questionnaire_id": "Identifiant du questionnaire", "definition_version": "Version de la définition",
        "template_id": "Modèle de rapport", "template_version": "Version du modèle",
        "view_id": "Vue enregistrée", "view_version": "Version de la vue",
        "respondent_id": "Identifiant du répondant", "revision_id": "Identifiant de la révision",
        "accepted_number": "Révision acceptée", "revision_number": "Révision courante",
        "draft_version": "Version du brouillon", "sealed_revision": "Révision soumise",
        "created": "Rapport enregistré le", "generated": "Document produit le",
        "updated": "Réponse enregistrée le", "source_workbook": "Classeur original",
        "workbook_sha256": "SHA-256 du classeur", "source_question": "Question originale",
        "source_location": "Emplacement dans la feuille originale", "source_columns": "Colonnes originales",
        "source_rows": "Lignes originales", "questionnaire": "Questionnaire",
        "original_wording": "Libellé original de la question",
        "original_french": "Libellé français original", "original_english": "Libellé anglais original",
        "scope_public": "Les réponses et les textes de remplacement suivent cette édition publique enregistrée. Un texte de remplacement public est explicatif et n’entre pas dans les statistiques numériques.",
        "scope_protected": "Cette édition contient toutes les valeurs des réponses sélectionnées. Les références aux questions et aux feuilles identifient les sources conservées par l’application.",
        "state_frozen": "Les questions sélectionnées, les révisions acceptées, les vues et la mise en page appartiennent à ce rapport. Les modifications ultérieures de l’application apparaissent dans un nouveau rapport.",
        "state_preview": "Il s’agit de l’aperçu courant du rapport. Enregistrez le rapport dans l’application pour conserver une édition immuable.",
        "state_draft": "Ce document correspond au brouillon enregistré courant. Continuez à le modifier ou soumettez la réponse dans l’application.",
        "state_submitted": "Ce document correspond à la dernière réponse soumise. Les révisions antérieures restent dans l’historique de l’application.",
        "state_empty": "Ce document contient les questions publiées avant l’enregistrement d’une réponse.",
        "source_note": "Les références ci-dessous proviennent de l’édition sélectionnée. Les coordonnées préservent l’ordre des lignes physiques et les colonnes liées dans le classeur original.",
        "word_note": "Les titres, paragraphes, tableaux et graphiques Word restent modifiables. Pour changer les réponses conservées par l’application, enregistrez-les dans l’application, puis téléchargez une nouvelle copie.",
    },
}
MONTHS = {
    "en": ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"),
    "fr": ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"),
}


def language_name(value):
    value = str(value or "en").lower().replace("_", "-")
    if value in {"en", "en-ca", "en-us", "en-gb"}:
        return "en"
    if value in {"fr", "fr-ca", "fr-fr"}:
        return "fr"
    raise ValueError("Document reader labels support English (en) or French (fr)")


def reader_labels(language):
    return LABELS[language_name(language)]


def _text(value):
    if value is None:
        return ""
    text = str(value)
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text):
        raise ValueError("A document reference contains a nonprinting control character")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _present(value):
    return value is not None and value != ""


def anchor(kind, identity):
    return "nt_" + hashlib.sha256((kind + "\0" + str(identity)).encode()).hexdigest()[:24]


def display_stamp(value, language):
    """Render an actual timestamp without inventing an offset for a naive value."""
    text = _text(value)
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    suffix = ""
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc)
        suffix = " UTC"
    day = str(parsed.day) + " " + MONTHS[language][parsed.month - 1] + " " + str(parsed.year)
    if "T" in text or " " in text:
        return day + ", " + parsed.strftime("%H:%M:%S") + suffix
    return day


def _rows(values):
    """Compact consecutive runs while retaining explicit gaps and original order."""
    if not values:
        return ""
    groups = []
    first = previous = values[0]
    for value in values[1:]:
        if type(value) is int and type(previous) is int and value == previous + 1:
            previous = value
            continue
        groups.append(str(first) if first == previous else str(first) + "–" + str(previous))
        first = previous = value
    groups.append(str(first) if first == previous else str(first) + "–" + str(previous))
    return ", ".join(groups)


def _binding(question, labels):
    binding = question.get("source")
    if not isinstance(binding, dict):
        return [], None
    lines = []
    sheet = _text(binding.get("sheet"))
    if sheet:
        quoted = "'" + sheet.replace("'", "''") + "'"
        if _present(binding.get("cell")):
            location = quoted + "!" + _text(binding["cell"])
        else:
            rows = binding.get("rows")
            if isinstance(rows, list):
                row_text = _rows(rows)
            elif _present(binding.get("start_row")) and _present(binding.get("end_row")):
                row_text = _rows([binding["start_row"]]) if binding["start_row"] == binding["end_row"] else str(binding["start_row"]) + "–" + str(binding["end_row"])
            else:
                row_text = ""
            location = quoted + (": " + labels["source_rows"].lower() + " " + row_text if row_text else "")
        lines.append(labels["source_location"] + ": " + location)
    columns = [
        _text(c.get("label") or c.get("id")) + " (" + _text(c["source_column"]) + ")"
        for c in question.get("columns", [])
        if isinstance(c, dict) and _present(c.get("source_column"))
    ]
    if columns:
        lines.append(labels["source_columns"] + ": " + "; ".join(columns))
    sha = binding.get("workbook_sha256")
    source = None
    if isinstance(sha, str) and re.fullmatch(r"[a-fA-F0-9]{64}", sha):
        source = {"sha256": sha, "name": _text(question.get("source_workbook_name"))}
    return lines, source


def display_answer(item, labels):
    """Translate generated markers, never an original answer that looks like one."""
    if item.get("answer_state") == "withheld":
        return labels["withheld"]
    if item.get("answer_state") == "missing":
        return labels["not_answered"]
    if type(item.get("boolean_value")) is bool:
        return labels["yes"] if item["boolean_value"] else labels["no"]
    return item["text"]


def display_cell(item, labels):
    text = display_answer(item, labels)
    if item.get("alternative"):
        text += "\n" + labels["alternative"] + "\n" + item["alternative"]
    return text


def intro_text(model):
    labels = model["reading"]["labels"]
    responses, questions = len(model["responses"]), model["question_count"]
    return labels["intro"].format(
        responses=responses, questions=questions,
        response_noun=labels["response_one" if responses == 1 else "response_many"],
        question_noun=labels["question_one" if questions == 1 else "question_many"],
    )


def reading_context(payload, model):
    """Build navigation and references from this exact selected edition only."""
    language = language_name(model.get("language", "en"))
    labels = reader_labels(language)
    public = model["edition"] == "public"
    is_response = str(payload.get("schema", "")).startswith("atssc.response-document.")
    state = payload.get("document_state") if is_response else "preview" if payload.get("report_id") == "preview" else "frozen"
    if state not in {"draft", "submitted", "empty", "preview", "frozen"}:
        state = "submitted" if is_response else "frozen"
    references = []
    def add(label, value):
        if _present(value):
            references.append((labels[label], _text(value)))
    add("report_id", payload.get("report_id"))
    if not public:
        publication = payload.get("publication") or {}
        if isinstance(publication, dict):
            add("publication_id", publication.get("id"))
            add("questionnaire_id", publication.get("questionnaire_id"))
            add("definition_version", publication.get("definition_version"))
    layout = payload.get("report_layout") or {}
    if isinstance(layout, dict):
        add("template_id", layout.get("template_id"))
        add("template_version", layout.get("template_version"))
    if is_response:
        add("draft_version", payload.get("draft_version"))
        if state != "empty":
            add("sealed_revision", payload.get("sealed_revision"))
    if _present(payload.get("created")):
        add("generated" if is_response else "created", display_stamp(payload["created"], language))
    if is_response and _present(payload.get("updated")):
        add("updated", display_stamp(payload["updated"], language))

    question_refs, workbooks = {}, {}
    questions = payload.get("questions", payload.get("definition", {}).get("questions", []))
    for question in questions:
        qid = question["id"]
        notes = [labels["source_question"] + ": " + _text(qid)]
        wordings = []
        # Public question IDs/labels are already selected by the native core.
        # Never recover private definitions, workbook bindings or hidden notes.
        if not public:
            locations, source = _binding(question, labels)
            notes.extend(locations)
            if source:
                existing = workbooks.get(source["sha256"])
                if not existing or not existing["name"]:
                    workbooks[source["sha256"]] = source
        # Static source wording has already been selected by the native core
        # for this edition. Its complete original stem is rendered by the
        # existing grouped question context; retain the paired French wording
        # beside it without recovering any hidden definition or answer.
        text = question.get("original_french_text")
        displayed = next((item for response in model["responses"] for item in response["questions"] if item["id"] == qid), {})
        visible_wording = {displayed.get("label", ""), *displayed.get("context", [])}
        if isinstance(text, str) and text.strip() and text != question.get("label") and text != question.get("original_question_text") and text not in visible_wording:
            wordings.append((labels["original_french"], text))
        question_refs[qid] = {"notes": notes, "wordings": wordings}

    entries, response_refs, view_refs = [], [], []
    def entry(kind, identity, title, level=0, contents=False):
        row = {"key": anchor(kind, identity), "title": _text(title), "level": level, "contents": contents}
        entries.append(row)
        return row

    summary = None
    if model["numeric_totals"] and not model["view_sections"]:
        summary = entry("summary", "all", labels["summary"], contents=True)
    for view in model["view_sections"]:
        selected = next((x for x in layout.get("ordered_sections", []) if x.get("id") == view["id"]), {})
        item = entry("view", view["id"], view["title"], contents=True)
        notes = []
        variable = view.get("variable") or {}
        qid = variable.get("question_id") or view.get("question_id")
        if qid:
            notes.extend(question_refs.get(qid, {"notes": [labels["source_question"] + ": " + _text(qid)]})["notes"])
            if _present(variable.get("column_id")):
                notes.append(labels["column"] + ": " + _text(variable["column_id"]))
        for key, label in (("saved_view_id", "view_id"), ("saved_view_version", "view_version")):
            if _present(selected.get(key)):
                notes.append(labels[label] + ": " + _text(selected[key]))
        view_refs.append({**item, "notes": notes})
    for index, (original, response) in enumerate(zip(payload["accepted_responses"], model["responses"]), 1):
        heading = labels["response"] + " " + _text(original.get("response_number", index))
        notes = []
        if not public:
            if _present(original.get("name")):
                heading += "  " + _text(original["name"])
            for key in ("respondent_id", "accepted_number", "revision_number", "revision_id", "workbook_sha256"):
                if _present(original.get(key)):
                    notes.append(labels[key] + ": " + _text(original[key]))
        item = entry("response", index, heading, contents=model["include_response_details"])
        children = []
        for question in response["questions"]:
            navigation = entry("question", str(index) + "\0" + question["id"], question["label"], level=1)
            children.append({**navigation, **question_refs[question["id"]]})
        response_refs.append({**item, "metadata": notes, "questions": children})
    reference_entry = entry("references", "edition", labels["references"], contents=True)
    # Hidden response details also stay out of the document's navigation tree.
    visible_keys = {x["key"] for x in view_refs}
    if summary:
        visible_keys.add(summary["key"])
    if model["include_response_details"]:
        for row in response_refs:
            visible_keys.add(row["key"])
            visible_keys.update(x["key"] for x in row["questions"])
    visible_keys.add(reference_entry["key"])
    entries = [x for x in entries if x["key"] in visible_keys]
    return {
        "language": language, "labels": labels, "state": state,
        "state_label": labels[state], "state_note": labels["state_" + state],
        "scope_note": labels["scope_public" if public else "scope_protected"],
        "references": references, "workbooks": list(workbooks.values()) if not public else [],
        "selected_sources": [{"title": row["title"], "metadata": row["metadata"]} for row in response_refs] if not public else [],
        "entries": entries, "contents": [x for x in entries if x["contents"]],
        "summary": summary, "views": view_refs, "responses": response_refs,
        "reference_entry": reference_entry,
    }
