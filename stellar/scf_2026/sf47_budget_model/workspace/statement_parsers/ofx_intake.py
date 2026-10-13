"""Bounded, offline OFX bank/credit-card statement intake. Python 3.10+.

A deliberately explicit import profile, not an OFX client or a ledger. Source
files are untrusted evidence. Never initiates connections, applies corrections,
infers completeness, or promotes checksums to financial-institution authority.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from hashlib import sha256
import json
import re
import xml.parsers.expat as expat

PROFILE = "ofx-statement-intake/1"
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024
MAX_FILES = 32
MAX_NODES = 300_000
MAX_ROWS = 50_000
MAX_DEPTH = 16
MAX_TEXT = 8192
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\Z")
SCOPE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\Z")
MONEY_RE = re.compile(r"[+-]?(?:[0-9]+(?:[.,][0-9]*)?|[.,][0-9]+)\Z")
DATE_RE = re.compile(r"([0-9]{8})([0-9]{2}(?:[0-9]{2}(?:[0-9]{2})?)?)?(?:\.([0-9]{1,3}))?(?:\[([+-]?[0-9]{1,2}(?:\.[0-9]{1,2})?)(?::([A-Za-z][A-Za-z0-9_+-]{0,15}))?\])?\Z")
TYPES = frozenset("CREDIT DEBIT INT DIV FEE SRVCHG DEP ATM POS XFER CHECK PAYMENT CASH DIRECTDEP DIRECTDEBIT REPEATPMT OTHER HOLD".split())
AGGREGATES = frozenset("OFX SIGNONMSGSRSV1 SONRS STATUS FI BANKMSGSRSV1 CREDITCARDMSGSRSV1 STMTTRNRS CCSTMTTRNRS STMTRS CCSTMTRS BANKACCTFROM CCACCTFROM BANKTRANLIST BANKTRANLISTP STMTTRN STMTTRNP LEDGERBAL AVAILBAL CURRENCY ORIGCURRENCY PAYEE BANKACCTTO CCACCTTO".split())
LEAVES = frozenset("TRNUID CODE SEVERITY MESSAGE DTSERVER LANGUAGE ORG FID INTU.BID CLTCOOKIE CURDEF BANKID BRANCHID ACCTID ACCTTYPE ACCTKEY DTSTART DTEND TRNTYPE DTPOSTED DTUSER DTAVAIL TRNAMT FITID CORRECTFITID CORRECTACTION SRVRTID CHECKNUM REFNUM SIC PAYEEID NAME EXTDNAME MEMO DTASOF BALAMT MKTGINFO DTTRAN DTEXPIRE CURRATE CURSYM ADDR1 ADDR2 ADDR3 CITY STATE POSTALCODE COUNTRY PHONE CASHADVBALAMT CASHADVAVAILAMT CASHADVCREDITLIMIT INTRATE INTRATEPURCH INTRATECASH INTRATEXFER".split())


class IntakeError(ValueError):
    """Safe diagnostic: schema paths and codes, never raw account/file content."""

    def __init__(self, code: str, location: str = "input"):
        self.code, self.location = code, location
        super().__init__(f"{code} at {location}")


def require(ok: bool, code: str, where: str = "input") -> None:
    if not ok:
        raise IntakeError(code, where)


def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False,
                       separators=(",", ":")) + "\n").encode("ascii")


def digest(value: object) -> str:
    return sha256(canonical(value)).hexdigest()


def _no_duplicates(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def strict_json(raw: bytes, limit: int = MAX_FILE) -> object:
    require(type(raw) is bytes and len(raw) <= limit, "JSON_SIZE_OR_TYPE")
    def no_number(_: str) -> None:
        raise IntakeError("JSON_NONINTEGER_OR_NONFINITE")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates,
                          parse_float=no_number, parse_constant=no_number)
    except IntakeError:
        raise
    except (UnicodeError, ValueError, RecursionError, OverflowError) as exc:
        raise IntakeError("INVALID_JSON") from exc


def normalize_plan(plan: object) -> dict:
    require(type(plan) is dict and set(plan) == {"schema", "sources"}, "PLAN_FIELDS")
    require(plan["schema"] == "ofx-intake-plan/v1", "PLAN_VERSION")
    sources = plan["sources"]
    require(type(sources) is list and 1 <= len(sources) <= MAX_FILES, "PLAN_SOURCE_COUNT")
    seen, result = set(), []
    for row in sources:
        require(type(row) is dict and set(row) == {"file", "institution"}, "PLAN_SOURCE_FIELDS")
        name, institution = row["file"], row["institution"]
        require(type(name) is str and NAME_RE.fullmatch(name) is not None and name not in {".", ".."}, "SOURCE_FILENAME")
        require(type(institution) is str and SCOPE_RE.fullmatch(institution) is not None, "INSTITUTION_SCOPE")
        require(not name.endswith(".") and name.split(".", 1)[0].upper() not in
                {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))},
                "PORTABLE_SOURCE_FILENAME")
        require(name.casefold() not in seen, "DUPLICATE_SOURCE_NAME")
        seen.add(name.casefold())
        result.append({"file": name, "institution": institution})
    return {"schema": plan["schema"], "sources": sorted(result, key=lambda r: r["file"])}


def decimal_text(value: str, where: str = "amount") -> str:
    """OFX's comma is a decimal separator, NEVER a thousands separator.

    Fraction/integer conversion is context-free, unlike Decimal's ambient
    precision. Preserve raw text separately in source fields.
    """
    require(type(value) is str and len(value) <= 32 and MONEY_RE.fullmatch(value) is not None,
            "INVALID_DECIMAL", where)
    value = value.replace(",", ".")
    sign = "-" if value.startswith("-") else ""
    value = value.lstrip("+-")
    integer, dot, fraction = value.partition(".")
    integer = integer.lstrip("0") or "0"
    fraction = fraction.rstrip("0")
    if integer == "0" and not fraction:
        sign = ""
    return sign + integer + (("." + fraction) if fraction else "")


def sum_decimal(values: list[str]) -> str:
    scale = max((len(v.partition(".")[2]) for v in values), default=0)
    total = 0
    for value in values:
        sign = -1 if value.startswith("-") else 1
        integer, _, fraction = value.lstrip("-").partition(".")
        total += sign * (int(integer) * 10 ** scale + int((fraction + "0" * scale)[:scale] or "0"))
    digits = str(abs(total)).zfill(scale + 1)
    raw = ("-" if total < 0 else "") + (digits[:-scale] + "." + digits[-scale:] if scale else digits)
    # Aggregates may have more digits than one input's 32-character bound.
    integer, _, fraction = raw.partition(".")
    fraction = fraction.rstrip("0")
    return integer + (("." + fraction) if fraction else "")


def timestamp(value: str, where: str = "date") -> dict:
    require(type(value) is str, "INVALID_DATE", where)
    match = DATE_RE.fullmatch(value)
    require(match is not None, "INVALID_DATE", where)
    day, clock, ms, offset, zone = match.groups()
    require(ms is None or (clock is not None and len(clock) == 6), "DATE_PRECISION", where)
    clock = clock or ""
    full = clock.ljust(6, "0")
    # Explicit supported profile: no year zero, leap seconds or smart dates.
    try:
        local = datetime(int(day[:4]), int(day[4:6]), int(day[6:8]),
                         int(full[:2]), int(full[2:4]), int(full[4:6]),
                         int((ms or "0").ljust(3, "0")) * 1000)
        offset_seconds = Fraction(offset or "0") * 3600
        require(-43200 <= offset_seconds <= 43200 and offset_seconds.denominator == 1,
                "DATE_OFFSET", where)
        utc = local - timedelta(seconds=int(offset_seconds))
    except (ValueError, OverflowError) as exc:
        raise IntakeError("INVALID_DATE", where) from exc
    return {"raw": value, "local_date": local.date().isoformat(),
            "utc": utc.isoformat(timespec="milliseconds") + "Z",
            "precision": {0: "date", 2: "hour", 4: "minute", 6: "second"}[len(clock)] if ms is None else "fraction",
            "offset_seconds": int(offset_seconds), "offset_explicit": offset is not None,
            "zone_label": zone}


@dataclass
class Node:
    tag: str
    line: int
    children: list[Node] = field(default_factory=list)
    text: str = ""
    cdata_start: int | None = None
    cdata_end: int = 0


def _valid_text(text: str, where: str, *, trim: bool = True) -> str:
    require(len(text) <= MAX_TEXT, "TEXT_LIMIT", where)
    require(all(ord(c) >= 32 or c in "\t\r\n" for c in text), "CONTROL_CHARACTER", where)
    require(not any(0xD800 <= ord(c) <= 0xDFFF or ord(c) in (0xFFFE, 0xFFFF) for c in text), "INVALID_CHARACTER", where)
    return text.strip(" \t\r\n") if trim else text


def _attrs(raw: str, allowed: set[str], required: set[str], where: str) -> dict:
    matcher = re.compile(r'''\s+([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(["'])([^"'<>]*)\2''')
    result, pos = {}, 0
    while pos < len(raw) and raw[pos:].strip():
        match = matcher.match(raw, pos)
        require(match is not None, "INVALID_HEADER_ATTRIBUTES", where)
        key, _, value = match.groups()
        require(key in allowed and key not in result, "UNKNOWN_OR_DUPLICATE_HEADER", where)
        result[key] = value
        pos = match.end()
    require(required <= result.keys(), "MISSING_HEADER", where)
    return result


def _decode(raw: bytes) -> tuple[str, str, dict, int]:
    require(type(raw) is bytes and 0 < len(raw) <= MAX_FILE, "SOURCE_SIZE_OR_TYPE")
    data = raw[3:] if raw.startswith(b"\xef\xbb\xbf") else raw
    if data.startswith(b"OFXHEADER:"):
        index = data.find(b"<OFX>")
        require(0 < index <= 4096, "SGML_HEADER")
        try:
            prelude = data[:index].decode("ascii")
        except UnicodeError as exc:
            raise IntakeError("SGML_HEADER_ENCODING") from exc
        headers = {}
        for line in prelude.splitlines():
            if not line.strip():
                continue
            parts = line.strip().split(":", 1)
            require(len(parts) == 2 and re.fullmatch(r"[A-Z]+", parts[0]) is not None,
                    "SGML_HEADER")
            key, value = parts
            require(key not in headers, "DUPLICATE_HEADER")
            headers[key] = value.strip()
        require(set(headers) == {"OFXHEADER", "DATA", "VERSION", "SECURITY", "ENCODING", "CHARSET", "COMPRESSION", "OLDFILEUID", "NEWFILEUID"}, "SGML_HEADER_FIELDS")
        require(headers["OFXHEADER"] == "100" and headers["DATA"] == "OFXSGML" and headers["VERSION"] in {"102", "103", "160"}, "UNSUPPORTED_SGML_VERSION")
        require(headers["SECURITY"] == "NONE" and headers["COMPRESSION"] == "NONE", "UNSUPPORTED_ENVELOPE")
        encoding, charset = headers["ENCODING"], headers["CHARSET"]
        codecs = {("USASCII", "1252"): "cp1252", ("USASCII", "8859-1"): "iso8859-1",
                  ("USASCII", "NONE"): "ascii", ("USASCII", "USASCII"): "ascii",
                  ("UTF-8", "NONE"): "utf-8", ("UTF8", "NONE"): "utf-8",
                  ("UNICODE", "UTF-8"): "utf-8", ("UNICODE", "65001"): "utf-8"}
        require((encoding, charset) in codecs, "UNSUPPORTED_ENCODING")
        try:
            body = data[index:].decode(codecs[encoding, charset], errors="strict")
        except UnicodeError as exc:
            raise IntakeError("SOURCE_ENCODING") from exc
        return body, "SGML", headers, prelude.count("\n")
    # The supported XML profile requires both declarations. No heuristic repair.
    match = re.match(br"<\?xml(\s[^?]{0,1024})\?>", data)
    require(match is not None, "XML_DECLARATION_REQUIRED")
    try:
        decl = _attrs(match.group(1).decode("ascii"), {"version", "encoding", "standalone"}, {"version"}, "XML")
    except UnicodeError as exc:
        raise IntakeError("XML_DECLARATION_ENCODING") from exc
    require(decl["version"] == "1.0" and decl.get("standalone", "no") in {"yes", "no"}, "UNSUPPORTED_XML_DECLARATION")
    enc = decl.get("encoding", "UTF-8").upper()
    codecs = {"UTF-8": "utf-8", "US-ASCII": "ascii", "WINDOWS-1252": "cp1252", "ISO-8859-1": "iso8859-1"}
    require(enc in codecs, "UNSUPPORTED_ENCODING")
    try:
        text = data.decode(codecs[enc], errors="strict")
    except UnicodeError as exc:
        raise IntakeError("SOURCE_ENCODING") from exc
    ofx_pi = re.match(r"<\?xml\s[^?]*\?>\s*<\?OFX(\s[^?]{0,2048})\?>", text)
    require(ofx_pi is not None, "OFX_XML_HEADER_REQUIRED")
    headers = _attrs(ofx_pi.group(1), {"OFXHEADER", "VERSION", "SECURITY", "OLDFILEUID", "NEWFILEUID"},
                     {"OFXHEADER", "VERSION", "SECURITY", "OLDFILEUID", "NEWFILEUID"}, "OFX")
    require(headers["OFXHEADER"] == "200" and headers["VERSION"] in {"200", "201", "202", "203", "210", "211", "220", "221", "230"}, "UNSUPPORTED_XML_VERSION")
    require(headers["SECURITY"] == "NONE", "UNSUPPORTED_ENVELOPE")
    headers["XML_ENCODING"] = enc
    return text, "XML", headers, 0


def _parse_xml(text: str) -> Node:
    parser = expat.ParserCreate()
    stack, roots = [], []
    count, instructions = 0, 0
    in_cdata = False
    def start(tag: str, attrs: dict) -> None:
        nonlocal count
        require(not attrs and tag in AGGREGATES | LEAVES, "UNSUPPORTED_TAG_OR_ATTRIBUTE", f"line:{parser.CurrentLineNumber}")
        count += 1
        require(count <= MAX_NODES and len(stack) < MAX_DEPTH, "XML_COMPLEXITY_LIMIT")
        node = Node(tag, parser.CurrentLineNumber)
        if stack:
            require(stack[-1].tag in AGGREGATES, "NESTED_SCALAR")
            stack[-1].children.append(node)
        else:
            roots.append(node)
        stack.append(node)
    def end(tag: str) -> None:
        node = stack.pop()
        value = _valid_text(node.text, f"line:{node.line}", trim=False)
        # OFX layout whitespace is ignorable, but XML CDATA explicitly protects
        # its edge whitespace (OFX 2.3 sections 1.2.2 and 2.3.1.1). Preserve the
        # outermost nonempty CDATA character positions, regardless of Expat's
        # callback chunking; do not trim each callback or the assembled literal.
        left = len(value) - len(value.lstrip(" \t\r\n"))
        right = len(value.rstrip(" \t\r\n"))
        if node.cdata_start is not None:
            left = min(left, node.cdata_start)
            right = max(right, node.cdata_end)
        node.text = value[left:right]
        require(not (node.children and node.text), "MIXED_CONTENT")
    def data(chunk: str) -> None:
        if stack:
            if stack[-1].tag in AGGREGATES:
                require(not chunk.strip(), "AGGREGATE_TEXT")
                return
            node = stack[-1]
            require(len(node.text) + len(chunk) <= MAX_TEXT, "TEXT_LIMIT")
            if in_cdata and chunk:
                if node.cdata_start is None:
                    node.cdata_start = len(node.text)
                node.cdata_end = len(node.text) + len(chunk)
            node.text += chunk
        else:
            require(not chunk.strip(), "OUTSIDE_ROOT_TEXT")
    def cdata_start() -> None:
        nonlocal in_cdata
        in_cdata = True
    def cdata_end() -> None:
        nonlocal in_cdata
        in_cdata = False
    def refuse(*_: object) -> None:
        raise IntakeError("DTD_ENTITY_OR_COMMENT_UNSUPPORTED")
    def instruction(target: str, content: str) -> None:
        nonlocal instructions
        instructions += 1
        require(target == "OFX" and instructions == 1 and not roots and not stack,
                "UNSUPPORTED_PROCESSING_INSTRUCTION")
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.CharacterDataHandler = data
    parser.StartCdataSectionHandler, parser.EndCdataSectionHandler = cdata_start, cdata_end
    parser.StartDoctypeDeclHandler = refuse
    parser.EntityDeclHandler = refuse
    parser.ExternalEntityRefHandler = refuse
    parser.CommentHandler = refuse
    parser.ProcessingInstructionHandler = instruction
    try:
        parser.Parse(text, True)
    except expat.ExpatError as exc:
        raise IntakeError("MALFORMED_XML", f"line:{exc.lineno}") from exc
    require(len(roots) == 1 and roots[0].tag == "OFX" and instructions == 1, "OFX_ROOT")
    return roots[0]


def _unescape(value: str, where: str) -> str:
    entities = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}
    matcher = re.compile(r"&([A-Za-z]+|#[0-9]+|#x[0-9A-Fa-f]+);")
    chunks, pos = [], 0
    for match in matcher.finditer(value):
        require("&" not in value[pos:match.start()], "INVALID_ENTITY", where)
        chunks.append(value[pos:match.start()])
        item = match.group(1)
        if item.startswith("#"):
            try:
                character = chr(int(item[2:], 16) if item.startswith("#x") else int(item[1:]))
            except (ValueError, OverflowError) as exc:
                raise IntakeError("INVALID_ENTITY", where) from exc
        else:
            require(item in entities, "INVALID_ENTITY", where)
            character = entities[item]
        chunks.append(character)
        pos = match.end()
    require("&" not in value[pos:], "INVALID_ENTITY", where)
    chunks.append(value[pos:])
    return _valid_text("".join(chunks), where)


def _parse_sgml(text: str, line_offset: int) -> Node:
    matcher = re.compile(r"</?([A-Z][A-Z0-9_.]*)\s*>")
    stack, roots = [], []
    pos, line, count, last_leaf = 0, 1 + line_offset, 0, None
    while pos < len(text):
        bracket = text.find("<", pos)
        if bracket < 0:
            require(not text[pos:].strip(), "TRAILING_CONTENT")
            break
        gap = text[pos:bracket]
        require(not gap.strip(), "UNEXPECTED_TEXT", f"line:{line}")
        line += gap.count("\n")
        match = matcher.match(text, bracket)
        require(match is not None, "MALFORMED_SGML_TAG", f"line:{line}")
        tag, closing = match.group(1), text[bracket:bracket + 2] == "</"
        require(tag in AGGREGATES | LEAVES, "UNSUPPORTED_TAG", f"line:{line}")
        pos = match.end()
        if closing:
            if tag in LEAVES:
                require(last_leaf == tag, "UNEXPECTED_LEAF_CLOSE", f"line:{line}")
            else:
                require(bool(stack) and stack[-1].tag == tag, "AGGREGATE_CLOSE_MISMATCH", f"line:{line}")
                stack.pop()
            last_leaf = None
            continue
        last_leaf = None
        count += 1
        require(count <= MAX_NODES and len(stack) < MAX_DEPTH, "SGML_COMPLEXITY_LIMIT")
        node = Node(tag, line)
        if stack:
            stack[-1].children.append(node)
        else:
            roots.append(node)
        if tag in AGGREGATES:
            stack.append(node)
        else:
            require(bool(stack), "SCALAR_OUTSIDE_ROOT")
            next_tag = text.find("<", pos)
            require(next_tag >= 0, "UNCLOSED_SGML")
            raw_value = text[pos:next_tag]
            node.text = _unescape(raw_value, f"line:{line}")
            line += raw_value.count("\n")
            pos, last_leaf = next_tag, tag
    require(not stack and len(roots) == 1 and roots[0].tag == "OFX", "UNCLOSED_OR_MULTIPLE_ROOT")
    return roots[0]


def fields(node: Node, required: set[str], optional: set[str] | None = None,
           repeated: set[str] | None = None) -> dict[str, Node | list[Node]]:
    optional, repeated = optional or set(), repeated or set()
    allowed = required | optional | repeated
    result = {}
    require(not node.text, "AGGREGATE_TEXT", node.tag)
    for child in node.children:
        require(child.tag in allowed, "UNSUPPORTED_FIELD", node.tag + f"/line:{child.line}")
        if child.tag in repeated:
            result.setdefault(child.tag, []).append(child)
        else:
            require(child.tag not in result, "DUPLICATE_FIELD", node.tag + "/" + child.tag)
            result[child.tag] = child
    require(required <= result.keys(), "MISSING_FIELD", node.tag)
    return result


def scalar(node: Node, max_length: int = MAX_TEXT, allow_empty: bool = False) -> str:
    require(not node.children and len(node.text) <= max_length and (bool(node.text) or allow_empty),
            "INVALID_SCALAR", node.tag)
    return node.text


def leaves(node: Node, required: set[str], optional: set[str] | None = None) -> dict[str, str]:
    return {k: scalar(v) for k, v in fields(node, required, optional).items()}


def status(node: Node) -> dict:
    out = leaves(node, {"CODE", "SEVERITY"}, {"MESSAGE"})
    require(re.fullmatch(r"[0-9]{1,6}", out["CODE"]) is not None and out["SEVERITY"] in {"INFO", "WARN", "ERROR"}, "INVALID_STATUS")
    out["success"] = int(out["CODE"]) == 0 and out["SEVERITY"] == "INFO"
    return out


def account(node: Node) -> dict:
    bank = node.tag.startswith("BANK")
    out = leaves(node, {"BANKID", "ACCTID", "ACCTTYPE"} if bank else {"ACCTID"},
                 {"BRANCHID", "ACCTKEY"} if bank else {"ACCTKEY"})
    require(all(len(x) <= 255 for x in out.values()), "ACCOUNT_FIELD_LIMIT")
    if bank:
        require(out["ACCTTYPE"] in {"CHECKING", "SAVINGS", "MONEYMRKT", "CREDITLINE", "CD"}, "ACCOUNT_TYPE")
    return out


def balance(node: Node) -> dict:
    out = leaves(node, {"BALAMT", "DTASOF"})
    return {"raw": out, "amount": decimal_text(out["BALAMT"]), "asof": timestamp(out["DTASOF"])}


def transaction(node: Node) -> dict:
    pending = node.tag == "STMTTRNP"
    required = {"TRNTYPE", "TRNAMT", "DTTRAN"} if pending else {"TRNTYPE", "TRNAMT", "DTPOSTED", "FITID"}
    optional = {"NAME", "EXTDNAME", "REFNUM", "MEMO", "CURRENCY", "ORIGCURRENCY"}
    optional |= {"DTEXPIRE"} if pending else {"DTUSER", "DTAVAIL", "CORRECTFITID", "CORRECTACTION", "SRVRTID", "CHECKNUM", "SIC", "PAYEEID", "PAYEE", "BANKACCTTO", "CCACCTTO"}
    data = fields(node, required, optional)
    raw = {}
    for key, child in data.items():
        if key in {"CURRENCY", "ORIGCURRENCY"}:
            item = leaves(child, {"CURRATE", "CURSYM"})
            require(re.fullmatch(r"[A-Z]{3}", item["CURSYM"]) is not None, "CURRENCY_CODE")
            decimal_text(item["CURRATE"], key + "/CURRATE")
            raw[key] = item
        elif key == "PAYEE":
            raw[key] = leaves(child, {"NAME"}, {"ADDR1", "ADDR2", "ADDR3", "CITY", "STATE", "POSTALCODE", "COUNTRY", "PHONE"})
        elif key in {"BANKACCTTO", "CCACCTTO"}:
            raw[key] = account(child)
        else:
            raw[key] = scalar(child, 255 if key in {"FITID", "CORRECTFITID"} else MAX_TEXT)
    require(raw["TRNTYPE"] in TYPES and (pending or raw["TRNTYPE"] != "HOLD"), "TRANSACTION_TYPE")
    for a, b in [("CURRENCY", "ORIGCURRENCY"), ("NAME", "PAYEE"), ("BANKACCTTO", "CCACCTTO")]:
        require(not (a in raw and b in raw), "EXCLUSIVE_FIELDS", node.tag)
    require(("CORRECTFITID" in raw) == ("CORRECTACTION" in raw), "CORRECTION_PAIR")
    if "CORRECTACTION" in raw:
        require(raw["CORRECTACTION"] in {"DELETE", "REPLACE"}, "CORRECTION_ACTION")
    if "DTEXPIRE" in raw:
        require(raw["TRNTYPE"] == "HOLD", "EXPIRY_NON_HOLD")
    if "SIC" in raw:
        require(re.fullmatch(r"[0-9]{1,6}", raw["SIC"]) is not None, "SIC_FORMAT")
    dates = {k: timestamp(v, k) for k, v in raw.items() if k.startswith("DT")}
    return {"raw": raw, "amount": decimal_text(raw["TRNAMT"]), "dates": dates,
            "pending": pending, "source_line": node.line}


def parse_source(raw: bytes) -> dict:
    text, syntax, headers, line_offset = _decode(raw)
    root = _parse_xml(text) if syntax == "XML" else _parse_sgml(text, line_offset)
    top = fields(root, {"SIGNONMSGSRSV1"}, {"BANKMSGSRSV1", "CREDITCARDMSGSRSV1"})
    sign = fields(top["SIGNONMSGSRSV1"], {"SONRS"})["SONRS"]
    sign_fields = fields(sign, {"STATUS", "DTSERVER", "LANGUAGE"}, {"FI", "INTU.BID"})
    signon = {"status": status(sign_fields["STATUS"]),
              "server_time": timestamp(scalar(sign_fields["DTSERVER"])),
              "language": scalar(sign_fields["LANGUAGE"], 3)}
    if "FI" in sign_fields:
        signon["fi"] = leaves(sign_fields["FI"], {"ORG", "FID"})
    if "INTU.BID" in sign_fields:
        signon["intu_bid"] = scalar(sign_fields["INTU.BID"], 255)
    statements, responses = [], []
    for msg, wrapper, stmt, acct in [("BANKMSGSRSV1", "STMTTRNRS", "STMTRS", "BANKACCTFROM"),
                                    ("CREDITCARDMSGSRSV1", "CCSTMTTRNRS", "CCSTMTRS", "CCACCTFROM")]:
        if msg not in top:
            continue
        wrappers = fields(top[msg], set(), repeated={wrapper}).get(wrapper, [])
        require(bool(wrappers), "EMPTY_MESSAGE_SET", msg)
        for wrap in wrappers:
            wf = fields(wrap, {"TRNUID", "STATUS"}, {stmt, "CLTCOOKIE"})
            response = {"kind": msg, "trnuid": scalar(wf["TRNUID"], 255),
                        "status": status(wf["STATUS"]), "line": wrap.line}
            if "CLTCOOKIE" in wf:
                response["client_cookie"] = scalar(wf["CLTCOOKIE"], 255)
            responses.append(response)
            if stmt not in wf:
                require(not response["status"]["success"], "SUCCESS_MISSING_STATEMENT")
                continue
            sf = fields(wf[stmt], {"CURDEF", acct, "LEDGERBAL"},
                        {"BANKTRANLIST", "BANKTRANLISTP", "AVAILBAL", "MKTGINFO", "INTRATE", "CASHADVBALAMT", "CASHADVAVAILAMT", "CASHADVCREDITLIMIT", "INTRATEPURCH", "INTRATECASH", "INTRATEXFER"})
            currency = scalar(sf["CURDEF"], 3)
            require(re.fullmatch(r"[A-Z]{3}", currency) is not None, "CURRENCY_CODE")
            statement = {"kind": "BANK" if acct == "BANKACCTFROM" else "CREDITCARD",
                         "account": account(sf[acct]), "currency": currency,
                         "response": response, "line": wf[stmt].line,
                         "ledger_balance": balance(sf["LEDGERBAL"]), "transactions": [], "pending": []}
            for key, item in sf.items():
                if key == "AVAILBAL":
                    statement["available_balance"] = balance(item)
                elif key == "MKTGINFO" or key.startswith("INTRATE") or key.startswith("CASHADV"):
                    value = scalar(item)
                    if key != "MKTGINFO":
                        decimal_text(value, key)
                    statement.setdefault("extra_fields", {})[key] = value
            if "BANKTRANLIST" in sf:
                tf = fields(sf["BANKTRANLIST"], {"DTSTART", "DTEND"}, repeated={"STMTTRN"})
                start, end = timestamp(scalar(tf["DTSTART"])), timestamp(scalar(tf["DTEND"]))
                require(start["utc"] <= end["utc"], "REVERSED_DOWNLOAD_WINDOW")
                statement["download_window"] = {"start": start, "end": end}
                statement["transactions"] = [transaction(t) for t in tf.get("STMTTRN", [])]
            if "BANKTRANLISTP" in sf:
                pf = fields(sf["BANKTRANLISTP"], {"DTASOF"}, repeated={"STMTTRNP"})
                statement["pending_asof"] = timestamp(scalar(pf["DTASOF"]))
                statement["pending"] = [transaction(t) for t in pf.get("STMTTRNP", [])]
            statements.append(statement)
    require(bool(responses), "NO_STATEMENT_RESPONSE")
    require(sum(len(s["transactions"]) + len(s["pending"]) for s in statements) <= MAX_ROWS, "ROW_LIMIT")
    return {"syntax": syntax, "headers": headers, "signon": signon, "responses": responses,
            "statements": statements}


def compile_report(plan: object, sources: dict[str, bytes]) -> dict:
    """Review supplied occurrences; never construct an authoritative live ledger."""
    normalized_plan = normalize_plan(plan)
    require(type(sources) is dict and set(sources) == {r["file"] for r in normalized_plan["sources"]}, "SOURCE_SET_MISMATCH")
    require(all(type(v) is bytes for v in sources.values()) and sum(map(len, sources.values())) <= MAX_TOTAL, "TOTAL_SOURCE_LIMIT")
    source_reports, findings, occurrences, pending, accounts = [], [], [], [], {}
    groups = defaultdict(list)
    total_rows = 0
    def finding(code: str, level: str, refs: list[str], detail: str) -> None:
        findings.append({"code": code, "level": level, "refs": sorted(refs), "detail": detail})
    for source_spec in normalized_plan["sources"]:
        name, institution = source_spec["file"], source_spec["institution"]
        data = parse_source(sources[name])
        source_reports.append({"file": name, "institution": institution, "sha256": sha256(sources[name]).hexdigest(),
                               "bytes": len(sources[name]), "parsed": data})
        source_ok = data["signon"]["status"]["success"]
        if not source_ok:
            finding("SIGNON_STATUS_REVIEW", "HOLD", [name], "Supplied response status is not success/INFO; no affected rows enter the clean handoff.")
        for response in data["responses"]:
            if not response["status"]["success"]:
                finding("RESPONSE_STATUS_REVIEW", "HOLD", [name + ":" + str(response["line"])], "Statement response is not success/INFO.")
        for index, statement in enumerate(data["statements"]):
            statement_ref = name + ":statement:" + str(index + 1)
            # Account key intentionally excludes currency to detect currency drift.
            # The bank profile treats ACCTKEY as an optional checksum, but a
            # CREDITCARD ACCTKEY remains part of account identity.
            account_identity = dict(statement["account"])
            if statement["kind"] == "BANK":
                account_identity.pop("ACCTKEY", None)
            identity = {"institution": institution, "kind": statement["kind"], "account": account_identity}
            account_key = digest(identity)
            accounts.setdefault(account_key, {"identity": identity, "currencies": set(), "snapshots": []})
            accounts[account_key]["currencies"].add(statement["currency"])
            accounts[account_key]["snapshots"].append({"source": statement_ref, "ledger": statement["ledger_balance"],
                                                       "available": statement.get("available_balance")})
            if "download_window" not in statement:
                finding("BALANCE_ONLY", "INFO", [statement_ref], "No posted transaction list supplied; absence is not a zero-activity or complete-history assertion.")
            usable = source_ok and statement["response"]["status"]["success"]
            for row_index, row in enumerate(statement["transactions"]):
                total_rows += 1
                require(total_rows <= MAX_ROWS, "TOTAL_ROW_LIMIT")
                reference = statement_ref + ":posted:" + str(row_index + 1)
                occurrence = {"ref": reference, "account_key": account_key, "currency": statement["currency"],
                              "row": row, "source_status_ok": usable}
                occurrences.append(occurrence)
                groups[(account_key, row["raw"]["FITID"])].append(occurrence)
            for row_index, row in enumerate(statement["pending"]):
                total_rows += 1
                require(total_rows <= MAX_ROWS, "TOTAL_ROW_LIMIT")
                pending.append({"ref": statement_ref + ":pending:" + str(row_index + 1),
                                "account_key": account_key, "currency": statement["currency"], "row": row,
                                "asof": statement["pending_asof"], "source_status_ok": usable})
    account_holds, tainted = set(), set()
    institution_claims = defaultdict(set)
    for source in source_reports:
        fi = source["parsed"]["signon"].get("fi")
        if fi is not None:
            institution_claims[source["institution"]].add(digest(fi))
    conflicting_institutions = {k for k, v in institution_claims.items() if len(v) > 1}
    for key, value in accounts.items():
        if value["identity"]["institution"] in conflicting_institutions:
            account_holds.add(key)
            finding("INSTITUTION_DECLARATION_CONFLICT", "HOLD", [key], "Different FI declarations share an operator institution namespace; affected accounts held.")
        if len(value["currencies"]) > 1:
            account_holds.add(key)
            finding("ACCOUNT_CURRENCY_CONFLICT", "HOLD", [key], "One supplied account identity has multiple default currencies; no cross-currency reconciliation is attempted.")
        snapshots = defaultdict(list)
        for shot in value["snapshots"]:
            for kind in ("ledger", "available"):
                if shot[kind] is not None:
                    snapshots[(kind, shot[kind]["asof"]["utc"])].append(shot)
        for (kind, instant), shots in snapshots.items():
            if len({s[kind]["amount"] for s in shots}) > 1:
                account_holds.add(key)
                finding("BALANCE_SNAPSHOT_CONFLICT", "HOLD", [s["source"] for s in shots], "Different " + kind + " amounts share a supplied as-of instant; affected account held.")
    for group_key, rows in groups.items():
        for row in rows:
            raw = row["row"]["raw"]
            if "CORRECTFITID" in raw:
                target_key = (group_key[0], raw["CORRECTFITID"])
                tainted.add(group_key)
                tainted.add(target_key)
                finding("CORRECTION_REVIEW", "HOLD", [row["ref"]], "Correction and any target occurrences are retained but excluded; no DELETE/REPLACE is applied.")
                if target_key not in groups:
                    finding("CORRECTION_TARGET_NOT_SUPPLIED", "HOLD", [row["ref"]], "The referenced account-scoped FITID is absent from this supplied batch.")
            if "CURRENCY" in raw or "ORIGCURRENCY" in raw:
                tainted.add(group_key)
                finding("TRANSACTION_CURRENCY_REVIEW", "HOLD", [row["ref"]], "Currency override/original-currency evidence retained; no conversion or currency interpretation is silently applied.")
    handoff, duplicate_occurrences, group_reviews = [], 0, []
    for group_key in sorted(groups):
        key, fitid = group_key
        rows = groups[group_key]
        # The whole typed row except physical source line is compared. Different
        # raw date precision/memo is deliberately a conflict, never guessed equal.
        signatures = {digest({k: v for k, v in row["row"].items() if k != "source_line"}) for row in rows}
        refs = sorted(row["ref"] for row in rows)
        reasons = []
        if len(signatures) != 1:
            reasons.append("FITID_CONFLICT")
            finding("FITID_CONFLICT", "HOLD", refs, "Same account-scoped FITID has different supplied transaction fields; all variants excluded.")
        elif len(rows) > 1:
            duplicate_occurrences += len(rows) - 1
            finding("DUPLICATE_DOWNLOAD", "INFO", refs, "Identical repeated FITID occurrences retained; at most one row may enter the clean handoff.")
        if group_key in tainted:
            reasons.append("CORRECTION_OR_CURRENCY_REVIEW")
        if key in account_holds:
            reasons.append("ACCOUNT_HOLD")
        if not all(row["source_status_ok"] for row in rows):
            reasons.append("SOURCE_STATUS_REVIEW")
        group_reviews.append({"account_key": key, "fitid": fitid, "occurrences": refs, "reasons": reasons,
                              "status": "HOLD" if reasons else "CONSISTENT_SUPPLIED_RECORD"})
        if not reasons:
            representative = min(rows, key=lambda row: row["ref"])
            handoff.append({"account_key": key, "fitid": fitid, "currency": representative["currency"],
                            "amount": representative["row"]["amount"],
                            "posted": representative["row"]["dates"]["DTPOSTED"],
                            "type": representative["row"]["raw"]["TRNTYPE"],
                            "name": representative["row"]["raw"].get("NAME", representative["row"]["raw"].get("PAYEE", {}).get("NAME", "")),
                            "memo": representative["row"]["raw"].get("MEMO", ""),
                            "source_refs": refs})
    handoff_by_account = defaultdict(list)
    for row in handoff:
        handoff_by_account[row["account_key"]].append(row)
    for key, value in accounts.items():
        value["currencies"] = sorted(value["currencies"])
        value["snapshots"] = sorted(value["snapshots"], key=lambda r: r["source"])
        subset = handoff_by_account[key]
        value["handoff_row_count"] = len(subset)
        value["handoff_signed_sum"] = None if len(value["currencies"]) != 1 else sum_decimal([r["amount"] for r in subset])
        value["sum_meaning"] = "Supplied consistent posted subset only, not balance movement, income, available funds, or complete history."
    findings.sort(key=lambda f: (f["code"], f["refs"]))
    report = {"schema": PROFILE, "plan": normalized_plan, "sources": source_reports, "accounts": accounts,
              "occurrences": occurrences, "pending_observations": pending, "fitid_review": group_reviews,
              "findings": findings, "handoff": handoff,
              "status": "REVIEW_REQUIRED" if any(f["level"] == "HOLD" for f in findings) else "PARSED_FOR_OWNER_REVIEW",
              "summary": {"sources": len(source_reports), "accounts": len(accounts),
                          "posted_occurrences": len(occurrences), "pending_observations": len(pending),
                          "duplicate_occurrences": duplicate_occurrences, "handoff_rows": len(handoff),
                          "held_fitids": sum(bool(g["reasons"]) for g in group_reviews)},
              "limitations": ["Supplied snapshots only; no authenticated bank custody or completeness.",
                              "Pending observations are not stable ledger events and are never deduplicated or handed off as posted.",
                              "Corrections and affected targets are excluded, not executed; absence of a target is not proof it never existed.",
                              "Download windows are server search/add-time boundaries, not a filter for posted dates.",
                              "Sensitive account and transaction fields remain in local JSON/CSV; hashes do not anonymize them."],
              "authority": {"bank_authenticated": False, "history_complete": False, "live_balance": False,
                            "ledger_posting": False, "payment_or_trade": False, "outbound": False,
                            "revenue_recognized": False}}
    report["report_sha256"] = digest(report)
    return report
