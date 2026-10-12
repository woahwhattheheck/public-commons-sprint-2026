# SPDX-License-Identifier: MIT
def classFactory(iface):
    from .plugin import StarforgeStacPlugin
    return StarforgeStacPlugin(iface)
