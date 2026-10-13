"""Meaningful solver, recovery, export and source-contract checks; no physical sims."""
import copy, hashlib, importlib, itertools, json, os, shutil, sys, tempfile, time, unittest, zipfile
from pathlib import Path
from contract_support import install_namespace, domain_fixture, source_record, configuration
PACKAGE,Workspace,ContractError,MODE=install_namespace()
net=importlib.import_module(PACKAGE+".model.monitoring_network")
design=importlib.import_module(PACKAGE+".model.monitoring_design")
camp=importlib.import_module(PACKAGE+".model.monitoring_campaign")
service=importlib.import_module(PACKAGE+".model.monitoring_workspace")
route=importlib.import_module(PACKAGE+".operator.monitoring").route_monitoring

class Journeys(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.workspace=Workspace(self.temp.name);self.s=service.MonitoringWorkspace(self.workspace)
        domain,stations=domain_fixture();d=source_record(self.workspace,domain,"Authored domain fixture");s=source_record(self.workspace,stations,"Authored station fixture")
        self.network=self.s.import_network(domain_source_id=d["id"],station_source_id=s["id"],stratum_field="stratum",priority_field="priority",station_outlet_field="at_outlet",title="Algorithm acceptance fixture")
    def tearDown(self):self.temp.cleanup()
    def make_plan(self):return self.s.design(network_id=self.network["id"],configuration=configuration(),title="Acceptance fixture campaign")
    def test_solver_matches_exhaustive_and_cost_tiebreak(self):
        domain,stations=domain_fixture(10)
        network=net.build_network(domain,stations,source_bindings={"domain":{"fixture":True},"stations":{"fixture":True}},stratum_field="stratum",priority_field="priority",station_outlet_field="at_outlet")
        for mode in ("local","outlet_context"):
            c=configuration();c.update(coverage_mode=mode,budget="750.00",max_sites=4,minimum_network_separation=1)
            result=design.solve_design(network,c);self.assertEqual(result["status"],"optimal")
            cover=net.coverage_sets(network,mode);pairs=net.graph_distances(network,1);costs,_=camp.cost_table(network,c,c["calendar"])
            best=(-1,float("-inf"))
            keys=sorted(network["nodes"])
            for r in range(c["min_sites"],5):
                for combo in itertools.combinations(keys,r):
                    selected=set(combo);spent=sum(costs[k] for k in combo)+10000
                    if spent>75000 or any(a in selected and b in selected for a,b in pairs):continue
                    if any(sum(network["nodes"][k]["stratum"]==s for k in selected)<v for s,v in c["minimum_by_stratum"].items()):continue
                    covered=set().union(*(cover[k] for k in combo))
                    score=(sum(network["nodes"][k]["weight"] for k in covered),-spent)
                    best=max(best,score)
            self.assertEqual((result["coverage"]["covered_weight"],-result["cost"]["total_cents"]),best)
    def test_calendar_capacity_is_a_design_constraint(self):
        c=configuration();c["calendar"].update(round_window_days=1,interval_days=28,end_date="2026-11-30",visit_minutes=180,travel_buffer_minutes=60)
        c.update(max_sites=20,min_sites=0,minimum_by_stratum={},budget="9000.00")
        result=design.solve_design(self.network,c)
        self.assertEqual(len(result["selected_ids"]),2);self.assertEqual(len(result["calendar"]["visits"]),4)
        c["min_sites"]=3
        self.assertEqual(design.solve_design(self.network,c)["status"],"infeasible")
    def test_boundaries_cycles_bad_ids_and_exact_money(self):
        domain,stations=domain_fixture(2)
        domain["features"][0]["properties"]["tohuc"]="F00001"
        with self.assertRaises(ContractError):net.build_network(domain,None,source_bindings={"domain":True})
        domain,_=domain_fixture(2);domain["features"][0]["properties"]["huc12"]=123
        with self.assertRaises(ContractError):net.build_network(domain,None,source_bindings={"domain":True})
        for bad in ("0.001","NaN",True,"-1.00"):
            with self.assertRaises(ContractError):camp.money_cents(bad,"cost")
        self.assertEqual(camp.money_cents("12.30","cost"),1230)
        domain,stations=domain_fixture(2);domain["features"][1]["geometry"]=copy.deepcopy(domain["features"][0]["geometry"])
        ambiguous=net.build_network(domain,stations,source_bindings={"domain":True,"stations":True})
        self.assertTrue(ambiguous["station_assignment_issues"])
        with self.assertRaises(ContractError):net.existing_coverage(ambiguous,"local",["TEST-00000"])
    def test_campaign_field_replay_restart_and_full_exports(self):
        plan=self.make_plan();created=self.s.create_campaign(plan_id=plan["id"],title="<script>must escape</script>",operation_id="create-fixed")
        self.assertEqual(created,self.s.create_campaign(plan_id=plan["id"],title="<script>must escape</script>",operation_id="create-fixed"))
        bindings={h:f"TEST-{int(h[1:]):05d}" for h in plan["selected_ids"]}
        revised=self.s.revise_campaign(campaign_id=created["campaign_id"],expected_revision_id=created["id"],operation_id="bind-fixed",site_bindings=bindings)
        with self.assertRaises(ContractError):self.s.revise_campaign(campaign_id=created["campaign_id"],expected_revision_id=created["id"],operation_id="stale",note="stale")
        payload=dict(campaign_id=created["campaign_id"],expected_revision_id=revised["id"],operation_id="event-fixed",visit_key=plan["calendar"]["visits"][0]["visit_key"],status="collected",occurred_at="2026-11-02T09:00:00-05:00",sample_id="TEST-SAMPLE-01",note="<script>escape</script>")
        result=self.s.field_event(**payload)
        reopened=service.MonitoringWorkspace(Workspace(self.temp.name));self.assertEqual(result,reopened.field_event(**payload))
        self.assertEqual(reopened.campaign(created["campaign_id"])["calendar"][0]["status"],"collected")
        with self.assertRaises(ContractError):reopened.field_event(**{**payload,"note":"changed payload"})
        export=reopened.export(campaign_id=created["campaign_id"])
        with zipfile.ZipFile(Path(self.temp.name)/export["path"]) as z:
            manifest=json.loads(z.read("manifest.json"))
            for f in manifest["files"]:self.assertEqual(hashlib.sha256(z.read(f["path"])).hexdigest(),f["sha256"])
            report=z.read("report.html").decode();self.assertNotIn("<script>must escape",report);self.assertIn("&lt;script&gt;must escape",report)
            self.assertEqual(len(json.loads(z.read("catchments.geojson"))["features"]),24)
            self.assertEqual(len(json.loads(z.read("campaign-history.json"))),3)
            self.assertEqual(len(z.read("calendar.csv").decode().splitlines()),len(plan["calendar"]["visits"])+1)
        # Reopen an independently copied native-API fixture tree; no original files needed.
        with tempfile.TemporaryDirectory() as dest:
            shutil.copytree(self.temp.name,Path(dest)/"received")
            receiver=service.MonitoringWorkspace(Workspace(Path(dest)/"received"))
            edit=receiver.revise_campaign(campaign_id=created["campaign_id"],expected_revision_id=result["id"],operation_id="recipient-edit",title="Independent recipient")
            self.assertEqual(edit["revision"],4);self.assertEqual(reopened.campaign(created["campaign_id"])["revision"]["revision"],3)
    def test_source_hash_and_duplicate_samples(self):
        plan=self.make_plan();created=self.s.create_campaign(plan_id=plan["id"],title="t",operation_id="c")
        with self.assertRaises(ContractError):self.s.field_event(campaign_id=created["campaign_id"],expected_revision_id=created["id"],operation_id="unbound",visit_key=plan["calendar"]["visits"][0]["visit_key"],status="collected",occurred_at="2026-11-02T09:00:00Z",sample_id="S1")
        source_id=self.network["source_bindings"]["domain"]["source_id"]
        self.workspace.source_file(source_id).write_text("{}")
        with self.assertRaises(ContractError):self.make_plan()
    def test_frontier_and_full_pagination(self):
        c=configuration();c["minimum_by_stratum"]={};c["min_sites"]=0
        frontier=self.s.frontier(network_id=self.network["id"],configuration=c,budgets=["100.00","400.00","900.00","1800.00"])
        self.assertEqual(frontier["budgets_completed"],4)
        scores=[r["covered_weight"] for r in frontier["rows"]];self.assertEqual(scores,sorted(scores))
        page=self.s.list("plans",limit=2);second=self.s.list("plans",limit=2,cursor=page["next_cursor"],snapshot=page["snapshot"])
        self.assertEqual(len(page["records"]+second["records"]),4)
        self.assertEqual(len({r["id"] for r in page["records"]+second["records"]}),4)
    def test_frontier_resumes_after_interruption(self):
        from unittest.mock import patch
        original=service.solve_design;count=0
        def interrupted(network,config):
            nonlocal count
            count+=1
            if count==2:raise KeyboardInterrupt("authored interruption")
            return original(network,config)
        params=dict(network_id=self.network["id"],configuration=configuration(),budgets=["400.00","900.00","1800.00"])
        with patch.object(service,"solve_design",interrupted):
            with self.assertRaises(KeyboardInterrupt):self.s.frontier(**params)
        progress=self.s.frontier_progress(**params);self.assertEqual(progress["budgets_completed"],1)
        first=next(iter(progress["plan_ids"].values()))
        completed=self.s.frontier(**params);self.assertEqual(completed["budgets_completed"],3)
        self.assertEqual(completed["plan_ids"][0],first)
        self.assertEqual(completed,self.s.frontier(**params))

    def test_original_route_extension_repeat_safe(self):
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]));import install_monitoring
        original='def route_action(workspace, action, params):\n    """Native dispatch."""\n    params = dict(params or {})\n    if action == "peer.product": return 42\n    raise ValueError(action)\n'
        patched=install_monitoring.router(original)
        self.assertEqual(install_monitoring.router(patched),patched);self.assertIn('if action == "peer.product": return 42',patched)
        html='<!doctype html><html><body><script src="/static/peer.js"></script></body></html>'
        patched_html=install_monitoring.template(html)
        self.assertEqual(install_monitoring.template(patched_html),patched_html);self.assertIn('/static/peer.js',patched_html)
        self.assertIn("campaign.event",route(self.workspace,"capabilities",{})["commands"])
    def test_512_catchment_complete_workload(self):
        domain,stations=domain_fixture(512)
        network=net.build_network(domain,stations,source_bindings={"domain":{"fixture":True},"stations":{"fixture":True}},stratum_field="stratum",priority_field="priority",station_outlet_field="at_outlet")
        c=configuration();c.update(max_sites=30,budget="6000.00",minimum_by_stratum={"S0":3,"S1":3,"S2":3});c["calendar"]["crews"]=3
        begin=time.perf_counter();result=design.solve_design(network,c)
        self.assertEqual(result["status"],"optimal");self.assertEqual(len(result["selected_ids"]),30)
        self.assertEqual(len(result["calendar"]["visits"]),90)
        evidence={"scope":"authored algorithm workload; not a basin model or field dataset","mode":MODE,"nodes":512,"source_station_points":512,"selected_sites":30,"scheduled_visits":90,"solver_seconds":result["elapsed_seconds"],"test_seconds":time.perf_counter()-begin,"status":result["status"]}
        out=Path(__file__).resolve().parents[1]/"evidence/workload.json";out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(evidence,indent=2))

if __name__=="__main__":unittest.main(verbosity=2)
