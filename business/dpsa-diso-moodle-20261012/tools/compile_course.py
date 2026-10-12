#!/usr/bin/env python3
"""Build a complete editable DISO course package for the original Moodle 4.5 importer."""
from __future__ import annotations
import argparse, base64, hashlib, html, json, math, os, re, tempfile
from collections import Counter
from pathlib import Path
import xml.etree.ElementTree as ET

MOODLE_COMMIT = "215f44380bdc3ccf852a3a22e34f8423ff64033a"
TYPES = {"multichoice", "truefalse", "matching", "gapselect", "ddwtos", "ddimageortext"}
STYLE = """body{font:16px/1.6 system-ui,sans-serif;color:#202020;background:#fff;max-width:76rem;margin:0 auto;padding:2rem}
h1,h2,h3{line-height:1.25}h2{border-top:2px solid #333;padding-top:1.2rem;margin-top:3rem}
h3{margin-top:2rem}nav,aside{background:#f3f3f3;padding:1rem;border:1px solid #bbb}
a{color:#202020;text-underline-offset:.15em}table{border-collapse:collapse;width:100%}td,th{padding:.5rem;text-align:left;border:1px solid #aaa}
li{margin:.4rem 0}.source-list{font-size:.9rem}article{break-before:page}.learning-time{color:#555}
@media(max-width:640px){body{padding:1rem}table{font-size:.9rem}td,th{overflow-wrap:anywhere}}@media print{nav{display:none}body{padding:0;max-width:none}a{color:inherit}}"""

def require(value, message):
    if not value:
        raise ValueError(message)

def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def text(value):
    return html.escape(str(value), quote=True)

def owned_file(root, relative):
    rel = Path(relative)
    require(not rel.is_absolute() and ".." not in rel.parts, "Relative course source path required")
    file = root / rel
    require(file.is_file() and not file.is_symlink(), "Original regular course file required: " + relative)
    require(file.resolve().is_relative_to(root.resolve()), "Course file must remain within its source")
    return file

def source_links(ids, sources):
    rows = []
    for key in dict.fromkeys(ids):
        require(key in sources, "Unknown primary source: " + key)
        item = sources[key]
        url = item.get("url")
        require(isinstance(url, str) and url.startswith("https://"), "Public primary source URL required: " + key)
        rows.append('<li><a href="' + text(url) + '">' + text(item["title"]) + "</a></li>")
    return '<aside class="source-list"><h4>Sources</h4><ul>' + "".join(rows) + "</ul></aside>" if rows else ""

def common_text(parent, tag, value, formatted=False):
    element = ET.SubElement(parent, tag, {"format": "html"} if formatted else {})
    ET.SubElement(element, "text").text = str(value)
    return element

def combined_feedback(parent, explanation):
    common_text(parent, "correctfeedback", "<p>Correct. Review the explanation below.</p>", True)
    common_text(parent, "partiallycorrectfeedback", "<p>Some parts need another look. Review the explanation before trying again.</p>", True)
    common_text(parent, "incorrectfeedback", "<p>Review the explanation and the worked example, then try again.</p>", True)
    ET.SubElement(parent, "shownumcorrect")

