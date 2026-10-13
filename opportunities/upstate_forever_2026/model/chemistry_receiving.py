"""Reopen original chemistry selections and artifacts inside workspace receiving."""
from .chemistry import Chemistry
from .common import identifier, verify_file


def verify_all(workspace):
    service = Chemistry(workspace)
    cases = {}
    for saved in workspace._list('chemistry-cases'):
        case = service.get_case(saved['id'])
        cases[case['id']] = case
    for case in cases.values():
        if case.get('parent_id') and case['parent_id'] not in cases:
            raise ValueError('Chemical scenario is missing its original parent edition')
    runs = 0
    for path in sorted(service.root.glob('*/run.json')):
        key = identifier(path.parent.name)
        run = service.get_run(key)
        case = cases.get(run['case_id'])
        selection = run['selection']
        if (case is None or selection.get('case_id') != case['id']
                or selection.get('project_sha256') != case['project_sha256']):
            raise ValueError('Chemical analysis belongs to a different retained scenario')
        if run.get('calibrated_case_id') and run['calibrated_case_id'] not in cases:
            raise ValueError('Chemical analysis is missing its calibrated scenario')
        service._verified_artifacts(key, run)
        if run.get('checkpoint'):
            verify_file(service.root / key, run['checkpoint'])
        runs += 1
    from .chemistry_reports import verify_all as verify_reports
    reports = verify_reports(workspace)
    from .chemistry_report_source import verify_workspace
    report_sources = verify_workspace(workspace)
    return {'cases': len(cases), 'runs': runs, 'scientific_reports': reports['reports'],
            'scientific_report_sources': report_sources}
