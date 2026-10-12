"""MIT. Create or verify the complete public IATI customer handover.

This copies already reviewed original files. It does not install a runtime, query
a workspace, recompute financial amounts, or invoke a seller or payment service.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
from datetime import datetime
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import unicodedata
from urllib.parse import urlsplit
import uuid
import zipfile

SCHEMA = "stellar-forge.iati-customer-handover.v1"
MANIFEST = "stellar-forge.iati-customer-handover-manifest.v1"
REPORT = "stellar-forge.iati-report-packet.v1"
PORTFOLIO = "stellar-forge.iati-portfolio-packet.v1"
MAX_JSON = 64 * 1024 * 1024
MAX_FILE = 4 * 1024 * 1024 * 1024
MAX_TOTAL = 16 * 1024 * 1024 * 1024
MAX_MEMBERS = 16384
CHUNK = 1024 * 1024
SHA = re.compile(r"[a-f0-9]{64}\Z")
COMMIT = re.compile(r"[a-f0-9]{40}\Z")
COLLECTIONS = ("activities", "transactions", "budgets")
DATA_FILES = ("data.csv", "dataset.json", "iati-lineage.json")
GUIDES = {"IATI.md", "DOMAIN.md", "OPERATIONS.md", "RUNTIME.md", "INSTALLATION.md", "HANDOVER.md"}
REPORT_FILES = {"reports/report.html", "reports/report.json", "reports/activities.csv",
                "reports/transactions.csv", "reports/budgets.csv", "reports/review.jsonl",
                "reports/comparisons.json"}
COUNT_FIELDS = {"sources", "activities", "transactions", "budgets", "plannedDisbursementsRetained",
                "reviewRecords", "excludedFinancialRecords"}
RESERVED = {"manifest.json", "NOTICE.txt", "CONTENTS.md"}
PUBLISHER_NOTICES = {"publisher/AIDDATA_NIGERIA.md", "publisher/aiddata-nigeria.json"}
STAMP = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_mode", "st_nlink")


def need(ok, message):
    if not ok:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def digest(body):
    return hashlib.sha256(body).hexdigest()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "A JSON object repeats a field: " + key)
        value[key] = item
    return value


def decode(body):
    need(len(body) <= MAX_JSON, "JSON metadata exceeds the 64 MiB bound")
    def invalid(value):
        raise ValueError("Non-finite JSON number: " + value)
    return json.loads(body.decode("utf-8"), object_pairs_hook=unique_object,
                      parse_constant=invalid)


def integer(value, minimum=0, maximum=MAX_TOTAL):
    return type(value) is int and minimum <= value <= maximum


def absolute(value):
    need(isinstance(value, str) and value and "\0" not in value and
         os.path.isabs(value) and os.path.normpath(value) == value and value != "/",
         "Use an absolute, normalized original file or output path")
    path = Path(value)
    need(str(path) == value, "Use the canonical absolute path spelling")
    return path


def safe_name(value):
    need(isinstance(value, str) and 1 <= len(value.encode("utf-8")) <= 1024 and
         unicodedata.normalize("NFC", value) == value and not value.startswith("/") and
         not any(ord(c) < 32 or ord(c) == 127 or c in "\\:<>\"|?*" for c in value),
         "Archive names must be safe relative UTF-8 paths")
    pieces = value.split("/")
    need(str(PurePosixPath(value)) == value and all(
        part and part not in {".", ".."} and not part.startswith(".") and
        part == part.strip() and not part.endswith(".") and
        len(part.encode("utf-8")) <= 255 and
        not re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part)
        for part in pieces), "Archive name has an unsafe or ambiguous path segment")
    return value


def no_links(path, *, allow_missing=False):
    """Check every ancestor before using a source or an owned output name."""
    need(path.is_absolute(), "A physical path must be absolute")
    current = Path(path.anchor)
    for index, component in enumerate(path.parts[1:]):
        current /= component
        try:
            info = current.lstat()
        except FileNotFoundError:
            if allow_missing:
                continue
            raise
        need(not stat.S_ISLNK(info.st_mode), "Symbolic links are not handover inputs: " + str(current))
        if index < len(path.parts) - 2:
            need(stat.S_ISDIR(info.st_mode), "A path ancestor is not a directory")
    if not allow_missing:
        need(path.resolve(strict=True) == path, "A physical path changed its canonical location")


def private_directory(path):
    no_links(path, allow_missing=True)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    no_links(path)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
         "Use a private operator-owned output directory")
    return path


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def stamp(info):
    return tuple(getattr(info, key) for key in STAMP)


def stream_to(stream, output=None, *, maximum=MAX_FILE):
    hasher, size = hashlib.sha256(), 0
    while True:
        block = stream.read(min(CHUNK, maximum - size + 1))
        if not block:
            break
        size += len(block)
        need(size <= maximum, "A member exceeded its declared byte limit")
        hasher.update(block)
        if output is not None:
            output.write(block)
    return {"bytes": size, "sha256": hasher.hexdigest()}


class Source:
    """An open immutable selection, checked by path and inode after every read."""
    def __init__(self, path, expected=None, *, maximum=MAX_FILE):
        self.path = absolute(str(path))
        no_links(self.path)
        fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        self.stream = os.fdopen(fd, "rb")
        try:
            self.before = os.fstat(fd)
            need(stat.S_ISREG(self.before.st_mode) and self.before.st_nlink == 1 and
                 self.before.st_size <= maximum, "Select one regular original file without additional hard links and within capacity")
            actual = stream_to(self.stream, maximum=maximum)
            self.value = {"path": str(self.path), **actual}
            self.check()
            if expected is not None:
                need(actual == {"bytes": expected["bytes"], "sha256": expected["sha256"]},
                     "A selected source changed from its reviewed bytes: " + str(self.path))
        except BaseException:
            self.stream.close()
            raise

    def check(self):
        no_links(self.path)
        current = os.fstat(self.stream.fileno())
        named = self.path.lstat()
        need(stamp(current) == stamp(self.before) == stamp(named),
             "A selected source changed while creating the handover: " + str(self.path))

    def copy(self, output=None):
        self.check()
        self.stream.seek(0)
        actual = stream_to(self.stream, output, maximum=self.value["bytes"])
        self.check()
        need(actual == {key: self.value[key] for key in ("bytes", "sha256")},
             "A selected source no longer has its reviewed complete bytes")
        return actual

    def json(self):
        need(self.value["bytes"] <= MAX_JSON, "Source JSON exceeds its metadata bound")
        self.check()
        self.stream.seek(0)
        body = self.stream.read(MAX_JSON + 1)
        self.check()
        need(len(body) == self.value["bytes"] and digest(body) == self.value["sha256"],
             "Source JSON changed while reading")
        return decode(body)

    def close(self):
        self.stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


@contextmanager
def output_lease(parent):
    path = parent / ".iati-customer-handover.lock"
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
             and not info.st_mode & 0o077, "The original output lock must be a private regular file")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def present(path):
    return path.exists() or path.is_symlink()


def recover_stage(stage, destination):
    """Keep incomplete attempts; remove only our recognized publication alias."""
    if not present(stage):
        return
    no_links(stage)
    info = stage.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
         "An existing stage is not this operator's regular private file")
    if present(destination):
        no_links(destination)
        target = destination.lstat()
        if (info.st_dev, info.st_ino) == (target.st_dev, target.st_ino):
            need(info.st_nlink == 2, "A published stage has unrelated hard links")
            stage.unlink()
            sync_directory(stage.parent)
            return
    need(info.st_nlink == 1, "An interrupted stage has unrelated hard links")
    retained = stage.with_name(stage.name + ".interrupted-" + uuid.uuid4().hex)
    os.rename(stage, retained)
    sync_directory(stage.parent)


def publish_metadata(path, value):
    """Select metadata only after a complete fsynced stage, without replacement."""
    body = encoded(value)
    need(len(body) <= MAX_JSON, "Handover metadata exceeds its declared capacity")
    stage = path.with_name("." + path.name + ".partial")
    recover_stage(stage, path)
    if present(path):
        with Source(path, maximum=MAX_JSON) as original:
            need(original.value["bytes"] == len(body) and original.value["sha256"] == digest(body),
                 "This retained output metadata belongs to another selection")
        return
    with os.fdopen(os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "wb") as out:
        out.write(body)
        out.flush()
        os.fsync(out.fileno())
    with Source(stage, {"bytes": len(body), "sha256": digest(body)}, maximum=MAX_JSON):
        pass
    try:
        os.link(stage, path, follow_symlinks=False)
    except FileExistsError:
        with Source(path, {"bytes": len(body), "sha256": digest(body)}, maximum=MAX_JSON):
            pass
    stage.unlink()
    sync_directory(path.parent)


def validated_descriptor(value):
    need(isinstance(value, dict) and set(value) == {"path", "name", "bytes", "sha256"} and
         integer(value["bytes"], 0, MAX_FILE) and isinstance(value["sha256"], str) and
         SHA.fullmatch(value["sha256"]), "Each file needs exact path, name, bytes and SHA-256")
    absolute(value["path"])
    safe_name(value["name"])
    return value


def configuration(value):
    required = {"schema", "operationId", "output", "sourceCommit", "publisher", "portfolio", "files", "notice"}
    need(isinstance(value, dict) and set(value) == required and value["schema"] == SCHEMA,
         "Supply the complete original IATI customer handover input")
    need(isinstance(value["operationId"], str) and
         re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,110}", value["operationId"]) and
         isinstance(value["sourceCommit"], str) and COMMIT.fullmatch(value["sourceCommit"]),
         "Retain the original operation ID and exact public source commit")
    output = absolute(value["output"])
    need(output.suffix.lower() == ".zip" and output.name not in RESERVED, "The customer output must be a ZIP file")
    safe_name(output.name)
    pub = value["publisher"]
    need(isinstance(pub, dict) and set(pub) == {"label", "url", "fetchedAt", "bytes", "sha256"} and
         isinstance(pub["label"], str) and 1 <= len(pub["label"]) <= 160 and
         isinstance(pub["url"], str) and isinstance(pub["fetchedAt"], str) and
         integer(pub["bytes"], 1, MAX_FILE) and isinstance(pub["sha256"], str) and SHA.fullmatch(pub["sha256"]),
         "Retain the original publisher identity and dated public provenance")
    url = urlsplit(pub["url"])
    need(url.scheme == "https" and url.hostname and url.username is None and url.password is None,
         "Publisher provenance must be the public HTTPS source URL")
    observed = datetime.fromisoformat(pub["fetchedAt"].replace("Z", "+00:00"))
    need(observed.tzinfo is not None, "Publisher acquisition time must include its original timezone")
    portfolio = value["portfolio"]
    need(isinstance(portfolio, dict) and set(portfolio) ==
         {"id", "revision", "definitionSha256", "counts", "financialGroups"} and
         isinstance(portfolio["id"], str) and SHA.fullmatch(portfolio["id"]) and
         integer(portfolio["revision"], 1, 1000000) and isinstance(portfolio["definitionSha256"], str) and
         SHA.fullmatch(portfolio["definitionSha256"]), "Select the final reviewed original portfolio revision")
    need(isinstance(portfolio["counts"], dict) and set(portfolio["counts"]) == COUNT_FIELDS and
         all(integer(n) for n in portfolio["counts"].values()) and isinstance(portfolio["financialGroups"], list),
         "Retain the original complete counts and distinct financial groups")
    for group in portfolio["financialGroups"]:
        need(isinstance(group, dict) and group.get("collection") in {"transactions", "budgets"} and
             isinstance(group.get("amount"), str) and re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", group["amount"]) and
             integer(group.get("count"), 1), "Financial group amounts must remain the original exact decimal strings")
    need(isinstance(value["notice"], str) and value["notice"].strip() and
         len(value["notice"].encode("utf-8")) <= 128000, "Retain the complete publisher attribution notice")
    need(isinstance(value["files"], list) and 1 <= len(value["files"]) <= 256,
         "Supply the explicit complete public customer-file selection")
    files = [validated_descriptor(item) for item in value["files"]]
    names = [item["name"] for item in files]
    need(len(set(name.casefold() for name in names)) == len(names), "Customer file names must be distinct on receiving systems")
    need(len({item["path"] for item in files}) == len(files), "Each selected physical source must have one customer role")
    runtime = [name for name in names if name.startswith("runtime/")]
    need(len(runtime) == 1 and runtime[0].count("/") == 1 and
         runtime[0].lower().endswith((".tgz", ".tar.gz", ".zip")), "Include the one untouched original READY runtime archive")
    required_names = {"publisher/publisher.xml", "portfolio/iati-portfolio.zip", "reports/iati-report.zip"}
    required_names |= {"merchant-datasets/" + collection + "/" + file for collection in COLLECTIONS for file in DATA_FILES}
    required_names |= {"guides/" + name for name in GUIDES}
    need(required_names <= set(names), "The complete customer delivery is missing an original dataset, report, source or guide")
    need(not (set(names) & PUBLISHER_NOTICES) or PUBLISHER_NOTICES <= set(names),
         "Retain the complete public publisher notice and source metadata together")
    for name in names:
        need(name in required_names or name in runtime or name in PUBLISHER_NOTICES or
             (name.startswith("guides/") and name.count("/") == 1 and name.endswith(".md")),
             "The customer selection contains a private or unsupported file category: " + name)
    need(sum(item["bytes"] for item in files) <= MAX_TOTAL, "The selected files exceed the 16 GiB customer capacity")
    publisher_file = next(item for item in files if item["name"] == "publisher/publisher.xml")
    need(all(publisher_file[key] == pub[key] for key in ("bytes", "sha256")),
         "The included publisher XML differs from its public provenance")
    for item in files:
        path = absolute(item["path"])
        need(path.parent != output.parent and output not in path.parents and path not in output.parents,
             "Place the handover output in a separate directory from all original source files")
    logical = {"schema": SCHEMA, "operationId": value["operationId"], "sourceCommit": value["sourceCommit"],
               "publisher": pub, "portfolio": portfolio,
               "files": [{key: item[key] for key in ("name", "bytes", "sha256")}
                         for item in sorted(files, key=lambda item: item["name"])],
               "notice": value["notice"]}
    return value, output, files, logical, digest(encoded(logical)), runtime[0]


def zip_members(archive, *, maximum=MAX_TOTAL):
    infos = archive.infolist()
    need(0 < len(infos) <= MAX_MEMBERS, "Archive member count is outside the complete-delivery bound")
    names = [safe_name(info.filename) for info in infos]
    need(len(set(name.casefold() for name in names)) == len(names), "Archive contains repeated or case-ambiguous names")
    for info in infos:
        kind = stat.S_IFMT(info.external_attr >> 16)
        need(not info.is_dir() and kind in {0, stat.S_IFREG} and not info.flag_bits & 1 and
             info.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} and
             integer(info.file_size, 0, MAX_FILE), "Archive contains a link, directory or unsupported member")
    need(sum(info.file_size for info in infos) <= maximum, "Archive exceeds its expanded byte capacity")
    return {info.filename: info for info in infos}


def zip_json(archive, info):
    need(info.file_size <= MAX_JSON, "Archive JSON metadata exceeds 64 MiB")
    with archive.open(info) as stream:
        body = stream.read(MAX_JSON + 1)
    need(len(body) == info.file_size, "Archive JSON metadata has an incomplete body")
    return decode(body), body


def checked_entries(manifest, infos):
    entries = manifest.get("files")
    need(isinstance(entries, dict) and len(entries) < MAX_MEMBERS and
         set(infos) == set(entries) | {"manifest.json"}, "Manifest does not enumerate every archive member exactly once")
    for name, item in entries.items():
        safe_name(name)
        need(name != "manifest.json" and isinstance(item, dict) and set(item) == {"bytes", "sha256"} and
             integer(item["bytes"], 0, MAX_FILE) and isinstance(item["sha256"], str) and
             SHA.fullmatch(item["sha256"]) and infos[name].file_size == item["bytes"],
             "Manifest member identity is invalid or incomplete")
    return entries


def member_identity(archive, info, expected, output=None):
    with archive.open(info) as stream:
        actual = stream_to(stream, output, maximum=expected["bytes"])
    need(actual == expected, "An archive member changed from its complete manifest: " + info.filename)
    return actual


def native_packet(source, schema, portfolio):
    source.check()
    source.stream.seek(0)
    archive = zipfile.ZipFile(source.stream)
    try:
        infos = zip_members(archive, maximum=MAX_FILE)
        need("manifest.json" in infos, "Native packet has no complete manifest")
        manifest, _ = zip_json(archive, infos["manifest.json"])
        need(isinstance(manifest, dict) and set(manifest) == {"schema", "files", "portfolio", "revision"} and
             manifest["schema"] == schema and manifest["portfolio"] == portfolio["id"] and
             manifest["revision"] == portfolio["revision"], "Native packet has another original portfolio or revision")
        entries = checked_entries(manifest, infos)
        for name, item in entries.items():
            member_identity(archive, infos[name], item)
        need(REPORT_FILES <= set(entries), "Native packet does not retain the complete report files")
        report, _ = zip_json(archive, infos["reports/report.json"])
        need(isinstance(report, dict) and report.get("portfolio") == portfolio["id"] and report.get("revision") == portfolio["revision"] and
             all(report.get(key) == portfolio[key] for key in ("definitionSha256", "counts", "financialGroups")),
             "The original report differs from the final reviewed portfolio selection")
        if schema == REPORT:
            need(all(name.startswith("reports/") and name.count("/") == 1 for name in entries),
                 "A native report contains a member outside its declared report family")
        else:
            need("portfolio-history.json" in entries, "Portfolio packet is missing its original revision history")
            history, _ = zip_json(archive, infos["portfolio-history.json"])
            need(isinstance(history, list) and len(history) == portfolio["revision"],
                 "Portfolio packet does not retain the complete revision history")
            for revision, item in enumerate(history, 1):
                need(isinstance(item, dict) and item.get("schema") == "stellar-forge.iati-portfolio.v1" and
                     item.get("id") == portfolio["id"] and item.get("revision") == revision,
                     "Portfolio packet history has another original identity")
            last = history[-1]
            need(last.get("definitionSha256") == portfolio["definitionSha256"] and
                 all(last.get("report", {}).get(key) == portfolio[key] for key in ("counts", "financialGroups")),
                 "Portfolio packet does not end at the selected reviewed original revision")
            manifest = {**manifest, "selectedPortfolio": last}
        source.check()
        return manifest, archive, infos
    except BaseException:
        archive.close()
        raise


def zip_info(name):
    info = zipfile.ZipInfo(safe_name(name), date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    info.compress_type = (zipfile.ZIP_STORED if name.lower().endswith((".zip", ".tgz", ".tar.gz", ".gz"))
                          else zipfile.ZIP_DEFLATED)
    return info


def contents(value, runtime_name):
    pub, portfolio = value["publisher"], value["portfolio"]
    label = html.escape(pub["label"]).replace("|", "\\|")
    text = [
        "# IATI customer handover", "", label, "",
        "Open [the complete report](report/report.html) to review the saved portfolio and its financial groups.",
        "The complete original [report ZIP](reports/iati-report.zip) and "
        "[portable portfolio ZIP](portfolio/iati-portfolio.zip) are retained alongside it.", "",
        "| Selection | Original value |", "| --- | --- |",
        "| Portfolio | " + portfolio["id"] + " |",
        "| Reviewed revision | " + str(portfolio["revision"]) + " |",
        "| Public source commit | " + value["sourceCommit"] + " |",
        "| Publisher acquired | " + html.escape(pub["fetchedAt"]) + " |",
    ]
    for name, count in sorted(portfolio["counts"].items()):
        text.append("| " + name + " | " + str(count) + " |")
    text += ["", "## Contents", "",
             "- [Install and open the original runtime](guides/INSTALLATION.md); its unchanged archive is [" +
             runtime_name + "](" + runtime_name + ").",
             "- [Operator guide](guides/OPERATIONS.md), [data interpretation](guides/DOMAIN.md), "
             "[runtime preparation](guides/RUNTIME.md), and [handover verification](guides/HANDOVER.md).",
             "- Original publisher XML: [publisher/publisher.xml](publisher/publisher.xml).",
             "- Each merchant dataset has its complete data.csv, dataset.json and iati-lineage.json "
             "under merchant-datasets/activities, transactions or budgets.",
             "- [NOTICE.txt](NOTICE.txt) preserves the publisher attribution; [manifest.json](manifest.json) "
             "records every included member's byte length and SHA-256.", "",
             "Financial amounts remain exact decimal strings. Currency, reporter, hierarchy, transaction type, "
             "budget type/status, value date and budget period retain their original separate group meanings. "
             "No conversion or cross-group addition is performed by this handover.", "",
             "This delivery contains public source and reviewed dataset artifacts. Local connection settings, "
             "session tokens, command records and browser screenshots are outside this customer archive.", ""]
    return "\n".join(text).encode("utf-8")


def verify_archive(path, expected_manifest=None, expected_sha256=None):
    """Read every customer member; callers may bind the complete ZIP SHA-256."""
    with Source(path, maximum=MAX_TOTAL) as source:
        if expected_sha256 is not None:
            need(source.value["sha256"] == expected_sha256, "Customer archive differs from its retained complete SHA-256")
        source.stream.seek(0)
        with zipfile.ZipFile(source.stream) as archive:
            infos = zip_members(archive)
            need("manifest.json" in infos, "Customer archive is missing its manifest")
            manifest, body = zip_json(archive, infos["manifest.json"])
            need(isinstance(manifest, dict) and manifest.get("schema") == MANIFEST and
                 SHA.fullmatch(manifest.get("selectionSha256", "")) and
                 isinstance(manifest.get("sourceFiles"), list), "Customer manifest has another schema or selection")
            if expected_manifest is not None:
                need(manifest == expected_manifest and body == encoded(expected_manifest),
                     "Completed destination belongs to a different customer handover")
            entries = checked_entries(manifest, infos)
            for name, item in entries.items():
                member_identity(archive, infos[name], item)
            source_names = []
            for item in manifest["sourceFiles"]:
                need(isinstance(item, dict) and set(item) == {"name", "bytes", "sha256"} and
                     entries.get(item["name"]) == {"bytes": item["bytes"], "sha256": item["sha256"]},
                     "Customer source selection differs from its complete file manifest")
                source_names.append(item["name"])
            need(len(set(source_names)) == len(source_names) and source_names == sorted(source_names) and
                 "NOTICE.txt" in entries and entries["NOTICE.txt"]["bytes"] <= 128000,
                 "Customer selection or complete attribution notice is invalid")
            with archive.open(infos["NOTICE.txt"]) as notice_stream:
                notice = notice_stream.read(128001).decode("utf-8")
            logical = {"schema": SCHEMA, "operationId": manifest["operationId"],
                       "sourceCommit": manifest["sourceCommit"], "publisher": manifest["publisher"],
                       "portfolio": manifest["portfolio"], "files": manifest["sourceFiles"], "notice": notice}
            need(digest(encoded(logical)) == manifest["selectionSha256"],
                 "Customer manifest no longer identifies its complete original selection")
            source.check()
            return {**source.value, "manifestSha256": digest(body), "manifest": manifest,
                    "fileCount": len(infos), "expandedBytes": sum(info.file_size for info in infos.values())}


def create_handover(value):
    value, output, descriptors, logical, selection_sha, runtime_name = configuration(value)
    parent = private_directory(output.parent)
    no_links(output, allow_missing=True)
    with output_lease(parent), ExitStack() as stack:
        publish_metadata(parent / ".iati-customer-selection.json",
                         {"schema": SCHEMA, "output": output.name, "selectionSha256": selection_sha, "selection": logical})
        sources = {item["name"]: stack.enter_context(Source(item["path"], item)) for item in descriptors}
        if "publisher/aiddata-nigeria.json" in sources:
            provenance = sources["publisher/aiddata-nigeria.json"].json()
            need(isinstance(provenance, dict) and provenance.get("schema") == "stellar-forge.iati-public-research-input.v1" and
                 isinstance(provenance.get("source"), dict) and
                 all(provenance["source"].get(key) == value["publisher"][key] for key in ("bytes", "sha256")),
                 "The selected public publisher notices describe another original XML source")
        packet, packet_zip, _ = native_packet(sources["portfolio/iati-portfolio.zip"], PORTFOLIO, value["portfolio"])
        stack.callback(packet_zip.close)
        last = packet["selectedPortfolio"]
        need(last.get("sources") == [value["publisher"]["sha256"]] and len(last.get("editions", [])) == 1,
             "This single-publisher handover must retain its complete original XML source")
        edition = last["editions"][0]
        for collection in COLLECTIONS:
            prefix = "merchant-datasets/" + collection + "/"
            lineage = sources[prefix + "iati-lineage.json"].json()
            need(lineage == edition[collection], "Merchant lineage differs from the reviewed original native edition")
            for filename in ("data.csv", "dataset.json"):
                declared = lineage.get("files", {}).get(filename)
                need(declared is not None and all(sources[prefix + filename].value[key] == declared[key]
                                                for key in ("bytes", "sha256")),
                     "A complete merchant dataset differs from its reviewed native bytes")
        report, report_zip, report_infos = native_packet(
            sources["reports/iati-report.zip"], REPORT, value["portfolio"])
        stack.callback(report_zip.close)
        originals = {item["name"]: {"bytes": item["bytes"], "sha256": item["sha256"]} for item in descriptors}
        generated = {"NOTICE.txt": value["notice"].encode("utf-8"), "CONTENTS.md": contents(value, runtime_name)}
        entries = dict(originals)
        entries.update({name: {"bytes": len(body), "sha256": digest(body)} for name, body in generated.items()})
        expanded = {"report/" + name[8:]: (name, item) for name, item in report["files"].items()}
        entries.update({name: item for name, (_, item) in expanded.items()})
        need(len(entries) + 1 <= MAX_MEMBERS and sum(item["bytes"] for item in entries.values()) <= MAX_TOTAL,
             "The complete original files and readable report exceed customer capacity")
        manifest = {"schema": MANIFEST, "operationId": value["operationId"], "sourceCommit": value["sourceCommit"],
                    "selectionSha256": selection_sha, "publisher": value["publisher"], "portfolio": value["portfolio"],
                    "sourceFiles": logical["files"], "files": entries, "runtimeFile": runtime_name,
                    "portfolioFile": "portfolio/iati-portfolio.zip", "reportFile": "reports/iati-report.zip",
                    "readableReport": "report/report.html", "noticeFile": "NOTICE.txt"}
        manifest_body = encoded(manifest)
        need(len(manifest_body) <= MAX_JSON and sum(item["bytes"] for item in entries.values()) + len(manifest_body) <= MAX_TOTAL,
             "The complete customer manifest exceeds its metadata or expanded-byte capacity")
        stage = output.with_name("." + output.name + ".partial")
        recover_stage(stage, output)
        reused = present(output)
        if not reused:
            with os.fdopen(os.open(stage, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "w+b") as out:
                with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                    archive.writestr(zip_info("manifest.json"), manifest_body)
                    for name in sorted(entries):
                        with archive.open(zip_info(name), "w", force_zip64=True) as member:
                            if name in sources:
                                sources[name].copy(member)
                            elif name in generated:
                                member.write(generated[name])
                            else:
                                original_name, declared = expanded[name]
                                member_identity(report_zip, report_infos[original_name], declared, member)
                out.flush()
                os.fsync(out.fileno())
            verify_archive(stage, manifest)
            for source in sources.values():
                source.check()
            try:
                os.link(stage, output, follow_symlinks=False)
            except FileExistsError:
                verify_archive(output, manifest)
                reused = True
            stage.unlink()
            sync_directory(parent)
        verified = verify_archive(output, manifest)
        for source in sources.values():
            source.check()
        result = {"schema": SCHEMA, "state": "COMPLETE", "operationId": value["operationId"],
                  "sourceCommit": value["sourceCommit"], "output": str(output), "file": str(output),
                  "bytes": verified["bytes"], "sha256": verified["sha256"],
                  "selectionSha256": selection_sha, "manifestSha256": verified["manifestSha256"],
                  "fileCount": verified["fileCount"], "expandedBytes": verified["expandedBytes"],
                  "publisher": value["publisher"], "portfolio": value["portfolio"],
                  "files": entries, "result": str(parent / "result.json")}
        publish_metadata(parent / "result.json", result)
        return {**result, "reused": reused}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--input", help="Absolute path to the complete original handover selection JSON")
    group.add_argument("--verify", help="Read and verify every member of an existing complete customer ZIP")
    parser.add_argument("--expected-sha256", help="Original complete customer ZIP SHA-256, for --verify")
    args = parser.parse_args()
    os.umask(0o077)
    if args.verify:
        need(args.expected_sha256 is None or SHA.fullmatch(args.expected_sha256),
             "Expected complete archive identity must be SHA-256")
        result = verify_archive(absolute(args.verify), expected_sha256=args.expected_sha256)
        manifest = result.pop("manifest")
        result.update(schema=SCHEMA, state="VERIFIED", operationId=manifest["operationId"],
                      sourceCommit=manifest["sourceCommit"], selectionSha256=manifest["selectionSha256"],
                      portfolio=manifest["portfolio"])
    else:
        need(args.expected_sha256 is None, "--expected-sha256 applies only to --verify")
        input_path = absolute(args.input)
        with Source(input_path, maximum=MAX_JSON) as selected:
            value = selected.json()
        need(isinstance(value, dict), "The handover input must be a JSON object")
        output = absolute(value.get("output", ""))
        if input_path.parent == output.parent:
            reserved_prefixes = (".iati-customer-", "." + output.name + ".partial", ".result.json.partial")
            need(input_path not in {output, output.parent / "result.json"} and
                 not input_path.name.startswith(reserved_prefixes),
                 "The command input overlaps an owned output, stage or receipt")
        result = create_handover(value)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({"schema": SCHEMA, "state": "FAILED", "error": type(error).__name__,
                          "message": str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
        raise SystemExit(1)
