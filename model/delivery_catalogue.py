"""Small current views of complete original delivery records."""
from .common import digest

REPORT_ROLES = (
    "report", "report_html", "report_markdown", "report_data", "report_model",
    "client_report", "client_report_html", "client_report_markdown",
    "client_report_data", "client_report_model",
)


def delivery_view(record):
    """One revision and report availability shared by polling and inspection."""
    files = record.get("files") or {}
    selection = record.get("selection") or {}
    return {
        "schema": "upstate.delivery-view/v1",
        "revision": digest(record),
        "report_roles": [role for role in REPORT_ROLES if role in files],
        "report_edition": "|".join(str(selection.get(selected) or record.get(saved) or "")
                                  for selected, saved in (
                                      ("client_report_edition", "report_edition"),
                                      ("report_renderer_version", "report_renderer_version"),
                                      ("client_companion_edition", "client_companion_edition"))),
    }
