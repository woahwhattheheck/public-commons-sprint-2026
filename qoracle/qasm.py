"""Bounded OpenQASM 2 interchange for QOracle's unitary circuit subset.

No includes are opened and no expressions are executed. Terminal measurements
are represented as ordered probability_wires; reset and classical control are
rejected rather than simulated incorrectly.
"""
from __future__ import annotations

import argparse
import ast
import math
import re
import sys
from pathlib import Path
from typing import Any

from .engine import MAX_GATES, MAX_QUBITS, OracleError, canonical, load_manifest

MAX_SOURCE_BYTES = 262_144
_REF = re.compile(r"([a-z][A-Za-z0-9_]*)\s*(?:\[\s*([0-9]+)\s*\])?\Z")
_DECL = re.compile(r"(qreg|creg)\s+([a-z][A-Za-z0-9_]*)\s*\[\s*([0-9]+)\s*\]\Z")
_RESERVED = {"qreg", "creg", "gate", "opaque", "measure", "reset", "barrier", "if", "include", "pi"}
_FIXED = {"h": "H", "x": "X", "y": "Y", "z": "Z", "s": "S", "t": "T"}
_ROT = {"rx": "RX", "ry": "RY", "rz": "RZ"}


def read_source(path: str) -> str:
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise OracleError(f"source exceeds {MAX_SOURCE_BYTES} bytes")
    return data.decode("utf-8")


def _angle(expression: str) -> float:
    if not expression or len(expression) > 256 or not re.fullmatch(r"[0-9.eEpi+*/()\s-]+", expression, re.ASCII):
        raise OracleError("angle must use decimal numbers, pi, parentheses and + - * /")
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except (SyntaxError, RecursionError) as exc:
        raise OracleError("malformed angle expression") from exc
    if sum(1 for _ in ast.walk(tree)) > 128:
        raise OracleError("angle expression is too complex")

    def visit(node: ast.AST, depth: int = 0) -> float:
        if depth > 24:
            raise OracleError("angle expression is too deep")
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            value = float(node.value)
        elif isinstance(node, ast.Name) and node.id == "pi":
            value = math.pi
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = visit(node.operand, depth + 1) * (-1 if isinstance(node.op, ast.USub) else 1)
        elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            left, right = visit(node.left, depth + 1), visit(node.right, depth + 1)
            if isinstance(node.op, ast.Add):
                value = left + right
            elif isinstance(node.op, ast.Sub):
                value = left - right
            elif isinstance(node.op, ast.Mult):
                value = left * right
            else:
                value = left / right
        else:
            raise OracleError("unsupported angle expression")
        if not math.isfinite(value):
            raise OracleError("angle must be finite")
        return value

    try:
        return visit(tree.body)
    except (OverflowError, ZeroDivisionError) as exc:
        raise OracleError("angle overflow or division by zero") from exc


def _refs(text: str, registers: dict[str, list[int]]) -> list[int]:
    match = _REF.fullmatch(text.strip())
    if not match or match[1] not in registers:
        raise OracleError("unknown or malformed register reference")
    wires = registers[match[1]]
    if match[2] is None:
        return wires
    index = int(match[2])
    if index >= len(wires):
        raise OracleError("register index is out of range")
    return [wires[index]]


def _operation(statement: str) -> tuple[str, list[float], list[str]]:
    match = re.match(r"([A-Za-z][A-Za-z0-9_]*)\b", statement)
    if not match:
        raise OracleError("malformed operation")
    name, rest = match[1], statement[match.end():].strip()
    params: list[float] = []
    if rest.startswith("("):
        depth, end = 0, None
        for index, char in enumerate(rest):
            depth += (char == "(") - (char == ")")
            if depth > 24:
                raise OracleError("angle expression is too deep")
            if depth == 0:
                end = index
                break
        if end is None:
            raise OracleError("unterminated gate parameters")
        params = [_angle(part.strip()) for part in rest[1:end].split(",")]
        rest = rest[end + 1:].strip()
    if not rest:
        raise OracleError("operation has no register operands")
    return name, params, [part.strip() for part in rest.split(",")]


