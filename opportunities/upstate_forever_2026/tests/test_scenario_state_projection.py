"""Original source projection/installation fixtures; no scientific model execution."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]
APPLICATION = Path(os.environ.get('UPSTATE_TEST_APPLICATION', str(SOURCE)))
sys.path.insert(0, str(APPLICATION / 'operator'))
sys.path.insert(0, str(APPLICATION))

def module(name, path):
    specification = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(value)
    return value

registry_source = module('conditional_state_registry', SOURCE / 'operator/extension_registry.py')
installer = module('conditional_scenario_installer', SOURCE / 'operator/apply_scenario_analysis.py')
from model.workspace import Workspace

class Owner:
    team = None
    def __init__(self, workspace):
        self.workspace = workspace
    def ws(self, key):
        return self.workspace

class Projection(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir='/dev/shm')
        self.root = Path(self.temporary.name)
        self.workspace = Workspace(self.root / 'workspace', create=True, title='Source projection fixture')
        self.descriptor = json.loads((SOURCE / 'operator/extensions/scenario-analysis.json').read_text())
        for marker in ['a', 'b']:
            destination = self.workspace.root / 'analyses' / (marker * 64) / 'summary.json'
            destination.parent.mkdir(parents=True)
            destination.write_text(json.dumps({'id': marker * 64, 'state': 'pending', 'fixture': 'source-only'}))
    def tearDown(self):
        self.temporary.cleanup()
    def registry(self, descriptor=None):
        value = registry_source.ExtensionRegistry(Owner(self.workspace), ValueError)
        value.register(descriptor or self.descriptor)
        return value
    def test_existing_native_projection_is_preserved_and_stale_issue_cleared(self):
        value = self.registry()
        rows = self.workspace.overview()['scenario_analyses']
        value._issue('scenario-analysis', 'state', ValueError('earlier overwrite'))
        value._call = lambda *_: self.fail('Existing native state must not invoke the fallback')
        for native in [rows, [], None]:
            result = value.extend_state('original', {'scenario_analyses': native})
            self.assertIs(result['scenario_analyses'], native)
            self.assertEqual(value.manifest()['issues'], [])
    def test_older_workspace_receives_original_provider_projection(self):
        value = self.registry()
        result = value.extend_state('original', {})
        self.assertEqual(result['scenario_analyses'], self.workspace.overview()['scenario_analyses'])
        self.assertEqual(len(result['scenario_analyses']), 2)
    def test_default_state_collision_remains_visible(self):
        self.descriptor['backend']['state'].pop('when_missing')
        value = self.registry()
        native = []
        self.assertIs(value.extend_state('original', {'scenario_analyses': native})['scenario_analyses'], native)
        self.assertIn('overwrite', value.manifest()['issues'][0]['message'])
    def test_flag_is_typed_and_duplicate_extension_owner_is_rejected(self):
        self.descriptor['backend']['state']['when_missing'] = 'true'
        with self.assertRaisesRegex(ValueError, 'explicit boolean'):
            self.registry()
        self.descriptor['backend']['state']['when_missing'] = True
        value = self.registry()
        second = json.loads(json.dumps(self.descriptor))
        second['id'] = 'second-projection'
        second['backend']['actions'] = []
        second['backend']['items'] = []
        second['client'] = {}
        with self.assertRaisesRegex(ValueError, 'already owned'):
            value.register(second)
    def test_exact_installed_source_replay_accepts_matching_current_host(self):
        app = self.root / 'application'
        for name in ['model/workspace.py', 'operator/server.py', 'operator/web/app.mjs']:
            destination = app / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(APPLICATION / name, destination)
        for name in ['operator/extension_registry.py', 'operator/extensions/scenario-analysis.json']:
            destination = app / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / name, destination)
        name = 'operator/extensions/scenario-analysis.json'
        packet = {'files': {name: (app / name).read_text()}, 'prefix': '.',
                  'operator_edits': [], 'registry_files': [name], 'operation_id': 'exact-source-replay'}
        self.assertEqual(installer.apply(app, packet, 'extensions')['changed'], [])
        old = json.loads(packet['files'][name])
        old['backend']['state'].pop('when_missing')
        packet['files'][name] = json.dumps(old)
        (app / name).write_text(packet['files'][name])
        with self.assertRaisesRegex(ValueError, 'matching conditional scenario state'):
            installer.apply(app, packet, 'extensions')

if __name__ == '__main__':
    unittest.main()