def questions_xml(unit, sources, source):
    quiz = ET.Element("quiz")
    questions = unit["quiz"]["questions"]
    require(10 <= len(questions) <= 20, unit["id"] + ": 10–20 assessment questions required")
    for q in questions:
        kind = q["type"]
        require(kind in TYPES, "Supported native Moodle question type required: " + kind)
        node = ET.SubElement(quiz, "question", {"type": kind})
        common_text(node, "name", q["name"])
        ET.SubElement(node, "idnumber").text = q["id"]
        prompt = q["promptHtml"]
        explanation = q["generalFeedbackHtml"] + source_links(q.get("sourceIds", []), sources)
        if kind in {"gapselect", "ddwtos"}:
            choices, correct = q["choices"], q["correctChoices"]
            gaps = [int(value) for value in re.findall(r"\[\[(\d+)\]\]", prompt)]
            require(gaps and set(gaps) == set(range(1, len(correct) + 1)), q["id"] + ": every authored gap needs its answer")
            require(all(type(value) is int and 1 <= value <= len(choices) for value in correct), q["id"] + ": invalid choice identity")
            prompt = re.sub(r"\[\[(\d+)\]\]", lambda m: "[[" + str(correct[int(m[1]) - 1]) + "]]", prompt)
        if kind == "ddimageortext":
            prompt += "<p><strong>Diagram description:</strong> " + text(q["background"]["alt"]) + "</p>"
        common_text(node, "questiontext", prompt, True)
        common_text(node, "generalfeedback", explanation, True)
        ET.SubElement(node, "defaultgrade").text = "1"
        ET.SubElement(node, "penalty").text = "0"
        ET.SubElement(node, "hidden").text = "0"
        if kind == "multichoice":
            answers = q["answers"]
            require(len(answers) >= 3, q["id"] + ": meaningful answer alternatives required")
            fractions = [answer["fraction"] for answer in answers]
            require(all(isinstance(v, (int, float)) and math.isfinite(v) and -100 <= v <= 100 for v in fractions), q["id"] + ": invalid answer grade")
            require(abs(sum(max(v, 0) for v in fractions) - 100) < .001, q["id"] + ": positive grades must total 100%")
            require(not q["single"] or fractions.count(100) == 1, q["id"] + ": one correct single-choice answer required")
            ET.SubElement(node, "single").text = "true" if q["single"] else "false"
            ET.SubElement(node, "shuffleanswers").text = "true"
            ET.SubElement(node, "answernumbering").text = "abc"
            combined_feedback(node, explanation)
            for answer in answers:
                answer_node = ET.SubElement(node, "answer", {"fraction": str(answer["fraction"]), "format": "html"})
                ET.SubElement(answer_node, "text").text = answer["textHtml"]
                common_text(answer_node, "feedback", answer["feedbackHtml"], True)
        elif kind == "truefalse":
            require(type(q["correct"]) is bool, q["id"] + ": boolean answer required")
            for value in [True, False]:
                answer = ET.SubElement(node, "answer", {"fraction": "100" if value == q["correct"] else "0", "format": "html"})
                ET.SubElement(answer, "text").text = "true" if value else "false"
                common_text(answer, "feedback", q["trueFeedbackHtml"] if value else q["falseFeedbackHtml"], True)
        elif kind == "matching":
            require(len(q["pairs"]) >= 3, q["id"] + ": at least three matching concepts required")
            ET.SubElement(node, "shuffleanswers").text = "true"
            combined_feedback(node, explanation)
            for pair in q["pairs"]:
                sub = ET.SubElement(node, "subquestion", {"format": "html"})
                ET.SubElement(sub, "text").text = pair["promptHtml"]
                common_text(sub, "answer", pair["answer"])
        elif kind == "ddimageortext":
            background = q["background"]
            data = owned_file(source, background["file"]).read_bytes()
            require(data.startswith(b"\x89PNG\r\n\x1a\n"), q["id"] + ": render the original editable diagram as PNG")
            ET.SubElement(node, "file", {"name": Path(background["file"]).name, "path": "/", "encoding": "base64"}).text = base64.b64encode(data).decode("ascii")
            ET.SubElement(node, "shuffleanswers")
            combined_feedback(node, explanation)
            drags, drops = q["drags"], q["drops"]
            require([d["no"] for d in drags] == list(range(1, len(drags) + 1)), q["id"] + ": sequential native drag identities required")
            require([d["no"] for d in drops] == list(range(1, len(drops) + 1)), q["id"] + ": sequential native drop identities required")
            for drag in drags:
                option = ET.SubElement(node, "drag")
                for key, value in [("no", drag["no"]), ("text", drag["text"]), ("draggroup", drag["group"])]:
                    ET.SubElement(option, key).text = str(value)
                if drag.get("infinite", False): ET.SubElement(option, "infinite")
            for drop in drops:
                require(type(drop["choice"]) is int and 1 <= drop["choice"] <= len(drags), q["id"] + ": original diagram choice required")
                require(0 <= drop["xleft"] < background["width"] and 0 <= drop["ytop"] < background["height"], q["id"] + ": drop lies on its original diagram")
                target = ET.SubElement(node, "drop")
                for key, value in [("no", drop["no"]), ("text", drop["label"]), ("choice", drop["choice"]), ("xleft", drop["xleft"]), ("ytop", drop["ytop"])]:
                    ET.SubElement(target, key).text = str(value)
        else:
            ET.SubElement(node, "shuffleanswers").text = "true"
            combined_feedback(node, explanation)
            occurrences = Counter(correct[index - 1] for index in gaps)
            for index, choice in enumerate(choices, 1):
                option = ET.SubElement(node, "selectoption" if kind == "gapselect" else "dragbox")
                ET.SubElement(option, "text").text = choice["text"]
                group = choice.get("group", 1)
                require(type(group) is int and group > 0, q["id"] + ": native answer group required")
                ET.SubElement(option, "group").text = str(group)
                if kind == "ddwtos" and occurrences[index] > 1:
                    ET.SubElement(option, "infinite")
        tags = ET.SubElement(node, "tags")
        common_text(tags, "tag", unit["id"])
        common_text(tags, "tag", "DISO public service")
    data = ET.tostring(quiz, encoding="utf-8", xml_declaration=True)
    ET.fromstring(data)
    return data + b"\n"