def load_qasm(text: str) -> dict[str, Any]:
    """Import supported QASM 2, flattening qregs in declaration order."""
    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise OracleError("QASM source must be bounded UTF-8 text")
    source = re.sub(r"//[^\n]*", "", text).strip()
    if not source.endswith(";"):
        raise OracleError("QASM statements must end with semicolons")
    statements = [part.strip() for part in source[:-1].split(";")]
    if not statements or not re.fullmatch(r"OPENQASM\s+2\.0", statements[0]):
        raise OracleError("expected OPENQASM 2.0 header")
    qregs: dict[str, list[int]] = {}
    cregs: dict[str, list[int]] = {}
    gates: list[dict[str, Any]] = []
    measured: dict[int, int] = {}
    qubits = classical = 0
    included = started = measurement_started = False
    for ordinal, statement in enumerate(statements[1:], 2):
        try:
            if not statement:
                raise OracleError("empty statement")
            if re.fullmatch(r'include\s+"qelib1\.inc"', statement):
                if included or started:
                    raise OracleError("qelib1.inc must be included once before operations")
                included = True
                continue
            declaration = _DECL.fullmatch(statement)
            if declaration:
                if started:
                    raise OracleError("register declarations must precede operations")
                kind, name, size_text = declaration.groups()
                size = int(size_text)
                if name in qregs or name in cregs or name in _RESERVED:
                    raise OracleError("duplicate or reserved register name")
                if not 1 <= size <= MAX_QUBITS:
                    raise OracleError("register size exceeds the oracle limit")
                if kind == "qreg":
                    qregs[name] = list(range(qubits, qubits + size))
                    qubits += size
                else:
                    cregs[name] = list(range(classical, classical + size))
                    classical += size
                if max(qubits, classical) > MAX_QUBITS:
                    raise OracleError("total register size exceeds the oracle limit")
                continue
            measurement = re.match(r"measure\s+", statement)
            if measurement:
                started = measurement_started = True
                sides = statement[measurement.end():].split("->")
                if len(sides) != 2:
                    raise OracleError("measurement needs quantum -> classical operands")
                inputs, outputs = _refs(sides[0], qregs), _refs(sides[1], cregs)
                if len(inputs) != len(outputs):
                    raise OracleError("measurement register widths differ")
                for wire, bit in zip(inputs, outputs):
                    if bit in measured or wire in measured.values():
                        raise OracleError("each measured wire and classical bit must be unique")
                    measured[bit] = wire
                continue
            name, params, operands = _operation(statement)
            started = True
            groups = [_refs(operand, qregs) for operand in operands]
            if name == "barrier":
                if params:
                    raise OracleError("barrier takes no parameters")
                continue
            if measurement_started:
                raise OracleError("operations after measurement are not supported")
            arity = 2 if name in {"cx", "CX", "cz"} else 1
            parameter_count = 3 if name in {"U", "u3"} else 2 if name == "u2" else 1 if name in {*_ROT, "u1"} else 0
            if name not in {*_FIXED, *_ROT, "cx", "CX", "cz", "U", "u3", "u2", "u1", "id", "sdg", "tdg"}:
                raise OracleError(f"unsupported operation {name}")
            if name not in {"U", "CX"} and not included:
                raise OracleError("standard gates require include qelib1.inc")
            if len(groups) != arity or len(params) != parameter_count:
                raise OracleError("operation has the wrong operand or parameter count")
            width = max(map(len, groups))
            if any(len(group) not in (1, width) for group in groups):
                raise OracleError("broadcast register widths differ")
            for index in range(width):
                wires = [group[0 if len(group) == 1 else index] for group in groups]
                if arity == 2:
                    if wires[0] == wires[1]:
                        raise OracleError("two-qubit operands must differ")
                    gates.append({"op": "CZ" if name == "cz" else "CNOT", "control": wires[0], "target": wires[1]})
                elif name in _FIXED:
                    gates.append({"op": _FIXED[name], "wire": wires[0]})
                elif name in _ROT:
                    gates.append({"op": _ROT[name], "wire": wires[0], "theta": params[0]})
                elif name != "id":
                    if name in {"sdg", "tdg", "u1"}:
                        angle = -math.pi / (2 if name == "sdg" else 4) if name != "u1" else params[0]
                        sequence = [("RZ", angle)]
                    else:
                        theta, phi, lam = params if name in {"U", "u3"} else [math.pi / 2, *params]
                        sequence = [("RZ", lam), ("RY", theta), ("RZ", phi)]
                    gates.extend({"op": op, "wire": wires[0], "theta": angle} for op, angle in sequence)
                if len(gates) > MAX_GATES:
                    raise OracleError("expanded circuit exceeds the oracle gate limit")
        except (OracleError, ValueError, OverflowError) as exc:
            raise OracleError(f"statement {ordinal}: {exc}") from exc
    result: dict[str, Any] = {"schema": 1, "qubits": qubits, "gates": gates, "observables": []}
    if measured:
        if set(measured) != set(range(classical)):
            raise OracleError("terminal measurements must fill every declared classical bit")
        result["probability_wires"] = [measured[bit] for bit in range(classical)]
    return load_manifest(canonical(result))


def dump_qasm(manifest: dict[str, Any]) -> str:
    """Export all QOracle gates; reject observables instead of dropping them."""
    clean = load_manifest(canonical(manifest))
    if clean["observables"]:
        raise OracleError("QASM circuit export cannot preserve Pauli observables; export an explicit circuit-only copy")
    lines = ['OPENQASM 2.0;', 'include "qelib1.inc";', f'qreg q[{clean["qubits"]}];']
    selected = clean.get("probability_wires")
    if selected is not None:
        lines.append(f"creg c[{len(selected)}];")
    for gate in clean["gates"]:
        op = gate["op"]
        if op == "SWAP":
            a, b = gate["wire_a"], gate["wire_b"]
            lines.extend([f"cx q[{a}],q[{b}];", f"cx q[{b}],q[{a}];", f"cx q[{a}],q[{b}];"])
        elif op in {"CNOT", "CZ"}:
            name = "cx" if op == "CNOT" else "cz"
            lines.append(f'{name} q[{gate["control"]}],q[{gate["target"]}];')
        else:
            params = f'({gate["theta"]!r})' if "theta" in gate else ""
            lines.append(f'{op.lower()}{params} q[{gate["wire"]}];')
    if selected is not None:
        lines.extend(f"measure q[{wire}] -> c[{bit}];" for bit, wire in enumerate(selected))
    output = "\n".join(lines) + "\n"
    # Check expansion limits and ensure every emitted construct can be reimported.
    load_qasm(output)
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("import", "export"))
    parser.add_argument("input", help="QASM source or QOracle JSON manifest")
    args = parser.parse_args(argv)
    try:
        source = read_source(args.input)
        output = canonical(load_qasm(source)) + "\n" if args.operation == "import" else dump_qasm(load_manifest(source))
        sys.stdout.write(output)
        return 0
    except (OracleError, OSError, UnicodeError, ValueError, TypeError, OverflowError) as exc:
        print(f"qoracle qasm: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
