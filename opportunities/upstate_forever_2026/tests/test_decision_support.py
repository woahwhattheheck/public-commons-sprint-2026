"""Authored handoff regressions; these are not regional scientific evidence."""
import copy
import importlib.util
import os
from pathlib import Path
import unittest

module_path = Path(__file__).resolve().parent.parent / "model" / "decision_analysis.py"
if not module_path.is_file():
    module_path = Path(__file__).with_name("decision_analysis.py")
spec = importlib.util.spec_from_file_location("decision_analysis", os.environ.get(
    "DECISION_MODULE", str(module_path)))
decision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(decision)


def ident(n):
    return f"{n:064x}"


def fixture():
    base = {"run_id": ident(1), "scenario_id": ident(2), "scenario_key": ident(3),
            "profile_id": ident(4), "grid_id": ident(5), "invest_version": "test",
            "outputs": {"phosphorus_export": {"total": 100, "units": "kg/year"}}}
    alternatives = []
    for n, mass in ((10, 80), (20, 70)):
        alternatives.append({"run_id": ident(n), "scenario_id": ident(n+1),
            "scenario_key": ident(n+2), "profile_id": ident(4), "kind": "landcover",
            "label": "Authored test alternative", "outputs": {"phosphorus_export": {
                "baseline": 100, "alternative": mass, "reduction": 100-mass,
                "delta": mass-100, "reduction_percent": 100-mass, "units": "kg/year",
                "comparison_valid_cells": 10, "support": {"status": "paired", "id": ident(40)}}}})
    packet = {"schema": decision.INPUT_SCHEMA, "project": {"id": ident(50)},
        "comparisons": [{"id": ident(60), "baseline": base, "alternatives": alternatives}],
        "sources": [{"sha256": ident(70), "path": "authored-test-source.json"}]}
    selection = {"schema": decision.SELECTION_SCHEMA, "title": "Authored support validation",
                 "comparison_id": ident(60)}
    return packet, selection


class SupportValidation(unittest.TestCase):
    def test_consistent_shared_support_preserves_decision(self):
        packet, selection = fixture()
        report = decision.analyze_packet(packet, selection)
        self.assertEqual(report["frontier"]["frontier_ids"], [ident(20)])
        self.assertEqual(report["alternatives"][0]["outputs"]["phosphorus_export"]["reduction"], 20)

    def test_inconsistent_baseline_rejected_before_ranking(self):
        packet, selection = fixture()
        output = packet["comparisons"][0]["alternatives"][1]["outputs"]["phosphorus_export"]
        output.update(baseline=200, alternative=170, reduction_percent=15)
        with self.assertRaisesRegex(decision.DecisionError, "Identical support"):
            decision.analyze_packet(packet, selection)

    def test_same_mass_different_cell_count_rejected(self):
        packet, selection = fixture()
        packet["comparisons"][0]["alternatives"][1]["outputs"]["phosphorus_export"]["comparison_valid_cells"] = 11
        with self.assertRaisesRegex(decision.DecisionError, "Identical support"):
            decision.analyze_packet(packet, selection)

    def test_fractional_cell_count_rejected(self):
        packet, selection = fixture()
        packet["comparisons"][0]["alternatives"][0]["outputs"]["phosphorus_export"]["comparison_valid_cells"] = 10.5
        with self.assertRaisesRegex(decision.DecisionError, "integer"):
            decision.analyze_packet(packet, selection)

    def test_distinct_supports_can_have_distinct_baselines(self):
        packet, selection = fixture()
        output = packet["comparisons"][0]["alternatives"][1]["outputs"]["phosphorus_export"]
        output.update(baseline=200, alternative=170, reduction_percent=15)
        output["support"]["id"] = ident(41)
        report = decision.analyze_packet(packet, selection)
        self.assertEqual(len(report["frontier"]["groups"]), 2)

    def test_different_profile_baselines_are_not_forced_equal(self):
        packet, selection = fixture()
        member = copy.deepcopy(packet["comparisons"][0])
        member["id"] = ident(61)
        member["baseline"].update(run_id=ident(101), profile_id=ident(104))
        member["baseline"]["outputs"]["phosphorus_export"]["total"] = 200
        for alternative in member["alternatives"]:
            alternative["profile_id"] = ident(104)
            alternative["run_id"] = ident(int(alternative["run_id"], 16) + 100)
            output = alternative["outputs"]["phosphorus_export"]
            output["baseline"] = 200
            output["alternative"] += 100
            output["reduction_percent"] /= 2
        packet["comparisons"].append(member)
        selection["sensitivity_comparison_ids"] = [ident(61)]
        report = decision.analyze_packet(packet, selection)
        self.assertTrue(report["alternatives"][0]["sensitivity"]["complete"])


if __name__ == "__main__":
    unittest.main()
