"""MIT. One complete native product journey; optional full-volume source editions."""
from pathlib import Path
import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import time
from workspace import Workspace, InputError

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, help='New private directory for the retained journey')
    parser.add_argument('--rows', type=int, default=0, help='Additional generated full-volume records, up to 1000000')
    args = parser.parse_args()
    if not 0 <= args.rows <= 1000000:
        parser.error('--rows must be from 0 to 1000000')
    root = Path(args.out).absolute()
    root.mkdir(mode=0o700, exist_ok=False)
    start = time.monotonic()
    first = (HERE / 'examples/inventory.xml').read_bytes()
    second = first.replace(b'<i:units>12</i:units>', b'<i:units>15</i:units>').replace(b'sku="0003"', b'sku="0004"').replace(b'<i:', b'<z:').replace(b'</i:', b'</z:').replace(b'xmlns:i=', b'xmlns:z=')
    mapping = json.loads((HERE / 'examples/mapping.json').read_text())
    with Workspace(root / 'sender', create=True) as ws:
        a = ws.add_source(io.BytesIO(first), 'Original inventory')
        b = ws.add_source(io.BytesIO(second), 'Changed inventory')
        plan = ws.save_plan(mapping)
        x = ws.build(a['id'], plan['id']); y = ws.build(b['id'], plan['id'])
        q = ws.query(x['id'], {'limit': '2', 'sort': '-units'})['response']['body']
        assert q['rows'][0]['sku'] == '9007199254740993'
        assert q['rows'][0]['price'] == '1234.5000000000000000001'
        assert q['rows'][0]['note'] == 'Use slowly.' and q['rows'][0]['tags'] == '["a","b"]'
        cursor = q['page']['nextCursor']
        assert ws.query(x['id'], {'limit': '2', 'sort': '-units', 'cursor': cursor})['response']['body']['rows'][0]['units'] is None
        assert ws.query(y['id'], {'limit': '2', 'sort': '-units', 'cursor': cursor})['response']['status'] == 409
        delta = ws.compare(x['id'], y['id'])
        assert delta['counts'] == {'added': 1, 'removed': 1, 'changed': 1, 'unchanged': 1}
        packet = ws.export_packet(y['id'], root / 'project.zip')
        ws.export_dataset(y['id'], root / 'native-dataset')
        for invalid in [b'<!DOCTYPE x [<!ENTITY e "x">]><x>&e;</x>', b'<x><unclosed></x>']:
            try: ws.add_source(io.BytesIO(invalid))
            except InputError: pass
            else: raise AssertionError('Invalid source accepted')
        empty_map = ws.save_plan({**mapping, 'allowEmpty': True})
        empty_source = ws.add_source(io.BytesIO(b'<inventory xmlns="urn:inventory"/>'))
        before = ws.build(a['id'], empty_map['id']); empty = ws.build(empty_source['id'], empty_map['id'])
        assert ws.compare(before['id'], empty['id'])['counts']['removed'] == 3
    with Workspace(root / 'receiver', create=True) as receiver:
        restored = receiver.import_packet(root / 'project.zip')
        assert restored['build']['id'] == y['id']
        assert restored['build']['native']['snapshot'] == y['native']['snapshot']
    # Separate process, separate native loader, exact original retained IDs.
    reopened = subprocess.run([sys.executable, str(HERE / 'cli.py'), '--workspace', str(root / 'receiver'),
        'query', '--build', y['id'], '--params', '{"where_sku":"9007199254740993"}'],
        capture_output=True, text=True, check=True, timeout=120)
    assert json.loads(reopened.stdout)['response']['body']['rows'][0]['units'] == 15
    merchant = subprocess.run([os.environ.get('SF30_XML_NODE', 'node'), str(HERE / 'acceptance.mjs'),
        str(root / 'native-dataset/dataset.json')], capture_output=True, text=True, check=True, timeout=60)
    report = {'source': 'generated fictional inventory', 'first': x, 'second': y,
        'comparison': delta, 'packet': packet, 'merchant': json.loads(merchant.stdout)}
    if args.rows:
        n = args.rows
        large_map = {'schema': 'stellar-forge.xml-mapping.v1', 'name': 'Generated full-volume inventory',
            'recordPath': ['inventory', 'item'], 'columns': [
                {'name': 'sku', 'path': [], 'attribute': 'sku', 'type': 'string'},
                {'name': 'units', 'path': ['units'], 'type': 'integer'},
                {'name': 'price', 'path': ['price'], 'type': 'string'}],
            'keys': ['sku'], 'filters': ['sku'], 'ranges': ['units'], 'sorts': ['units'],
            'maxRows': n, 'maxBytes': 256 * 1024 * 1024}
        for edition in [0, 1]:
            with (root / f'volume-{edition}.xml').open('w') as stream:
                stream.write('<inventory>\n')
                for i in range(n):
                    units = i % 1000 + (1 if edition and i % 100 == 0 else 0)
                    stream.write(f'<item sku="{9007199254740993+i}"><units>{units}</units><price>0.0100000000000000001</price></item>\n')
                stream.write('</inventory>\n')
        volume_start = time.monotonic()
        with Workspace(root / 'volume', create=True) as ws:
            plan = ws.save_plan(large_map); builds = []
            for edition in [0, 1]:
                with (root / f'volume-{edition}.xml').open('rb') as stream:
                    source = ws.add_source(stream, f'Full edition {edition}')
                builds.append(ws.build(source['id'], plan['id']))
            changes = ws.compare(builds[0]['id'], builds[1]['id'])
            assert changes['counts']['changed'] == (n+99)//100
            assert changes['counts']['unchanged'] == n-(n+99)//100
            assert ws.query(builds[1]['id'], {'where_sku': '9007199254740993'})['response']['body']['rows'][0]['units'] == 1
            ws.export_packet(builds[1]['id'], root / 'volume.zip')
        with Workspace(root / 'volume-receiver', create=True) as receiver:
            restored = receiver.import_packet(root / 'volume.zip')
            assert restored['build']['native']['snapshot'] == builds[1]['native']['snapshot']
            assert restored['build']['rowCount'] == n
        report['volume'] = {'rowsPerEdition': n, 'counts': changes['counts'],
            'xmlBytes': (root / 'volume-0.xml').stat().st_size, 'csvBytes': builds[1]['files']['data.csv']['bytes'],
            'seconds': round(time.monotonic()-volume_start, 3), 'snapshot': builds[1]['native']['snapshot']}
    report['seconds'] = round(time.monotonic()-start, 3)
    (root / 'result.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'root': str(root), 'seconds': report['seconds'], 'merchant': report['merchant'],
        'volume': report.get('volume'), 'comparison': delta['counts']}, indent=2))


if __name__ == '__main__':
    main()
