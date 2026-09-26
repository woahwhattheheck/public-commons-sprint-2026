"""Standalone human review projection of a natively verified RepoAtlas bundle."""
from __future__ import annotations

from html import escape

from .core import verify_bundle


def _text(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "yes" if value else "no"
    return escape(str(value), quote=True)


def _table(headers, rows) -> str:
    head = "".join(f'<th scope="col">{_text(value)}</th>' for value in headers)
    body = "".join("<tr>" + "".join(f"<td>{_text(value)}</td>" for value in row) + "</tr>" for row in rows)
    if not body:
        return '<p class="muted">No rows in this admitted snapshot.</p>'
    return f'<div class="table-wrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def render_report(raw, packet, receipt) -> str:
    """Verify against the source manifest before presenting findings or metadata."""
    verify_bundle(raw, packet, receipt)
    actions = {(row["path"], row["code"]): row["action"] for row in packet["recommendations"]}
    sections = []

    def section(anchor, title, content):
        sections.append(f'<section id="{anchor}"><h2>{title}</h2>{content}</section>')

    section("findings", "Findings and next steps", _table(
        ["Risk", "Code", "Path", "Finding", "Suggested human next step"],
        [[row["risk"], row["code"], row["path"], row["detail"], actions.get((row["path"], row["code"]), "—")]
         for row in packet["findings"]]))
    section("modules", "Module ownership", _table(
        ["Module", "Owners", "Files", "Test files", "Changed", "Public APIs"],
        [[row["module"], ", ".join(row["owners"]), row["files"], row["tests"], row["changed"], row["public_api"]]
         for row in packet["modules"]]))
    section("changes", "Changed paths", _table(
        ["Path", "Change", "Before SHA-256", "After SHA-256"],
        [[row["path"], row["change"], row.get("before_sha256"), row.get("after_sha256")]
         for row in sorted(raw.get("changes", []), key=lambda row: row["path"])]))
    section("files", "Admitted file inventory",
        '<p>Owners, test references and hashes are supplied manifest evidence. This report does not read repository files or execute tests.</p>' + _table(
        ["Path", "Kind", "Module", "Owner", "Public API", "Declared test references", "SHA-256"],
        [[row["path"], row["kind"], row.get("module", row["path"].split("/", 1)[0]),
          row.get("owner", "UNOWNED"), row.get("public_api", False),
          "\n".join(sorted(set(row.get("tests", [])))) or "—", row["sha256"]]
         for row in sorted(raw["files"], key=lambda row: row["path"])]))
    section("dependencies", "Dependency relationships", _table(
        ["From", "To", "Kind"],
        [[row["from"], row["to"], row["kind"]] for row in sorted(raw.get("dependencies", []),
         key=lambda row: (row["from"], row["to"], row["kind"]))]))
    docs = []
    for key, label in (("adrs", "Architecture decision"), ("runbooks", "Runbook")):
        docs.extend([[label, row["id"], "\n".join(sorted(set(row["covers"]))) or "—", row["sha256"]]
                     for row in sorted(raw.get(key, []), key=lambda row: row["id"])])
    section("documents", "Architecture and runbook coverage", _table(["Type", "ID", "Covered paths", "SHA-256"], docs))
    section("identity", "Bundle identity and provider state",
        '<p>The input identity below is the native normalized manifest hash; packet and receipt identities use their native canonical definitions. Keep the source JSON, packet and receipt for independent verification.</p>' +
        _table(["Identity", "Value"], [
            ["Repository", packet["repository"]], ["Baseline", packet["baseline"]],
            ["Normalized input SHA-256", packet["input_sha256"]],
            ["Packet SHA-256", packet["packet_sha256"]],
            ["Receipt SHA-256", receipt["receipt_sha256"]]]) +
        _table(["Admitted provider flag", "Value"], sorted(raw["provider"].items())) +
        _table(["Native authority", "Value"], sorted(packet["authority"].items())))

    summary = packet["summary"]
    metrics = "".join(f'<div><strong>{summary[key]}</strong><span>{label}</span></div>' for key, label in (
        ("files", "admitted files"), ("dependencies", "dependencies"),
        ("changed_paths", "changed paths"), ("modules", "modules")))
    risks = " · ".join(f'{_text(risk)} {count}' for risk, count in summary["finding_counts"].items())
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RepoAtlas review · {_text(packet["repository"])}</title>
<style>
:root {{ color-scheme: light; font-family: system-ui,sans-serif; color:#172638; background:#f3f6f8; }}
body {{ margin:0 auto; max-width:1400px; padding:32px 24px 64px; }}
header,section {{ background:white; border:1px solid #d5dfe7; border-radius:12px; padding:24px; margin-bottom:20px; }}
h1 {{ margin:8px 0; font-size:clamp(24px,4vw,40px); overflow-wrap:anywhere; }} h2 {{ margin-top:0; font-size:22px; }}
p {{ line-height:1.55; }} .eyebrow,.muted {{ color:#506276; }} .states {{ font-weight:700; color:#6c4200; }}
.metrics {{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:24px 0; }}
.metrics div {{ padding:14px; background:#edf3f8; border-radius:8px; }} .metrics strong {{ display:block; font-size:28px; }} .metrics span {{ color:#506276; }}
nav {{ display:flex; flex-wrap:wrap; gap:14px; margin:18px 0; }} a {{ color:#075e89; }} section {{ scroll-margin-top:20px; }}
.table-wrap {{ overflow-x:auto; }} table {{ border-collapse:collapse; width:100%; table-layout:fixed; font-size:13px; }}
th,td {{ text-align:left; vertical-align:top; padding:10px; border-bottom:1px solid #dce4eb; overflow-wrap:anywhere; white-space:pre-wrap; }}
th {{ background:#edf3f8; }} tbody tr:nth-child(even) {{ background:#fafcfd; }}
@media(max-width:700px) {{ body {{ padding:16px 10px; }} header,section {{ padding:16px; }} .metrics {{ grid-template-columns:repeat(2,1fr); }} table {{ min-width:680px; }} }}
@media print {{ body {{ max-width:none; padding:0; background:white; }} header,section {{ border-radius:0; }} nav {{ display:none; }} thead {{ display:table-header-group; }} tr {{ break-inside:avoid; }} .table-wrap {{ overflow:visible; }} table {{ min-width:0; }} }}
</style></head><body><header>
<p class="eyebrow">REPOATLAS · HUMAN REVIEW</p><h1>{_text(packet["repository"])}</h1>
<p class="states">{_text(packet["state"])} · {_text(packet["competition_state"])}</p>
<p>Bundle verification passed against the supplied manifest. These are admitted-source findings for human review; they do not establish current provider facts or authorize release, deployment, registration, submission or payment.</p>
<div class="metrics">{metrics}</div><p>{risks}</p>
<nav aria-label="Report sections"><a href="#findings">Findings</a><a href="#modules">Ownership</a><a href="#changes">Changes</a><a href="#files">Files</a><a href="#dependencies">Dependencies</a><a href="#documents">Documents</a><a href="#identity">Identity</a></nav>
</header>{''.join(sections)}<footer><p>Standalone snapshot · no network resources or executable scripts · native analysis rules unchanged</p></footer></body></html>
'''
