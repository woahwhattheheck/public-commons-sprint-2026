"""Original verified download tickets for captured Published-study reviews."""
from pathlib import PurePosixPath
from model.common import verify_file


def decorate(operator, workspace_key, result):
    workspace = operator.ws(workspace_key)
    for review in result.get("published_reviews", []):
        downloads = []
        for item in review["source_members"]:
            path = verify_file(workspace.root, item)
            label = item["label"]
            downloads.append(operator._ticket(
                workspace_key, path,
                {**item, "filename": PurePosixPath(label).name}, label))
        review["_downloads"] = downloads
    return result
