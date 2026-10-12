"""Native Cognos parsing and reviewed PBIP/PBIR/TMDL project generation.

The mechanical Cognos parser is the pinned, MIT-licensed cognos2powerbi core.
This adapter owns source bindings, literal-preserving TMDL, stable native IDs,
complete schema validation, and portable local-data opening.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "vendor"))

from cognos2powerbi.core.detect import detect_source_kind, SourceKind
from cognos2powerbi.core.ir.models import MigrationProject
from cognos2powerbi.core.parsers import parse_report, parse_model, parse_data_module, parse_dashboard
from cognos2powerbi.core.generators.pbip_generator import PbipGenerator
from .compare import read_csv
from .store import digest, encoded

SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/"
SCHEMAS = {
    "project": SCHEMA + "pbip/pbipProperties/1.0.0/schema.json",
    "model": SCHEMA + "item/semanticModel/definitionProperties/1.0.0/schema.json",
    "link": SCHEMA + "item/report/definitionProperties/2.0.0/schema.json",
    "report": SCHEMA + "item/report/definition/report/3.1.0/schema.json",
    "page": SCHEMA + "item/report/definition/page/1.0.0/schema.json",
    "pages": SCHEMA + "item/report/definition/pagesMetadata/1.1.0/schema.json",
    "version": SCHEMA + "item/report/definition/versionMetadata/1.0.0/schema.json",
    "visual": SCHEMA + "item/report/definition/visualContainer/2.9.0/schema.json",
    "platform": SCHEMA + "gitIntegration/platformProperties/2.0.0/schema.json",
}
TYPES = {"string": "type text", "int64": "Int64.Type", "double": "type number",
         "decimal": "Currency.Type", "boolean": "type logical", "dateTime": "type datetime"}


def clean_name(value):
    value = str(value)
    if not value or any(ord(c) < 32 for c in value) or len(value) > 500:
        raise ValueError("Native model names must be nonempty and contain no control characters.")
    return value


def name(value):
    return "'" + clean_name(value).replace("'", "''") + "'"


def m_string(value):
    value = str(value).replace("#", "#(#)").replace('"', '""')
    value = value.replace("\r", "#(cr)").replace("\n", "#(lf)").replace("\t", "#(tab)")
    return '"' + value + '"'


def native_id(*values):
    return uuid.uuid5(uuid.NAMESPACE_URL, "commons-bi/" + "/".join(map(str, values))).hex


def file_name(value):
    label = re.sub("[^A-Za-z0-9_-]", "_", str(value))[:30].strip("_") or "item"
    return label + "_" + hashlib.sha256(str(value).encode()).hexdigest()[:12]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def analyze(path, filename):
    data = Path(path).read_bytes()
    if len(data) > 32 * 1024 * 1024:
        raise ValueError("Cognos specifications may contain at most 32 MiB.")
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("Import a standalone Cognos specification without document entities.")
    kind = detect_source_kind(data, filename)
    parser = {SourceKind.REPORT: parse_report, SourceKind.FM_MODEL: parse_model,
              SourceKind.DATA_MODULE: parse_data_module, SourceKind.DASHBOARD: parse_dashboard}.get(kind)
    if parser is None:
        raise ValueError("Use a Cognos report XML, Framework Manager XML, data module or dashboard JSON.")
    project = parser(path)
    project.name = file_name(Path(filename).stem)
    project.source_path = filename
    result = project.model_dump(mode="json")
    # A Cognos logical query name is not a physical SQL table or connection.
    result["data_source"] = {"kind": "none", "server": "", "database": "", "schema_name": ""}
    result["review_flags"] = list(result.get("review_flags", []))
    return {"kind": kind.value, "project": result, "inventory": inventory(result)}


def inventory(project):
    return {
        "tables": len(project.get("tables", [])),
        "columns": sum(len(t.get("columns", [])) for t in project.get("tables", [])),
        "measures": sum(len(t.get("measures", [])) for t in project.get("tables", [])),
        "pages": len(project.get("pages", [])),
        "visuals": sum(len(p.get("visuals", [])) for p in project.get("pages", [])),
        "relationships": len(project.get("relationships", [])),
        "prompts": len(project.get("prompts", [])), "filters": len(project.get("filters", [])),
        "review_items": len(project.get("review_flags", [])),
        "query_graph": project.get("query_graph", {}),
    }


def validate_project(payload):
    project = MigrationProject.model_validate(payload)
    canonical = project.model_dump(mode="json")

    def unknown_keys(given, understood, where="project"):
        if isinstance(given, dict) and isinstance(understood, dict):
            for key, value in given.items():
                if key not in understood:
                    raise ValueError(f"Unknown native model property: {where}.{key}")
                unknown_keys(value, understood[key], where + "." + key)
        elif isinstance(given, list) and isinstance(understood, list):
            for index, (a, b) in enumerate(zip(given, understood)):
                unknown_keys(a, b, f"{where}[{index}]")

    unknown_keys(payload, canonical)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", project.name):
        raise ValueError("The project filename must contain letters, digits, underscores or hyphens.")
    table_names = set()
    for table in project.tables:
        clean_name(table.name)
        if table.name.casefold() in table_names:
            raise ValueError("Table names must be unique, ignoring case.")
        table_names.add(table.name.casefold())
        field_names = set()
        for item in [*table.columns, *table.measures]:
            clean_name(item.name)
            if item.name.casefold() in field_names:
                raise ValueError(f"Duplicate column or measure in {table.name}: {item.name}")
            field_names.add(item.name.casefold())
    tables = {t.name: t for t in project.tables}
    for relation in project.relationships:
        for table, column in ((relation.from_table, relation.from_column), (relation.to_table, relation.to_column)):
            if table not in tables or tables[table].column(column) is None:
                raise ValueError(f"Relationship references absent field {table}.{column}.")
    for page in project.pages:
        clean_name(page.name)
        for visual in page.visuals:
            if visual.width <= 0 or visual.height <= 0 or min(visual.x, visual.y) < 0:
                raise ValueError("Visual positions and dimensions must fit a nonnegative canvas.")
            for field in visual.fields:
                if field.table not in tables or field.name not in {
                    c.name for c in [*tables[field.table].columns, *tables[field.table].measures]
                }:
                    raise ValueError(f"Visual references absent field {field.table}.{field.name}.")
    return project


def _tmdl_property(value):
    return '"' + str(value).replace('"', '""').replace("\r", " ").replace("\n", " ") + '"'


def _expression(lines, declaration, expression, level):
    if not str(expression).strip():
        raise ValueError(f"Enter a native expression for {declaration}.")
    # Verbatim blocks preserve string literals, whitespace and comments in DAX/M.
    fence = chr(96) * 3
    if any(line.strip() == fence for line in str(expression).splitlines()):
        raise ValueError("Native expressions cannot contain a standalone TMDL expression fence.")
    lines.append("\t" * level + declaration + " = " + fence)
    lines.extend("\t" * (level + 1) + line for line in str(expression).splitlines())
    lines.append("\t" * (level + 1) + fence)


class Generator(PbipGenerator):
    def __init__(self, bindings, get_blob, project_key):
        self.bindings = bindings
        self.get_blob = get_blob
        self.project_key = project_key
        self.data_files = {}

    def _write_review_report(self, root, project):
        # Keep the pinned parser and metadata writer unchanged. This application
        # has an operator review workflow, not the upstream optional AI stage.
        if not project.review_flags:
            return
        def cell(value):
            return str(value or "").replace("|", "\\|").replace("\r", " ").replace("\n", " ")
        lines = [f"# Migration review: {project.name}", "",
            "Review these retained source findings in the migration workspace and Power BI Desktop.",
            "Resolve the relevant bindings, calculations, prompts, filters and report behavior; rebuild",
            "and compare the resulting query outputs with the original Cognos results before rollout.",
            "Original findings and query metadata remain in MIGRATION_PLAN.json and the metadata files.", "",
            "| Severity | Code | Message | Source |", "| --- | --- | --- | --- |"]
        for flag in project.review_flags:
            lines.append("| " + " | ".join(cell(value) for value in
                (flag.severity.value, flag.code, flag.message, flag.source_ref)) + " |")
        (root / "MIGRATION_REVIEW.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _binding_m(self, table):
        binding = self.bindings.get(table.name)
        if not binding:
            raise ValueError(f"Choose a physical source for table {table.name}.")
        kind = binding.get("kind")
        if kind == "csv":
            sha = binding["digest"]
            data = self.get_blob(sha)
            headers, rows = read_csv(data)
            for column in table.columns:
                if not column.is_calculated and (column.source_column or column.name) not in headers:
                    raise ValueError(f"{table.name}.{column.name} does not match the CSV source header.")
            relative = "data/" + file_name(table.name) + ".csv"
            self.data_files[relative] = data
            delimiter = binding.get("delimiter", ",")
            if delimiter != ",":
                raise ValueError("Normalize the source to comma-separated UTF-8 CSV before binding.")
            lines = [
                "let",
                "    Source = Csv.Document(File.Contents(DataRoot & " + m_string("/" + relative) +
                "), [Delimiter=\",\", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),",
                "    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),",
            ]
            previous = "Headers"
            if binding.get("null_token") is not None:
                lines.append("    Nulls = Table.ReplaceValue(Headers, " + m_string(binding["null_token"]) +
                             ", null, Replacer.ReplaceValue, Table.ColumnNames(Headers)),")
                previous = "Nulls"
            types = ["{" + m_string(c.source_column or c.name) + ", " + TYPES[c.data_type.value] + "}"
                     for c in table.columns if not c.is_calculated]
            lines.extend(["    Typed = Table.TransformColumnTypes(" + previous + ", {" + ", ".join(types) +
                          "}, " + m_string(binding.get("culture", "en-US")) + ")", "in", "    Typed"])
            return "\n".join(lines)
        if kind == "sqlserver":
            server, database = binding.get("server"), binding.get("database")
            if not server or not database:
                raise ValueError(f"Enter the SQL Server and database for {table.name}.")
            source = "Sql.Database(" + m_string(server) + ", " + m_string(database) + ")"
            if binding.get("query"):
                params = binding.get("parameters", {})
                if not isinstance(params, dict):
                    raise ValueError("SQL query parameters must be a named object.")
                def m_value(value):
                    if value is None:
                        return "null"
                    if value is True:
                        return "true"
                    if value is False:
                        return "false"
                    if isinstance(value, (int, float)):
                        return json.dumps(value, allow_nan=False)
                    return m_string(value)
                parameter_record = "[" + ", ".join("#" + m_string(k) + "=" + m_value(v) for k, v in params.items()) + "]"
                return ("let\n    Source = " + source + ",\n    Result = Value.NativeQuery(Source, " +
                        m_string(binding["query"]) + ", " + parameter_record + ", [EnableFolding=true])\nin\n    Result")
            schema, item = binding.get("schema", "dbo"), binding.get("table")
            if not item:
                raise ValueError(f"Select an actual SQL table/view or reviewed native query for {table.name}.")
            return ("let\n    Source = " + source + ",\n    Result = Source{[Schema=" + m_string(schema) +
                    ",Item=" + m_string(item) + "]}[Data]\nin\n    Result")
        if kind == "m":
            expression = binding.get("expression", "").strip()
            if not expression:
                raise ValueError(f"Enter a Power Query expression for {table.name}.")
            return expression
        raise ValueError(f"Unsupported source binding for {table.name}: {kind}")

    def _render_model_tmdl(self, project):
        lines = ["model Model", "\tculture: en-US", "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
                 "\tsourceQueryCulture: en-US", ""]
        if any(b.get("kind") == "csv" for b in self.bindings.values()):
            lines += ['expression DataRoot = "" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]', ""]
        for table in project.tables:
            lines.append("ref table " + name(table.name))
        lines.append("")
        for r in project.relationships:
            lines += ["relationship " + native_id(self.project_key, r.from_table, r.from_column, r.to_table, r.to_column),
                      "\tfromColumn: " + name(r.from_table) + "." + name(r.from_column),
                      "\ttoColumn: " + name(r.to_table) + "." + name(r.to_column)]
            if not r.is_active:
                lines.append("\tisActive: false")
            if r.cardinality.value in {"oneToOne", "oneToMany"}:
                lines.append("\tfromCardinality: one")
            if r.cardinality.value in {"manyToMany", "oneToMany"}:
                lines.append("\ttoCardinality: many")
            if r.cross_filter.value == "bothDirections":
                lines.append("\tcrossFilteringBehavior: bothDirections")
            lines.append("")
        return "\n".join(lines) + "\n"

    def _render_table_tmdl(self, table, _):
        lines = ["table " + name(table.name), "\tlineageTag: " + native_id(self.project_key, table.name), ""]
        if table.data_category:
            lines.insert(2, "\tdataCategory: " + _tmdl_property(table.data_category))
        for col in table.columns:
            if col.is_calculated:
                _expression(lines, "column " + name(col.name), col.dax_expression, 1)
            else:
                lines.append("\tcolumn " + name(col.name))
            lines += ["\t\tdataType: " + col.data_type.value,
                      "\t\tlineageTag: " + native_id(self.project_key, table.name, "column", col.name)]
            if not col.is_calculated:
                lines.append("\t\tsourceColumn: " + _tmdl_property(col.source_column or col.name))
            if col.is_hidden:
                lines.append("\t\tisHidden")
            if col.is_key:
                lines.append("\t\tisKey")
            if col.summarize_by:
                if col.summarize_by not in {"none", "sum", "min", "max", "count", "average", "distinctCount", "default"}:
                    raise ValueError("Unknown TMDL summarizeBy value.")
                lines.append("\t\tsummarizeBy: " + col.summarize_by)
            if col.data_category:
                lines.append("\t\tdataCategory: " + _tmdl_property(col.data_category))
            if col.format_string:
                lines.append("\t\tformatString: " + _tmdl_property(col.format_string))
            lines.append("")
        for measure in table.measures:
            _expression(lines, "measure " + name(measure.name), measure.dax_expression, 1)
            lines.append("\t\tlineageTag: " + native_id(self.project_key, table.name, "measure", measure.name))
            if measure.format_string:
                lines.append("\t\tformatString: " + _tmdl_property(measure.format_string))
            lines.append("")
        lines += ["\tpartition " + name(table.name) + " = m", "\t\tmode: import"]
        _expression(lines, "source", self._binding_m(table), 2)
        lines.append("")
        return "\n".join(lines)

    def _write_semantic_model(self, model_dir, project):
        write_json(model_dir / ".platform", self._platform("SemanticModel", project.name))
        write_json(model_dir / "definition.pbism", {"$schema": SCHEMAS["model"], "version": "4.0", "settings": {}})
        definition = model_dir / "definition"
        (definition / "tables").mkdir(parents=True, exist_ok=True)
        (definition / "database.tmdl").write_text("database\n\tcompatibilityLevel: 1604\n", encoding="utf-8")
        (definition / "model.tmdl").write_text(self._render_model_tmdl(project), encoding="utf-8")
        for table in project.tables:
            (definition / "tables" / (file_name(table.name) + ".tmdl")).write_text(
                self._render_table_tmdl(table, project.data_source), encoding="utf-8")

    def _platform(self, kind, label):
        return {"$schema": SCHEMAS["platform"], "metadata": {"type": kind, "displayName": label},
                "config": {"version": "2.0", "logicalId": str(uuid.UUID(native_id(self.project_key, kind)))}}

    def _write_report(self, report_dir, model_dir, project):
        write_json(report_dir / ".platform", self._platform("Report", project.name))
        write_json(report_dir / "definition.pbir",
                   {"$schema": SCHEMAS["link"], "version": "4.0",
                    "datasetReference": {"byPath": {"path": "../" + model_dir.name}}})
        definition = report_dir / "definition"
        write_json(definition / "version.json", {"$schema": SCHEMAS["version"], "version": "2.0.0"})
        theme = {"name": "CommonsIndustrial", "dataColors": ["#222222", "#666666", "#999999", "#bbbbbb", "#dddddd"],
                 "background": "#ffffff", "foreground": "#222222", "tableAccent": "#555555"}
        write_json(report_dir / "StaticResources" / "RegisteredResources" / "CommonsIndustrial.json", theme)
        versions = {"visual": "2.9.0", "report": "3.1.0", "page": "1.0.0"}
        write_json(definition / "report.json", {
            "$schema": SCHEMAS["report"],
            "themeCollection": {
                "baseTheme": {"name": "CY24SU06", "reportVersionAtImport": versions, "type": "SharedResources"},
                "customTheme": {"name": "CommonsIndustrial", "reportVersionAtImport": versions, "type": "RegisteredResources"}},
            "resourcePackages": [
                {"name": "SharedResources", "type": "SharedResources",
                 "items": [{"name": "CY24SU06", "path": "BaseThemes/CY24SU06.json", "type": "BaseTheme"}]},
                {"name": "RegisteredResources", "type": "RegisteredResources",
                 "items": [{"name": "CommonsIndustrial", "path": "CommonsIndustrial.json", "type": "CustomTheme"}]}],
            "settings": {"exportDataMode": "AllowSummarizedAndUnderlying", "useEnhancedTooltips": True}})
        pages = []
        for index, page in enumerate(project.pages):
            page_id = native_id(self.project_key, "page", page.name, index)[:20]
            pages.append(page_id)
            folder = definition / "pages" / page_id
            height = max([720, *[v.y + v.height + 24 for v in page.visuals]])
            width = max([1280, *[v.x + v.width + 24 for v in page.visuals]])
            write_json(folder / "page.json", {"$schema": SCHEMAS["page"], "name": page_id,
                       "displayName": page.display_name or page.name, "displayOption": "FitToPage", "height": height, "width": width})
            for number, visual in enumerate(page.visuals):
                visual_id = native_id(self.project_key, page_id, "visual", number)[:20]
                query_state = self._build_query_state(visual, project)
                for role in query_state.values():
                    for projection in role["projections"]:
                        projection.pop("active", None)
                        if visual.visual_type.value == "pivotTable" and "Column" in projection["field"]:
                            projection["active"] = True
                visual_type = {"columnChart": "clusteredColumnChart", "barChart": "clusteredBarChart"}.get(
                    visual.visual_type.value, visual.visual_type.value)
                config = {"visualType": visual_type, "drillFilterOtherVisuals": True}
                if query_state:
                    config["query"] = {"queryState": query_state}
                if visual.title:
                    config["visualContainerObjects"] = {"title": [{"properties": {
                        "show": {"expr": {"Literal": {"Value": "true"}}},
                        "text": {"expr": {"Literal": {"Value": "'" + visual.title.replace("'", "''") + "'"}}}}}]}
                write_json(folder / "visuals" / visual_id / "visual.json", {
                    "$schema": SCHEMAS["visual"], "name": visual_id,
                    "position": {"x": visual.x, "y": visual.y, "z": number, "width": visual.width,
                                 "height": visual.height, "tabOrder": number}, "visual": config})
        if not pages:
            page_id = native_id(self.project_key, "model-browser")[:20]
            pages.append(page_id)
            write_json(definition / "pages" / page_id / "page.json", {
                "$schema": SCHEMAS["page"], "name": page_id, "displayName": "Model",
                "displayOption": "FitToPage", "height": 720, "width": 1280})
        write_json(definition / "pages" / "pages.json",
                   {"$schema": SCHEMAS["pages"], "pageOrder": pages, "activePageName": pages[0]})


def validate_schemas(folder):
    from jsonschema import Draft7Validator
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT7
    schema_dir = ROOT / "schemas"
    index = json.loads((schema_dir / "index.json").read_text())
    resources = {}
    for url, record in index.items():
        data = (schema_dir / record["file"]).read_bytes()
        if digest(data) != record["sha256"]:
            raise ValueError("A retained Microsoft schema has changed.")
        resources[url] = Resource.from_contents(json.loads(data), default_specification=DRAFT7)
    registry = Registry().with_resources(resources.items())
    checked, errors = [], []
    for path in sorted(Path(folder).rglob("*")):
        if path.is_file() and (path.suffix in {".json", ".pbip", ".pbir", ".pbism"} or path.name == ".platform"):
            try:
                document = json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                raise ValueError(f"Invalid JSON in {path.name}.")
            url = document.get("$schema") if isinstance(document, dict) else None
            if url is None:
                continue
            if url not in resources:
                raise ValueError(f"The native schema is not installed: {url}")
            validator = Draft7Validator(resources[url].contents, registry=registry)
            for error in validator.iter_errors(document):
                errors.append({"file": str(path.relative_to(folder)), "path": list(error.absolute_path), "message": error.message})
            checked.append(str(path.relative_to(folder)))
    if errors:
        raise ValueError("Native Power BI schema validation: " + encoded(errors[:20]))
    return {"files": checked, "schemas": len(resources), "errors": []}


def build(plan, get_blob, folder):
    project = validate_project(plan["project"])
    generator = Generator(plan.get("bindings", {}), get_blob, plan.get("project_key", project.name))
    target = Path(folder)
    target.mkdir(parents=True, exist_ok=True)
    pbip = generator.generate(project, target)
    for relative, data in generator.data_files.items():
        path = target / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    write_json(target / "MIGRATION_PLAN.json", plan)
    prepare = ROOT / "prepare_project.py"
    (target / prepare.name).write_bytes(prepare.read_bytes())
    (target / "OPEN_POWER_BI.ps1").write_bytes((ROOT / "OPEN_POWER_BI.ps1").read_bytes())
    (target / "OPEN_PROJECT.txt").write_text(
        "Open this folder in Windows. Run OPEN_POWER_BI.ps1, or run python prepare_project.py and open " +
        pbip.name + ". The helper binds DataRoot to this extracted directory. Refresh the semantic model, " +
        "then open the report pages. Review SQL or M bindings in MIGRATION_PLAN.json. " +
        "Original Cognos prompt/filter/query metadata remain alongside the native project.\n", encoding="utf-8")
    validation = validate_schemas(target)
    return {"project_file": pbip.name, "inventory": inventory(plan["project"]), "schema_validation": validation,
            "files": [{"path": str(p.relative_to(target)), "bytes": p.stat().st_size, "sha256": digest(p.read_bytes())}
                      for p in sorted(target.rglob("*")) if p.is_file()]}
