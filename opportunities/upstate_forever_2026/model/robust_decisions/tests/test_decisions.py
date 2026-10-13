"""Focused arithmetic and complete operator-workflow checks; no ecological simulations."""
from __future__ import annotations
import copy
import hashlib
import itertools
import json
import multiprocessing
import os
import time
from pathlib import Path
import numpy as np
import pytest
from fastapi.testclient import TestClient
from eco_robust.engine import Problem, solve, frontier
from eco_robust.schema import Study
from eco_robust.native import from_experiment
from eco_robust.operations import DecisionWorkspace
from eco_robust.service import create_app
from eco_robust.store import Conflict


def arithmetic_study():
    """Unitless mathematical decision example, explicitly not watershed outputs."""
    gains = [[10, 5, 7, -1], [2, 11, 7, -2], [8, 8, 7, -3]]
    return {"title": "Arithmetic example — not ecological model output", "mode": "native_packages",
            "metrics": [{"id": "gain", "units": "example units", "scale": 1, "weight": 1}],
            "candidates": [{"id": c, "cost": cost} for c, cost in zip(["A", "B", "C", "harmful"], [10, 10, 9, 1])],
            "profiles": [{"id": str(i), "probability": prob} for i, prob in enumerate([.2, .5, .3])],
            "cells": [{"profile_id": str(p), "candidate_id": c, "gains": {"gain": gains[p][i]}}
                      for p in range(3) for i, c in enumerate(["A", "B", "C", "harmful"])],
            "budget": 10, "source": {"basis": "Authored arithmetic fixture; no environmental location, data or forecast"}}


def test_complete_package_objectives_and_negative_gain():
    s = arithmetic_study()
    worst = solve(s)
    assert worst["result"]["selected_ids"] == ["C"]
    regret = solve(s, "minimax_regret")
    assert regret["result"]["selected_ids"] == ["C"]
    assert regret["result"]["maximum_regret"] == 4
    expected = solve(s, "expected")
    assert expected["result"]["selected_ids"] == ["B"]
    assert expected["value_of_information"]["evpi"] == pytest.approx(1)
    s["budget"] = 1
    assert solve(s)["result"]["worst_score"] == -3
    points = frontier(arithmetic_study(), [0, 1, 9, 10])["points"]
    assert [p["result"]["status"] for p in points] == ["infeasible", "optimal", "optimal", "optimal"]


def test_additive_milp_matches_full_feasible_population():
    rng = np.random.default_rng(192)
    s = {"title": "Explicit additive arithmetic fixture", "mode": "additive_actions", "additive_basis": "Independent authored arithmetic contributions",
         "metrics": [{"id": "one", "units": "unit A", "scale": 10, "weight": 2, "guaranteed_gain": 5},
                     {"id": "two", "units": "unit B", "scale": 2, "weight": .3}],
         "candidates": [{"id": str(i), "cost": int(rng.integers(1, 7)), "group": str(i % 2), "required": i == 1, "excluded": i == 7} for i in range(8)],
         "profiles": [{"id": str(i), "probability": 1/3} for i in range(3)],
         "cells": [{"profile_id": str(p), "candidate_id": str(c), "gains": {"one": int(rng.integers(-2, 20)), "two": int(rng.integers(-4, 9))}} for p in range(3) for c in range(8)],
         "budget": 13, "capacity": 4, "group_limits": {"0": 2, "1": 3}}
    p = Problem(Study.model_validate(s), time.monotonic()+60, 0)
    xs = np.array([x for x in itertools.product((0, 1), repeat=8) if p.evaluate(x)])
    assert len(xs) > 3
    scores = xs @ p.scores.T
    benchmarks = scores.max(axis=0)
    for kind in ["worst_case", "minimax_regret", "expected"]:
        answer = solve(s, kind)["result"]
        assert answer["status"] == "optimal"
        x = np.array([int(c["id"] in answer["selected_ids"]) for c in s["candidates"]])
        assert p.evaluate(x)
        chosen = p.scores @ x
        if kind == "worst_case": assert min(chosen) == pytest.approx(scores.min(axis=1).max())
        elif kind == "minimax_regret": assert max(benchmarks-chosen) == pytest.approx((benchmarks-scores).max(axis=1).min())
        else: assert chosen.mean() == pytest.approx(scores.mean(axis=1).max())


