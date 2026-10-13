"""Whole output retention on the existing application's identities and queue."""
import tempfile, unittest, shutil
from pathlib import Path
import pandas as pd
from ecsa_runs.workspace_adapter import WorkspaceRetention

class ExistingWorkspaceJourney(unittest.TestCase):
    def test_original_identity_receive_and_lossless_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); native=root/'native';native.mkdir()
            weather=native/'weather.csv';weather.write_text('rain\n1.25\n')
            raster=native/'native-result.bin';raster.write_bytes(bytes(range(256))*8192)
            result={'family':'GTModel','run_id':'native-run-008',
                'scenario_id':'scenario-original-003','native_output':str(raster),
                'series':pd.DataFrame({'station':['001','002'],'value':[1.25,None]})}
            vault=WorkspaceRetention(root/'vault','project-original-001')
            metadata=vault.retain('existing-job-009',result,attempt=2,model_family='GTModel',
                run_id=result['run_id'],scenario_id=result['scenario_id'],inputs={'existing':'unchanged'},
                input_files={'weather':weather},output_pointers=('/native_output',))
            self.assertEqual(metadata,vault.retain('existing-job-009',result,attempt=2,
                model_family='GTModel',run_id=result['run_id'],scenario_id=result['scenario_id'],
                inputs={'existing':'unchanged'},input_files={'weather':weather},output_pointers=('/native_output',)))
            with self.assertRaises(ValueError):
                vault.retain('existing-job-009',{**result,'extra':1},attempt=2,
                    model_family='GTModel',run_id=result['run_id'])
            self.assertEqual(vault.store.list(),[])
            vault.export(root/'received.ecsar')
            shutil.rmtree(native);shutil.rmtree(vault.store.root)
            received=WorkspaceRetention.receive(root/'received.ecsar',root/'receiver','project-original-001')
            restored=received.load('existing-job-009',2)
            self.assertEqual(set(result),set(restored))
            self.assertEqual(restored['run_id'],result['run_id'])
            pd.testing.assert_frame_equal(restored['series'],result['series'])
            self.assertEqual(Path(restored['native_output']).read_bytes(),bytes(range(256))*8192)
            self.assertEqual(Path(received.inputs('existing-job-009',2)['files'][0]['local_path']).read_text(),'rain\n1.25\n')
            self.assertEqual(received.store.list(),[])
            # New native attempt is explicit; existing editions remain addressable.
            next_result={**restored,'run_id':'native-run-010'}
            received.retain('existing-job-009',next_result,attempt=3,model_family='GTModel',
                run_id='native-run-010',output_pointers=('/native_output',))
            self.assertEqual(received.load('existing-job-009',2)['run_id'],'native-run-008')
            self.assertEqual(received.load('existing-job-009',3)['run_id'],'native-run-010')

if __name__=='__main__': unittest.main()
