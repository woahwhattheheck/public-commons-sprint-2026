#!/usr/bin/env python3
"""Package a completed native report as a self-contained reader and original-file ZIP.

No scientific source is recomputed. The operation's exact retained bodies are
verified, preserved, and made directly downloadable without a server.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
from typing import Any
import zipfile
from html import escape

VERSION = "upstate.offline-observed-report/v1.1"

STYLE = """
.offline-tools{border:1px solid #888;padding:16px;margin:0 0 24px;background:#f6f6f6}
.offline-tools h2{font-size:18px;margin:0 0 8px;border:0;padding:0}
.offline-tools .actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.offline-tools button,.offline-tools select,.offline-tools input{font:inherit;color:inherit;background:#fff;border:1px solid #777;padding:9px 12px;border-radius:0;max-width:100%}
.offline-tools button{cursor:pointer;white-space:normal;text-align:left}
.offline-tools button:disabled{opacity:.55;cursor:default}
.offline-tools button:focus-visible,.offline-tools select:focus-visible,.offline-tools input:focus-visible{outline:2px solid #111;outline-offset:3px}
.offline-tools label{display:block;margin-top:12px;margin-bottom:4px}
.offline-tools input,.offline-tools select{width:100%;min-width:0}
.offline-tools select{height:180px;font-size:13px}
.offline-tools details{margin-top:12px}.offline-tools summary{cursor:pointer}
.offline-tools .status{font-size:13px;min-height:1.5em;margin:8px 0 0;overflow-wrap:anywhere}
@media(max-width:620px){.offline-tools{padding:12px}.offline-tools .actions{display:grid;grid-template-columns:1fr}.offline-tools button{width:100%}}
.offline-figure-button{font:inherit;color:inherit;background:#fff;border:1px solid #777;padding:8px 12px;margin:10px 0;cursor:pointer}
.offline-figure-dialog{width:min(1100px,calc(100vw - 24px));max-width:calc(100vw - 24px);border:1px solid #555;padding:16px;color:#171717;background:#fff}
.offline-figure-dialog::backdrop{background:rgba(0,0,0,.4)}
.offline-figure-dialog h2{font-size:18px;margin:0 0 12px;border:0}
.offline-figure-dialog .figure-controls{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.offline-figure-dialog .figure-controls button{font:inherit;background:#fff;border:1px solid #777;padding:7px 10px;cursor:pointer}
.offline-figure-scroll{overflow:auto;max-height:65vh;border:1px solid #bbb;background:#fff;overscroll-behavior:contain}
.offline-figure-scroll img{display:block;max-width:none;height:auto;margin:auto}
@media print{.offline-tools,.offline-figure-button,.offline-figure-dialog{display:none}}
"""

SCRIPT = r"""
(() => {
  'use strict';
  const payload = JSON.parse(document.getElementById('offline-report-payload').textContent);
  const panel = document.getElementById('offline-report-tools');
  const status = document.getElementById('offline-report-status');
  const select = document.getElementById('offline-source-select');
  const filter = document.getElementById('offline-source-filter');
  const selectedButton = document.getElementById('offline-selected-download');
  const entries = Object.entries(payload.files);
  let exporting = false;
  function setStatus(text) { status.textContent = text; }
  function showOptions() {
    const query = filter.value.trim().toLocaleLowerCase();
    const prior = select.value;
    const matching = entries.filter(([path, item]) =>
      (path + ' ' + item.title).toLocaleLowerCase().includes(query));
    select.replaceChildren(...matching.map(([path, item]) => {
      const option = document.createElement('option');
      option.value = path; option.textContent = item.title;
      return option;
    }));
    if (matching.some(([path]) => path === prior)) select.value = prior;
    else if (matching.length) select.selectedIndex = 0;
    selectedButton.disabled = exporting || !matching.length;
    setStatus(matching.length ? `${matching.length} retained files. Select one to save its original bytes.`
                              : 'No matching retained files. Clear the search to show all sources.');
  }
  function bytesOf(item) {
    const raw = atob(item.content_base64);
    if (raw.length !== item.bytes) throw new Error('The retained file is incomplete. Reopen the original reader.');
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  async function download(item) {
    if (!item || exporting) return;
    exporting = true;
    const buttons = [...panel.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    setStatus(`Preparing ${item.filename}…`);
    try {
      // Yield so the real pending state is visible before a large local decode.
      await new Promise(resolve => requestAnimationFrame(resolve));
      const bytes = bytesOf(item);
      const url = URL.createObjectURL(new Blob([bytes], {type: item.mime_type}));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = item.filename; anchor.hidden = true;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(`Saved original ${item.filename} (${item.bytes.toLocaleString()} bytes).`);
    } catch (error) {
      setStatus('Could not save this file: ' + error.message);
    } finally {
      exporting = false;
      buttons.forEach(button => { button.disabled = false; });
      selectedButton.disabled = !select.options.length;
    }
  }
  panel.querySelectorAll('[data-download-role]').forEach(button => {
    button.disabled = false;
    button.addEventListener('click', () => {
      const role = button.dataset.downloadRole;
      download(role === 'zip' ? payload.bundle : payload.files[payload.roles[role]]);
    });
  });
  selectedButton.addEventListener('click', () => download(payload.files[select.value]));
  filter.addEventListener('input', showOptions);
  select.addEventListener('change', () => { selectedButton.disabled = exporting || !select.value; });
  // Local report-source links retain their exact targets and original source IDs.
  // Only the known embedded bodies become downloads. Fragments and publisher URLs
  // keep their original browser behavior.
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!Object.prototype.hasOwnProperty.call(payload.files, href)) return;
    event.preventDefault(); download(payload.files[href]);
  });
  const dialog = document.getElementById('offline-figure-dialog');
  const fullImage = dialog.querySelector('img');
  const figureScroll = dialog.querySelector('.offline-figure-scroll');
  const figureTitle = document.getElementById('offline-figure-title');
  let selectedFigure = null;
  document.querySelectorAll('figure.scientific-figure').forEach((figure, index) => {
    const record = payload.figures[index];
    const image = figure.querySelector('img');
    if (!record || !image || !payload.files[record.path]) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'offline-figure-button';
    button.textContent = 'Inspect full-size figure';
    button.addEventListener('click', () => {
      selectedFigure = record;
      figureTitle.textContent = record.title;
      fullImage.src = image.src; fullImage.alt = image.alt;
      fullImage.style.width = image.naturalWidth + 'px';
      dialog.showModal(); figureScroll.scrollTo(0, 0);
    });
    figure.insertBefore(button, figure.querySelector('figcaption'));
  });
  dialog.querySelector('[data-figure-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-figure-fit]').addEventListener('click', () => {
    fullImage.style.width = Math.min(fullImage.naturalWidth, figureScroll.clientWidth) + 'px';
    figureScroll.scrollTo(0, 0);
  });
  dialog.querySelector('[data-figure-actual]').addEventListener('click', () => {
    fullImage.style.width = fullImage.naturalWidth + 'px';
  });
  dialog.querySelector('[data-figure-save]').addEventListener('click', () => {
    if (selectedFigure) download(payload.files[selectedFigure.path]);
  });
  showOptions();
})();
"""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def retained_file(root: Path, relative: str) -> tuple[Path, bytes]:
    p = PurePosixPath(relative)
    if (not relative or p.is_absolute() or '..' in p.parts or '\\' in relative
            or str(p) != relative):
        raise ValueError(f"Expected a normalized retained relative file: {relative}")
    path = root.joinpath(*p.parts)
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents if parent != root and parent.is_relative_to(root)):
        raise ValueError(f"Retained sources must be regular files: {relative}")
    path = path.resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f"Retained source is outside the selected report: {relative}")
    return path, path.read_bytes()


def write_exact(path: Path, data: bytes) -> None:
    if path.exists():
        if path.is_symlink() or path.read_bytes() != data:
            raise FileExistsError(f"Select a new delivery directory; existing output differs: {path}")
        return
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, 'wb') as out:
        out.write(data)


def complete_zip(files: dict[str, bytes]) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, body in sorted(files.items()):
            member = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            archive.writestr(member, body)
    return stream.getvalue()


def package(report: Path, output: Path, stem: str) -> dict[str, Any]:
    report = report.resolve(strict=True)
    output = output.resolve()
    if output.is_relative_to(report) or report.is_relative_to(output):
        raise ValueError('Keep the delivery directory independent of the retained report.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,120}', stem):
        raise ValueError('Use a short alphanumeric file stem with dots, underscores or hyphens.')
    _, operation_bytes = retained_file(report, 'operation.json')
    operation = json.loads(operation_bytes)
    if operation.get('state') != 'complete' or not isinstance(operation.get('files'), dict):
        raise ValueError('Select a completed native report operation.')
    files: dict[str, bytes] = {'operation.json': operation_bytes}
    roles: dict[str, str] = {}
    for role, item in operation['files'].items():
        _, body = retained_file(report, item['path'])
        if len(body) != item['bytes'] or sha(body) != item['sha256']:
            raise ValueError('Retained original file changed: ' + item['path'])
        if item['path'] in files and files[item['path']] != body:
            raise ValueError('Conflicting retained source identities: ' + item['path'])
        files[item['path']] = body
        roles[role] = item['path']
    for role in ('report_html', 'report_pdf', 'report_data'):
        if role not in roles:
            raise ValueError('Completed report is missing original role: ' + role)
    data = json.loads(files[roles['report_data']])
    titles = {roles['report_pdf']: 'Scientific report PDF', roles['report_html']: 'Original report HTML',
              roles['report_data']: 'Complete structured scientific report', 'operation.json': 'Original native report operation'}
    for section in data.get('sections', []):
        for block in section.get('blocks', []):
            if isinstance(block, dict) and block.get('kind') == 'links':
                for link in block['items']:
                    titles.setdefault(link['path'], link['title'])
            if isinstance(block, dict) and block.get('kind') == 'figure':
                titles[block['path']] = block.get('title') or Path(block['path']).name
    figures = [{'path': block['path'], 'title': block.get('title') or 'Original scientific figure'}
               for section in data.get('sections', []) for block in section.get('blocks', [])
               if isinstance(block, dict) and block.get('kind') == 'figure']
    registry = {}
    for name, body in sorted(files.items()):
        registry[name] = {'filename': Path(name).name, 'title': titles.get(name, Path(name).name),
                          'mime_type': mimetypes.guess_type(name)[0] or 'application/octet-stream',
                          'bytes': len(body), 'sha256': sha(body),
                          'content_base64': base64.b64encode(body).decode('ascii')}
    zip_bytes = complete_zip(files)
    bundle = {'filename': stem + '_Report_and_Sources.zip', 'mime_type': 'application/zip',
              'bytes': len(zip_bytes), 'sha256': sha(zip_bytes),
              'content_base64': base64.b64encode(zip_bytes).decode('ascii')}
    original_html = files[roles['report_html']].decode('utf-8')
    if original_html.count('<main>') != 1 or original_html.count('</body>') != 1 or original_html.count('</head>') != 1:
        raise ValueError('Expected the maintained scientific report HTML document.')
    panel = '''<section class="offline-tools" id="offline-report-tools" aria-label="Offline report files">
<h2>Report and original sources</h2>
<p>This file includes the complete report and its retained sources. Data links save original files directly, including when working offline.</p>
<div class="actions"><button type="button" data-download-role="report_pdf" disabled>Download report PDF</button>
<button type="button" data-download-role="zip" disabled>Download complete report and sources</button>
<button type="button" data-download-role="report_data" disabled>Download structured report</button></div>
<details><summary>Browse original files</summary>
<label for="offline-source-filter">Find a retained source</label><input type="search" id="offline-source-filter" placeholder="Watershed, utility, annual, figure…" autocomplete="off">
<label for="offline-source-select">Original file</label><select id="offline-source-select" size="8"></select>
<div class="actions"><button type="button" id="offline-selected-download" disabled>Download selected original file</button></div></details>
<p class="status" id="offline-report-status" role="status" aria-live="polite">Loading the included source files…</p>
<noscript><p>Read the full report below. Enable JavaScript to save the files embedded in this standalone reader.</p></noscript></section>'''
    payload = json.dumps({'schema': VERSION, 'operation_id': operation['operation_id'],
                          'roles': roles, 'files': registry, 'bundle': bundle, 'figures': figures},
                         ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    dialog = '<dialog class="offline-figure-dialog" id="offline-figure-dialog" aria-labelledby="offline-figure-title">' \
             '<h2 id="offline-figure-title">Original scientific figure</h2><div class="figure-controls">' \
             '<button type="button" data-figure-close>Close figure</button><button type="button" data-figure-fit>Fit width</button>' \
             '<button type="button" data-figure-actual>Actual size</button><button type="button" data-figure-save>Download original SVG</button>' \
             '</div><p>Scroll across or down to inspect the original labels and points.</p>' \
             '<div class="offline-figure-scroll" tabindex="0" aria-label="Scrollable original figure"><img alt=""></div></dialog>'
    reader = original_html.replace('</head>',  '<style>' + STYLE + '</style></head>')
    reader = reader.replace('<main>', '<main>' + panel)
    reader = reader.replace('</body>', dialog + '<script type="application/json" id="offline-report-payload">' + payload
                            + '</script><script>' + SCRIPT + '</script></body>')
    output.mkdir(parents=True, exist_ok=True)
    reader_name = stem + '_Offline_Reader.html'
    pdf_name = stem + '_Scientific_Report.pdf'
    products = {reader_name: reader.encode('utf-8'), bundle['filename']: zip_bytes,
                pdf_name: files[roles['report_pdf']]}
    for name, body in products.items():
        write_exact(output / name, body)
    manifest = {'schema': VERSION, 'operation_id': operation['operation_id'],
                'original_operation_sha256': sha(operation_bytes), 'title': data['title'],
                'report_version': data['schema'], 'original_file_count': len(files),
                'original_source_bytes': sum(map(len, files.values())),
                'outputs': {name: {'bytes': len(body), 'sha256': sha(body)} for name, body in products.items()},
                'members': {name: {'bytes': len(body), 'sha256': sha(body)} for name, body in files.items()}}
    write_exact(output / (stem + '_Delivery.json'), (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--stem', default='Scientific_Report')
    args = parser.parse_args()
    result = package(args.report, args.output, args.stem)
    print(json.dumps({key: value for key, value in result.items() if key != 'members'}, indent=2))


if __name__ == '__main__':
    main()
