"""Compatibility route for the original earlier package-based operator."""
from ..model.monitoring_actions import invoke

def route_monitoring(workspace, action, params):
    return invoke(workspace, action, params)
