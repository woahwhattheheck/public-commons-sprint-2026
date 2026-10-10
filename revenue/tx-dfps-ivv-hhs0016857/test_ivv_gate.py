"""One focused source-artifact integrity regression; tempfile fixtures are not customer data."""
import copy
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from ivv_gate import audit


class IvvEvidenceFocusedTest(unittest.TestCase):
    def test_offline_acceptance_and_rejection_vectors(self):
        with TemporaryDirectory(prefix='tx-ivv-focused-') as tmp:
            root=Path(tmp);(root/'artifacts').mkdir()
            artifact=root/'artifacts'/'real-bytes.txt'
            artifact.write_bytes(b'original sample bytes used for an actual digest')
            manifest={
                'schema':'tj-ivv-evidence/v1','baseline':'baseline-001',
                'review_as_of':'2026-10-10T09:00:00Z',
                'implementer_org':'Implementer A',
                'requirements':[{'id':'R-01','critical':True,'required_tests':['T-01','T-02']}],
                'observations': [
                    {'id':f'O-{i}','requirement_id':'R-01','test_id':f'T-0{i}',
                     'baseline':'baseline-001','outcome':'pass','observed_at':f'2026-10-10T08:0{i}:00Z',
                     'reviewer_org':'Independent B','artifact_path':'artifacts/real-bytes.txt',
                     'sha256':sha256(artifact.read_bytes()).hexdigest()} for i in (1,2)
                ]}
            path=root/'manifest.json'
            self.assertTrue(audit(manifest,path)['pass'])
            artifact.write_bytes(b'tampered sample bytes')
            out=audit(manifest,path)
            self.assertFalse(out['pass'])
            self.assertEqual([i['code'] for i in out['issues']],['ARTIFACT_HASH_MISMATCH']*2)
            artifact.write_bytes(b'original sample bytes used for an actual digest')
            same_org=copy.deepcopy(manifest)
            same_org['observations'][0]['reviewer_org']='implementer a'
            self.assertIn('REVIEWER_NOT_INDEPENDENT', [i['code'] for i in audit(same_org,path)['issues']])
            missing=copy.deepcopy(manifest)
            missing['observations'].pop()
            self.assertEqual(audit(missing,path)['requirements'][0]['tests']['T-02'],'MISSING')
            stale=copy.deepcopy(manifest)
            stale['observations'][0]['baseline']='older-baseline'
            self.assertIn('BASELINE_DRIFT',[i['code'] for i in audit(stale,path)['issues']])
            orphan=copy.deepcopy(manifest)
            orphan['observations'][1]['requirement_id']='other'
            self.assertIn('ORPHAN_REQUIREMENT',[i['code'] for i in audit(orphan,path)['issues']])
            future=copy.deepcopy(manifest)
            future['observations'][1]['observed_at']='2027-10-10T08:00:00Z'
            self.assertIn('FUTURE_OBSERVATION',[i['code'] for i in audit(future,path)['issues']])


if __name__=='__main__':
    unittest.main()
