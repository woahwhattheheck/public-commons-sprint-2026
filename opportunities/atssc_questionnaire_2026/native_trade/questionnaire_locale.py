"""Original-workspace language preferences and separately authored display wording.

No source, answer, disclosure, choice value or frozen report is translated here.
"""
from __future__ import annotations

import json

from questionnaire_workspace import OperationError, encoded, now


LANGUAGES = {"EN", "FR"}


def install_schema(workspace):
    with workspace.connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS language_preferences(
          principal TEXT PRIMARY KEY,respondent_id TEXT,language TEXT NOT NULL,
          version INTEGER NOT NULL,updated TEXT NOT NULL,
          FOREIGN KEY(respondent_id) REFERENCES respondents(id),
          CHECK(language IN ('EN','FR')));
        CREATE TABLE IF NOT EXISTS language_preference_versions(
          principal TEXT NOT NULL,version INTEGER NOT NULL,language TEXT NOT NULL,
          created TEXT NOT NULL,PRIMARY KEY(principal,version),
          FOREIGN KEY(principal) REFERENCES language_preferences(principal));
        CREATE TABLE IF NOT EXISTS questionnaire_translations(
          questionnaire_id TEXT NOT NULL,definition_version INTEGER NOT NULL,
          language TEXT NOT NULL,version INTEGER NOT NULL,updated TEXT NOT NULL,
          PRIMARY KEY(questionnaire_id,definition_version,language),
          FOREIGN KEY(questionnaire_id,definition_version)
            REFERENCES definitions(questionnaire_id,version));
        CREATE TABLE IF NOT EXISTS questionnaire_translation_versions(
          questionnaire_id TEXT NOT NULL,definition_version INTEGER NOT NULL,
          language TEXT NOT NULL,version INTEGER NOT NULL,translations TEXT NOT NULL,
          created TEXT NOT NULL,
          PRIMARY KEY(questionnaire_id,definition_version,language,version),
          FOREIGN KEY(questionnaire_id,definition_version,language)
            REFERENCES questionnaire_translations(questionnaire_id,definition_version,language));
        """)
        db.commit()


def _actor(workspace, params):
    context = getattr(workspace.context, "request", None) or {}
    actor = params.get("_actor", context.get("actor", {"role": "native_operator"}))
    if not isinstance(actor, dict):
        raise OperationError("LANGUAGE_SCOPE", "Open the original operator or respondent session")
    if actor.get("role") in {"operator", "native_operator"}:
        return "operator", None
    if actor.get("role") == "respondent" and isinstance(actor.get("respondent_id"), str):
        return "respondent:" + actor["respondent_id"], actor["respondent_id"]
    raise OperationError("LANGUAGE_SCOPE", "Open the original operator or respondent session")


def _language(value):
    if value not in LANGUAGES:
        raise OperationError("LANGUAGE", "Select EN or FR")
    return value


def _version(value):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise OperationError("VERSION", "Use the retained language edition version")
    return value


def get_preference(workspace, params):
    principal, respondent_id = _actor(workspace, params)
    with workspace.connection() as db:
        if respondent_id:
            workspace._row(db, "respondents", respondent_id)
        row = db.execute("SELECT * FROM language_preferences WHERE principal=?", (principal,)).fetchone()
        return dict(row) if row else {"principal": principal, "respondent_id": respondent_id,
                                     "language": "EN", "version": 0, "updated": None}


def set_preference(workspace, params):
    principal, respondent_id = _actor(workspace, params)
    language, expected = _language(params.get("language")), _version(params.get("expected_version"))
    method = "language.set_preference"
    cached = workspace._request_result(method)
    if cached:
        if cached.get("principal") != principal:
            raise OperationError("LANGUAGE_SCOPE", "This request belongs to another language preference")
        return cached

    def save(db):
        if respondent_id:
            workspace._row(db, "respondents", respondent_id)
        row = db.execute("SELECT version FROM language_preferences WHERE principal=?", (principal,)).fetchone()
        if (row["version"] if row else 0) != expected:
            raise OperationError("VERSION_CONFLICT", "Reload the current language preference before saving")
        version, stamp = expected + 1, now()
        db.execute("INSERT INTO language_preferences VALUES(?,?,?,?,?) ON CONFLICT(principal) DO UPDATE SET language=excluded.language,version=excluded.version,updated=excluded.updated",
                   (principal, respondent_id, language, version, stamp))
        db.execute("INSERT INTO language_preference_versions VALUES(?,?,?,?)", (principal, version, language, stamp))
        return {"principal": principal, "respondent_id": respondent_id, "language": language,
                "version": version, "updated": stamp}
    result = workspace._write(method, principal, {"language": language, "expected_version": expected}, save)
    if result.get("principal") != principal:
        raise OperationError("LANGUAGE_SCOPE", "This request belongs to another language preference")
    return result


def _definition(workspace, db, params):
    _, respondent_id = _actor(workspace, params)
    if respondent_id:
        if params.get("respondent_id") != respondent_id:
            raise OperationError("LANGUAGE_SCOPE", "Open this respondent's own wording edition")
        respondent = workspace._row(db, "respondents", respondent_id)
        publication, definition = workspace._definition(db, respondent["publication_id"])
        return publication["questionnaire_id"], publication["definition_version"], definition
    questionnaire_id = params.get("questionnaire_id")
    version = params.get("definition_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise OperationError("DEFINITION", "Select a retained definition edition")
    row = db.execute("SELECT definition FROM definitions WHERE questionnaire_id=? AND version=?", (questionnaire_id, version)).fetchone()
    if not row:
        raise OperationError("NOT_FOUND", "The original definition edition is not retained")
    return questionnaire_id, version, json.loads(row[0])


def _text(value, maximum=12000):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 and c not in "\n\t\r" for c in value):
        raise OperationError("TRANSLATION", "Display wording must be ordinary text within its field limit")
    return value


def _wording(value, field):
    if not isinstance(value, dict) or set(value) - {"label", "help", "unit", "section", "columns", "choices"}:
        raise OperationError("TRANSLATION", "Translate display wording only; retain original answer and source fields")
    result = {key: _text(text) for key, text in value.items() if key in {"label", "help", "unit", "section"}}
    columns = value.get("columns", {})
    available = {column["id"]: column for column in field.get("columns", [])}
    if not isinstance(columns, dict) or set(columns) - set(available):
        raise OperationError("TRANSLATION", "Use the original table column identifiers")
    if columns:
        result["columns"] = {key: _wording(column, available[key]) for key, column in columns.items()}
    choices = value.get("choices", {})
    original_choices = field.get("choices", [])
    if not isinstance(choices, dict) or set(choices) - set(original_choices):
        raise OperationError("TRANSLATION", "Choice display labels must keep their original stored values")
    if choices:
        result["choices"] = {key: _text(label) for key, label in choices.items()}
    return result


def _translations(value, definition):
    if not isinstance(value, dict) or set(value) - {"title", "questions"}:
        raise OperationError("TRANSLATION", "Supply a display title and original question wording only")
    questions = value.get("questions", {})
    original = {question["id"]: question for question in definition["questions"]}
    if not isinstance(questions, dict) or set(questions) - set(original):
        raise OperationError("TRANSLATION", "Use the retained definition's original question identifiers")
    return {**({"title": _text(value["title"])} if "title" in value else {}),
            "questions": {key: _wording(wording, original[key]) for key, wording in questions.items()}}


def get_translations(workspace, params):
    language = _language(params.get("language", "FR"))
    with workspace.connection() as db:
        questionnaire_id, definition_version, definition = _definition(workspace, db, params)
        row = db.execute("SELECT * FROM questionnaire_translations WHERE questionnaire_id=? AND definition_version=? AND language=?",
                         (questionnaire_id, definition_version, language)).fetchone()
        current = row["version"] if row else 0
        requested = params.get("translation_version", current)
        _version(requested)
        translations = {"questions": {}}
        if requested:
            edition = db.execute("SELECT translations,created FROM questionnaire_translation_versions WHERE questionnaire_id=? AND definition_version=? AND language=? AND version=?",
                                 (questionnaire_id, definition_version, language, requested)).fetchone()
            if not edition:
                raise OperationError("NOT_FOUND", "The retained wording version is not available")
            translations = json.loads(edition["translations"])
        source_wording = {q["id"]: q["original_french_text"] for q in definition["questions"]
                          if isinstance(q.get("original_french_text"), str) and q["original_french_text"].strip()}
        source_names = {sha: db.execute("SELECT name FROM workbooks WHERE sha=?", (sha,)).fetchone()["name"]
                        for sha in definition["source_workbooks"]}
        return {"schema": "atssc.display-wording.v1", "questionnaire_id": questionnaire_id,
                "definition_version": definition_version, "language": language,
                "version": requested, "current_version": current, "translations": translations,
                "original_french_text": source_wording,
                "source_workbook_names": source_names,
                "basis": "Operator-authored display wording; original French source text is retained separately"}


def save_translations(workspace, params):
    principal, respondent_id = _actor(workspace, params)
    if respondent_id:
        raise OperationError("LANGUAGE_SCOPE", "Only the operator can author display wording")
    language, expected = _language(params.get("language", "FR")), _version(params.get("expected_version"))
    method = "language.save_translations"
    with workspace.connection() as db:
        questionnaire_id, definition_version, definition = _definition(workspace, db, params)
    translations = _translations(params.get("translations"), definition)

    def save(db):
        row = db.execute("SELECT version FROM questionnaire_translations WHERE questionnaire_id=? AND definition_version=? AND language=?",
                         (questionnaire_id, definition_version, language)).fetchone()
        if (row["version"] if row else 0) != expected:
            raise OperationError("VERSION_CONFLICT", "Reload the current display wording before saving")
        version, stamp = expected + 1, now()
        db.execute("INSERT INTO questionnaire_translations VALUES(?,?,?,?,?) ON CONFLICT(questionnaire_id,definition_version,language) DO UPDATE SET version=excluded.version,updated=excluded.updated",
                   (questionnaire_id, definition_version, language, version, stamp))
        db.execute("INSERT INTO questionnaire_translation_versions VALUES(?,?,?,?,?,?)",
                   (questionnaire_id, definition_version, language, version, encoded(translations), stamp))
        return {"schema": "atssc.display-wording.v1", "questionnaire_id": questionnaire_id,
                "definition_version": definition_version, "language": language,
                "version": version, "current_version": version, "translations": translations,
                "basis": "Operator-authored display wording"}
    return workspace._write(method, questionnaire_id + ":" + str(definition_version) + ":" + language,
                            {"language": language, "definition_version": definition_version,
                             "expected_version": expected, "wording_fields": len(translations["questions"])}, save)


OPERATIONS = {"language.get_preference": get_preference, "language.set_preference": set_preference,
              "language.get_translations": get_translations, "language.save_translations": save_translations}
