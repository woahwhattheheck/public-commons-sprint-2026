#!/usr/bin/env python3
"""Receive original Community sources and prepare editable four-watershed work plans.

Uses the maintained Workspace, Communities and report APIs. The original package
is retained as source. New plans are explicitly proposed engineering work, with
new native identities; historical donor records are not rewritten or synthesized.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import zipfile

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from model.common import atomic_json, file_digest, held, verify_file
from model.workspace import Workspace
from model import communities, community_reports


def exact_write(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != body:
            raise ValueError(f"An existing original differs: {path}")
    else:
        with path.open('xb') as out:
            out.write(body)


def extract_original(archive: Path, root: Path) -> dict:
    """Retain a complete bounded input package, rejecting unsafe/duplicate names."""
    with zipfile.ZipFile(archive) as src:
        names = src.namelist()
        if len(names) != len(set(names)) or sum(x.file_size for x in src.infolist()) > 64 * 1024**2:
            raise ValueError('The Community package repeats members or exceeds 64 MiB')
        for item in src.infolist():
            p = Path(item.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in item.filename or item.is_dir():
                raise ValueError('The Community package needs ordinary relative file members')
            if (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('The Community package must not contain symbolic links')
            exact_write(root / p, src.read(item))
    for required in ['receiving/original-table.json', 'receiving/original-plan.json',
                     'receiving/revised-plan.json', 'receiving/revised-report.json',
                     'receiving/original-community-source.csv', 'sources/sources.json',
                     'report/community-report.html', 'receiving/community-report.zip']:
        if not (root / required).is_file():
            raise ValueError('The complete original package is missing ' + required)
    return {'filename': archive.name, 'bytes': archive.stat().st_size,
            'sha256': file_digest(archive), 'members': len(names)}


def planning_tasks(table: dict, watershed: dict, utility: str) -> list[dict]:
    """Author useful production tasks, not claims about completed field activity."""
    huc = watershed['scope_id']
    label = watershed['label']
    specifications = [
        ('SOURCE', 'Reconcile source editions and review geography', 'investigate',
         'Establish one documented production input set for the named focus watershed.',
         'Record the source edition, dates, grid, masks and missing inputs. Retain original Table 1 memberships; keep whole block-group context separate from watershed geometry.'),
        ('SCREEN', 'Prepare source-water opportunity screening', 'investigate',
         'Translate the selected catchment and retained environmental layers into a reviewable engineering work product.',
         'Join available land cover, stream, protection and parcel layers; identify candidate reaches or lands for expert review. Record criteria and layer lineage. Use only native results with matching reporting geography; leave unavailable quantities blank.'),
        ('FIELD', 'Prepare reconnaissance and access-screening package', 'monitor',
         'Make the desktop shortlist usable for a later authorized field review.',
         'Prepare candidate reference IDs, location map, observation fields, access questions and a blank reconnaissance checklist. Separate proposed visits from completed observations; confirm access before a visit.'),
        ('RETURN', 'Assemble editable review and GIS handback', 'other',
         'Deliver a repeatable work product the scientific prime can review and revise.',
         'Export the selected map/data sources, criteria, plan and original-source report. Capture reviewer changes as a new saved plan. Reopen the received project and preserve original source and revision history.'),
    ]
    return [{'id': f'{utility}-{huc}-{suffix}', 'title': title + ': ' + label,
             'utility_id': utility, 'watershed_id': huc, 'geoids': watershed['geoids'],
             'priority': 'medium', 'strategy': strategy, 'status': 'proposed',
             'reason': reason, 'owner': 'Unassigned', 'next_step': next_step,
             'cost_estimate_usd': None,
             'notes': 'Proposed production task prepared from the retained RFP source. Priority is an editable planning default, not a scientific risk ranking.'}
            for suffix, title, strategy, reason, next_step in specifications]


def produce(package: Path, workspace_path: Path, output: Path) -> dict:
    workspace = Workspace(workspace_path)
    output.mkdir(parents=True, exist_ok=True)
    with held(output / '.community-production.lock', blocking=False):
        result_path = output / 'community-production.json'
        if result_path.exists():
            previous = json.loads(result_path.read_text())
            if previous['project_id'] != workspace.project['id'] or previous['input']['sha256'] != file_digest(package):
                raise ValueError('The saved production belongs to another project or input edition')
            for row in previous['reports']:
                actual = workspace._get(communities.REPORT_KIND, row['report_id'])
                for record in actual['files'].values():
                    verify_file(workspace.root, record)
            return previous
        before = {k: [r['id'] for r in workspace._list(k)]
                  for k in (communities.TABLE_KIND, communities.PLAN_KIND, communities.REPORT_KIND)}
        source = output / 'source'
        original = source / 'original'
        incoming = extract_original(package, original)
        exact_write(source / package.name, package.read_bytes())
        old_table = json.loads((original / 'receiving/original-table.json').read_text())
        old_plan = json.loads((original / 'receiving/revised-plan.json').read_text())
        old_report = json.loads((original / 'receiving/revised-report.json').read_text())
        csv = original / 'receiving/original-community-source.csv'
        if file_digest(csv) != old_table['source']['sha256']:
            raise ValueError('Original Table 1 bytes differ from the retained native table')
        source_record = next(c for c in old_plan['context']['snapshots']['source_collections']
                             if c['id'] == old_table['source']['collection_id'])
        entry = next(e for e in source_record['entries'] if e['id'] == old_table['source']['source_id'])
        entry = {k: deepcopy(v) for k, v in entry.items() if k not in ('body', 'companions')}
        entry.update(path='original/receiving/original-community-source.csv', sha256=file_digest(csv))
        archive_entry = {'id': 'ORIGINAL_COMMUNITY_RECEIVING_PACKAGE', 'kind': 'document',
                         'title': 'Original Lower Six and Twenty Creek Community report and receiving files',
                         'uri': entry['uri'], 'vintage': entry['vintage'],
                         'path': package.name, 'sha256': incoming['sha256'],
                         'provenance': {'original_table_id': old_table['id'],
                                        'original_plan_id': old_plan['id'], 'original_report_id': old_report['id']},
                         'companions': [{'path': 'original/' + p.relative_to(original).as_posix(),
                                         'sha256': file_digest(p)}
                                        for p in sorted(original.rglob('*')) if p.is_file()]}
        manifest = {'schema': 'upstate.sources/v1', 'title': 'Original RFP community table and completed report input',
                    'captured_at': source_record['captured_at'], 'entries': [entry, archive_entry],
                    'notes': ['Complete original incoming package retained. New engineering plans use new native identifiers.']}
        atomic_json(source / 'sources.json', manifest, immutable=True)
        received = workspace.import_sources(source / 'sources.json')
        geometry = workspace.import_sources(original / 'sources/sources.json')
        table = communities.import_table(workspace, {'source_collection_id': received['id'],
                      'source_id': old_table['source']['source_id'], 'title': old_table['title']})
        if table['summaries'] != old_table['summaries'] or table['groups'] != old_table['groups']:
            raise ValueError('Receiving changed the original community totals or memberships')
        context = {'source_collection_ids': [received['id'], geometry['id']]}
        tasks = []
        for watershed in table['summaries']['watersheds']:
            utility = next(m['utility_id'] for g in table['groups'] for m in g['memberships']
                           if m['watershed_id'] == watershed['scope_id'])
            tasks.extend(planning_tasks(table, watershed, utility))
        selections = [('programme', 'Four-watershed Community engineering programme', {}, tasks)]
        for watershed in table['summaries']['watersheds']:
            huc = watershed['scope_id']
            selections.append((huc, watershed['label'] + ' engineering work plan',
                               {'watershed_ids': [huc]}, [t for t in tasks if t['watershed_id'] == huc]))
        for utility in table['metadata']['utilities']:
            selections.append((utility['id'], utility['name'] + ' engineering programme',
                               {'utility_ids': [utility['id']]}, [t for t in tasks if t['utility_id'] == utility['id']]))
        reports = []
        notes = ['Whole-block-group counts use the original RFP table; they are not populations clipped to watersheds or estimates of pollutant exposure.',
                 'Service populations, model reporting areas and community membership remain separate.',
                 'All work items are proposed. Costs and individual owners are unset for the prime to choose.',
                 'Original completed Lower Six and Twenty Creek report and CSV history are retained under Sources.']
        for slug, title, selection, work_items in selections:
            plan = communities.save_plan(workspace, {'table_id': table['id'], 'title': title,
                'purpose': 'Prepare repeatable source-water engineering production and editable review for the four RFP focus watersheds.',
                'selection': selection, 'context': context, 'interventions': work_items, 'notes': notes})
            report = community_reports.build(workspace, {'plan_id': plan['id'], 'title': title})
            dest = output / 'reports' / slug
            for name, record in report['files'].items():
                exact_write(dest / name, verify_file(workspace.root, record).read_bytes())
            reports.append({'scope': slug, 'plan_id': plan['id'], 'report_id': report['id'],
                            'title': title, 'summary': plan['summaries']['all'], 'tasks': len(work_items)})
        # The original revised plan also becomes an explicitly source-derived receiving
        # counterpart. The donor identity remains provenance, never a forged registry.
        counterpart = communities.save_plan(workspace, {'table_id': table['id'],
            'title': old_plan['title'] + ' (source-derived receiving copy)', 'purpose': old_plan['purpose'],
            'selection': old_plan['selection'], 'context': context,
            'interventions': old_plan['interventions'], 'notes': old_plan['notes'] + [
                'Received from original saved plan ' + old_plan['id'] + '; original record retained in Sources.']})
        counterpart_report = community_reports.build(workspace, {'plan_id': counterpart['id']})
        for name, record in counterpart_report['files'].items():
            exact_write(output / 'reports' / 'original-plan-received' / name,
                        verify_file(workspace.root, record).read_bytes())
        result = {'schema': 'upstate.community-production/v1', 'project_id': workspace.project['id'],
                  'input': incoming, 'source_collection_id': received['id'], 'geometry_source_collection_id': geometry['id'],
                  'table_id': table['id'], 'original_table_id': old_table['id'], 'original_plan_id': old_plan['id'],
                  'received_counterpart_plan_id': counterpart['id'], 'received_counterpart_report_id': counterpart_report['id'],
                  'task_count': len(tasks), 'original_record_ids_preserved': before,
                  'reports': reports, 'status': 'prepared',
                  'scope': 'Native editable community production plans; all proposed work, original source counts.'}
        atomic_json(result_path, result, immutable=True)
        return result


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package', required=True, type=Path)
    p.add_argument('--workspace', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args()
    try:
        value = produce(a.package.resolve(strict=True), a.workspace.resolve(strict=True), a.output.resolve())
        print(json.dumps(value, indent=2, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
