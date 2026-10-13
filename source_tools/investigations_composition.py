"""Join saved Scientific interpretation to the original native Investigations desk."""
from __future__ import annotations

CALLBACK = "experimentDiagnostics.setInvestigationHandler(async selection=>{\n const selectedWorkspace=workspace;\n if(selection?.workspace_key!==selectedWorkspace)throw Error('Open this analysis in its original selected workspace.');\n await extensions.load();\n if(workspace!==selectedWorkspace)throw Error('The workspace changed while opening this analysis.');\n return extensions.openExtension('investigations','openForDiagnostic',selection);\n});\n"


PROGRAMME_CAPABILITY = " openNativeProgramme:options=>experiments.openForInvestigation(options),\n"
PROGRAMME_ANCHOR = "const extensions=createExtensionHost({"


def _native_programme(source):
    """Expose the original built-in controller without constructing another desk."""
    if PROGRAMME_CAPABILITY in source:
        if source.count(PROGRAMME_CAPABILITY) != 1:
            raise ValueError("Ambiguous original programme designer capability.")
        return source
    if "openNativeProgramme:" in source:
        raise ValueError("Compose the existing original programme designer capability.")
    built_in = ("const experiments=attachExperiments(" in source
                or "const experiments = attachExperiments(" in source)
    if not built_in:
        # A fully migrated host uses its registered experiments desk instead.
        return source
    if source.count(PROGRAMME_ANCHOR) != 1:
        raise ValueError("Compose the original extension host's programme capability.")
    return source.replace(PROGRAMME_ANCHOR, PROGRAMME_ANCHOR + "\n" + PROGRAMME_CAPABILITY, 1)



def registered_diagnostics(application):
    """Validate the maintained registered desk's existing investigation bridge."""
    import json
    from pathlib import Path
    application = Path(application).resolve()
    descriptor = application / "operator/extensions/experiment-diagnostics.json"
    if not descriptor.is_file():
        return False
    value = json.loads(descriptor.read_text(encoding="utf-8"))
    client = value.get("client", {})
    if (value.get("schema") != "upstate.operator-extension/v1"
            or value.get("id") != "experiment-diagnostics"
            or client.get("module") != "/web/retained_desks.mjs"
            or client.get("factory") != "attachDiagnosticsDesk"
            or client.get("view", {}).get("id") != "experiment-diagnostics"):
        raise ValueError("Compose the installed Scientific interpretation registration.")
    bridge = (application / "operator/web/retained_desks.mjs").read_text(encoding="utf-8")
    required = (
        "export async function attachDiagnosticsDesk(host)",
        "await import('./experiment_diagnostics.mjs')",
        "selection=>host.openExtension('investigations','openForDiagnostic',selection)",
    )
    if any(part not in bridge for part in required):
        raise ValueError("Compose the registered Scientific interpretation investigation bridge.")
    return True


def patch_app(source, *, diagnostics_registered=False):
    source = _native_programme(source)
    marker = "experimentDiagnostics.setInvestigationHandler(async selection=>{"
    if CALLBACK in source:
        if source.count(CALLBACK) != 1 or source.count(marker) != 1:
            raise ValueError("Ambiguous original diagnostic investigation callback.")
        return source
    if marker in source:
        raise ValueError("Compose the existing diagnostic investigation callback.")
    if "const experimentDiagnostics=" not in source and "const experimentDiagnostics =" not in source:
        if diagnostics_registered:
            return source
        raise ValueError("Install the current original Scientific interpretation desk first.")
    if "const extensions=createExtensionHost(" not in source:
        raise ValueError("Install the current original typed extension host first.")
    anchor = "function toast(message){"
    if source.count(anchor) != 1:
        raise ValueError("Expected one current original operator toast function.")
    return source.replace(anchor, CALLBACK + anchor, 1)
