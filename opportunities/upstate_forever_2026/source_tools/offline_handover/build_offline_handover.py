#!/usr/bin/env python3
"""Build an offline original-record handover without recalculating study science.

Reads the maintained report's study-data JSON, or an explicit equivalent JSON.
All originals and code under the study directory are retained in a companion ZIP
and embedded as individually downloadable, byte-identical files. Python 3.10+.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
from html.parser import HTMLParser
import json
import mimetypes
from pathlib import Path
import sys
import zipfile
from io import BytesIO

DIMENSIONS = ['station_id','group','characteristic','fraction','comparison_unit','sample_media',
 'sample_media_subdivision','depth_value','depth_unit','depth_reference',
 'result_depth_value','result_depth_unit','result_depth_reference','method_context',
 'method_id','method_name','method_specification','result_value_type','temperature_basis','weight_basis',
 'analytical_fraction']

class StudyData(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.capture = False
        self.parts: list[str] = []
    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('id') == 'study-data':
            self.capture = True
    def handle_endtag(self, tag):
        if tag == 'script': self.capture = False
    def handle_data(self, data):
        if self.capture: self.parts.append(data)

def sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()

def expand_records(value: dict) -> dict:
    """Expand a retained column table without changing any original response."""
    columns = value.get('record_columns')
    if value.get('encoding') == 'column-row-tables':
        if (not isinstance(columns, list) or not columns
                or any(not isinstance(key, str) or not key for key in columns)
                or len(set(columns)) != len(columns)):
            raise ValueError('The original record columns must be distinct nonempty names.')
        expanded = []
        for cells in value['records']:
            if not isinstance(cells, list) or len(cells) != len(columns):
                raise ValueError('An original compact record has a different column count.')
            expanded.append(dict(zip(columns, cells)))
        value = dict(value)
        value['records'] = expanded
        value['source_record_encoding'] = value['encoding']
        value['encoding'] = 'record-objects'
    tables = value.get('source_tables', {})
    for record in value['records']:
        if not isinstance(record, dict):
            raise ValueError('Every expanded source record must be an object.')
        interval = record.get('interval')
        if not isinstance(interval, dict):
            raise ValueError('Every record needs its maintained interval object.')
        record['comparison_unit'] = (record.get('interval_unit')
                                    or interval.get('unit') or record.get('unit') or '')
        table = tables.get(record.get('source_file'))
        if table is None:
            continue
        table_columns, table_rows = table.get('columns'), table.get('rows')
        row_number = record.get('source_row')
        if (not isinstance(table_columns, list) or not table_columns
                or any(not isinstance(key, str) or not key for key in table_columns)
                or len(set(table_columns)) != len(table_columns)
                or not isinstance(table_rows, list)
                or isinstance(row_number, bool) or not isinstance(row_number, int)
                or not 2 <= row_number <= len(table_rows) + 1):
            raise ValueError('The original source table or row selector is invalid.')
        cells = table_rows[row_number - 2]
        if not isinstance(cells, list) or len(cells) != len(table_columns):
            raise ValueError('An original source row has a different column count.')
        original = dict(zip(table_columns, cells))
        if (original.get('ResultIdentifier') != record.get('result_id')
                or original.get('ActivityIdentifier') != record.get('activity_id')):
            raise ValueError('The original source row changed its result or activity identity.')
        record['original'] = original
        record['source_sha256'] = table.get('sha256', '')
    return value

def load_study(root: Path, report: str, data: Path | None) -> tuple[dict, bytes, str]:
    if data:
        raw = data.read_bytes()
        value = json.loads(raw)
        source = data.name
    else:
        report_path = (root / report).resolve(strict=True)
        if not report_path.is_relative_to(root):
            raise ValueError('Report path must be inside the study directory.')
        raw = report_path.read_bytes()
        parser = StudyData()
        parser.feed(raw.decode('utf-8-sig'))
        if not parser.parts:
            raise ValueError('Maintained report has no study-data JSON. Supply --data with its original summary/records JSON.')
        value = json.loads(''.join(parser.parts))
        source = report
    if not isinstance(value, dict) or not isinstance(value.get('records'), list):
        raise ValueError('Study data must contain the original records array.')
    if not isinstance(value.get('summary'), dict):
        raise ValueError('Study data must contain its original summary object.')
    value = expand_records(value)
    ids = set()
    for row in value['records']:
        if not isinstance(row, dict) or not row.get('record_id'):
            raise ValueError('Every record needs its original record_id.')
        if row['record_id'] in ids:
            raise ValueError('Duplicate original record_id: '+row['record_id'])
        ids.add(row['record_id'])
        if not isinstance(row.get('interval'), dict):
            raise ValueError('Every record needs its maintained interval object.')
    return value, raw, source

def build(root: Path, output: Path, *, report: str = 'report.html',
          data: Path | None = None, title: str | None = None) -> dict:
    root = root.resolve(strict=True)
    output = output.resolve()
    if output.is_relative_to(root):
        raise ValueError('Write the new handover outside the retained study to avoid recursive packaging.')
    study, original_report, source_name = load_study(root, report, data)
    assets = []
    packed = BytesIO()
    # No mutable cache files or credentials are expected in an authored source study.
    # A symlink or private runtime directory is rejected rather than followed.
    paths = sorted(p for p in root.rglob('*') if p.is_file() or p.is_symlink())
    if len(paths) > 10000:
        raise ValueError('Select a source study, not an entire runtime or workspace.')
    total = 0
    with zipfile.ZipFile(packed, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in paths:
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                raise ValueError('Source study contains a symlink: '+relative)
            if any(part in {'.git','.env','operator-state','__pycache__'} for part in path.relative_to(root).parts):
                raise ValueError('Select an authored source study without runtime/private directories: '+relative)
            body = path.read_bytes()
            total += len(body)
            if total > 256 * 1024 * 1024:
                raise ValueError('Study exceeds the 256 MiB offline handover budget.')
            info = zipfile.ZipInfo(relative, (1980,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, body)
            assets.append({'path':relative,'bytes':len(body),'sha256':sha(body),
                'mime':mimetypes.guess_type(relative)[0] or 'application/octet-stream',
                'data':base64.b64encode(body).decode('ascii')})
    zipped = packed.getvalue()
    data_body = json.dumps(study, ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode('utf-8')
    package = {'schema':'upstate.offline-original-record-handover/v1',
        'title': title or 'Original water-quality observations',
        'study':study,'dimensions':DIMENSIONS,
        'binding':{'source':source_name,'source_sha256':sha(original_report),
                   'study_sha256':sha(data_body),'records':len(study['records'])},
        'files':assets,'zip':{'name':output.stem+'-original-study.zip',
                            'sha256':sha(zipped),'bytes':len(zipped),
                            'data':base64.b64encode(zipped).decode('ascii')}}
    # Escaping '<' prevents original text from closing the non-executable JSON node.
    encoded = json.dumps(package, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    encoded = encoded.replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    template = Path(__file__).with_name('offline_handover.html').read_text('utf-8')
    if template.count('__STUDY_PACKAGE__') != 1:
        raise ValueError('Offline template is missing its single data insertion point.')
    html = template.replace('__STUDY_PACKAGE__', encoded)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding='utf-8')
    zip_path = output.with_name(package['zip']['name'])
    zip_path.write_bytes(zipped)
    manifest = {key:value for key,value in package.items() if key not in {'study','files','zip'}}
    manifest.update(files=[{k:v for k,v in item.items() if k!='data'} for item in assets],
        original_study_zip={k:v for k,v in package['zip'].items() if k!='data'},
        html={'name':output.name,'bytes':output.stat().st_size,'sha256':sha(output.read_bytes())})
    output.with_suffix('.manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    return {'html':str(output),'zip':str(zip_path),'records':len(study['records']),
            'original_files':len(assets),'original_bytes':total,'study_sha256':sha(data_body)}

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('study_root', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', default='report.html')
    parser.add_argument('--data', type=Path)
    parser.add_argument('--title')
    args = parser.parse_args()
    try:
        result = build(args.study_root, args.output, report=args.report,
                       data=args.data, title=args.title)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print('Handover: '+str(error), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
