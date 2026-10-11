"""Native RDL 2016 tabular reports from explicitly reviewed CSV or SQL sources."""
from __future__ import annotations
import functools
import re
from pathlib import Path
from lxml import etree as ET
from .compare import read_csv
from .store import digest

NS = "http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition"
RD = "http://schemas.microsoft.com/SQLServer/reporting/reportdesigner"
SCHEMA = Path(__file__).resolve().parents[1] / "schemas/rdl/reportdefinition.xsd"


def element(parent, name, text=None, **attributes):
    node = ET.SubElement(parent, "{" + NS + "}" + name, **attributes)
    if text is not None:
        node.text = str(text)
    return node


def safe_name(value, fallback):
    value = re.sub(r"[^A-Za-z0-9_]", "_", str(value))
    return value if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value) else fallback


@functools.lru_cache(maxsize=1)
def schema():
    parser = ET.XMLParser(resolve_entities=False, no_network=True)
    return ET.XMLSchema(ET.parse(str(SCHEMA), parser))


def inspect(data):
    if len(data) > 64 * 1024 * 1024:
        raise ValueError("A local RDL import may contain at most 64 MiB.")
    parser = ET.XMLParser(resolve_entities=False, load_dtd=False, no_network=True)
    root = ET.fromstring(data, parser)
    if root.getroottree().docinfo.doctype:
        raise ValueError("An RDL import cannot contain a document type declaration.")
    name = ET.QName(root)
    if name.localname != "Report" or not re.fullmatch(
            r"http://schemas\.microsoft\.com/sqlserver/reporting/\d{4}/\d{2}/reportdefinition", name.namespace or ""):
        raise ValueError("Select an original Report Definition Language .rdl report.")
    validation = {"namespace": name.namespace, "xml_checked": True, "schema_checked": False}
    if name.namespace == NS:
        schema().assertValid(root)
        validation.update(schema_checked=True, schema_sha256=digest(SCHEMA.read_bytes()))
    ns = {"r": name.namespace}
    validation["datasets"] = [{"name": item.get("Name"),
        "fields": [field.get("Name") for field in item.findall("r:Fields/r:Field", ns)]}
        for item in root.findall("r:DataSets/r:DataSet", ns)]
    validation["parameters"] = [item.get("Name") for item in root.findall("r:ReportParameters/r:ReportParameter", ns)]
    validation["data_sources"] = [item.get("Name") for item in root.findall("r:DataSources/r:DataSource", ns)]
    validation["embedded_code"] = bool(root.findall("r:Code", ns) or root.findall("r:CodeModules", ns))
    return validation


def textbox(parent, name, text, *, header=False, export_name=None):
    box = element(parent, "Textbox", Name=name)
    element(box, "CanGrow", "true")
    element(box, "KeepTogether", "true")
    paragraphs = element(box, "Paragraphs")
    paragraph = element(paragraphs, "Paragraph")
    run = element(element(paragraph, "TextRuns"), "TextRun")
    element(run, "Value", text)
    style = element(run, "Style")
    element(style, "FontFamily", "Arial")
    element(style, "FontSize", "8pt")
    if header:
        element(style, "FontWeight", "Bold")
    element(paragraph, "Style")
    style = element(box, "Style")
    border = element(style, "Border")
    element(border, "Color", "#D4D4D4")
    element(border, "Style", "Solid")
    element(border, "Width", "0.5pt")
    for name in ("PaddingLeft", "PaddingRight", "PaddingTop", "PaddingBottom"):
        element(style, name, "3pt")
    if header:
        element(style, "BackgroundColor", "#EDEDED")
    if export_name:
        element(box, "DataElementName", export_name)
        element(box, "DataElementOutput", "Output")
        element(box, "DataElementStyle", "Element")
    else:
        element(box, "DataElementOutput", "NoOutput")
    return box


