"""Original review download tickets; the transport verifies bytes on opening."""
from pathlib import PurePosixPath
from model.common import identifier


def decorate(operator, workspace_key, result):
    from model.study_transfer import _member
    workspace = operator.ws(workspace_key)
    root = workspace.root.resolve()
    for review in result.get("published_reviews", []):
        downloads = []
        for item in review["source_members"]:
            # The original resolver supplied this exact retained descriptor.
            # A ticket describes it; open_download hashes the actual opened
            # file and checks descriptor stability before serving any bytes.
            identifier(item["sha256"])
            if type(item.get("bytes")) is not int or item["bytes"] < 0:
                raise ValueError("The retained review download needs its original length")
            path = _member(root, item["path"])
            if path.stat().st_size != item["bytes"]:
                raise ValueError("The retained review download changed its original length")
            label = item["label"]
            downloads.append(operator._ticket(
                workspace_key, path,
                {**item, "filename": PurePosixPath(label).name}, label))
        review["_downloads"] = downloads
    return result
