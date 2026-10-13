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
    if not isinstance(package_index, dict) or package_index.get('schema') not in (
            'upstate-ec-sdc-2026/package-v1', 'commons.native-study-package/v1'):
        raise ValueError('handoff view requires an upstate package-v1 index')
    native_study = package_index['schema'] == 'commons.native-study-package/v1'
    package_label = 'Original native study' if native_study else 'Upstate EC-SDC'
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
    if disposition == 'PACKAGED_NATIVE_STUDY':
        disposition_class = 'passed'
    disposition_detail = {
        'PACKAGED_NATIVE_STUDY': 'The complete original study contains its native maps, scientific report, source context and portable working project.',
        'PACKAGED_HUMAN_REVIEW_REQUIRED': (
            'The captured original study is ready for scientific interpretation and map review.' if native_study
            else 'The captured package still needs qualified-prime human review.'),
        'PACKAGED_FOR_REMEDIATION': 'Resolve the package dependencies and technical findings before treating this as a complete handoff.',
        'PACKAGED_AUDIT_UNAVAILABLE': 'The native technical audit was unavailable. Open audit.json for the cause and inspect missing references below.',
    }.get(disposition, 'The package disposition is unavailable. Inspect package.json before relying on the handoff.')

    manifest_href = _delivery_href(package_index.get('manifestPath'))
    manifest_link = (f'<a href="{manifest_href}" download>Portable manifest</a>' if manifest_href
                     else '<span class="attention">Portable manifest link unavailable</span>')
    atlas_browser_link = ('<a href="delivery/maps/atlas-browser.html" target="_blank" rel="noopener noreferrer">Browse map atlas</a>'
                          if any(item.get('path') == 'delivery/maps/atlas-browser.html' for item in artifacts) else '')
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
:root{font-family:system-ui,sans-serif;line-height:1.5;color:#242424;background:#f4f4f4}*{box-sizing:border-box}body{margin:0}header{background:#262626;color:#fff;padding:30px max(22px,calc((100vw - 1240px)/2))}header p{color:#e4e4e4;max-width:820px;margin-bottom:0}h1{font-size:clamp(27px,4vw,38px);line-height:1.15;margin:8px 0}header small{text-transform:uppercase;letter-spacing:.12em;color:#d0d0d0}main{max-width:1284px;padding:24px 22px;margin:auto}h2{font-size:20px;margin:0 0 12px}a{color:#333333;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #555555;outline-offset:3px}.card{background:#fff;border:1px solid #c8c8c8;border-radius:9px;padding:20px;margin-bottom:20px}.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.toolbar a{display:inline-block;padding:9px 12px;border:1px solid #999999;border-radius:5px;text-decoration:none;font-weight:600}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}.stat{background:#fff;border:1px solid #c8c8c8;border-radius:7px;padding:14px 17px}.stat b{display:block;font-size:25px;color:#262626}.stat span,.muted{color:#626262;font-size:13px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;background:#eeeeee;color:#555555;font-size:11px;text-transform:uppercase;letter-spacing:.05em}th,td{padding:12px 10px;border-bottom:1px solid #d8d8d8;vertical-align:top}code{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere}.role{display:block;font-size:12px;margin-bottom:4px;overflow-wrap:anywhere}.size,.action{white-space:nowrap}.action a{font-weight:650}details{margin-top:7px}summary{cursor:pointer;font-size:12px;color:#555555}.hash{display:block;max-width:760px;word-break:break-all;margin-top:8px}.level{display:inline-block;padding:4px 7px;border-radius:4px;font-size:11px;font-weight:650}.passed{background:#eeeeee;color:#333333}.pending{background:#e8e8e8;color:#333333}.failed{background:#dedede;color:#222222}.neutral{background:#f0f0f0;color:#555555}.attention{color:#222222}.boundary{font-size:13px;border-left:4px solid #777777;padding:9px 13px;background:#f0f0f0;margin:15px 0 0}.missing{padding-left:20px}.missing li{padding:9px 0;border-bottom:1px solid #dddddd}.missing p{margin:5px 0;font-size:13px}footer{max-width:1284px;margin:auto;padding:0 22px 28px;color:#626262;font-size:12px}@media(max-width:600px){main{padding:16px 12px}.card{padding:14px}.stats{gap:7px}.stat{padding:11px}.stat b{font-size:22px}th,td{padding:10px 7px}.toolbar a{width:100%}}
</style></head><body>
<header><small>''' + _text(package_label) + ''' · Local handoff</small><h1>Captured GIS delivery</h1><p>Open the captured deliverables by role. Keep this whole folder together so its file links and portable manifest continue to work.</p></header>
<main><section class="card"><h2>Start here</h2><p><span class="level ''' + disposition_class + '">' + _text(disposition) + '</span></p><p>' + disposition_detail + '</p><p class="muted">Human review: ' + _text(package_index.get('humanReview', 'Not recorded')) + '</p><div class="toolbar">' + manifest_link + atlas_browser_link + '''
<a href="package.json" download>File inventory</a><a href="audit.json" download>Original audit result</a></div>
<p class="muted">PDF maps open in a separate tab. Save other formats for your local GIS or text tools. This page does not load remote content or render customer HTML/SVG.</p>
<details><summary>Package fingerprint</summary><code class="hash">''' + _text(package_index.get('packageSha256', 'Unavailable')) + '''</code></details></section>
<div class="stats"><div class="stat"><b>''' + str(len(artifacts)) + '''</b><span>Catalogued files</span></div><div class="stat"><b>''' + str(len(missing)) + '''</b><span>Missing references</span></div><div class="stat"><b>''' + str(review_count) + '''</b><span>Human review findings</span></div></div>
<section class="card"><h2>Captured deliverables</h2><div class="table-wrap"><table><thead><tr><th>Manifest role</th><th>Packaged file</th><th>Size</th><th>Open locally</th></tr></thead><tbody>''' + artifact_rows + '''</tbody></table></div></section>
<section class="card"><h2>Missing references</h2>''' + missing_block + '''</section>
<section class="card"><h2>Original technical audit</h2><p><span class="level ''' + status_class + '">' + _text(status) + '</span> <span class="muted">' + str(fail_count) + ''' failed findings</span></p>
<p class="boundary">''' + ('Review the original study assumptions, common valid-cell support and rendered maps alongside the reported physical and economic results.' if native_study else 'A technical precheck does not establish environmental model correctness, cartographic quality or issuer acceptance. Human review findings remain work for the qualified prime.') + '''</p>
<div class="table-wrap"><table><thead><tr><th>Level</th><th>Check</th><th>Finding</th></tr></thead><tbody>''' + finding_rows + '''</tbody></table></div></section>
</main><footer>Private local delivery package. The original source folder is not modified. Moving individual files can break links; transfer the complete package.</footer>
</body></html>
'''