def build_table(table, binding, store, *, columns=None, title=None, description=""):
    chosen = table["columns"] if columns is None else [
        next((c for c in table["columns"] if c["name"] == name or c.get("source_column") == name), None)
        for name in columns]
    if not chosen or any(c is None for c in chosen):
        raise ValueError("Choose existing model columns for every paginated report field.")
    if len({c["name"] for c in chosen}) != len(chosen):
        raise ValueError("A paginated report column may only appear once.")
    fields = []
    exported = set()
    for index, column in enumerate(chosen):
        export_name = safe_name(column.get("source_column") or column["name"], "Column_" + str(index + 1))
        if export_name in exported:
            export_name += "_" + str(index + 1)
        exported.add(export_name)
        fields.append({"name": "F" + str(index + 1), "display": column["name"],
            "source_column": column.get("source_column") or column["name"], "export_name": export_name})
    root = ET.Element("{" + NS + "}Report", nsmap={None: NS, "rd": RD})
    element(root, "Description", description or "Tabular native report from the retained reviewed migration model.")
    element(root, "Author", "TokenJunkie Labs")
    source = element(element(root, "DataSources"), "DataSource", Name="OriginalSource")
    connection = element(source, "ConnectionProperties")
    dataset = element(element(root, "DataSets"), "DataSet", Name="OriginalRows")
    query = element(dataset, "Query")
    element(query, "DataSourceName", "OriginalSource")
    kind = binding.get("kind")
    rows_count = None
    source_digest = None
    if kind == "csv":
        raw = store.bytes(binding["digest"])
        headers, rows = read_csv(raw)
        missing = [f["source_column"] for f in fields if f["source_column"] not in headers]
        if missing:
            raise ValueError("Original CSV columns are missing: " + ", ".join(missing))
        element(connection, "DataProvider", "XML")
        element(connection, "ConnectString", "")
        command = ET.Element("Query")
        data = ET.SubElement(ET.SubElement(command, "XmlData"), "Data")
        for row in rows:
            item = ET.SubElement(data, "Row")
            for field in fields:
                ET.SubElement(item, field["name"]).text = row[field["source_column"]]
        ET.SubElement(command, "ElementPath").text = "Data{}/Row{" + ",".join(
            field["name"] + "(String)" for field in fields) + "}"
        element(query, "CommandText", ET.tostring(command, encoding="unicode"))
        rows_count, source_digest = len(rows), digest(raw)
    elif kind == "sqlserver":
        element(connection, "DataProvider", "SQL")
        server, database = binding.get("server", ""), binding.get("database", "")
        if not server or not database:
            raise ValueError("Enter the reviewed SQL Server and database.")
        quote = lambda value: '"' + str(value).replace('"', '""') + '"'
        element(connection, "ConnectString", "Data Source=" + quote(server) + ";Initial Catalog=" + quote(database) + ";")
        element(connection, "IntegratedSecurity", "true")
        sql = binding.get("query")
        if not sql:
            table_name = binding.get("table")
            if not table_name:
                raise ValueError("Enter the reviewed physical table/view or native SQL query.")
            quote_id = lambda value: "[" + str(value).replace("]", "]]") + "]"
            sql = "SELECT " + ", ".join(quote_id(f["source_column"]) for f in fields) + " FROM " + \
                  quote_id(binding.get("schema", "dbo")) + "." + quote_id(table_name)
        element(query, "CommandText", sql)
        parameters = binding.get("parameters", {})
        if parameters:
            query_parameters = element(query, "QueryParameters")
            report_parameters = element(root, "ReportParameters")
            for index, (name, value) in enumerate(parameters.items()):
                if not re.fullmatch(r"@?[A-Za-z_][A-Za-z0-9_]*", name):
                    raise ValueError("Use a SQL parameter name containing letters, numbers and underscores.")
                parameter_name = name.lstrip("@")
                query_parameter = element(query_parameters, "QueryParameter", Name="@" + parameter_name)
                element(query_parameter, "Value", "=Parameters!" + parameter_name + ".Value")
                report_parameter = element(report_parameters, "ReportParameter", Name=parameter_name)
                data_type = "Boolean" if isinstance(value, bool) else "Integer" if isinstance(value, int) else \
                    "Float" if isinstance(value, float) else "String"
                element(report_parameter, "DataType", data_type)
                element(element(element(report_parameter, "DefaultValue"), "Values"), "Value",
                    str(value).lower() if isinstance(value, bool) else value)
                element(report_parameter, "Prompt", parameter_name)
    else:
        raise ValueError("Paginated generation requires a reviewed CSV or SQL Server binding for " + table["name"] + ".")
    field_nodes = element(dataset, "Fields")
    for field in fields:
        node = element(field_nodes, "Field", Name=field["name"])
        element(node, "DataField", field["name"] if kind == "csv" else field["source_column"])
        if kind == "csv":
            ET.SubElement(node, "{" + RD + "}TypeName").text = "System.String"
    section = element(element(root, "ReportSections"), "ReportSection")
    body = element(section, "Body")
    items = element(body, "ReportItems")
    heading = textbox(items, "ReportTitle", title or table["name"], header=True)
    width = max(9.5, len(fields) * 0.85)
    element(heading, "Top", "0in")
    element(heading, "Left", "0in")
    element(heading, "Height", "0.35in")
    element(heading, "Width", str(width) + "in")
    table_node = element(items, "Tablix", Name="OriginalRowsTable")
    table_body = element(table_node, "TablixBody")
    column_nodes = element(table_body, "TablixColumns")
    for _ in fields:
        element(element(column_nodes, "TablixColumn"), "Width", str(round(width / len(fields), 5)) + "in")
    row_nodes = element(table_body, "TablixRows")
    for header in (True, False):
        row = element(row_nodes, "TablixRow")
        element(row, "Height", "0.3in" if header else "0.23in")
        cells = element(row, "TablixCells")
        for field in fields:
            contents = element(element(cells, "TablixCell"), "CellContents")
            textbox(contents, ("Header_" if header else "Value_") + field["name"],
                field["display"] if header else "=Fields!" + field["name"] + ".Value",
                header=header, export_name=None if header else field["export_name"])
    column_members = element(element(table_node, "TablixColumnHierarchy"), "TablixMembers")
    for _ in fields:
        element(column_members, "TablixMember")
    row_members = element(element(table_node, "TablixRowHierarchy"), "TablixMembers")
    header_member = element(row_members, "TablixMember")
    element(header_member, "KeepWithGroup", "After")
    element(header_member, "RepeatOnNewPage", "true")
    element(header_member, "KeepTogether", "true")
    element(header_member, "DataElementOutput", "NoOutput")
    member = element(row_members, "TablixMember")
    element(member, "Group", Name="OriginalRowDetails")
    element(member, "DataElementName", "Row")
    element(member, "DataElementOutput", "Output")
    element(table_node, "DataSetName", "OriginalRows")
    element(table_node, "Top", "0.45in")
    element(table_node, "Left", "0in")
    element(table_node, "Height", "0.53in")
    element(table_node, "Width", str(width) + "in")
    element(table_node, "DataElementName", "OriginalRows")
    element(table_node, "DataElementOutput", "Output")
    element(body, "Height", "1in")
    element(section, "Width", str(width) + "in")
    page = element(section, "Page")
    element(page, "PageHeight", "8.5in")
    element(page, "PageWidth", str(width + 1) + "in")
    for edge in ("Left", "Right", "Top", "Bottom"):
        element(page, edge + "Margin", "0.5in")
    element(page, "Style")
    element(root, "Language", "en-US")
    element(root, "ConsumeContainerWhitespace", "true")
    data = ET.tostring(root, encoding="utf-8", xml_declaration=True, pretty_print=True)
    validation = inspect(data)
    return data, {"table": table["name"], "source_kind": kind, "source_sha256": source_digest,
        "source_rows": rows_count, "fields": fields, "validation": validation,
        "scope": "Explicit tabular projection; every row of the selected source is retained. Original model measures and visual layouts require their separately reviewed report implementation.",
        "native_runtime": "awaiting_report_builder_or_report_server_render"}
