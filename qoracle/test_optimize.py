"""Focused analytical and CLI checks for the local energy optimizer."""

import copy
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from .engine import OracleError, simulate
from .optimize import minimize_energy


class OptimizeTests(unittest.TestCase):
    def test_two_qubit_ground_energy_and_monotone_descent(self):
        path = Path(__file__).parent / "examples/vqe_two_qubit.json"
        problem = json.loads(path.read_text())
        saved = copy.deepcopy(problem)
        result = minimize_energy(**{key: value for key, value in problem.items() if key != "schema"})
        self.assertAlmostEqual(result["final_energy"], -math.sqrt(0.7 ** 2 + 0.6 ** 2), places=10)
        energies = [row["energy"] for row in result["history"]]
        self.assertTrue(all(right < left for left, right in zip(energies, energies[1:])))
        values = simulate(result["optimized_manifest"])["expectations"]
        self.assertAlmostEqual(result["final_energy"], 0.7 * values["ZI"] + 0.6 * values["XX"], places=12)
        self.assertEqual(result["stop_reason"], "gradient_tolerance")
        self.assertEqual(problem, saved)

    def test_budget_and_frozen_gate(self):
        source = {"schema": 1, "qubits": 2, "gates": [{"op": "RY", "wire": 0, "theta": 0.4}, {"op": "RY", "wire": 1, "theta": 0.7}]}
        saved = copy.deepcopy(source)
        result = minimize_energy(source, {"ZI": 1}, [0], max_steps=1)
        self.assertEqual(result["stop_reason"], "max_steps")
        self.assertEqual(result["iterations"], 1)
        self.assertLess(result["final_energy"], result["initial_energy"])
        self.assertEqual(result["optimized_manifest"]["gates"][1]["theta"], 0.7)
        self.assertEqual(source, saved)
        zero = minimize_energy(source, {"ZI": 1}, [0], max_steps=0)
        self.assertEqual(zero["iterations"], 0)
        self.assertEqual(zero["objective_evaluations"], 1)
        self.assertEqual(zero["shifted_circuit_evaluations"], 0)

    def test_stationarity_is_not_global_optimality_and_input_errors(self):
        source = {"schema": 1, "qubits": 1, "gates": [{"op": "RY", "wire": 0, "theta": 0}]}
        result = minimize_energy(source, {"Z": 1})
        self.assertEqual(result["stop_reason"], "gradient_tolerance")
        self.assertAlmostEqual(result["final_energy"], 1)  # A stationary maximum, not ground energy -1.
        for terms in ({}, {"ZZ": 1}, {"Z": True}, {"Z": float("inf")}):
            with self.assertRaises(OracleError):
                minimize_energy(source, terms)
        with self.assertRaises(OracleError):
            minimize_energy(source, {"Z": 1}, max_steps=201)
        with self.assertRaises(OracleError):
            minimize_energy(source, {"Z": 1}, initial_step=0)

    def test_cli_example_and_invalid_input(self):
        root = Path(__file__).resolve().parent.parent
        run = subprocess.run([sys.executable, "-m", "qoracle.optimize", "qoracle/examples/vqe_two_qubit.json"], cwd=root, capture_output=True, text=True, check=True)
        self.assertAlmostEqual(json.loads(run.stdout)["final_energy"], -math.sqrt(0.85), places=10)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text('{"schema":1,"schema":1}')
            run = subprocess.run([sys.executable, str(root / "qoracle/optimize.py"), str(path)], cwd=root, capture_output=True, text=True)
            self.assertEqual(run.returncode, 2)
            self.assertEqual(run.stdout, "")
            self.assertIn("duplicate key", run.stderr)


if __name__ == "__main__":
    unittest.main()
