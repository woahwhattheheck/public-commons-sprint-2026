"""Exact portable source/report packages for the existing portfolio workspace."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import uuid
import zipfile

from portfolio.storage import canonical, digest, file_identity, open_regular, require, sync_directory
from portfolio_target.storage import write_bytes
from .timephased_contract import PROJECTION as TIMEPHASED_PROJECTION
from .timephased_report import report_section as timephased_report, guide_section as timephased_guide

SCHEMA = "portfolio.archive-package.v1"


def member_path(name):
    require(isinstance(name, str) and name and "\\" not in name and "\0" not in name and ":" not in name,
            "archive_member", "Retain a regular relative archive member.")
    path = PurePosixPath(name)
    require(not path.is_absolute() and not any(part in ("", ".", "..") for part in name.split("/"))
            and str(path) == name, "archive_member", "An archive member has an invalid relative path.", name)
    return path


class Sink:
    """Publish complete members atomically; names and metadata are deterministic."""
    def __init__(self, directory):
        self.root = Path(directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.files = {}

    def destination(self, name):
        path = self.root.joinpath(*member_path(name).parts)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        current = path
        while current != self.root:
            require(not current.is_symlink(), "archive_member_link", "A selected archive member cannot be a symbolic link.")
            current = current.parent
        return path

    def add_bytes(self, name, raw, **metadata):
        require(isinstance(raw, bytes), "archive_bytes", "Retain complete original member bytes.")
        actual = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        destination = self.destination(name)
        write_bytes(destination, raw, immutable=True)
        self._record(name, actual, metadata)
        return destination

    def add_file(self, name, source, identity, **metadata):
        source, destination = Path(source), self.destination(name)
        require(file_identity(source) == identity, "archive_source_changed", "The selected original file changed before archiving.", str(source))
        if destination.exists():
            require(file_identity(destination) == identity,
                    "archive_member_changed", "A retained archive member has different bytes.", name)
        else:
            try:
                os.link(source, destination)
                sync_directory(destination.parent)
            except OSError as error:
                if isinstance(error, FileExistsError):
                    require(file_identity(destination) == identity,
                            "archive_member_changed", "A concurrently retained archive member differs.", name)
                else:
                    temporary = destination.parent / ("." + uuid.uuid4().hex + ".incoming")
                    try:
                        with open_regular(source) as original, open(temporary, "xb") as target:
                            os.chmod(temporary, 0o600)
                            before = os.fstat(original.fileno())
                            shutil.copyfileobj(original, target, 1024 * 1024)
                            after = os.fstat(original.fileno())
                            require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
                                    "archive_source_changed", "The original file changed while archiving.", str(source))
                            target.flush()
                            os.fsync(target.fileno())
                        require(file_identity(temporary) == identity,
                                "archive_source_hash", "The original file changed during its archive copy.")
                        try:
                            os.link(temporary, destination)
                        except FileExistsError:
                            require(file_identity(destination) == identity,
                                    "archive_member_changed", "A concurrently retained archive member differs.", name)
                        sync_directory(destination.parent)
                    finally:
                        temporary.unlink(missing_ok=True)
        self._record(name, identity, metadata)
        return destination

    def _record(self, name, identity, metadata):
        item = {"path": name, **identity, **metadata}
        require(name not in self.files or self.files[name] == item,
                "archive_member_reused", "The same package path was assigned different source metadata.", name)
        self.files[name] = item

    def package(self, review, review_sha256, approval, destination):
        require(digest(review) == review_sha256, "archive_review_hash", "The exact reviewed cohort changed.")
        manifest = {"schema": SCHEMA, "review_sha256": review_sha256,
                    "review": review, "approval": approval,
                    "files": [self.files[name] for name in sorted(self.files)]}
        raw = canonical(manifest)
        require(len(raw) <= 32 * 1024 * 1024, "archive_manifest_size",
                "The complete original archive manifest exceeds the supported 32 MiB receiving limit.")
        require(len(self.files) <= 100000 and sum(item["bytes"] for item in self.files.values()) + len(raw) <= 8 * 1024 ** 3,
                "archive_package_size", "The complete selected archive exceeds the supported receiving inventory or 8 GiB size.")
        manifest_path = self.add_bytes("manifest.json", raw, role="manifest")
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = destination.parent / ("." + destination.name + "." + uuid.uuid4().hex + ".incoming")
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                os.chmod(temporary, 0o600)
                for name in sorted(self.files):
                    item = self.files[name]
                    path = self.destination(name)
                    require(file_identity(path) == {"sha256": item["sha256"], "bytes": item["bytes"]},
                            "archive_member_hash", "A completed archive member changed before packaging.", name)
                    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    with open_regular(path) as source, archive.open(info, "w", force_zip64=True) as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
            with open(temporary, "rb") as original:
                os.fsync(original.fileno())
            os.replace(temporary, destination)
            sync_directory(destination.parent)
            return {"manifest": manifest, "manifest_sha256": hashlib.sha256(raw).hexdigest(),
                    "manifest_bytes": len(raw), "manifest_path": str(manifest_path),
                    "file_count": len(self.files), **file_identity(destination), "path": str(destination)}
        finally:
            temporary.unlink(missing_ok=True)


class ReceivedPackage:
    """Validate the complete original manifest and stream its exact member bytes."""
    def __init__(self, path):
        self.path = Path(path)
        self.identity = file_identity(self.path)
        self.archive = zipfile.ZipFile(self.path, "r")
        self.entries = {}
        try:
            folded, uncompressed = set(), 0
            for item in self.archive.infolist():
                member_path(item.filename)
                require(item.filename.casefold() not in folded and all(part == part.rstrip(" .") for part in item.filename.split("/")),
                        "archive_member_alias", "The portable archive contains aliased member names.")
                folded.add(item.filename.casefold())
                uncompressed += item.file_size
                require(uncompressed <= 8 * 1024 ** 3, "archive_receiving_size", "Receive a complete selected package up to 8 GiB of original members.")
                mode = item.external_attr >> 16
                require(not item.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG) and item.filename not in self.entries
                        and not item.flag_bits & 1,
                        "archive_member_kind", "Receive distinct regular unencrypted archive members.")
                require(item.file_size >= 0, "archive_member_size", "A retained member has an invalid size.")
                self.entries[item.filename] = item
            require("manifest.json" in self.entries and self.entries["manifest.json"].file_size <= 32 * 1024 * 1024,
                    "archive_manifest", "Receive the complete original archive manifest.")
            raw = self.archive.read("manifest.json")
            self.manifest_sha256 = hashlib.sha256(raw).hexdigest()
            self.manifest = json.loads(raw.decode("utf-8"))
            manifest = self.manifest
            require(manifest.get("schema") == SCHEMA and digest(manifest["review"]) == manifest["review_sha256"]
                    and manifest["review"].get("schema") == "portfolio.archive-review.v1"
                    and manifest["review"].get("projection") == (TIMEPHASED_PROJECTION
                        if manifest["review"].get("profile", {}).get("timephased") is not None
                        else "portfolio.archive-projection.v1")
                    and manifest.get("approval", {}).get("review_sha256") == manifest["review_sha256"],
                    "archive_manifest_schema", "The archive must name its exact reviewed cohort and reporting projection.")
            files = manifest.get("files")
            require(isinstance(files, list) and len(files) <= 100000,
                    "archive_manifest_files", "Retain the original complete member inventory.")
            self.files = {}
            for item in files:
                name = str(member_path(item["path"]))
                require(name != "manifest.json" and name not in self.files
                        and name in self.entries and self.entries[name].file_size == item["bytes"],
                        "archive_member_inventory", "The original member inventory changed.", name)
                self.files[name] = item
            require(set(self.entries) == set(self.files) | {"manifest.json"},
                    "archive_member_inventory", "The archive contains unlisted or missing original members.")
            for name, item in self.files.items():
                hasher, count = hashlib.sha256(), 0
                with self.archive.open(name) as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        hasher.update(chunk)
                        count += len(chunk)
                require(count == item["bytes"] and hasher.hexdigest() == item["sha256"],
                        "archive_receiving_hash", "A selected archive member differs from its original identity.", name)
            require(file_identity(self.path) == self.identity,
                    "archive_receiving_changed", "The selected archive changed during its complete read.")
        except BaseException:
            self.archive.close()
            raise

    def bytes(self, name):
        require(name in self.files, "archive_member_missing", "Select a member from the original archive inventory.")
        raw = self.archive.read(name)
        item = self.files[name]
        require(len(raw) == item["bytes"] and hashlib.sha256(raw).hexdigest() == item["sha256"],
                "archive_member_hash", "The retained archive member changed.")
        return raw

    def materialize(self, name, destination):
        require(name in self.files, "archive_member_missing", "Select a complete retained archive member.")
        item = self.files[name]
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if destination.exists():
            require(file_identity(destination) == {"sha256": item["sha256"], "bytes": item["bytes"]},
                    "archive_receiving_conflict", "The selected original output already contains different bytes.")
            return destination
        temporary = destination.parent / ("." + destination.name + "." + uuid.uuid4().hex + ".incoming")
        try:
            with self.archive.open(name) as source, open(temporary, "xb") as output:
                os.chmod(temporary, 0o600)
                shutil.copyfileobj(source, output, 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            require(file_identity(temporary) == {"sha256": item["sha256"], "bytes": item["bytes"]},
                    "archive_receiving_hash", "The selected original member changed while receiving.")
            try:
                os.link(temporary, destination)
            except FileExistsError:
                require(file_identity(destination) == {"sha256": item["sha256"], "bytes": item["bytes"]},
                        "archive_receiving_conflict", "The selected original output has different bytes.")
            sync_directory(destination.parent)
            return destination
        finally:
            temporary.unlink(missing_ok=True)

    @contextmanager
    def staged_member(self, name, destination):
        """Yield one owned temporary member, then retire its received extraction."""
        path = self.materialize(name, destination)
        try:
            yield path
        finally:
            path.unlink(missing_ok=True)

    def close(self):
        self.archive.close()

    def __enter__(self):
        return self

    def __exit__(self, *arguments):
        self.close()


def power_query(headers):
    def quoted_m(value):
        return '"' + value.replace('"', '""') + '"'
    names = sorted(headers)
    declarations = []
    for name in names:
        columns = ", ".join(quoted_m(value) for value in headers[name])
        declarations.append("        " + name + " = ReadTable(" + quoted_m(name) + ", {" + columns + "})")
    return """// Original UTF-8 CSV values remain text. Set Folder to the extracted package.
