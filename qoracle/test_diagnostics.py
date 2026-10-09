"""Analytical checks for gradient and partial-trace functionality only."""

import copy
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from .diagnostics import expectation_gradients, reduced_state
from .engine import OracleError, load_manifest, simulate


def manifest(qubits, gates, observables=()):
    return load_manifest(json.dumps({"schema": 1, "qubits": qubits, "gates": gates, "observables": list(observables)}))


class DiagnosticsTests(unittest.TestCase):
    def test_rx_ry_rz_analytical_derivatives(self):
        theta = 0.37
        cases = [
            ("RX", [], {"X": 0, "Y": -math.cos(theta), "Z": -math.sin(theta)}),
            ("RY", [], {"X": math.cos(theta), "Y": 0, "Z": -math.sin(theta)}),
            ("RZ", [{"op": "H", "wire": 0}], {"X": -math.sin(theta), "Y": math.cos(theta), "Z": 0}),
        ]
        for op, prefix, expected in cases:
            with self.subTest(op=op):
                source = manifest(1, prefix + [{"op": op, "wire": 0, "theta": theta}], expected)
                saved = copy.deepcopy(source)
                result = expectation_gradients(source)
                self.assertEqual(result["shifted_evaluations"], 2)
                for label, value in expected.items():
                    self.assertAlmostEqual(result["gradients"][0]["expectation_derivatives"][label], value, places=12)
                self.assertEqual(source, saved)

    def test_entangled_shared_occurrences_and_large_angle(self):
        theta = 0.23
        shared = manifest(1, [{"op": "RY", "wire": 0, "theta": theta}] * 2, ["Z"])
        result = expectation_gradients(shared, [1, 0])
        self.assertEqual([row["gate_index"] for row in result["gradients"]], [1, 0])
        self.assertAlmostEqual(sum(row["expectation_derivatives"]["Z"] for row in result["gradients"]), -2 * math.sin(2 * theta))
        entangled = manifest(2, [{"op": "RY", "wire": 0, "theta": theta}, {"op": "CNOT", "control": 0, "target": 1}], ["XX", "ZZ"])
        values = expectation_gradients(entangled)["gradients"][0]["expectation_derivatives"]
        self.assertAlmostEqual(values["XX"], math.cos(theta))
        self.assertAlmostEqual(values["ZZ"], 0)
        large = manifest(1, [{"op": "RY", "wire": 0, "theta": 1e20}], ["Z"])
        self.assertAlmostEqual(expectation_gradients(large)["gradients"][0]["expectation_derivatives"]["Z"], -math.sin(1e20))

    def test_bell_partial_trace_and_complex_pure_state(self):
        bell = manifest(2, [{"op": "H", "wire": 0}, {"op": "CNOT", "control": 0, "target": 1}])
        one = reduced_state(bell, [0])
        self.assertAlmostEqual(one["purity"], 0.5)
        self.assertAlmostEqual(one["trace"], 1)
        self.assertEqual(one["density_matrix"][0][1], [0.0, 0.0])
        self.assertAlmostEqual(reduced_state(bell, [0, 1])["purity"], 1)
        plus_i = manifest(1, [{"op": "H", "wire": 0}, {"op": "S", "wire": 0}])
        pure = reduced_state(plus_i, [0])
        self.assertAlmostEqual(pure["density_matrix"][0][1][1], -0.5)
        self.assertAlmostEqual(pure["density_matrix"][1][0][1], 0.5)
        self.assertAlmostEqual(pure["purity"], 1)

    def test_wire_order_matches_existing_marginals(self):
        source = manifest(3, [{"op": "X", "wire": 0}, {"op": "H", "wire": 2}, {"op": "CNOT", "control": 2, "target": 1}])
        for wires, occupied in (([2, 0], [2, 3]), ([0, 2], [1, 3])):
            result = reduced_state(source, wires)
            self.assertEqual(result["wires"], wires)
            expected = simulate(dict(source, probability_wires=wires))["probabilities"]
            for got, want in zip(result["probabilities"], expected):
                self.assertAlmostEqual(got, want)
            self.assertEqual([i for i, p in enumerate(result["probabilities"]) if p > 0.1], occupied)

    def test_invalid_requests(self):
        source = manifest(2, [{"op": "H", "wire": 0}, {"op": "RY", "wire": 1, "theta": 0.2}], ["ZZ"])
        for indices in ([0], [1, 1], [True], [-1], [2], []):
            with self.assertRaises(OracleError):
                expectation_gradients(source, indices)
        for wires in ([0, 0], [False], [2], []):
            with self.assertRaises(OracleError):
                reduced_state(source, wires)
        with self.assertRaises(OracleError):
            reduced_state(manifest(7, []), list(range(7)))
        with self.assertRaises(OracleError):
            expectation_gradients(dict(source, observables=[]))
        with self.assertRaises(OracleError):
            expectation_gradients(manifest(1, [{"op": "RY", "wire": 0, "theta": 0.1}] * 33, ["Z"]))

    def test_cli_module_direct_and_legacy_verify(self):
        root = Path(__file__).resolve().parent.parent
        source = manifest(1, [{"op": "RY", "wire": 0, "theta": 0.4}], ["Z"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.json"
            path.write_text(json.dumps(source), encoding="utf-8")
            result = subprocess.run([sys.executable, "-m", "qoracle.cli", "gradient", str(path)], cwd=root, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout)["analysis"], "expectation_gradients")
            result = subprocess.run([sys.executable, str(root / "qoracle/cli.py"), "reduced-state", str(path), "--wires", "0"], cwd=root, capture_output=True, text=True, check=True)
            self.assertAlmostEqual(json.loads(result.stdout)["purity"], 1)
            expected = simulate(source)
            candidate = Path(directory) / "candidate.json"
            candidate.write_text(json.dumps({key: expected[key] for key in ("probabilities", "expectations")}), encoding="utf-8")
            result = subprocess.run([sys.executable, "-m", "qoracle.cli", "verify", str(path), str(candidate)], cwd=root, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout)["state"], "MATCH")
            result = subprocess.run([sys.executable, "-m", "qoracle.cli", "gradient", str(path), "--gates", "4"], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")
            self.assertIn("out-of-range", result.stderr)


if __name__ == "__main__":
    unittest.main()