def application_html(unit):
    item = unit["application"]
    rubric = "".join("<tr><td>" + text(row["criterion"]) + "</td><td>" + text(row["points"]) + "</td></tr>" for row in item["rubric"])
    return ("<h3>" + text(item["title"]) + "</h3>" + item["instructionsHtml"] +
            "<h4>Your working document</h4><p>" + text(item["deliverable"]) + "</p>" +
            "<h4>Review your response</h4><table><thead><tr><th>Criterion</th><th>Points</th></tr></thead><tbody>" + rubric +
            "</tbody></table><h4>Reflection</h4><p>" + text(unit["reflection"]["prompt"]) + "</p>" +
            "<p>Submit your practice workbook to open the suggested answer and reflection guidance, then revise your response. Keep personal and operationally sensitive information out of practice submissions.</p>")

def build(source, output, media):
    source, output = source.resolve(), output.resolve()
    require(source != output and not source.is_relative_to(output), "Separate compiled output directory required")
    source_records = []
    def load(relative):
        file = owned_file(source, relative)
        data = file.read_bytes()
        source_records.append({"path": relative, "bytes": len(data), "sha256": sha(data)})
        return json.loads(data)
    def retain(relative):
        data = owned_file(source, relative).read_bytes()
        source_records.append({"path": relative, "bytes": len(data), "sha256": sha(data)})
        return data
    course = load("course.json")
    require(course["schema"] == "dpsa.diso.course.v1", "Original course schema required")
    require(course["passPercent"] == 75 and course["attempts"] == 0, "Tender assessment settings must be retained")
    require(len(course["modules"]) == 13, "Complete thirteen-module course required")
    catalog = load(course["sourcesFile"])
    require(catalog["schema"] == "dpsa.diso.sources.v1", "Original primary-source catalog required")
    sources = {row["id"]: row for row in catalog["sources"]}
    require(len(sources) == len(catalog["sources"]), "Unique source identities required")
    glossary = load(course.get("glossaryFile", "glossary.json"))
    scripts = load(course.get("mediaFile", "media/scripts.json"))
    diagrams = load(course.get("diagramsFile", "images/diagrams.json"))
    retain("render_diagrams.py")
    require(glossary["schema"] == "dpsa.diso.glossary.v1" and scripts["schema"] == "dpsa.diso.media.v1", "Complete editable glossary and module presentations required")
    media = media.resolve()
    media_manifest = json.loads(owned_file(media, "media.json").read_bytes())
    require(media_manifest["scriptSha256"] == sha(owned_file(source, course.get("mediaFile", "media/scripts.json")).read_bytes()), "Rendered media belongs to these exact original scripts")
    require(len(media_manifest["videos"]) == 13, "All13 original module presentations required")
    rendered = {item["moduleId"]: item for item in media_manifest["videos"]}
    glossary_html = "<h2>" + text(glossary["title"]) + "</h2><dl>" + "".join(
        "<dt><strong>" + text(item["term"]) + "</strong></dt><dd>" + item["definitionHtml"] +
        source_links(item.get("sourceIds", []), sources) + "</dd>" for item in glossary["entries"]) + "</dl>"
    modules, identifiers, instructor = [], set(), []
    files, question_types = {}, Counter()
    for item in media_manifest["files"]:
        data = owned_file(media, item["path"]).read_bytes()
        require(len(data) == item["bytes"] and sha(data) == item["sha256"], "Original rendered presentation differs: " + item["path"])
        files["media/" + item["path"]] = data
    files["media/media.json"] = owned_file(media, "media.json").read_bytes()
    printable = ['<h1>' + text(course["title"]) + '</h1><p>Self-paced departmental information security practice.</p>']
    for position, entry in enumerate(course["modules"], 1):
        module = load(entry["file"])
        require(module["schema"] == "dpsa.diso.module.v1" and module["id"] == entry["id"], "Original module identity differs")
        require(len(module["units"]) == 2, module["id"] + ": both complete learning units required")
        example = module["realExample"]
        summary = ("<p>" + text(module["summary"]) + "</p><h3>Learning outcomes</h3><ul>" +
                   "".join("<li>" + text(item) + "</li>" for item in module["outcomes"]) +
                   "</ul><h3>" + text(example["title"]) + "</h3><p>" + text(example["documentedOutcome"]) +
                   "</p><p>" + text(example["discussion"]) + "</p><p>" + text(example["scope"]) + "</p>" +
                   source_links(example["sourceIds"], sources))
        video = rendered[module["id"]]
        native = {"id": module["id"], "section": position, "title": module["title"], "summaryHtml": summary, "units": [],
                  "video": {**video, "files": [{**item, "path": "media/" + item["path"]} for item in video["files"]]}}
        printable.append('<article id="' + text(module["id"]) + '"><h2>' + text(module["title"]) + "</h2>" + summary)
        instructor.append("<h2>" + text(module["title"]) + "</h2>")
        for unit in module["units"]:
            require(unit["quiz"]["passPercent"] == 75 and unit["quiz"]["attempts"] == 0, unit["id"] + ": assessment policy differs")
            require(unit["chapters"] and unit["application"]["rubric"] and unit["reflection"]["prompt"], unit["id"] + ": complete learning materials required")
            for q in unit["quiz"]["questions"]:
                require(q["id"] not in identifiers, "Unique question identity required: " + q["id"])
                identifiers.add(q["id"]); question_types[q["type"]] += 1
                if q["type"] == "ddimageortext":
                    for relative in [q["background"]["file"], q["background"]["sourceFile"]]:
                        files[relative] = retain(relative)
                require(q["promptHtml"].strip() and q["generalFeedbackHtml"].strip(), q["id"] + ": meaningful question and feedback required")
            chapters = [{"id": c["id"], "title": c["title"], "content": c["bodyHtml"] + source_links(c["sourceIds"], sources)} for c in unit["chapters"]]
            chapters.append({"id": unit["id"] + "-APPLICATION", "title": "Apply the unit", "content": application_html(unit)})
            guidance = "<h3>Suggested answer</h3>" + unit["application"]["suggestedAnswerHtml"] + "<h3>Reflection guidance</h3>" + unit["reflection"]["guidanceHtml"]
            files["guidance/" + unit["id"] + ".html"] = guidance.encode("utf-8")
            instructor.append("<h3>" + text(unit["title"]) + "</h3>" + application_html(unit) + guidance)
            xml_name = "questions/" + unit["id"] + ".xml"
            files[xml_name] = questions_xml(unit, sources, source)
            book = "<h2>" + text(unit["title"]) + "</h2>" + "".join("<section><h3>" + text(c["title"]) + "</h3>" + c["content"] + "</section>" for c in chapters)
            files["books/" + unit["id"] + ".html"] = book.encode()
            printable.append(book)
            native["units"].append({
                "id": unit["id"], "title": unit["title"], "estimatedMinutes": unit["estimatedMinutes"],
                "objectives": unit["objectives"], "chapters": chapters, "applicationHtml": application_html(unit), "guidanceHtml": guidance,
                "quiz": {"id": unit["quiz"]["id"], "title": unit["quiz"]["title"], "file": xml_name,
                         "passPercent": 75, "attempts": 0,
                         "questions": [{"id": q["id"], "type": q["type"], "name": q["name"]} for q in unit["quiz"]["questions"]]},
            })
        printable.append("</article>")
        modules.append(native)
    require(len(identifiers) == 312, "Complete 26-unit /312-question edition required")
    sources_html = "<h2>Primary sources and further reading</h2>" + source_links(list(sources), sources)
    printable.append(glossary_html)
    printable.append(sources_html)
    navigation = "<nav aria-label=\"Course modules\"><ol>" + "".join('<li><a href="#' + text(m["id"]) + '">' + text(m["title"]) + "</a></li>" for m in modules) + "</ol></nav>"
    page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + text(course["title"]) + "</title><style>" + STYLE + "</style></head><body>" + navigation + "".join(printable) + "</body></html>"
    files["Complete_DISO_Course.html"] = page.encode()
    files["Instructor_Guidance.html"] = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DISO instructor guidance</title><style>' + STYLE + "</style></head><body><h1>DISO instructor guidance</h1><p>Worked answers and reflection guidance for course editors and facilitators.</p>" + "".join(instructor) + "</body></html>").encode()
    source_identity = sha(encode({"sources": sorted(source_records, key=lambda row: row["path"]), "renderedMediaSha256": sha(owned_file(media, "media.json").read_bytes())}))
    package = {"schema": "dpsa.diso.moodle-package.v1", "moodleBranch": "405", "moodleCommit": MOODLE_COMMIT,
               "sourceSha256": source_identity, "course": course, "modules": modules, "sourcesHtml": sources_html, "glossaryHtml": glossary_html,
               "counts": {"modules": 13, "units": 26, "books": 26, "assignments": 26, "quizzes": 26,
                          "questions": len(identifiers), "questionTypes": dict(question_types), "sources": len(sources),
                          "videos": len(rendered), "glossaryEntries": len(glossary["entries"]), "chapters": 104, "guidancePages": 26}}
    files["package.json"] = encode(package)
    manifest = {"schema": "dpsa.diso.compiled-source.v1", "sourceSha256": source_identity,
                "moodleCommit": MOODLE_COMMIT, "sourceFiles": source_records,
                "outputs": [{"path": name, "bytes": len(data), "sha256": sha(data)} for name, data in sorted(files.items())]}
    files["SOURCE_MANIFEST.json"] = encode(manifest)
    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        require(not destination.is_symlink(), "Compiled source file must be regular")
        fd, temporary = tempfile.mkstemp(prefix=".diso-", dir=destination.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
    return {"status": "COMPLETE", "directory": str(output), "package": str(output / "package.json"),
            "sourceSha256": source_identity, "counts": package["counts"], "files": len(files)}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Complete curriculum directory")
    parser.add_argument("--output", type=Path, required=True, help="Separate compiled course directory")
    parser.add_argument("--media", type=Path, required=True, help="Rendered complete module media directory")
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.output, args.media), indent=2))