(Folder as text) as record =>
let
    Separator = if Text.EndsWith(Folder, "/") or Text.EndsWith(Folder, "\\") then "" else "/",
    ReadTable = (Name as text, Expected as list) as table =>
        let
            Raw = Csv.Document(File.Contents(Folder & Separator & "tables/" & Name & ".csv"),
                [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv, ExtraValues=ExtraValues.Error]),
            Named = Table.PromoteHeaders(Raw, [PromoteAllScalars=true]),
            Checked = if Table.ColumnNames(Named) = Expected then Named else error "The original archive header changed.",
            TextValues = Table.TransformColumnTypes(Checked, List.Transform(Expected, each {_, type text}))
        in TextValues,
    Tables = [
""" + ",\n".join(declarations) + """
    ]
in
    Tables
"""


def azure_sql(headers):
    lines = [
        "-- Original portfolio archive table schema for a selected Azure SQL database.",
        "-- Import each UTF-8 CSV with a CSV-aware client; embedded line breaks stay inside quoted values.",
        "-- All values remain text. Use reviewed decimal precision/currency/unit conversions in downstream views.",
        "-- No provider, database, credentials or paid service is created by this file.",
    ]
    for table, columns in sorted(headers.items()):
        lines.append("CREATE TABLE [dbo].[portfolio_" + table + "] (\n" +
                     ",\n".join("    [" + name.replace("]", "]]") + "] nvarchar(max) NULL" for name in columns) + "\n);\n")
    return "\n".join(lines) + "\n"


def html_report(review, approval, tables, totals):
    e = lambda value: html.escape("" if value is None else str(value), quote=True)
    def table(headers, rows):
        return "<div class='scroll'><table><thead><tr>" + "".join("<th>" + e(x) + "</th>" for x in headers) + \
               "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + e(x) + "</td>" for x in row) + "</tr>" for row in rows) + "</tbody></table></div>"
    members = table(["Project", "Original edition", "Kind", "Model SHA-256"], [
        (row["label"], row["edition_id"], row["kind"], row["model_sha256"]) for row in review["members"]])
    counts = table(["Table", "Rows", "UTF-8 CSV"], [
        (name, count, "tables/" + name + ".csv") for name, count in sorted(tables.items())])
    metrics = table(["Project", "Measure / native field", "Grain", "Exact total", "Currency", "Units / elapsed", "Completeness"], [
        (row["project_key"], row["metric"] + " / " + row["field"], row["grain"],
         row["total_text"], row["currency"], str(row["units"] or "") + " / " + str(row["elapsed"] or ""),
         row["completeness"]) for row in totals])
    findings = table(["Project", "Source / reporting finding", "Details"], [
        (row.get("project_key"), row.get("message") or row.get("code"), json.dumps(row.get("details"), ensure_ascii=False))
        for row in review["findings"]])
    return """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>""" + e(review["name"]) + """ · Portfolio archive</title><style>
