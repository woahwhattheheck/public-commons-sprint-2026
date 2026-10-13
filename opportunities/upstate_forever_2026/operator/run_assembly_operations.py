"""Read the installed original run.start completed-stage capability."""
from __future__ import annotations

import inspect


class RunAssemblyOperations:
    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def read(self, workspace_key, operation, payload):
        if operation != "catalog":
            raise self.fault("RUN_ASSEMBLY_ROUTE",
                             "Choose the native run assembly catalogue.", 404)
        workspace = self.operator.ws(workspace_key)
        available, reason = False, ""
        try:
            from ecsa_runs import upstate
            capabilities = getattr(upstate, "ORIGINAL_RUN_CAPABILITIES", {})
            declared = (isinstance(capabilities, dict) and
                        isinstance(capabilities.get("run.start"), dict) and
                        capabilities["run.start"].get("source_runs") is True)
            if not declared:
                reason = "Install the current original run.start source-runs helper."
            elif not callable(getattr(workspace, "combine_runs", None)):
                reason = "Install the selected-model Workspace assembly method."
            else:
                source = inspect.getsourcefile(type(self.operator))
                if not source:
                    reason = "Open the original operator from its installed source."
                else:
                    # The maintained integrator examines the actual original
                    # Operator._invoke run.start branch. This read never writes.
                    joined = upstate.integrate_operator(source, write=False)
                    available = joined.get("state") == "already_integrated"
                    if not available:
                        reason = "Join the original run.start helper in this operator."
        except ImportError as error:
            reason = "Install the original native retention and assembly modules: " + str(error)
        except (OSError, TypeError, ValueError, SyntaxError, AttributeError) as error:
            reason = str(error) or type(error).__name__
        return {
            "schema": "upstate.native-run-assembly-capabilities/v1",
            "available": available,
            "action": "run.start",
            "source_runs": available,
            "source_models": ["ndr", "sdr"],
            "helper": "ecsa_runs.upstate.invoke_original_run",
            "result": "original_complete_native_run",
            "reason": reason,
        }
