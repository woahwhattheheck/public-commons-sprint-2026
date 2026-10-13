"""Render the offline entry point to a captured GIS delivery package."""
from html import escape
from pathlib import PurePosixPath
from urllib.parse import quote


def _text(value):
    return escape(str(value), quote=True)


def _delivery_href(value):
    """Only link to a literal relative file inside this package's delivery tree."""
    if not isinstance(value, str) or not value.startswith('delivery/'):
        return None
    if '\\' in value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        return None
    return quote(value, safe='/')


def _roles(value):
    if not isinstance(value, list) or not value:
        return '<span class="muted">Unspecified role</span>'
    return ''.join('<span class="role">' + _text(role) + '</span>' for role in value)


def _size(value):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        return 'Size unavailable'
    if value < 1024:
        return f'{value:,} bytes'
    if value < 1024 ** 2:
        return f'{value / 1024:,.1f} KiB'
    return f'{value / (1024 ** 2):,.1f} MiB'


def _artifact_row(item):
    path = item.get('path', '')
    # The CLI adds this one generated root file to the sealed inventory.
    href = 'audit.json' if path == 'audit.json' else _delivery_href(path)
    name = _text(path) if path else 'Path unavailable'
    if href:
        # Maps open directly. Other formats remain downloads for the operator's
        # native GIS/text tools; customer HTML/SVG is never embedded or executed.
        if PurePosixPath(path).suffix.lower() == '.pdf':
            link = f'<a href="{href}" target="_blank" rel="noopener noreferrer">Open PDF</a>'
        else:
            link = f'<a href="{href}" download>Save file</a>'
    else:
        link = '<span class="attention">No safe package link</span>'
    return ('<tr><td>' + _roles(item.get('roles')) + '</td><td><code>' + name +
            '</code><details><summary>Captured file SHA-256</summary><code class="hash">' +
            _text(item.get('sha256', 'Unavailable')) + '</code></details></td><td class="size">' +
            _size(item.get('bytes')) + '</td><td class="action">' + link + '</td></tr>')


def render_handoff(package_index, audit):
    """Return a self-contained HTML navigator; never open source files or URLs.

    Inputs are the packager's package-v1 index and the original audit result.
    The caller writes this page at the package root alongside package.json and
    audit.json. All customer-provided values become escaped text or a validated,
    URL-encoded link to a captured file under delivery/ or the known audit.json.
    """
    if not isinstance(package_index, dict) or package_index.get('schema') != 'upstate-ec-sdc-2026/package-v1':
        raise ValueError('handoff view requires an upstate package-v1 index')
    artifacts = package_index.get('artifacts', [])
    missing = package_index.get('missing', [])
    if not isinstance(artifacts, list) or not isinstance(missing, list):
        raise ValueError('package artifact and missing inventories must be lists')
    if not all(isinstance(item, dict) for item in artifacts + missing):
        raise ValueError('package inventory entries must be objects')
    audit = audit if isinstance(audit, dict) else {}
    findings = audit.get('findings', [])
    findings = findings if isinstance(findings, list) else []
    findings = [item for item in findings if isinstance(item, dict)]
    fail_count = sum(item.get('level') == 'FAIL' for item in findings)
    review_count = sum(item.get('level') == 'REVIEW' for item in findings)
    status = audit.get('status', 'AUDIT_UNAVAILABLE')
    status_class = 'failed' if status == 'FAIL' else 'pending'
    if status == 'TECHNICAL_PRECHECK_PASS':
        status_class = 'passed'
    disposition = package_index.get('disposition', 'PACKAGE_STATUS_UNAVAILABLE')
    disposition_class = 'failed' if disposition == 'PACKAGED_FOR_REMEDIATION' else 'pending'
    disposition_detail = {
        'PACKAGED_HUMAN_REVIEW_REQUIRED': 'The captured package still needs qualified-prime human review.',
        'PACKAGED_FOR_REMEDIATION': 'Resolve the package dependencies and technical findings before treating this as a complete handoff.',
        'PACKAGED_AUDIT_UNAVAILABLE': 'The native technical audit was unavailable. Open audit.json for the cause and inspect missing references below.',
    }.get(disposition, 'The package disposition is unavailable. Inspect package.json before relying on the handoff.')

    manifest_href = _delivery_href(package_index.get('manifestPath'))
    manifest_link = (f'<a href="{manifest_href}" download>Portable manifest</a>' if manifest_href
                     else '<span class="attention">Portable manifest link unavailable</span>')
    artifact_rows = ''.join(_artifact_row(item) for item in artifacts)
    if not artifact_rows:
        artifact_rows = '<tr><td colspan="4" class="muted">No captured artifacts are listed.</td></tr>'
    missing_rows = ''.join('<li>' + _roles(item.get('roles')) + '<code>' +
                           _text(item.get('path') or 'No path declared') + '</code><p>' +
                           _text(item.get('reason', 'No reason supplied')) + '</p></li>' for item in missing)
    missing_block = ('<ul class="missing">' + missing_rows + '</ul>' if missing_rows else
                     '<p class="muted">The packager reported no missing artifact references.</p>')
    finding_rows = ''.join('<tr><td><span class="level ' +
                           ('failed' if item.get('level') == 'FAIL' else 'pending' if item.get('level') == 'REVIEW' else 'neutral') +
                           '">' + _text(item.get('level', 'INFO')) + '</span></td><td><code>' +
                           _text(item.get('check', '')) + '</code></td><td>' +
                           _text(item.get('detail', '')) + '</td></tr>' for item in findings)
    if not finding_rows:
        detail = audit.get('error') or audit.get('detail') or 'No original audit findings are available. Inspect audit.json for the execution result.'
        finding_rows = '<tr><td colspan="3">' + _text(detail) + '</td></tr>'

    return '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Captured GIS delivery</title>
