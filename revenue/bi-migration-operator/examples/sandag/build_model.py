from pathlib import Path
import argparse, csv, hashlib, io, json, shutil, zipfile
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description="Rebuild the reviewed public SANDAG model from its exact retained source tables.")
parser.add_argument("--source-directory", required=True, help="Directory containing retained dataset/ CSVs and source companions")
parser.add_argument("--output", default=str(Path(__file__).resolve().parent))
args = parser.parse_args()
PUBLISHED = Path(args.source_directory).expanduser().resolve()
OUT = Path(args.output).expanduser().resolve()
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "data").mkdir(exist_ok=True)
EXPECTED_SOURCE_CSVS = {
  "offenses.csv": "a1416c8e5198f3a8d0b7e7a852b2045e5a67c5bfd3e78df65b5a456522977a82",
  "jurisdictions.csv": "5b3d26dc335662010871dabf8e5393332bf98e765c8098f2a452cb9e8e5857ff",
  "population.csv": "1c280c8ec1c500efe60337848f37252258ac318ac16a9d84f8435de55f7d2229",
  "summary_reference.csv": "6021cdac9460975b69bdb704beb2a0fe838144ec34cd646987661ac36db5f36f"
}
for filename, expected in EXPECTED_SOURCE_CSVS.items():
    actual = hashlib.sha256((PUBLISHED / "dataset" / filename).read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError("The retained SANDAG source table differs: " + filename)

TABLES = {
    "OffenseCells": "offenses.csv", "Jurisdictions": "jurisdictions.csv",
    "Population": "population.csv", "PublishedControls": "summary_reference.csv",
}
NAMES = {"source_record_id": "Source Row", "jurisdiction_id": "Jurisdiction ID",
         "jurisdiction_parent_id": "Parent Jurisdiction ID", "offense_id": "Offense ID",
         "source_sha256": "Source SHA256", "source_url": "Source URL",
         "is_regional_group_component": "Regional Group Component"}


def name(value):
    return NAMES.get(value, value.replace("_", " ").title())


def datatype(table, field):
    if field.startswith("is_") or field in {"numeric_format_anomaly", "source_table_alignment_review"}:
        return "boolean"
    if field in {"page", "year", "source_column"}:
        return "int64"
    if field == "value":
        return "double" if table == "PublishedControls" else "int64"
    return "string"


def csvdata(headers, rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, headers, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode()


project = {"name": "SANDAG_Published_Offense_Counts",
           "source_path": "SANDAG_Public_Aggregates.xml",
           "data_source": {"kind": "none", "server": "", "database": "", "schema_name": ""},
           "tables": [], "relationships": [], "pages": [], "query_graph": {"nodes": [], "edges": []},
           "filters": [], "prompts": [], "review_flags": []}
tables = {}
metadata = []
for table, filename in TABLES.items():
    raw = (PUBLISHED / "dataset" / filename).read_bytes()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    rows = list(reader)
    fields = reader.fieldnames
    normalized = [{key: ("\\N" if value == "" else value.lower() if datatype(table, key) == "boolean" else value)
                   for key, value in row.items()} for row in rows]
    data = csvdata(fields, normalized)
    (OUT / "data" / (table + ".csv")).write_bytes(data)
    tables[table] = {"rows": normalized, "fields": fields}
    metadata.append({"table": table, "source_file": filename, "source_csv_sha256": hashlib.sha256(raw).hexdigest(),
                     "rows": len(rows), "file": "data/" + table + ".csv", "sha256": hashlib.sha256(data).hexdigest()})
    project["tables"].append({"name": table, "source_query": table, "role": "dimension" if table == "Jurisdictions" else "fact",
        "columns": [{"name": name(field), "source_column": field, "data_type": datatype(table, field),
                     "is_key": field == "source_record_id" or (table == "Jurisdictions" and field == "jurisdiction_id"),
                     "summarize_by": "none", "is_hidden": field in {"source_url", "source_sha256"}}
                    for field in fields], "measures": []})
    project["query_graph"]["nodes"].append({"name": table, "role": "output", "is_output": True})

years = [{"year": str(year)} for year in (2021, 2023, 2024)]
data = csvdata(["year"], years)
(OUT / "data" / "Years.csv").write_bytes(data)
tables["Years"] = {"rows": years, "fields": ["year"]}
metadata.append({"table": "Years", "rows": 3, "file": "data/Years.csv", "sha256": hashlib.sha256(data).hexdigest(),
                 "source": "Distinct years actually reported in the retained appendix tables."})
project["tables"].append({"name": "Years", "source_query": "Years", "role": "dimension",
    "columns": [{"name": "Year", "source_column": "year", "data_type": "int64", "is_key": True, "summarize_by": "none"}],
    "measures": []})
project["query_graph"]["nodes"].append({"name": "Years", "role": "output", "is_output": True})
for table in ("OffenseCells", "Population", "PublishedControls"):
    project["relationships"] += [
        {"from_table": table, "from_column": "Jurisdiction ID", "to_table": "Jurisdictions", "to_column": "Jurisdiction ID",
         "cardinality": "manyToOne", "cross_filter": "oneDirection"},
        {"from_table": table, "from_column": "Year", "to_table": "Years", "to_column": "Year",
         "cardinality": "manyToOne", "cross_filter": "oneDirection"}]

project["relationships"] = [r for r in project["relationships"]
    if not (r["from_table"] == "Population" and r["from_column"] == "Year")]
offenses = next(t for t in project["tables"] if t["name"] == "OffenseCells")
controls = next(t for t in project["tables"] if t["name"] == "PublishedControls")
selection = (
    "VAR HasRegion = CONTAINS(VALUES('Jurisdictions'[Jurisdiction ID]), 'Jurisdictions'[Jurisdiction ID], \"san-diego-region\")\n"
    "VAR HasSheriff = CONTAINS(VALUES('Jurisdictions'[Jurisdiction ID]), 'Jurisdictions'[Jurisdiction ID], \"sheriff-total\")\n"
    "VAR SelectedUnits = FILTER('Jurisdictions', 'Jurisdictions'[Jurisdiction ID] <> \"san-diego-region\" && "
    "(NOT HasSheriff || NOT 'Jurisdictions'[Is Sheriff Component]))\n"
)
for group in ("A", "B"):
    count = "CALCULATE(SUM('OffenseCells'[Value]), KEEPFILTERS(SelectedUnits), 'OffenseCells'[Offense Level] = \"group_total\", 'OffenseCells'[Group] = \"" + group + "\")"
    regional_row = "CALCULATE(SUM('OffenseCells'[Value]), REMOVEFILTERS('Jurisdictions'), 'OffenseCells'[Regional Group Component] = TRUE(), 'OffenseCells'[Group] = \"" + group + "\")"
    offenses["measures"].append({"name": "Detailed Group " + group,
        "dax_expression": selection + "RETURN IF(HasRegion, " + regional_row + ", " + count + ")", "format_string": "#,0"})
    # The retained published summary controls cover Group A; there is no Group B control row.
    if group == "A":
        base = "CALCULATE(SUM('PublishedControls'[Value]), 'PublishedControls'[Offense ID] = \"total-group-a-offenses\", 'PublishedControls'[Unit] = \"count\""
        controls["measures"].append({"name": "Published Group A",
            "dax_expression": selection + "RETURN IF(HasRegion, " + base +
            ", REMOVEFILTERS('Jurisdictions'), 'PublishedControls'[Jurisdiction ID] = \"san-diego-region\"), " +
            base + ", KEEPFILTERS(SelectedUnits)))", "format_string": "#,0"})
        offenses["measures"].append({"name": "Detailed minus Published A",
            "dax_expression": "IF(NOT ISBLANK([Detailed Group A]) && NOT ISBLANK([Published Group A]), [Detailed Group A] - [Published Group A])",
            "format_string": "#,0"})
offenses["measures"] += [
    {"name": "Reported source cells", "dax_expression": "CALCULATE(COUNTROWS('OffenseCells'), KEEPFILTERS('OffenseCells'[Value State] = \"reported\"))", "format_string": "#,0"},
    {"name": "Other source states", "dax_expression": "CALCULATE(COUNTROWS('OffenseCells'), KEEPFILTERS('OffenseCells'[Value State] <> \"reported\"))", "format_string": "#,0"},
]


def field(table, column, role="values"):
    return {"table": table, "name": column, "role": role}


def visual(title, fields, kind="tableEx", x=24, y=24, width=1232, height=580):
    return {"title": title, "visual_type": kind, "fields": fields, "x": x, "y": y, "width": width, "height": height}


for group in ("A", "B"):
    unit = "Group A offense counts" if group == "A" else "Group B arrest-based offense counts"
    series = [field("Years", "Year", "category"), field("OffenseCells", "Detailed Group " + group)]
    columns = [field("Years", "Year"), field("Jurisdictions", "Jurisdiction"), field("OffenseCells", "Detailed Group " + group)]
    if group == "A":
        series += [field("PublishedControls", "Published Group A")]
        columns += [field("PublishedControls", "Published Group A"), field("OffenseCells", "Detailed minus Published A")]
    project["pages"].append({"name": "Group" + group, "display_name": unit,
        "visuals": [
            visual(unit + " — published years 2021 / 2023 / 2024",
                series, "lineChart", height=265),
            visual("Detailed tables and independently published Group A controls" if group == "A" else
                   "Group B detailed offense counts by jurisdiction — one offense per recorded arrest",
                columns, y=310, height=370)]})
project["pages"].append({"name": "SourceCoverage", "display_name": "Source coverage and row trace",
    "visuals": [visual("Published source cells by year and reporting state",
        [field("Years", "Year"), field("OffenseCells", "Value State"),
         field("OffenseCells", "Reported source cells"), field("OffenseCells", "Other source states")], height=240),
        visual("Original table cells — labels, raw tokens, page and hierarchy",
        [field("OffenseCells", c) for c in ("Source Row", "Year", "Jurisdiction", "Offense", "Group", "Value", "Value State", "Raw Value", "Page")],
        y=285, height=390)]})
project["pages"].append({"name": "Population", "display_name": "Published population denominators",
    "visuals": [visual("Published denominator and estimate vintage",
        [field("Population", c) for c in ("Year Label", "Applicable Years", "Jurisdiction", "Value", "Population Source", "Source Row")])]})
project["review_flags"] = [
    {"code": "PUBLIC_SOURCE_SCOPE", "severity": "info",
     "message": "This example specification was authored for the published SANDAG aggregate tables; it is not an agency Cognos production export."},
    {"code": "COUNTING_UNITS", "severity": "warning",
     "message": "Group A counting units differ by category; Group B is arrest-based. These are published offense counts, not unique incidents or people. See counting-basis.json."},
    {"code": "PUBLISHER_CONTROL_DIFFERENCES", "severity": "warning",
     "message": "The retained summary controls cover Group A only. The 66 detailed-versus-summary comparison observations and coverage differences remain in published_table_comparison.json. Preserve the publisher's values; do not infer corrections."},
    {"code": "SOURCE_NULL_AND_HIERARCHY", "severity": "warning",
     "message": "Retain unreported, partial-year and blank source states. Twelve original unlabeled cells retain their source-row IDs. Regional totals use Sheriff-Total once and exclude its children."},
    {"code": "POPULATION_PERIOD", "severity": "info",
     "message": "Population observations use the issuer's original 2021 and combined 2023/2024 periods. The reference page shows Year Label and Applicable Years; no active single-year relationship discards or duplicates the combined-period observation."},
]
(OUT / "reviewed-project.json").write_text(json.dumps(project, indent=2) + "\n")

# Authored native Cognos-compatible specification: one query per explicitly mapped table.
NS = "http://developer.cognos.com/schemas/report/7.0/"
ET.register_namespace("", NS)
node = lambda key: "{" + NS + "}" + key
report = ET.Element(node("report"), {"expressionLocale": "en-us"})
ET.SubElement(report, node("modelPath")).text = "/content/package[@name='Published SANDAG Aggregates']/model[@name='model']"
queries = ET.SubElement(report, node("queries"))
for table in project["tables"]:
    query = ET.SubElement(queries, node("query"), {"name": table["name"]})
    selection = ET.SubElement(query, node("selection"))
    for column in table["columns"]:
        item = ET.SubElement(selection, node("dataItem"), {"name": column["name"], "aggregate": "none", "dataType": column["data_type"]})
        ET.SubElement(item, node("expression")).text = "[Published Aggregates].[" + table["name"] + "].[" + column["source_column"] + "]"
    ET.SubElement(ET.SubElement(query, node("source")), node("model"))
layouts = ET.SubElement(report, node("layouts"))
layout = ET.SubElement(layouts, node("layout"))
pages = ET.SubElement(layout, node("reportPages"))
for table in project["tables"]:
    page = ET.SubElement(pages, node("page"), {"name": table["name"]})
    contents = ET.SubElement(ET.SubElement(page, node("pageBody")), node("contents"))
    listing = ET.SubElement(contents, node("list"), {"refQuery": table["name"], "name": table["name"]})
    columns = ET.SubElement(listing, node("listColumns"))
    for column in table["columns"][:9]:
        col = ET.SubElement(columns, node("listColumn"))
        content = ET.SubElement(ET.SubElement(col, node("listColumnBody")), node("contents"))
        text_item = ET.SubElement(content, node("textItem"))
        data_source = ET.SubElement(text_item, node("dataSource"))
        ET.SubElement(data_source, node("dataItemValue"), {"refDataItem": column["name"]})
ET.indent(report)
(OUT / "SANDAG_Public_Aggregates.xml").write_bytes(ET.tostring(report, encoding="utf-8", xml_declaration=True))

projection = ["source_record_id", "year", "jurisdiction_id", "offense_id", "group", "value", "value_state", "raw_value", "page",
              "is_detail_leaf", "is_regional_group_component"]
baseline_rows = [{key: row[key] for key in projection} for row in tables["OffenseCells"]["rows"]]
(OUT / "expected-native-rows.csv").write_bytes(csvdata(projection, baseline_rows))
query = "EVALUATE\nSELECTCOLUMNS(\n    'OffenseCells',\n" + ",\n".join(
    '    "' + key + '", \'OffenseCells\'[' + name(key) + ']' for key in projection) + "\n)\nORDER BY [source_record_id]\n"
(OUT / "capture-query.dax").write_text(query)
comparison = {"keys": ["source_record_id"], "null_token": "\\N",
              "fields": [{"left": key, "right": "[" + key + "]",
                          "type": "number" if key in {"year", "value", "page"} else "boolean" if key.startswith("is_") else "text",
                          **({"absolute": "0", "relative": "0"} if key in {"year", "value", "page"} else {})}
                         for key in projection]}
(OUT / "native-comparison.json").write_text(json.dumps(comparison, indent=2) + "\n")
for filename in ("footnotes.json", "published_table_comparison.json", "source_warnings.json", "tables.json"):
    shutil.copyfile(PUBLISHED / "dataset" / filename, OUT / filename)
shutil.copyfile(PUBLISHED / "counting-basis.json", OUT / "counting-basis.json")
source = {"title": "2024 Crime in the San Diego Region — published aggregate appendix tables",
          "url": "https://www.sandag.org/-/media/SANDAG/Documents/PDF/data-and-research/criminal-justice-and-public-safety/criminal-justice-research-clearinghouse/cj-bulletin/cj-bulletin-2024-crime-in-the-san-diego-region-2025-08-18.pdf",
          "sha256": "e25453715fbf0712c8b690ba09b2fb6c44191534f24f228b19d626d2da59738b",
          "bytes": 1345423, "data_scope": "Published aggregate table cells; no individual or incident-level records.",
          "normalization": "Blank extracted cells use the explicit CSV null token \\N; original value_state/raw_value and source row/table/page remain. Booleans use lowercase true/false. Counts are unchanged.",
          "specification_origin": "Commons-authored Cognos-compatible demonstration report, explicitly mapped to these public aggregate CSV tables.",
          "datasets": metadata}
(OUT / "SOURCE.json").write_text(json.dumps(source, indent=2) + "\n")
print(json.dumps({"datasets": metadata, "tables": len(project["tables"]), "relationships": len(project["relationships"]),
                  "pages": len(project["pages"]), "visuals": sum(len(p["visuals"]) for p in project["pages"])}))

# Complete CSVs travel together, without an external data service.
csv_files = {p.relative_to(OUT).as_posix(): p.read_bytes() for p in (OUT / "data").glob("*.csv")}
csv_files["expected-native-rows.csv"] = (OUT / "expected-native-rows.csv").read_bytes()
with zipfile.ZipFile(OUT / "data.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
    for path, data in sorted(csv_files.items()):
        info = zipfile.ZipInfo(path, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100600 << 16
        package.writestr(info, data)
