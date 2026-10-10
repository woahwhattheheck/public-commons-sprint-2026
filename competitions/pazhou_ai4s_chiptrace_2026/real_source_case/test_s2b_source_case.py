import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("s2b_source_case", HERE / "s2b_source_case.py")
case_mod = importlib.util.module_from_spec(SPEC)
sys.modules["s2b_source_case"] = case_mod
SPEC.loader.exec_module(case_mod)

CSV = Path(os.environ.get("CHIPTRACE_S2B_CSV", str(HERE / "data" / "cervix_chip_teer_supp_s2b.csv")))
META = Path(os.environ.get("CHIPTRACE_S2B_METADATA", str(HERE / "data" / "adapter_metadata.json")))
CORE = Path(os.environ.get("CHIPTRACE_CORE", str(HERE.parent / "chiptrace.py")))


@unittest.skipUnless(CSV.exists() and META.exists() and CORE.exists(), "frozen source CSV, metadata or core not present")
class S2BSourceCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "a"
        cls.case = case_mod.build_case(CSV, META, CORE, cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_observed_and_absent_cells_per_group(self):
        self.assertEqual([g["key"] for g in self.case["groups"]], ["cervix_chip", "transwell"])
        for g in self.case["groups"]:
            self.assertEqual(g["grid_cell_count"], 72)
            self.assertEqual(g["observed_cell_count"], 36)
            self.assertEqual(g["absent_cell_count"], 36)
            self.assertEqual(sum(len(s["observations"]) for s in g["series"]), 36)

    def test_cell_rows_and_time_origin(self):
        for g in self.case["groups"]:
            for s in g["series"]:
                for o in s["observations"]:
                    self.assertEqual(o["cell"][0], s["series_column"])
                    self.assertEqual(int(o["cell"][1:]), o["source_day"] + 6)
                    self.assertEqual(o["time_s"], float((o["source_day"] + 3) * 86400))
                    self.assertTrue(o["source"].endswith("Supp Fig. S2b, " + o["cell"]))

    def test_wrapper_never_supports_biology_or_promotes_labels(self):
        self.assertEqual(self.case["dispositions"]["biological_quality"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(self.case["dispositions"]["source_identity"], "SOURCE_IDENTITY_UNVERIFIED")
        summaries = [g["self_reference_replay"] for g in self.case["groups"]] + [f["core"] for f in self.case["fault_controls"]]
        self.assertEqual(len(summaries), 5)
        for s in summaries:
            self.assertEqual(s["biological_quality_disposition"], "INSUFFICIENT_EVIDENCE")
            self.assertEqual(s["source_identity"], "SOURCE_IDENTITY_UNVERIFIED")
            self.assertTrue(s["core_receipt_verifies"])
        text = json.dumps(self.case)
        self.assertNotIn("verified_chip", text)
        for g in self.case["groups"]:
            for s in g["series"]:
                self.assertTrue(s["replicate_id"].startswith("unverified_source_series_"))

    def test_fault_controls_keep_lineage_and_add_nothing(self):
        for f in self.case["fault_controls"]:
            self.assertEqual(f["tag"], "synthetic_fault_injection")
            self.assertLessEqual(f["rows_generated"], f["rows_parent"])
            lines = (self.out / "work" / f["candidate_file"]).read_text(encoding="utf-8").splitlines()[1:]
            self.assertEqual(len(lines), f["rows_generated"])
            for line in lines:
                self.assertIn("synthetic_fault_injection:" + f["id"], line)
                self.assertIn(case_mod.EXPECTED["csv_sha256"], line)
            parents = {entry["parent_cell"][0] for entry in f["lineage"]}
            columns = next(g["columns"] for g in case_mod.GROUPS if g["key"] == f["group"])
            self.assertTrue(parents <= set(columns))

    def test_groups_not_pooled_and_subsets_byte_exact(self):
        parent_lines = set(CSV.read_bytes().splitlines(keepends=True))
        for g in self.case["groups"]:
            rows = (self.out / "work" / g["measured_subset"]["file"]).read_bytes().splitlines(keepends=True)[1:]
            self.assertEqual(len(rows), 36)
            self.assertEqual({r.split(b",", 1)[0] for r in rows}, {g["run_id"].encode("utf-8")})
            self.assertTrue(set(rows) <= parent_lines)

    def test_deterministic_outputs(self):
        out_b = Path(self.tmp.name) / "b"
        second = case_mod.build_case(CSV, META, CORE, out_b)
        self.assertEqual(second["case_receipt_sha256"], self.case["case_receipt_sha256"])
        self.assertEqual((out_b / "case.html").read_bytes(), (self.out / "case.html").read_bytes())

    def test_tampered_csv_rejected(self):
        tampered = Path(self.tmp.name) / "tampered.csv"
        tampered.write_bytes(CSV.read_bytes().replace(b"998.6754", b"998.6755", 1))
        with self.assertRaises(case_mod.SourceCaseError):
            case_mod.build_case(tampered, META, CORE, Path(self.tmp.name) / "c")

    def test_public_outputs_omit_local_paths(self):
        text = (self.out / "case.json").read_text(encoding="utf-8")
        for key in ("workbook_path", "csv_path", "current_public_report_rules"):
            self.assertNotIn(key, text)

    def test_html_labels(self):
        page = (self.out / "case.html").read_text(encoding="utf-8")
        self.assertEqual(page.count("Synthetic fault-control copies appear only"), 1)
        self.assertIn("ABSENT", page)
        self.assertIn("SOURCE_IDENTITY_UNVERIFIED", page)
        self.assertIn("differentiation day 0 (time_s 259200)", page)
        self.assertNotIn("<polyline", page)


if __name__ == "__main__":
    unittest.main()
