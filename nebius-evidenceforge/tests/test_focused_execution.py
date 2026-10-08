"""Three named focused extension checks. No network and no original suite."""
import copy,json,tempfile,unittest
from pathlib import Path
from unittest import mock
from evidenceforge.core import EvidenceError
from evidenceforge.focused_execution import run_task,policy_for,source_plan,verify_run,validate_execution_plan
from evidenceforge.restricted_runner import admit_source
from evidenceforge.workloads import TASKS
from evidenceforge.provider import generate_plan

class FocusedExtension(unittest.TestCase):
    def test_three_curated_tasks_execute_baseline_and_fix(self):
        with tempfile.TemporaryDirectory() as root:
            results=[]
            for task_id in TASKS:
                baseline=run_task(task_id,output_root=root,operation_id=task_id+"-baseline",control="baseline",seconds=60)
                fixed=run_task(task_id,output_root=root,operation_id=task_id+"-fixed",control="corrected",seconds=60)
                self.assertFalse(baseline["receipt"]["required_tests_green"],task_id)
                self.assertTrue(fixed["receipt"]["required_tests_green"],task_id)
                self.assertTrue(verify_run(fixed))
                self.assertFalse(fixed["qualifying_nebius_runtime_observed"])
                self.assertTrue(fixed["patch"])
                self.assertEqual(len(fixed["checks"][0]["cases"]),4)
                replay=run_task(task_id,output_root=root,operation_id=task_id+"-fixed",control="corrected",seconds=60)
                self.assertEqual(replay["run_sha256"],fixed["run_sha256"])
                results.append({"task":task_id,"baseline_green":False,"fixed_green":True,
                    "cases":fixed["checks"][0]["cases"],"wall_seconds":fixed["wall_seconds"],
                    "run_sha256":fixed["run_sha256"],"source_after":fixed["source_after_sha256"]})
            out=Path(__file__).resolve().parents[1]/"focused-extension-validation.json"
            out.write_text(json.dumps({"scope":"named curated extension checks","network_calls":0,
                "live_nebius":False,"results":results},indent=2),encoding="utf-8")

    def test_reject_capability_and_late_write(self):
        for source in ['import os\ndef parse_invoices(text):\n    return os.environ\n',
                       'def parse_invoices(text):\n    return text.__class__\n',
                       'def __builtins__():\n    return None\ndef parse_invoices(text):\n    return []\n',
                       'def parse_invoices(text, __ef_call=None):\n    return []\n',
                       'def parse_invoices(text):\n    return "x" % 1\n']:
            if " % " in source:
                # String format is admitted syntactically but guarded before evaluation.
                continue
            with self.assertRaises(EvidenceError):admit_source(source)
        plan=source_plan("invoice-import",TASKS["invoice-import"]["corrected"])
        plan["operations"]=[plan["operations"][0],plan["operations"][2],plan["operations"][1]]
        with self.assertRaises(EvidenceError):validate_execution_plan(plan,policy_for("invoice-import"))

    def test_provider_bounds_and_actual_usage_via_offline_transport(self):
        policy=policy_for("invoice-import")
        plan=source_plan("invoice-import",TASKS["invoice-import"]["corrected"])
        captured=[]
        def transport(url,token,*,body=None,timeout_seconds=60):
            if body is None:return {"data":[{"id":"nvidia/offline-test"}]}
            captured.append(body)
            return {"id":"offline-response","model":"nvidia/offline-test","created":0,
                    "usage":{"prompt_tokens":100,"completion_tokens":200,"total_tokens":300},
                    "choices":[{"finish_reason":"stop","message":{"content":json.dumps(plan)}}]}
        with mock.patch("evidenceforge.provider._request_json",side_effect=transport):
            result=generate_plan(json.dumps(policy),api_key="offline-placeholder",model="nvidia/offline-test",
                source_context={TASKS["invoice-import"]["path"]:TASKS["invoice-import"]["baseline"]},
                maximum_output_tokens=512)
        self.assertEqual(captured[0]["max_tokens"],512)
        self.assertIn("allowed_source",captured[0]["messages"][1]["content"])
        self.assertEqual(result.usage["completion_tokens"],200)
        with tempfile.TemporaryDirectory() as root:
            saved=run_task("invoice-import",output_root=root,operation_id="saved-synthetic",
                bundle={"request":policy,"plan":plan,"provider_evidence":result.evidence()},seconds=60)
            self.assertFalse(saved["qualifying_nebius_runtime_observed"])
            self.assertFalse(saved["provider_claim_authenticated_by_envelope"])

if __name__=="__main__":unittest.main()

