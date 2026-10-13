"""Native Workspace binding for retained paired-raster ensemble products.

The original Workspace owns sources, profiles, scenarios and native execution.
This service consumes its finished outputs and never launches another model.
Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
import json
from ..common import MODEL_OUTPUTS, selected_models
from ..native_versions import comparison_versions
from .ensemble_rasters import analyze, UNITS
from .ensemble_store import atomic, digest, identifier, now, read, verify


class EnsembleWorkspace:
    def __init__(self, workspace):
        self.workspace = workspace
        self.root = workspace.root / 'ensemble-products'

    def bind(self, selection):
        if not isinstance(selection, dict):
            raise ValueError('Select a paired ensemble with a JSON object')
        pairs = selection.get('pairs')
        if not isinstance(pairs, list) or not pairs:
            raise ValueError('Select complete profile-matched baseline/alternative pairs')
        pollutants = selection.get('pollutants', list(UNITS))
        if not isinstance(pollutants, list) or not pollutants or len(set(pollutants)) != len(pollutants) or any(p not in UNITS for p in pollutants):
            raise ValueError('Select distinct supported physical pollutant outputs')
        requested_models = {MODEL_OUTPUTS[pollutant][0] for pollutant in pollutants}
        members, seen_profiles, seen_pairs = [], set(), set()
        expected_grid = baseline_scenario = alternative_scenario = None
        profile_refs, original_runs = [], {}
        for row in pairs:
            if not isinstance(row, dict):
                raise ValueError('Each pair must name its original run IDs')
            before = self.workspace.inspect_run(identifier(row['baseline_run_id']))
            after = self.workspace.inspect_run(identifier(row['alternative_run_id']))
            for run in (before, after):
                if run.get('state') != 'complete':
                    raise ValueError('Finish selected native run ' + run['id'] + ' before ensemble analysis')
                if not requested_models.issubset(selected_models(run['selection'])):
                    raise ValueError('Choose pollutant outputs calculated by every selected native run')
            b, a = before['selection'], after['selection']
            if b['profile_id'] != a['profile_id']:
                raise ValueError('Each scenario effect must pair the SAME parameter profile')
            if row.get('profile_id', b['profile_id']) != b['profile_id']:
                raise ValueError('Declared profile differs from the original run selection')
            if row.get('scenario_id', a['scenario_id']) != a['scenario_id']:
                raise ValueError('Declared alternative scenario differs from its original run')
            if a['grid_id'] != b['grid_id']:
                raise ValueError('Each effect requires the same original reporting/model grid')
            if before['id'] == after['id'] or a['scenario_id'] == b['scenario_id']:
                raise ValueError('Select a distinct land-cover/management alternative and baseline')
            current = (b['grid_id'], b['scenario_id'], a['scenario_id'])
            if expected_grid is None:
                expected_grid, baseline_scenario, alternative_scenario = current
            elif current != (expected_grid, baseline_scenario, alternative_scenario):
                raise ValueError('All members must test the same scenario contrast and grid')
            for run in (before, after):
                previous = original_runs.setdefault(run['id'], run)
                if previous != run:
                    raise ValueError('Original native run changed while selecting paired results')
            profile_id = b['profile_id']
            if profile_id in seen_profiles:
                raise ValueError('Duplicate profile would implicitly overweight a tested member')
            seen_profiles.add(profile_id)
            pair_key = digest({'baseline_run_id': before['id'], 'alternative_run_id': after['id']})
            if pair_key in seen_pairs:
                raise ValueError('Duplicate native run pair')
            seen_pairs.add(pair_key)
            profile = self.workspace._get('profiles', profile_id)
            profile_models = selected_models(profile)
            if not requested_models.issubset(profile_models):
                raise ValueError('Choose pollutant outputs supplied by every selected parameter profile')
            if any(name not in profile for name in profile_models):
                raise ValueError('Retain each selected native model section in the original parameter profile')
            profile_refs.append({'profile_id': profile_id, 'title': profile.get('title'),
                                 'references': profile.get('references'),
                                 'table_summary': profile.get('table_summary'),
                                 'source_collection_id': profile.get('source_collection_id'),
                                 'biophysical_source_id': profile.get('biophysical_source_id'),
                                 **{name: profile[name] for name in ('ndr', 'sdr') if name in profile},
                                 **({'models': profile_models} if profile_models != ['ndr', 'sdr'] else {}),
                                 'scientific_status': profile.get('scientific_status', 'unspecified in original profile')})
            member = {'id': pair_key, 'profile_id': profile_id,
                      'baseline_run_id': before['id'], 'alternative_run_id': after['id'],
                      'scenario_id': a['scenario_id'], 'rasters': {}}
            for pollutant in pollutants:
                rasters = {'units': UNITS[pollutant]}
                for side, run in (('baseline', before), ('alternative', after)):
                    artifact = run['artifacts'].get(pollutant)
                    if artifact is None or artifact.get('units') != UNITS[pollutant]:
                        raise ValueError('Original run lacks ' + pollutant + ' in ' + UNITS[pollutant])
                    directory = self.workspace.root / 'runs' / run['id']
                    path = verify(directory, artifact)
                    rasters[side] = {'path': str(path), 'sha256': artifact['sha256'], 'bytes': artifact['bytes']}
                member['rasters'][pollutant] = rasters
            members.append(member)
        # Deterministic ordering makes repeated caller permutations equivalent.
        members.sort(key=lambda m: m['profile_id'])
        profile_refs.sort(key=lambda p: p['profile_id'])
        models = tuple(name for name in ('ndr', 'sdr') if name in requested_models)
        cohort = comparison_versions([original_runs[key] for key in sorted(original_runs)], models)
        versions = set(cohort['versions'].values())
        version = next(iter(versions)) if len(versions) == 1 else None
        runtime_records = {key: {
            'id': key, 'selection': deepcopy(run['selection']),
            'runtime': deepcopy(run.get('runtime')),
            'stages': {name: deepcopy({field: ((run.get('stages') or {}).get(name) or {}).get(field)
                                     for field in ('runtime', 'completed_at', 'reused_from')})
                       for name in models},
        } for key, run in sorted(original_runs.items())}
        grid = self.workspace.get_grid(expected_grid)
        mask = verify(self.workspace.root / 'grids' / expected_grid, grid['files']['reporting_mask'])
        source = {'project_id': self.workspace.project['id'], 'grid_id': expected_grid,
                  'grid_spec': grid.get('spec'), 'grid_sources': grid.get('inputs'),
                  'baseline_scenario': self.workspace._get('scenarios', baseline_scenario),
                  'alternative_scenario': self.workspace._get('scenarios', alternative_scenario),
                  'invest_version': version, 'profiles': profile_refs}
        # Uniform cohorts retain their historical scalar identity. Only genuinely
        # mixed producing stages require an additional per-model identity field.
        if len(versions) != 1:
            source['native_versions'] = deepcopy(cohort['versions'])
        return {'schema': 'upstate.ensemble-input/v1',
                'title': selection.get('title'), 'purpose': selection.get('purpose'),
                'input_description': selection.get('input_description', 'Completed original InVEST profile-matched scenario runs'),
                'input_kind': 'original Workspace native run artifacts',
                'source_references': source, 'members': members, 'pollutants': pollutants,
                'native_provenance': {'cohort': cohort, 'run_records': runtime_records},
                'reporting_mask': str(mask), 'quantiles': selection.get('quantiles', [0.1, 0.5, 0.9]),
                'support': selection.get('support', 'all_pairs'),
                'planned_member_count': selection.get('planned_member_count', len(members)),
                'improvement_thresholds': selection.get('improvement_thresholds', {})}

    def preview(self, selection):
        spec = self.bind(selection)
        return {'members': len(spec['members']), 'pollutants': spec['pollutants'],
                'support': spec['support'], 'source_references': spec['source_references'],
                'quantiles': spec['quantiles'], 'planned_member_count': spec['planned_member_count'],
                'native_version_provenance': spec['native_provenance']['cohort'],
                'effect_direction': 'baseline minus alternative; positive = reduction'}

    def build(self, selection, *, on_progress=None):
        from .ensemble_report import export_reports
        spec = self.bind(selection)
        control = self.root / 'controls' / (digest(selection) + '.json')
        settings = {
            'memory_mb': selection.get('memory_mb', 256),
            'tile_size': selection.get('tile_size', 256),
            'max_open_datasets': selection.get('max_open_datasets', 48),
        }
        recorded = set()
        def retain_settings(key):
            key = identifier(key)
            if key in recorded:
                return
            atomic(self.root / key / 'execution-settings.json', {
                'schema': 'upstate.ensemble-execution-settings/v1',
                'ensemble_id': key, **settings, 'updated_at': now(),
            })
            recorded.add(key)
        def progress(value):
            if value.get('id'):
                retain_settings(value['id'])
            atomic(control, {**value, 'updated_at': now()})
            if on_progress:
                on_progress(value)
        result = analyze(spec, self.root,
                         memory_mb=selection.get('memory_mb', 256),
                         tile_size=selection.get('tile_size', 256),
                         max_open_datasets=selection.get('max_open_datasets', 48),
                         on_progress=progress,
                         should_cancel=lambda: control.with_suffix('.cancel.json').exists())
        if not result.get('reused'):
            retain_settings(result['id'])
        if result['state'] == 'complete':
            # Preserve physical analysis IDs and complete historical archives. The
            # exact stage records are a separately hashed, immutable report input.
            directory = self.root / result['id']
            selected = read(directory / 'analysis.json')['selection']
            provenance = {
                'schema': 'upstate.ensemble-native-provenance/v1',
                'ensemble_id': result['id'], 'selection_sha256': digest(selected),
                'grid': selected['grid'], 'members': selected['members'],
                'source_references_sha256': digest(selected['source_references']),
                **spec['native_provenance'],
            }
            relative = 'native-provenance/' + digest(provenance) + '.json'
            path = directory / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic(path, provenance, immutable=True)
            from .ensemble_store import fingerprint
            reports = export_reports(directory, native_provenance={
                'path': relative, **fingerprint(path)})
            result['reports'] = reports
        atomic(control, {'id': result['id'], 'state': result['state'], 'updated_at': now()})
        return self.describe(result['id'])

    def cancel(self, selection):
        path = self.root / 'controls' / (digest(selection) + '.cancel.json')
        atomic(path, {'requested_at': now(), 'action': 'pause after the current durable tile'})
        return {'cancel_requested': True, 'selection_id': digest(selection)}

    def resume(self, selection, *, on_progress=None):
        path = self.root / 'controls' / (digest(selection) + '.cancel.json')
        path.unlink(missing_ok=True)
        return self.build(selection, on_progress=on_progress)

    def list(self):
        result = []
        for path in sorted(self.root.glob('*/analysis.json')):
            value = read(path)
            result.append({'id': value['id'], 'title': value['selection']['title'],
                           'state': value['state'], 'members': value['selection']['selected_member_count'],
                           'pollutants': value['selection']['pollutants'], 'completed_at': value.get('completed_at')})
        return result

    def describe(self, key):
        key = identifier(key)
        result = read(self.root / key / 'analysis.json')
        if result.get('id') != key or digest(result['selection']) != key:
            raise ValueError('Ensemble selection changed')
        reports = self.root / key / 'reports.json'
        return {**result, 'reports': read(reports) if reports.exists() else {}}

    def execution_settings(self, key):
        """Recover execution controls independently of scientific identity.

        Older editions retain the chosen memory and actual tile edge in
        execution.json. Newer calls also retain handle and requested-edge
        controls once the original kernel has accepted the invocation.
        """
        import math
        key = identifier(key)
        directory = self.root / key
        original_path = directory / 'execution.json'
        original = read(original_path) if original_path.is_file() else {}
        saved_path = directory / 'execution-settings.json'
        saved = read(saved_path) if saved_path.is_file() else {}
        if saved and (saved.get('schema') != 'upstate.ensemble-execution-settings/v1'
                      or saved.get('ensemble_id') != key):
            raise ValueError('Retained execution settings belong to another ensemble')
        settings = {
            'memory_mb': saved.get('memory_mb', original.get('memory_mb', 256)),
            'tile_size': saved.get('tile_size', original.get('tile_edge', 256)),
            'max_open_datasets': saved.get('max_open_datasets', 48),
        }
        memory, edge, handles = (settings['memory_mb'], settings['tile_size'],
                                 settings['max_open_datasets'])
        if (isinstance(memory, bool) or not isinstance(memory, (int, float))
                or not math.isfinite(memory) or memory <= 0):
            raise ValueError('Retain a positive tile-array memory budget')
        if isinstance(edge, bool) or not isinstance(edge, int) or not 1 <= edge <= 2048:
            raise ValueError('Retain a tile edge from 1 to 2048 pixels')
        if isinstance(handles, bool) or not isinstance(handles, int) or handles < 2:
            raise ValueError('Retain at least two open raster handles')
        return settings

    def retained_selection(self, key):
        """Recover the original native pairs and their accepted run controls."""
        result = self.describe(identifier(key))
        stored = result['selection']
        if stored.get('input_kind') != 'original Workspace native run artifacts':
            raise ValueError('Choose an analysis bound to original Workspace native runs')
        pairs = [{
            'profile_id': identifier(row['profile_id']),
            'baseline_run_id': identifier(row['baseline_run_id']),
            'alternative_run_id': identifier(row['alternative_run_id']),
            'scenario_id': identifier(row['scenario_id']),
        } for row in stored['members']]
        for pair in pairs:
            for side in ('baseline_run_id', 'alternative_run_id'):
                self.workspace.inspect_run(pair[side])
        return {
            'title': stored['title'], 'purpose': stored['purpose'],
            'input_description': stored['input_description'], 'pairs': pairs,
            'pollutants': stored['pollutants'], 'quantiles': stored['quantiles'],
            'support': stored['support'],
            'planned_member_count': stored['planned_member_count'],
            'improvement_thresholds': stored['improvement_thresholds'],
            **self.execution_settings(key),
        }

    def portable(self, key, destination, *, include_inputs=False):
        from .ensemble_portable import export_project
        # Native workspace backup is the route for complete original model input
        # editions. The ensemble archive contains complete reusable result data.
        if include_inputs:
            raise ValueError('Use Workspace.backup for the complete original scientific inputs; ensemble export contains complete result rasters and analysis')
        self.describe(key)
        return export_project(self.root / key, destination)
