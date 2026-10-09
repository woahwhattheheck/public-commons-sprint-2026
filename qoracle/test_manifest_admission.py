"""Focused malformed-input admission checks for the independent QOracle.

Only stdlib JSON and local QOracle functions are exercised. No external services,
credentialed engines or broad repository suites.
"""
from __future__ import annotations

import json
import random
import unittest

from qoracle.engine import OracleError, load_manifest, simulate, strict_loads, verify


def manifest(**changes):
    body = {"schema": 1, "qubits": 1, "gates": []}
    body.update(changes)
    return json.dumps(body, allow_nan=False)


class ManifestAdmissionTest(unittest.TestCase):
    def test_unhashable_and_wrong_type_gate_ops_use_oracle_error(self):
        for op in ([], {}, [1], {"op": "H"}, True, 1, None):
            with self.subTest(op=op), self.assertRaises(OracleError):
                load_manifest(manifest(gates=[{"op": op, "wire": 0}]))

    def test_schema_requires_literal_integer_one(self):
        for invalid in (True, False, 1.0, "1", None, [], {}):
            with self.subTest(schema=invalid), self.assertRaises(OracleError):
                load_manifest(manifest(schema=invalid))
        self.assertEqual(load_manifest(manifest())["schema"], 1)

    def test_large_rotation_integer_rejected_as_oracle_error(self):
        huge = 10 ** 400
        with self.assertRaises(OracleError):
            load_manifest(manifest(gates=[{"op": "RX", "wire": 0, "theta": huge}]))
        with self.assertRaises(OracleError):
            load_manifest('{"schema":1,"qubits":1,"gates":[{"op":"RY","wire":0,"theta":1e999}]}')

    def test_large_verify_tolerance_and_schema_rejected(self):
        actual = load_manifest(manifest())
        for invalid in (True, False, 1.0, "1", None, [], {}):
            with self.subTest(schema=invalid), self.assertRaises(OracleError):
                verify(actual, json.dumps({"schema": invalid, "probabilities": [1, 0]}))
        with self.assertRaises(OracleError):
            verify(actual, json.dumps({"probabilities": [1, 0], "tolerance": 10 ** 400}))

    def test_python_decoder_limits_are_normalized(self):
        with self.assertRaises(OracleError):
            strict_loads("[" * 2000 + "0" + "]" * 2000)
        with self.assertRaises(OracleError):
            strict_loads("9" * 5000)

    def test_seeded_4096_shape_admissions_only_return_oracle_contract(self):
        rng = random.Random(20261009)
        values = [None, True, False, 0, 1, 1.0, [], {}, [1],
                  {"nested": [1]}, "H", "RX", "CNOT", "SWAP", "invalid"]
        for case in range(4096):
            gate = {
                "op": rng.choice(values),
                "wire": rng.choice(values),
            }
            if rng.randrange(3) == 0:
                gate["theta"] = rng.choice(values + [10 ** 400, 0.25])
            if rng.randrange(3) == 0:
                gate["control"] = rng.choice(values)
                gate["target"] = rng.choice(values)
            if rng.randrange(3) == 0:
                gate["wire_a"] = rng.choice(values)
                gate["wire_b"] = rng.choice(values)
            try:
                accepted = load_manifest(manifest(gates=[gate]))
                self.assertEqual(accepted["gates"][0]["op"], gate["op"])
            except OracleError:
                pass
            except Exception as exc:
                self.fail(f"unhandled {type(exc).__name__} at seed=20261009 case={case}: {gate!r}")

    def test_valid_bell_and_pauli_y_behavior_preserved(self):
        bell = load_manifest(manifest(qubits=2,
            gates=[{"op": "H", "wire": 0},
                   {"op": "CNOT", "control": 0, "target": 1}],
            observables=["ZZ", "XX", "YY"]))
        result = simulate(bell)
        self.assertAlmostEqual(result["probabilities"][0], 0.5)
        self.assertAlmostEqual(result["probabilities"][3], 0.5)
        self.assertAlmostEqual(result["expectations"]["ZZ"], 1.0)
        self.assertAlmostEqual(result["expectations"]["XX"], 1.0)
        self.assertAlmostEqual(result["expectations"]["YY"], -1.0)
        self.assertEqual(verify(bell, json.dumps({
            "probabilities": result["probabilities"],
            "expectations": result["expectations"]}))["state"], "MATCH")


if __name__ == "__main__":
    unittest.main()
