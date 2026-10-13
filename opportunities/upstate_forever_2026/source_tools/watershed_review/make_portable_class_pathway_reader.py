#!/usr/bin/env python3
"""Create a standalone class-pathway reader with exact tables and saved questions."""
from __future__ import annotations

import argparse
import base64
import hashlib
import html as html_tools
import json
import os
import re
import tempfile
from pathlib import Path, PurePosixPath

DOWNLOADS = ('subject-summary.csv', 'group-quantities.csv', 'criterion-pathways.csv',
             'class-pathways.csv', 'analysis.json')
PROJECT = 'Upper_Savannah_Review_Project.json'


def build(delivery: Path, output: Path) -> dict[str, object]:
    """Create an additive reading edition; preserve the complete native delivery."""
    root = delivery.resolve(strict=True)
    manifest = json.loads((root / 'MANIFEST.json').read_text(encoding='utf-8'))
    if manifest.get('schema') != 'upstate.utility-class-attribution-files/v1':
        raise ValueError('Expected the completed original class-pathway delivery manifest.')
    entries = manifest.get('files')
    if not isinstance(entries, list):
        raise ValueError('The original delivery manifest has no file list.')
    by_path = {item['path']: item for item in entries}
    if len(by_path) != len(entries):
        raise ValueError('The original delivery manifest contains duplicate paths.')

    def original(name: str) -> bytes:
        relative = PurePosixPath(name)
        if relative.is_absolute() or any(x in ('', '.', '..') for x in name.split('/')):
            raise ValueError('Expected a canonical relative original path.')
        candidate = root / name
        if candidate.is_symlink() or not candidate.resolve(strict=True).is_relative_to(root):
            raise ValueError('Expected an original file inside the delivery: ' + name)
        body = candidate.read_bytes()
        spec = by_path.get(name)
        if not spec or len(body) != spec['bytes'] or hashlib.sha256(body).hexdigest() != spec['sha256']:
            raise ValueError('Original delivery member differs from its manifest: ' + name)
        return body

    def data_uri(name: str, body: bytes) -> str:
        media_type = 'application/json' if name.endswith('.json') else 'text/csv'
        return 'data:' + media_type + ';charset=utf-8;base64,' + base64.b64encode(body).decode('ascii')

    source = original('OPEN_FIRST.html')
    document = source.decode('utf-8')
    embedded = []
    for name in DOWNLOADS:
        body = original(name)
        needle = 'href="' + name + '" download'
        if document.count(needle) != 1:
            raise ValueError('Expected one original download link: ' + name)
        document = document.replace(needle, 'href="' + data_uri(name, body) + '" download="' + name + '"', 1)
        embedded.append({'path': name, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})

    # Join the original queued question to its existing watershed, without editing the project.
    project_bytes = original('originals/' + PROJECT)
    project = json.loads(project_bytes)
    if project.get('schema') != 'upstate.watershed-review/v1' or project.get('source_edition') != manifest['source_edition']:
        raise ValueError('Saved review project and original class-pathway edition differ.')
    queued = []
    for huc, note in project.get('notes', {}).items():
        if not isinstance(note, dict) or not note.get('queued'):
            continue
        if not re.fullmatch(r'\d{12}', huc):
            raise ValueError('Invalid queued HUC identifier.')
        marker = '<div id="subject-huc12:' + huc + '" class="subject"'
        if document.count(marker) != 1:
            raise ValueError('Queued watershed is absent or duplicated in the reader: ' + huc)
        start = document.index(marker)
        anchor = document.index('<div style="overflow-x:auto">', start)
        close = document.index('</section></div>', start)
        if anchor >= close:
            raise ValueError('Expected the original watershed table after its heading.')
        question = html_tools.escape(str(note.get('question', '')))
        narrative = html_tools.escape(str(note.get('notes', '')))
        if not question:
            raise ValueError('Queued watershed has no original review question: ' + huc)
        block = ('<aside class="review-question"><h4>Saved review question</h4><p>' + question + '</p>'
                 '<details><summary>Read the original review note</summary><p>' + narrative + '</p></details></aside>')
        document = document[:anchor] + block + document[anchor:]
        queued.append(huc)
    if not queued:
        raise ValueError('The original project has no queued review questions.')
    marker = '</ul><p>The groups overlap by design.'
    if document.count(marker) != 1:
        raise ValueError('Expected the original downloads list.')
    project_link = ('<li><a href="' + data_uri(PROJECT, project_bytes) + '" download="' + PROJECT + '">'
                    'Saved review project (JSON)</a></li>')
    document = document.replace(marker, project_link + marker, 1)
    embedded.append({'path': PROJECT, 'bytes': len(project_bytes),
                     'sha256': hashlib.sha256(project_bytes).hexdigest()})

    # Reading-only presentation repairs. Full precision stays in the unchanged downloads.
    document = document.replace('includes class21,', 'includes class 21,')
    document = document.replace('among21–24', 'among 21–24')
    analysis = json.loads(original('analysis.json'))
    pattern = r'paired native cell area ([0-9.eE+\-]+) ha\.'
    matches = list(re.finditer(pattern, document))
    if len(matches) != 1 or float(matches[0].group(1)) != analysis['cell_area_ha']:
        raise ValueError('Expected the unchanged native cell-area footer.')
    document = re.sub(pattern, f"paired native cell area {analysis['cell_area_ha']:.4g} ha (full precision in analysis.json).", document, count=1)
    document = document.replace('<h2>Complete original-derived tables</h2>', '<h2>Tables and saved review</h2>', 1)
    if document.count('</style>') != 1:
        raise ValueError('Expected one original stylesheet.')
    styles = ('.review-question{border:1px solid #d1d1d1;background:#f6f6f5;padding:14px;margin:16px 0}'
              '.review-question h4{font-size:1rem;margin:0 0 8px}.review-question p{margin:8px 0}'
              '.review-question summary{cursor:pointer;text-decoration:underline;text-underline-offset:3px}'
              '.downloads a{overflow-wrap:anywhere}')
    document = document.replace('</style>', styles + '</style>', 1)
    data = document.encode('utf-8')

    if output.is_symlink():
        raise ValueError('The output must be a new regular file, not a symbolic link.')
    target = output.resolve(strict=False)
    if target == root or root in target.parents:
        raise ValueError('Choose an output outside the unchanged native delivery directory.')
    target.parent.mkdir(parents=True, exist_ok=True)
    # Publish complete bytes atomically; never replace an existing or concurrent edition.
    staged = None
    try:
        with tempfile.NamedTemporaryFile(prefix='.' + target.name + '-', suffix='.tmp',
                                         dir=target.parent, delete=False) as stream:
            staged = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(staged, target)
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)
    return {'schema': 'upstate.utility-class-portable-reader/v1',
            'output': str(target), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'original_html_sha256': hashlib.sha256(source).hexdigest(),
            'source_edition': manifest['source_edition'], 'queued_questions': queued,
            'embedded_downloads': embedded,
            'presentation': ['Original saved review question and expandable note beside each queued watershed',
                             'Readable class-label spacing and native cell-area footer',
                             'All original table/analysis downloads and saved review project embedded unchanged']}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--delivery', required=True, type=Path,
                        help='Complete original 20-file delivery directory.')
    parser.add_argument('--output', required=True, type=Path,
                        help='New standalone HTML file; existing files are preserved.')
    args = parser.parse_args()
    try:
        result = build(args.delivery, args.output)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, 'Portable reader: ' + str(error) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
