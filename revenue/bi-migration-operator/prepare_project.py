"""Bind an extracted native Power BI project's local CSV folder."""
from pathlib import Path
import re


def prepare(root=None):
    root = Path(root or Path(__file__).parent).resolve()
    text = str(root).replace("\\", "/").replace("#", "#(#)").replace('"', '""')
    count = 0
    for path in root.glob("*.SemanticModel/definition/model.tmdl"):
        original = path.read_text(encoding="utf-8")
        replacement = 'expression DataRoot = "' + text + '" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]'
        updated, matches = re.subn(r"(?m)^expression DataRoot = .*?$", lambda _: replacement, original)
        if matches:
            path.write_text(updated, encoding="utf-8")
            count += matches
    return {"folder": str(root), "local_data_parameters": count, "projects": [p.name for p in root.glob("*.pbip")]}


if __name__ == "__main__":
    import json
    print(json.dumps(prepare(), indent=2))
