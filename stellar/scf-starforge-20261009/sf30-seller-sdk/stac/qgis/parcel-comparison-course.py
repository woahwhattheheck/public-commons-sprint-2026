#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""One authored comparison course over the unchanged production comparison functions."""
from __future__ import annotations
import copy
import csv
from decimal import localcontext
import io
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from starforge_stac.parcels import comparison, portfolio
from starforge_stac.model import value_sha

def run():
    def row(key, amount="100.10", area="43560", **changes):
        value = {"parcelKey": key, "reviewStatus": "REVIEWED", "owner": "Original owner",
            "accountable": None, "status": "Retained status", "ward": "1",
            "assessmentBasis": "county-assessed", "assessment": amount, "currency": "USD",
            "taxYear": "2026", "asOfDate": "2026-01-01", "areaBasis": "county-reported-square-feet",
            "area": area, "areaUnit": "square-feet", "geometryAvailable": False,
            "sourceIssues": [], "decisionSha256": "a"*64, "factsSha256": "b"*64,
            "ownerClaim": None, "accountableEntity": None, "assessmentClaim": None,
            "areaClaim": None, "geometryClaim": None}
        return {**value, **changes}
    original_left = [row("0000000000000001"), row("0000000000000002", "0.00", "0"),
                     row("0000000000000003", None, None), row("0000000000000004", "50.00"),
                     row("0000000000000006", "9007199254740993.01")]
    original_right = [row("0000000000000001", "100.30", owner="Revised owner", decisionSha256="c"*64),
                      row("0000000000000002", "0.00", "0"),
                      row("0000000000000003", "10", None, taxYear="2027", asOfDate="2027-01-01"),
                      row("0000000000000005", "75.00"),
                      row("0000000000000006", "9007199254740993.03")]
    def frozen(rows):
        return {"schema":portfolio.SCHEMA,"selectedKeys":[x["parcelKey"] for x in rows],"rows":copy.deepcopy(rows)}
    left, right = frozen(original_left), frozen(original_right)
    untouched = copy.deepcopy((left,right))
    chosen = comparison.definition({"title":"Authored exact comparison","leftPortfolioId":"portfolio-"+"a"*64,
        "rightPortfolioId":"portfolio-"+"b"*64,"periodPolicy":"same-period","groupBy":["owner","ward"],
        "note":"Authored source examples for arithmetic and cohort semantics; not a publisher observation."})
    checks=[]
    def check(name, condition):
        if not condition: raise AssertionError(name)
        checks.append({"name":name,"passed":True})
    with localcontext() as ctx:
        ctx.prec=4096
        result=comparison._build_values(left,right,chosen)
        rows={x["parcelKey"]:x for x in result["rows"]}
        check("Exact common-key cohort and distinct additions/removals",result["summary"]["common"]==4 and
              result["summary"]["added"]==1 and result["summary"]["removed"]==1)
        check("Exact cents beyond binary-float integer precision",rows["0000000000000001"]["assessment"]["delta"]=="0.20" and
              rows["0000000000000006"]["assessment"]["delta"]=="0.02")
        check("Zero is measured; absent amount stays absent",rows["0000000000000002"]["assessment"]["comparable"] and
              rows["0000000000000002"]["assessment"]["delta"]=="0.00" and
              not rows["0000000000000003"]["assessment"]["comparable"])
        check("Cohort values are never subtracted from fabricated zero",
              rows["0000000000000004"]["assessment"]["delta"] is None and rows["0000000000000005"]["assessment"]["delta"] is None)
        check("Both group identities and original review/source rows survive",
              rows["0000000000000001"]["transition"]["left"]["owner"]=="Original owner" and
              rows["0000000000000001"]["transition"]["right"]["owner"]=="Revised owner" and
              rows["0000000000000001"]["left"]==left["rows"][0])
        changed=frozen([row("0000000000000001","125.10",taxYear="2027",asOfDate="2027-01-01")])
        default=comparison._build_values(frozen([original_left[0]]),changed,chosen)["rows"][0]
        explicit=comparison._build_values(frozen([original_left[0]]),changed,{**chosen,"periodPolicy":"compare-declared-periods"})["rows"][0]
        check("Different declared periods require explicit policy",default["assessment"]["delta"] is None and
              "period-differs" in default["assessment"]["reasons"] and explicit["assessment"]["delta"]=="25.00")
        changed["rows"][0]["assessmentBasis"]="local-assessed"
        changed["rows"][0]["areaUnit"]="acres"
        incompatible=comparison._build_values(frozen([original_left[0]]),changed,{**chosen,"periodPolicy":"compare-declared-periods"})["rows"][0]
        check("Cross-period permission never mixes basis or units","basis-differs" in incompatible["assessment"]["reasons"] and
              "unit-differs" in incompatible["area"]["reasons"] and incompatible["assessment"]["delta"] is None)
        changed["rows"][0].update(assessmentBasis="county-assessed",areaUnit="square-feet",asOfDate=None)
        absent=comparison._build_values(frozen([original_left[0]]),changed,{**chosen,"periodPolicy":"compare-declared-periods"})["rows"][0]
        check("An undeclared period never becomes cross-period evidence","period-missing" in absent["assessment"]["reasons"])
    check("All complete original rows remain unchanged",(left,right)==untouched)
    value={"schema":comparison.SCHEMA,"definition":chosen,
           "left":{"title":"Authored left"},"right":{"title":"Authored right"},**result}
    csv_rows=list(csv.DictReader(io.StringIO(comparison._csv(value).decode("utf-8"))))
    check("Ordinary CSV retains exact decimal amounts and source identities",
          next(x for x in csv_rows if x["parcelKey"]=="0000000000000006")["assessmentDelta"]=="0.02")
    html=comparison._report(value).decode("utf-8")
    check("Readable report exposes currency, basis, dates and missing-area attention",
          all(x in html for x in ("USD","county-assessed","2026-01-01","measure-missing","area")))
    return {"schema":"starforge.parcel-comparison-authored-course.v1","provenance":"Authored cases executed against the actual production comparison module.",
            "checks":checks,"summary":result["summary"],"sourceRowsSha256":value_sha({"left":left,"right":right})}

if __name__=="__main__":
    print(json.dumps(run(),ensure_ascii=False,indent=2))