def native_fixture():
    s = arithmetic_study()
    for m in s["metrics"]: m["units"] = "kg/year"
    support = hashlib.sha256(b"authored arithmetic support fixture").hexdigest()
    rows = []
    for i, cell in enumerate(s["cells"]):
        pid, cid = cell["profile_id"], cell["candidate_id"]
        gain = cell["gains"]["gain"]
        rows.append({"id": f"case{i}", "kind": "landcover", "state": "complete", "profile_id": pid, "scenario_id": cid,
                     "baseline_run_id": "base"+pid, "run_id": "alt"+pid+cid,
                     "selection": {"grid_id": "arithmetic-grid", "profile_id": pid, "scenario_id": cid, "invest_version": "3.20.0"},
                     "native_completed_at": "2026-10-12T00:00:00Z", "native_runtime": {"fixture": True},
                     "metrics": {"gain": {"units": "kg/year", "baseline_total": 100, "alternative_total": 100-gain,
                                          "delta": -gain, "reduction": gain, "paired_cells": 10, "coverage_fraction": 1,
                                          "support_sha256": support}}})
    config = {k: v for k, v in s.items() if k != "cells"}
    return {"schema": "upstate.experiment-summary/v1", "id": "arithmetic-experiment", "workspace_id": "arithmetic",
            "grid_id": "arithmetic-grid", "rows": rows}, config


def test_native_summary_receiver_preserves_actual_rows_contract():
    bundle, config = native_fixture()
    s = from_experiment(bundle, config)
    assert solve(s)["result"]["selected_ids"] == ["C"]
    assert s.source["experiment_id"] == "arithmetic-experiment"
    assert s.cells[0].source["native_case"]["selection"] == bundle["rows"][0]["selection"]
    for mutation in ["sign", "support", "missing", "units"]:
        broken = copy.deepcopy(bundle)
        if mutation == "sign": broken["rows"][0]["metrics"]["gain"]["delta"] *= -1
        if mutation == "support": broken["rows"][0]["metrics"]["gain"]["support_sha256"] = "a"*64
        if mutation == "missing": broken["rows"].pop()
        if mutation == "units": broken["rows"][0]["metrics"]["gain"]["units"] = "tonnes/year"
        with pytest.raises(ValueError): from_experiment(broken, config)


def test_infeasible_targets_and_explicit_probabilities():
    s = arithmetic_study(); s["metrics"][0]["guaranteed_gain"] = 50
    answer = solve(s)["result"]
    assert answer["status"] == "infeasible"
    diagnostic = answer["diagnostic_without_gain_targets"]
    assert diagnostic["selected_ids"] == ["C"]
    assert diagnostic["profiles"][0]["metrics"][0]["target_shortfall"] == 43
    s = arithmetic_study()
    for p in s["profiles"]: p.pop("probability")
    assert solve(s)["value_of_information"] is None
    with pytest.raises(ValueError): solve(s, "expected")
    s["cells"].pop()
    with pytest.raises(ValueError): Study.model_validate(s)


def test_revision_export_receive_independent_edit_and_replay(tmp_path):
    sender = DecisionWorkspace(tmp_path/"sender")
    doc = sender.store.create(arithmetic_study())
    answer = sender.solve(doc["id"], 1, "minimax_regret")
    changed = copy.deepcopy(doc["study"]); changed["budget"] = 1
    revised = sender.store.revise(doc["id"], changed, 1)
    with pytest.raises(Conflict): sender.store.revise(doc["id"], changed, 1)
    sender.frontier(doc["id"], 2, [1, 9, 10])
    packet = sender.store.export(doc["id"])
    receiver = DecisionWorkspace(tmp_path/"receiver")
    received = receiver.store.receive(packet)
    assert received["id"] != doc["id"] and received["revision"] == 2
    replay = receiver.solve(received["id"], 1, "minimax_regret")
    assert replay["answer"]["result"]["selected_ids"] == answer["answer"]["result"]["selected_ids"]
    assert receiver.store.read(received["id"], 1)["sha256"] == doc["sha256"]
    receiver.store.revise(received["id"], arithmetic_study(), 2)
    assert sender.store.read(doc["id"])["head"] == 2
    again = DecisionWorkspace(tmp_path/"third").store.receive(receiver.store.export(received["id"]))
    assert again["head"] == 3
    assert len(packet["payload"]["revisions"]) == 2 and len(packet["payload"]["runs"]) == 2


