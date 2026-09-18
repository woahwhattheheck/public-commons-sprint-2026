import json
from proofcam import compile_trace, synthetic_scene, verify_trace

CASES=(("none","CAPTURE_NEXT_FRAME"),("left","INSPECT_LEFT_ZONE"),("center","NO_ACTION"),("right","INSPECT_RIGHT_ZONE"))

def run_suite():
    rows=[]
    for hazard, expected in CASES:
        trace=compile_trace(synthetic_scene(hazard=hazard), observed_ms=1000, now_ms=1100)
        ok=trace["decision"]["tool_plan"]==expected and verify_trace(trace)
        rows.append({"hazard":hazard,"expected_tool":expected,"actual_tool":trace["decision"]["tool_plan"],"pass":ok})
    passed=sum(1 for row in rows if row["pass"])
    return {"schema":"proofcam.evaluation/v1","synthetic_cases":len(rows),"passed":passed,"success_ppm":passed*1000000//len(rows),"results":rows}

if __name__=="__main__":
    print(json.dumps(run_suite(),indent=2,sort_keys=True))