body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fafafa;max-width:1280px;margin:32px auto;padding:0 24px}
h1,h2{line-height:1.2}section{background:#fff;border:1px solid #d1d1d1;padding:20px;margin:20px 0}.scroll{overflow:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#f1f1f1}code{overflow-wrap:anywhere}a{color:#222}p{max-width:100ch}.meta{color:#555}@media print{body{margin:0;padding:0}.scroll{overflow:visible}section{break-inside:avoid}}
</style></head><body><header><p class="meta">PORTFOLIO ARCHIVE · ORIGINAL SOURCE EDITIONS</p><h1>""" + e(review["name"]) + "</h1><p>" + e(review.get("description", "")) + "</p><p>Review <code>" + e(digest(review)) + "</code><br>Approved by " + e(approval["reviewer"]) + " · " + e(approval["at"]) + "</p><p>" + e(approval["note"]) + """</p></header>
<section><h2>Selected original projects</h2>""" + members + """</section>
<section><h2>Exact reporting measures</h2><p>Each total uses the declared native row grain. Currency, duration units and elapsed status stay separate. Summary tasks are excluded from leaf-task totals. Missing or unsupported native values remain visible.</p>""" + metrics + """</section>
<section><h2>Complete relational delivery</h2><p><a href="portfolio.sqlite">SQLite database</a> · <a href="power-query.m">Power Query import</a> · <a href="azure-sql.sql">Azure SQL table schema</a> · <a href="data-dictionary.json">Column dictionary</a> · <a href="manifest.json">Original source and file inventory</a></p>""" + counts + """</section>
<section><h2>Source findings and reporting definitions</h2><p>The original schedules, field definitions, native JSON, calendars and companion files are retained in this package. Local date/time values retain their original semantics.</p>""" + findings + """</section>
<section><h2>Receiving and ongoing use</h2><p>Use the existing Portfolio migration desk Archive section to receive this complete ZIP. It restores the selected immutable source records and reporting database into the original workspace. Existing projects and native target operations stay in their current catalogues. Use the portable whole-workspace command for the complete working operator and its history.</p><p>Import CSV through the supplied Power Query function to preserve text, leading zeroes, exact numbers and quoted line breaks. Convert financial or duration values only with explicit original currency and native unit choices. The SQLite query interface provides <code>decimal_sum(value_text)</code> for exact decimal sums.</p></section>
""" + timephased_report(review) + """</body></html>"""


def readme(review):
    return """# """ + review["name"] + """ — portfolio archive

This package selects one exact original edition for each named business project.
The manifest retains the source identities, approval and every complete member hash.

Open report.html for the project, measure and table overview. portfolio.sqlite
contains the same relational rows as tables/*.csv. The full typed fields, original
field definitions, calendar details, custom native collections and original files
remain under source/.

## Power Query and Power BI

Create a blank Power Query, open Advanced Editor and paste power-query.m. Invoke
that function with this extracted directory's absolute path. The result is a record
of tables; choose each desired table and retain text types until a reviewed conversion
is applied. The original entity_id, target_entity_id, project_key and edition_id
columns support relationships. Calendar links are in relationships with a calendar:
role. The data dictionary describes all fixed and selected native columns.

The function uses the official Csv.Document UTF-8/QuoteStyle.Csv reader, validates
the exact column list and transforms every column to text. It does not launch
Power BI or create a PBIX file.

## SQL

The local desk opens this immutable SQLite publication read-only. Use text parameters,
explicit project selection and decimal_sum for exact decimal arithmetic. Group
financial measures by currency, and durations by native units and elapsed status.
The supplied azure-sql.sql creates text-preserving table definitions for an existing
selected Azure SQL database. Import the original CSV with a CSV-aware tool and define
reviewed typed views for that account. It contains no credentials or database creation.

## Portable receiving

Use the original Archive receive action with this complete ZIP. It verifies the whole
member inventory before rejoining the original PortfolioWorkspace source records.
The same request and same archive reopen their saved receipt after interruption.
Receiving does not run MPXJ, contact a native target or change existing project records.

Original source files and metadata can contain confidential customer information.
Deliver this selected package to its intended recipient through the existing case.
""" + timephased_guide(review)
