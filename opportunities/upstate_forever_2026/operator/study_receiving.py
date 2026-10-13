"""Authenticated file links for one retained selected-study receiving view."""
from pathlib import Path

from model import study_receiving


def read(operator, workspace_key, operation, value):
    workspace = operator.ws(workspace_key)
    if operation == "received":
        return study_receiving.catalog(
            workspace, offset=int(value.get("offset", 0)), limit=int(value.get("limit", 50)))
    result = study_receiving.detail(workspace, value.get("study_id"))

    def tickets(members, *, prefix=None):
        rows = []
        for item in members:
            path = Path(workspace.root) / item["path"]
            record = operator._ticket(
                workspace_key, str(path), {**item, "filename": path.name},
                item["path"][len(prefix):] if prefix and item["path"].startswith(prefix) else path.name)
            rows.append(record)
        return rows

    for report in result["reports"]:
        report["_downloads"] = tickets(report["members"])
    from report_changes import ReportChanges
    for comparison in result.get("report_comparisons", []):
        prefix = "scientific-report-comparisons/" + comparison["id"] + "/"
        comparison["_viewer_url"] = ReportChanges._url(workspace_key, comparison["id"], "index.html")
        for edition in comparison["edition_links"]:
            name = edition.get("report_html_path")
            edition["viewer_url"] = ReportChanges._url(
                workspace_key, comparison["id"], edition["side"] + "/" + name) if name else None
        comparison["_downloads"] = tickets(comparison["members"], prefix=prefix)
        comparison["_archive_downloads"] = tickets(
            [comparison["archive"]] if comparison.get("archive") is not None else [])
    for source in result["field_sources"]:
        for report in source["reports"]:
            report["_downloads"] = tickets(report["members"])
        for packet in source["deployments"]:
            packet["_downloads"] = tickets(packet["members"])
        if source.get("laboratory") is not None:
            lab = source["laboratory"]
            lab["_request_downloads"] = tickets(lab["request_members"])
            lab["_report_downloads"] = tickets(lab["report_members"])
    import gauge_receiving
    gauge_receiving.decorate(operator, workspace_key, result)
    import ensemble_receiving
    ensemble_receiving.decorate(operator, workspace_key, result)
    import observed_landcover_receiving
    observed_landcover_receiving.decorate(operator, workspace_key, result)
    import received_published_reviews
    received_published_reviews.decorate(operator, workspace_key, result)
    import assessment_receiving
    assessment_receiving.decorate(operator, workspace_key, result)
    result["workspace_key"] = workspace_key
    return result
