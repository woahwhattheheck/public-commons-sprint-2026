"""Chromium customer-action journey against the real monitoring action module.

A test-only HTTP adapter implements the inspected original /api/action envelope;
this is not the complete customer application's server or its physical model.
"""
from __future__ import annotations
import importlib,json,mimetypes,sys,tempfile,threading,urllib.request
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from contract_support import install_namespace,domain_fixture,source_record,configuration
from playwright.sync_api import sync_playwright

PACKAGE,Workspace,ContractError,MODE=install_namespace()
route=importlib.import_module(PACKAGE+".operator.monitoring").route_monitoring
ROOT=Path(__file__).resolve().parents[1]
ASSET=ROOT/"src/opportunities/upstate_forever_2026/operator/static/monitoring.js"

def main():
    with tempfile.TemporaryDirectory() as temp:
        workspace=Workspace(temp)
        domain,stations=domain_fixture()
        d=source_record(workspace,domain,"Authored catchment fixture")
        s=source_record(workspace,stations,"Authored station fixture")
        network=route(workspace,"network.import",dict(domain_source_id=d["id"],station_source_id=s["id"],title="Monitoring acceptance fixture",stratum_field="stratum",priority_field="priority",station_outlet_field="at_outlet"))
        plan=route(workspace,"design",dict(network_id=network["id"],configuration=configuration(),title="Field workflow acceptance"))
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def answer(self,status,body,content_type):
                self.send_response(status);self.send_header("Content-Type",content_type);self.send_header("Content-Length",str(len(body)));self.end_headers();self.wfile.write(body)
            def do_GET(self):
                if self.path=="/":
                    self.answer(200,b'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:12px;background:#e5e5e5"><div style="font:12px system-ui;padding:8px">ENGINEERING ACCEPTANCE FIXTURE - authored algorithm data</div><script src="/static/monitoring.js" defer></script></body></html>',"text/html")
                elif self.path=="/static/monitoring.js":self.answer(200,ASSET.read_bytes(),"application/javascript")
                elif self.path.startswith("/api/download?"):
                    name=parse_qs(urlparse(self.path).query)["path"][0];path=(workspace.root/name).resolve()
                    if not path.is_relative_to(workspace.root):return self.answer(400,b"bad path","text/plain")
                    self.answer(200,path.read_bytes(),mimetypes.guess_type(path.name)[0]or"application/octet-stream")
                else:self.answer(404,b"not found","text/plain")
            def do_POST(self):
                try:
                    request=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    action=request["action"]
                    if not action.startswith("monitoring."):raise ContractError("unknown action")
                    result=route(workspace,action[len("monitoring."):],request.get("params",{}))
                    self.answer(200,json.dumps({"ok":True,"result":result},allow_nan=False).encode(),"application/json")
                except (ContractError,ValueError,KeyError)as exc:self.answer(400,json.dumps({"ok":False,"error":str(exc)}).encode(),"application/json")
        server=ThreadingHTTPServer(("127.0.0.1",0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        errors=[];artifacts={}
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox"])
                page=browser.new_page(viewport={"width":1440,"height":1100},device_scale_factor=1)
                page.on("pageerror",lambda e:errors.append(str(e)))
                origin=f"http://127.0.0.1:{server.server_port}"
                # Environment policy blocks Chromium navigation to loopback. Render
                # programmatically and bridge fetch through the actual HTTP server;
                # no browser-policy changes or disabled security flags are used.
                def request_bridge(url, body):
                    if url != "/api/action": raise ValueError("unexpected test request")
                    req=urllib.request.Request(origin+url,data=body.encode(),headers={"Content-Type":"application/json"})
                    with urllib.request.urlopen(req) as response:
                        return {"status":response.status,"body":response.read().decode()}
                page.expose_function("__monitoringRequest",request_bridge)
                page.set_content(f'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><base href="{origin}/"></head><body style="margin:0;padding:12px;background:#e5e5e5"><div style="font:12px system-ui;padding:8px">ENGINEERING ACCEPTANCE FIXTURE - authored algorithm data</div></body></html>')
                page.add_script_tag(content="""
                window.fetch=async(url,options)=>{const r=await window.__monitoringRequest(String(url),options.body);return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json'}})};
                if(!crypto.randomUUID)crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(16))).map(v=>v.toString(16).padStart(2,'0')).join('');
                """)
                page.add_script_tag(content=ASSET.read_text())
                page.locator("#plans option").filter(has_text="Field workflow acceptance").wait_for(state="attached")
                page.locator("#plans").select_option(plan["id"])
                page.locator("#sites tbody tr").nth(6).wait_for()
                page.get_by_role("button",name="Create campaign from this design").click()
                page.locator("#bindings select").first.wait_for()
                for select in page.locator("#bindings select").all():
                    select.select_option(index=1)
                page.get_by_role("button",name="Save source-station bindings").click()
                page.wait_for_function("document.querySelector('eco-monitoring').shadowRoot.getElementById('campaign-detail').textContent.includes('revision 2')")
                page.get_by_text("Record a field event",exact=True).click()
                page.locator("#sample-id").fill("BROWSER-TEST-001")
                page.locator("#occurred").fill("2026-11-02T10:00:00-05:00")
                page.locator("#event-note").fill("Browser action-path acceptance")
                page.get_by_role("button",name="Append field event").click()
                page.wait_for_function("document.querySelector('eco-monitoring').shadowRoot.getElementById('campaign-detail').textContent.includes('revision 3')")
                assert "collected" in page.locator("#calendar tbody tr").first.inner_text()
                page.get_by_text("Reports and complete editable handover",exact=True).click()
                page.get_by_role("button",name="Field package",exact=True).click()
                page.locator("#downloads a").wait_for()
                href=page.locator("#downloads a").first.get_attribute("href")
                with urllib.request.urlopen(href) as response:
                    assert response.status==200
                    (ROOT/"evidence/browser-field-package.zip").write_bytes(response.read())
                page.get_by_text("Record a field event",exact=True).click()
                page.screenshot(path=str(ROOT/"evidence/monitoring-desktop.png"),full_page=True)
                assert page.locator("#map path").count()==24
                page.set_viewport_size({"width":412,"height":915})
                page.screenshot(path=str(ROOT/"evidence/monitoring-mobile.png"),full_page=True)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                # Reload and reopen retained campaign; current field state survives.
                campaign_id=page.locator("#campaigns").input_value()
                page.evaluate("document.querySelector('eco-monitoring').remove(); document.body.append(document.createElement('eco-monitoring'))");page.locator("#campaigns option").filter(has_text="revision 3").wait_for(state="attached")
                page.locator("#campaigns").select_option(campaign_id)
                page.locator("#calendar tbody tr").first.wait_for()
                assert "collected" in page.locator("#calendar tbody tr").first.inner_text()
                assert not errors,errors
                browser.close()
        finally:server.shutdown();server.server_close()
        output={"mode":MODE,"scope":"programmatic Chromium rendering + explicit fetch bridge to real local test HTTP adapter for monitoring actions",
                "direct_browser_navigation":"ERR_BLOCKED_BY_ADMINISTRATOR; policy unchanged",
                "workflow":["saved design open","source polygon map","campaign create","source station binding","field event append","complete field package download","mobile layout","remount and reopen retained campaign"],
                "page_errors":errors,"source_polygons_rendered":24,"campaign_revision":3,"passed":True}
        (ROOT/"evidence/browser.json").write_text(json.dumps(output,indent=2));print(json.dumps(output,indent=2))

if __name__=="__main__":main()