def _crash(root, sid):
    ws = DecisionWorkspace(root)
    with ws._execution(sid, 1, "worst_case"):
        os._exit(13)


def test_real_process_death_recovery_and_replay(tmp_path):
    ws = DecisionWorkspace(tmp_path); doc = ws.store.create(arithmetic_study())
    proc = multiprocessing.get_context("spawn").Process(target=_crash, args=(str(tmp_path), doc["id"]))
    proc.start(); proc.join(5)
    assert proc.exitcode == 13
    assert len(ws.recover()) == 1
    assert ws.store.read(doc["id"])["runs"][0]["status"] == "interrupted"
    assert ws.solve(doc["id"], 1)["answer"]["result"]["selected_ids"] == ["C"]
    with ws._execution(doc["id"], 1, "worst_case") as rid:
        assert ws.recover() == []
        ws.store.finish_run(rid, solve(arithmetic_study()))


def test_complete_http_native_import_edit_solve_frontier_export_receive(tmp_path):
    client = TestClient(create_app(tmp_path))
    assert client.get('/').status_code == 200
    summary, configuration = native_fixture()
    response = client.post('/api/robust/native', json={"summary": summary, "configuration": configuration})
    assert response.status_code == 201, response.text
    doc = response.json(); sid = doc["id"]
    response = client.post(f'/api/robust/studies/{sid}/solve', json={"revision": 1, "objective": "minimax_regret"})
    assert response.status_code == 200, response.text
    assert response.json()["answer"]["result"]["selected_ids"] == ["C"]
    s = doc["study"]; s["budget"] = 1
    assert client.put(f'/api/robust/studies/{sid}', json={"study": s, "expected_revision": 1}).status_code == 200
    assert client.put(f'/api/robust/studies/{sid}', json={"study": s, "expected_revision": 1}).status_code == 409
    assert client.post(f'/api/robust/studies/{sid}/frontier', json={"revision": 2, "budgets": [0,1,9,10]}).status_code == 200
    packet = client.get(f'/api/robust/studies/{sid}/export').json()
    received = client.post('/api/robust/receive', json=packet)
    assert received.status_code == 201, received.text
    assert len(client.get('/api/robust/studies').json()["studies"]) == 2
    assert client.post('/api/robust/studies', json=arithmetic_study(), headers={"Origin": "https://foreign.invalid"}).status_code == 403
    assert client.get('/api/robust/studies/nonexistent').status_code == 404


def test_dispatch_reports_selection_and_numeric_portability(tmp_path):
    from eco_robust.integration import dispatch
    from eco_robust.engine import canonical_hash
    from eco_robust.reports import html_report, csv_report
    assert canonical_hash({'x':1.0,'z':-0.0}) == canonical_hash({'x':1,'z':0})
    document = dispatch(tmp_path,'robust.study.create',{'study':arithmetic_study()})
    result = dispatch(tmp_path,'robust.solve',{'study_id':document['id'],'revision':1})
    args = {'study_id':document['id'],'run_id':result['run_id']}
    selection = dispatch(tmp_path,'robust.selection.export',args)
    assert selection['selected_ids'] == ['C'] and len(selection['selected_original_cells']) == 3
    for format in ('html','csv'):
        exported = dispatch(tmp_path,'robust.report.export',{**args,'format':format})
        assert exported['content'] and exported['filename'].endswith(format)
    client=TestClient(create_app(tmp_path))
    assert client.get(f"/api/robust/studies/{document['id']}/selection",params={'run_id':result['run_id']}).json()['selected_ids']==['C']
    report=client.get(f"/api/robust/studies/{document['id']}/report",params={'run_id':result['run_id']})
    assert report.status_code==200 and 'Complete original gain matrix' in report.text
    packet=dispatch(tmp_path,'robust.project.export',{'study_id':document['id']})
    # Equivalent integral JSON number representations stay independently receivable.
    def integers(v):
        if isinstance(v,float) and v.is_integer(): return int(v)
        if isinstance(v,dict): return {k:integers(x) for k,x in v.items()}
        if isinstance(v,list): return [integers(x) for x in v]
        return v
    received=dispatch(tmp_path/'second','robust.project.receive',{'project':integers(packet)})
    assert received['head']==1
