"""Software negative cases for original annual-load source admission.

These authored rows exercise the source contract; they are not regional data.
"""
import csv
import tempfile
import unittest
from pathlib import Path

from model import calibration_execution, observation_support, observations
from model.common import verify_file
from model.workspace import Workspace


class AnnualCoverageAdmission(unittest.TestCase):
    def ingest(self, **coverage):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = Workspace(root / "workspace", create=True,
                                  title="Software coverage admission case")
            path = root / "negative-case.csv"
            row = {
                "record_id": "SOFTWARE_CASE", "station_id": "SOFTWARE_STATION",
                "catchment_id": "SOFTWARE_CATCHMENT", "parameter": "nitrogen",
                "value": "123.456", "unit": "kg/year", "period_start": "2024-01-01",
                "period_end": "2025-01-01", **coverage,
            }
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(row))
                writer.writeheader()
                writer.writerow(row)
            source = path.read_bytes()
            saved = observations.ingest(workspace, path, {
                "title": "Authored software contract case",
                "source_uri": "software-case:annual-coverage-admission",
                "value_basis": "annual_mass_rate",
                "annualization_method": "Authored test value; no regional estimator",
                "measurement_support": "catchment_export",
            })
            retained = verify_file(workspace.root, {
                "path": saved["original"]["object"], "bytes": saved["original"]["bytes"],
                "sha256": saved["original"]["sha256"],
            })
            self.assertEqual(retained.read_bytes(), source)
            self.assertEqual(saved["rows"][0]["original"], {key: str(value) for key, value in row.items()})
            self.assertEqual(saved["rows"][0]["value_text"], "123.456")
            self.assertEqual(workspace._get("observations", saved["id"]), saved)
            return saved["rows"][0]

    def test_missing_day_cannot_be_admitted_without_complete_flag(self):
        row = self.ingest(coverage_days="365", expected_days="366")
        self.assertFalse(row["admitted"])
        self.assertTrue(any("365" in issue and "366" in issue for issue in row["issues"]))

    def test_complete_flag_cannot_override_missing_day(self):
        row = self.ingest(coverage_days="365", expected_days="366", coverage_complete="true")
        self.assertFalse(row["admitted"])
        self.assertEqual(row["coverage_complete"], True)

    def test_overcoverage_cannot_be_admitted(self):
        row = self.ingest(coverage_days="367", expected_days="366")
        self.assertFalse(row["admitted"])

    def test_empty_coverage_cannot_be_admitted(self):
        row = self.ingest(coverage_days="0", expected_days="0", coverage_complete="true")
        self.assertFalse(row["admitted"])

    def test_complete_leap_year_keeps_original_mass(self):
        row = self.ingest(coverage_days="366", expected_days="366", coverage_complete="true")
        self.assertTrue(row["admitted"])
        self.assertEqual(row["annual_mass"], 123.456)

    def test_legacy_explicit_annual_rate_without_counts_is_preserved(self):
        self.assertTrue(self.ingest()["admitted"])

    def test_declared_incomplete_flag_remains_excluded(self):
        self.assertFalse(self.ingest(coverage_days="366", expected_days="366",
                                     coverage_complete="false")["admitted"])

    def test_metadata_counts_guard_older_retained_rows_without_mutation(self):
        row = {"parameter": "nitrogen", "species": "total nitrogen",
               "quantity_basis": "annual_mass_rate"}
        before = dict(row)
        issues = observation_support.comparison_issues(row, {
            "value_basis": "annual_mass_rate", "coverage_days": 365, "expected_days": 366,
        })
        self.assertTrue(any("365" in issue and "366" in issue for issue in issues))
        self.assertEqual(row, before)

    def test_context_counts_do_not_create_native_load_requirements(self):
        issues = observation_support.comparison_issues({
            "parameter": "nitrogen", "species": "total nitrogen",
            "measurement_support": "concentration", "quantity_basis": "context",
            "coverage_days": 1, "expected_days": 366,
        })
        self.assertFalse(any("coverage" in issue.lower() for issue in issues))

    def test_old_comparison_cannot_bypass_new_admission_on_resume(self):
        candidate = {"native_outputs": {"nitrogen": {}}, "run_id": "SOFTWARE_RUN"}
        original = {"comparison_version": 6, "comparisons": []}
        self.assertFalse(calibration_execution.matching_outputs(
            original, candidate, ["nitrogen"], checkpoint_matches=True))
        current = {"comparison_version": observations.COMPARISON_SCHEMA_VERSION,
                   "comparisons": []}
        self.assertEqual(observations.COMPARISON_SCHEMA_VERSION, 7)
        self.assertFalse(calibration_execution.matching_outputs(
            current, candidate, ["nitrogen"], checkpoint_matches=False))
        self.assertTrue(calibration_execution.matching_outputs(
            current, candidate, ["nitrogen"], checkpoint_matches=True))


if __name__ == "__main__":
    unittest.main()
