"""Compatibility import for the maintained complete-project provider.

Historical descriptors may still name this module. Both descriptor names now
use the same maintained provider implementation and current action declarations.
"""
from extension_modules.project_continuity import (
    ProjectContinuityExtension as ProjectContinuity,
    create,
)
from project_continuity import ACTIONS