<style>
:root{font-family:system-ui,sans-serif;line-height:1.5;color:#203336;background:#eef2f0}*{box-sizing:border-box}body{margin:0}header{background:#183e3b;color:#fff;padding:30px max(22px,calc((100vw - 1240px)/2))}header p{color:#d0e3da;max-width:820px;margin-bottom:0}h1{font-size:clamp(27px,4vw,38px);line-height:1.15;margin:8px 0}header small{text-transform:uppercase;letter-spacing:.12em;color:#bdd4c8}main{max-width:1284px;padding:24px 22px;margin:auto}h2{font-size:20px;margin:0 0 12px}a{color:#165d51;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #cfab43;outline-offset:3px}.card{background:#fff;border:1px solid #cad6d0;border-radius:9px;padding:20px;margin-bottom:20px}.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.toolbar a{display:inline-block;padding:9px 12px;border:1px solid #a9bfb4;border-radius:5px;text-decoration:none;font-weight:600}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}.stat{background:#fff;border:1px solid #cad6d0;border-radius:7px;padding:14px 17px}.stat b{display:block;font-size:25px;color:#204d43}.stat span,.muted{color:#5b7069;font-size:13px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;background:#f2f6f3;color:#526c61;font-size:11px;text-transform:uppercase;letter-spacing:.05em}th,td{padding:12px 10px;border-bottom:1px solid #dfe7e1;vertical-align:top}code{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere}.role{display:block;font-size:12px;margin-bottom:4px;overflow-wrap:anywhere}.size,.action{white-space:nowrap}.action a{font-weight:650}details{margin-top:7px}summary{cursor:pointer;font-size:12px;color:#526c61}.hash{display:block;max-width:760px;word-break:break-all;margin-top:8px}.level{display:inline-block;padding:4px 7px;border-radius:4px;font-size:11px;font-weight:650}.passed{background:#e2f0e7;color:#25583c}.pending{background:#fff0cf;color:#745518}.failed{background:#fae7e1;color:#923d29}.neutral{background:#edf1ef;color:#51655d}.attention{color:#923d29}.boundary{font-size:13px;border-left:4px solid #8da791;padding:9px 13px;background:#f1f6f2;margin:15px 0 0}.missing{padding-left:20px}.missing li{padding:9px 0;border-bottom:1px solid #e2e7e3}.missing p{margin:5px 0;font-size:13px}footer{max-width:1284px;margin:auto;padding:0 22px 28px;color:#5b7069;font-size:12px}@media(max-width:600px){main{padding:16px 12px}.card{padding:14px}.stats{gap:7px}.stat{padding:11px}.stat b{font-size:22px}th,td{padding:10px 7px}.toolbar a{width:100%}}
</style></head><body>
<header><small>Upstate EC-SDC · Local handoff</small><h1>Captured GIS delivery</h1><p>Open the captured deliverables by role. Keep this whole folder together so its file links and portable manifest continue to work.</p></header>
<main><section class="card"><h2>Start here</h2><p><span class="level ''' + disposition_class + '">' + _text(disposition) + '</span></p><p>' + disposition_detail + '</p><p class="muted">Human review: ' + _text(package_index.get('humanReview', 'Not recorded')) + '</p><div class="toolbar">' + manifest_link + '''
<a href="package.json" download>File inventory</a><a href="audit.json" download>Original audit result</a></div>
<p class="muted">PDF maps open in a separate tab. Save other formats for your local GIS or text tools. This page does not load remote content or render customer HTML/SVG.</p>
<details><summary>Package fingerprint</summary><code class="hash">''' + _text(package_index.get('packageSha256', 'Unavailable')) + '''</code></details></section>
<div class="stats"><div class="stat"><b>''' + str(len(artifacts)) + '''</b><span>Catalogued files</span></div><div class="stat"><b>''' + str(len(missing)) + '''</b><span>Missing references</span></div><div class="stat"><b>''' + str(review_count) + '''</b><span>Human review findings</span></div></div>
<section class="card"><h2>Captured deliverables</h2><div class="table-wrap"><table><thead><tr><th>Manifest role</th><th>Packaged file</th><th>Size</th><th>Open locally</th></tr></thead><tbody>''' + artifact_rows + '''</tbody></table></div></section>
<section class="card"><h2>Missing references</h2>''' + missing_block + '''</section>
<section class="card"><h2>Original technical audit</h2><p><span class="level ''' + status_class + '">' + _text(status) + '</span> <span class="muted">' + str(fail_count) + ''' failed findings</span></p>
<p class="boundary">A technical precheck does not establish environmental model correctness, cartographic quality or issuer acceptance. Human review findings remain work for the qualified prime.</p>
<div class="table-wrap"><table><thead><tr><th>Level</th><th>Check</th><th>Finding</th></tr></thead><tbody>''' + finding_rows + '''</tbody></table></div></section>
</main><footer>Private local delivery package. The original source folder is not modified. Moving individual files can break links; transfer the complete package.</footer>
</body></html>
'''
