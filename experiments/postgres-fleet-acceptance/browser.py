#!/usr/bin/env python3
"""One browser continuation over the original PostgreSQL and fleet products.

This is a portable experiment driver, not an additional product or test suite.
The Node owner supplies private loopback URLs and closes each native surface.
"""
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

phase, input_file, output_file = sys.argv[1:]
inputs = json.loads(Path(input_file).read_text())
work = Path(inputs["work"])
errors = []
result = {"phase": phase, "browserErrors": errors}


def save_json(path, value):
    with open(path, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    os.chmod(path, 0o600)


def attach(page):
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())


def response_for(path):
    return lambda response: (urlsplit(response.url).path == path
                             and response.request.method == "POST")


def post_click(page, path, click, status=200):
    with page.expect_response(response_for(path)) as pending:
        click()
    response = pending.value
    value = response.json()
    assert response.status == status, value
    return value, response.request.post_data_json


def download(page, button, filename):
    with page.expect_download() as pending:
        button.click()
    target = work / filename
    pending.value.save_as(str(target))
    os.chmod(target, 0o600)
    return target


def responsive(page, stem):
    page.set_viewport_size({"width": 1280, "height": 960})
    page.screenshot(path=str(work / (stem + "-desktop.png")), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    size = page.evaluate("({width:innerWidth, content:document.documentElement.scrollWidth})")
    assert size["content"] <= size["width"], size
    page.screenshot(path=str(work / (stem + "-mobile.png")), full_page=True)
    return size


def check_source(source, package=None):
    assert set(source) == {"postgresPackage", "postgresInputManifestSha256", "runtime"}, source
    assert source["postgresPackage"].startswith("/")
    if package:
        assert source["postgresPackage"] == package
    assert len(source["postgresInputManifestSha256"]) == 64
    assert source["runtime"] == inputs["runtime"], source["runtime"]
    assert "port" not in source["runtime"]


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get("PG_FLEET_CHROMIUM", "/usr/bin/chromium"),
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
              "--disable-background-networking", "--renderer-process-limit=2"],
    )
    context = browser.new_context(viewport={"width": 1280, "height": 960}, accept_downloads=True)
    context.on("page", attach)
    page = context.new_page()
    try:
        if phase == "author":
            page.goto(inputs["url"])
            page.locator("#sources button").filter(has_text="products").click()
            for column in ["id", "title", "price_cents"]:
                page.get_by_role("checkbox", name="Include " + column, exact=True).check()
            page.locator("#order").select_option("id")
            for index, (column, operation, name) in enumerate([
                ("region", "eq", "region"), ("id", "min", "minimum_id")
            ]):
                page.locator("#add-filter").click()
                row = page.locator(".filter-row").nth(index)
                row.get_by_label("Column", exact=True).select_option(column)
                row.get_by_label("Match", exact=True).select_option(operation)
                row.get_by_label("Request parameter", exact=True).fill(name)
            for field, value in {
                "query-name": "catalog_workspace", "route-path": "/data/catalog",
                "description": "products data query", "public-origin": inputs["publicOrigin"],
                "max-rows": "2", "timeout": "1500", "amount": "10000",
                "asset": inputs["payment"]["asset"], "pay-to": inputs["payment"]["payTo"],
            }.items():
                page.locator("#" + field).fill(value)
            preview, choices = post_click(page, "/api/preview", page.locator("#preview").click)
            exported, _ = post_click(page, "/api/export", page.locator("#export").click, 201)
            expect(page.locator("#release-selection")).to_be_visible()
            expect(page.locator("#release-fleet-source")).to_be_enabled()
            expect(page.locator("#release-stage")).to_be_disabled()
            page.locator("#release-facilitator").fill(inputs["runtime"]["facilitator"])
            page.locator("#release-local-facilitator").check()
            page.locator("#release-port").fill("")
            target = download(page, page.locator("#release-fleet-source"), "workspace-fleet-source.json")
            source = json.loads(target.read_text())
            check_source(source, exported["directory"])
            assert preview["source"]["queries"]["catalog_workspace"]["parameterOrder"] == ["region", "minimum_id"]
            result.update(choices=choices, exported=exported, source=source,
                          sourceFile=str(target), noReleaseStoreRequired=True,
                          responsive=responsive(page, "postgres-workspace-source"))

        elif phase == "handoff":
            page.goto(inputs["consoleUrl"])
            details = page.locator("details.postgres-staging")
            if details.get_attribute("open") is None:
                details.locator("summary").click()
            sources = {}
            for index, item in enumerate(inputs["packages"]):
                page.locator("#postgres-package").fill(item["relativePath"])
                page.locator("#postgres-id").fill("source-review-" + str(index))
                page.locator("#postgres-port").fill("8423")
                page.locator("#postgres-facilitator").fill(inputs["runtime"]["facilitator"])
                page.locator("#postgres-local-facilitator").check()
                review, submitted = post_click(page, "/api/postgres/review", page.locator("#postgres-review").click)
                expect(page.locator("#postgres-fleet-source")).to_be_enabled()
                assert submitted["postgresPackage"] == item["relativePath"]
                assert submitted["postgresPackage"] != review["postgresPackage"]
                page.locator("#postgres-port").fill("")
                filename = item["tenant"] + "-" + item["alias"] + "-fleet-source.json"
                target = download(page, page.locator("#postgres-fleet-source"), filename)
                source = json.loads(target.read_text())
                check_source(source, item["directory"])
                assert source["postgresInputManifestSha256"] == review["postgres"]["inputManifestSha256"]
                sources.setdefault(item["tenant"], {})[item["alias"]] = source
            assert sources["products"]["current"] == inputs["workspaceSource"]
            result["consoleResponsive"] = responsive(page, "postgres-release-source")
            native = inputs["native"]
            for tenant in native["tenants"]:
                tenant["packages"] = sources[tenant["id"]]
            source_input = work / "source-input.json"
            save_json(source_input, native)
            page.close()
            page = context.new_page()
            page.goto(inputs["fleetUrl"])
            page.locator("#fleet-file-input").set_input_files(str(source_input))
            page.wait_for_function("document.querySelector('#fleet-status').textContent.startsWith('Setup opened.')")
            for field, value in {
                "fleet-folder": "postgres-fleet", "fleet-directory": inputs["directory"],
                "fleet-mcp-directory": inputs["mcpDirectory"], "fleet-workspace-port": "0",
            }.items():
                page.locator("#" + field).fill(value)
            page.locator('[data-fleet-step="1"]').click()
            current_index = list(native["tenants"][0]["packages"]).index("current")

            def card():
                return page.locator(".fleet-source-card").nth(current_index)

            def field(name):
                return page.locator('[data-field="tenants.0.sources.' + str(current_index) + '.' + name + '"]')

            current_file = work / "products-current-fleet-source.json"
            card().locator('input[type="file"]').set_input_files(str(current_file))
            page.wait_for_function("document.querySelector('#fleet-status').textContent.startsWith('Imported PostgreSQL')")
            expect(field("name")).to_have_value("current")
            expect(field("path")).to_have_value(sources["products"]["current"]["postgresPackage"])
            card().get_by_text("Reviewed PostgreSQL package", exact=True).click()
            expect(card().locator("details pre")).to_have_text(sources["products"]["current"]["postgresInputManifestSha256"])
            field("kind").select_option("mysqlPackage")
            assert card().get_by_text("Reviewed PostgreSQL package", exact=True).count() == 0
            field("kind").select_option("postgresPackage")
            assert card().get_by_text("Reviewed PostgreSQL package", exact=True).count() == 0
            card().locator('input[type="file"]').set_input_files(str(current_file))
            page.wait_for_function("document.querySelector('#fleet-status').textContent.startsWith('Imported PostgreSQL')")
            card().get_by_text("Reviewed PostgreSQL package", exact=True).click()
            result["fleetResponsive"] = responsive(page, "postgres-fleet-source")
            draft_file = download(page, page.locator("#fleet-download-draft"), "downloaded-draft.json")
            draft = json.loads(draft_file.read_text())
            selected = next(source for source in draft["tenants"][0]["sources"] if source["name"] == "current")
            assert selected["postgresInputManifestSha256"] == sources["products"]["current"]["postgresInputManifestSha256"]
            page.reload()
            page.locator("#fleet-file-input").set_input_files(str(draft_file))
            page.wait_for_function("document.querySelector('#fleet-status').textContent.startsWith('Setup opened.')")
            page.locator('[data-fleet-step="2"]').click()
            expect(page.locator("#fleet-download-packet")).to_be_enabled()
            zip_file = download(page, page.locator("#fleet-download-packet"), "postgres-fleet.zip")
            result["launchResponsive"] = responsive(page, "postgres-fleet-launch")
            result.update(sources=sources, zipFile=str(zip_file), canonicalRelativePaths=True,
                          reviewIdentityRoundtrip=True, typeChangeClearedReview=True)

        elif phase == "managed":
            page.goto(inputs["url"])
            expect(page.locator("#release-link")).to_have_text("Managed releases linked")
            page.locator("#release-tenant").select_option("products")
            expect(page.locator("#release-package")).to_contain_text("PostgreSQL")
            page.locator("#release-processes").get_by_role("button", name="Show merchant tools", exact=True).first.click()
            operations = page.locator("#release-processes").get_by_role("link", name="Operations", exact=True).first
            expect(operations).to_be_visible()
            with context.expect_page() as pending:
                operations.click()
            operation_page = pending.value
            expect(operation_page.locator("main")).to_be_visible()
            operation_page.screenshot(path=str(work / "postgres-native-operations.png"), full_page=True)
            result["operationsOpened"] = True
            operation_page.close()
            result["responsive"] = responsive(page, "postgres-managed-fleet")
        else:
            raise ValueError("Unknown browser phase: " + phase)
        assert errors == [], errors
    finally:
        browser.close()

save_json(output_file, result)
print(json.dumps({"phase": phase, "browserErrors": errors, "result": "PASS"}))
