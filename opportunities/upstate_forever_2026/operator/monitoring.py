"""Compatibility route using the current application model namespace."""
from model.monitoring_actions import invoke

def route_monitoring(workspace, action, params):
    return invoke(workspace, action, params)
