"""Tethys registration for the maintained groundwater workspace."""
from tethys_sdk.base import TethysAppBase
from tethys_sdk.app_settings import JSONCustomSetting
from tethys_sdk.permissions import Permission, PermissionGroup


class App(TethysAppBase):
    name = "Groundwater workspace"
    description = (
        "Source-preserving MODFLOW baseline, scenario, review and receiving "
        "over the original groundwater workspace."
    )
    package = "groundwater_workshare"
    root_url = "groundwater-workshare"
    index = "home"
    icon = "groundwater_workshare/images/icon.svg"
    color = "#24566b"
    tags = "Groundwater, MODFLOW, source review, receiving"
    enable_feedback = False

    def custom_settings(self):
        return (
            JSONCustomSetting(
                name="portal_configuration",
                description=(
                    "Private workspace scope (user or app), default named slot, "
                    "and maximum JSON request size. Contains no tenant secret, "
                    "solver path, or external receiving destination."
                ),
                required=False,
                default={
                    "workspace_scope": "user",
                    "default_slot": "workspace",
                    "max_request_bytes": 33554432,
                },
            ),
        )

    def permissions(self):
        definitions = (
            ("view_workspace", "Open this app and read its selected private workspace"),
            ("edit_workspace", "Create projects, import sources and create scenario editions"),
            ("review_workspace", "Record attributed edition and native-result reviews"),
            ("execute_runs", "Prepare or continue the original bounded native run"),
            ("configure_runtime", "Inspect and register installed native executable paths"),
            ("publish_reports", "Freeze an approved native report"),
            ("receive_reports", "Configure local receiving and record delivery or acknowledgment"),
            ("backup_workspace", "Create or resume the complete private backup"),
            ("use_shared_workspace", "Use the app-wide private workspace when configured"),
        )
        permissions = {name: Permission(name, description) for name, description in definitions}
        return (
            *permissions.values(),
            PermissionGroup("groundwater_reader", (permissions["view_workspace"],)),
            PermissionGroup(
                "groundwater_analyst",
                tuple(permissions[k] for k in ("view_workspace", "edit_workspace", "execute_runs")),
            ),
            PermissionGroup(
                "groundwater_reviewer",
                tuple(permissions[k] for k in ("view_workspace", "review_workspace")),
            ),
            PermissionGroup(
                "groundwater_receiver",
                tuple(permissions[k] for k in ("view_workspace", "receive_reports")),
            ),
            PermissionGroup(
                "groundwater_operator",
                tuple(permissions[k] for k in (
                    "view_workspace", "edit_workspace", "review_workspace", "execute_runs",
                    "publish_reports", "receive_reports", "backup_workspace",
                )),
            ),
            PermissionGroup("groundwater_administrator", tuple(permissions.values())),
        )

