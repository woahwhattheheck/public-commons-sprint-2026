#!/usr/bin/env python3
"""Operate rehearsals through the existing authenticated local operator.

Copyright 2026 TokenJunkieLabs. Reads the original startup JSON and task/file APIs.
This command never starts a scientific worker or silently retries a mutation.
"""
from __future__ import annotations
import argparse
import http.client
import json
from pathlib import Path
import re
import sys
import urllib.parse

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
from model.common import canonical, identifier, read_json
from model.retained_download import download as receive_download, receive_cohort

ACTIONS = {"rehearsal.save", "rehearsal.begin", "rehearsal.record", "rehearsal.export"}
MAX_JSON = 4 * 1024 * 1024
MAX_RESPONSE = 64 * 1024 * 1024


class Client:
    def __init__(self, connection):
        value = read_json(connection)
        url = urllib.parse.urlsplit(value["operator_url"])
        fragment = urllib.parse.parse_qs(url.fragment)
        tokens = fragment.get("token", [])
        origin = urllib.parse.urlsplit(value["origin"])
        if (url.scheme != "http" or url.hostname != "127.0.0.1"
            or url.username is not None or url.password is not None
            or not url.port or url.path not in ("", "/") or url.query
            or len(tokens) != 1 or not tokens[0]
            or origin.scheme != "http" or origin.hostname != "127.0.0.1"
            or origin.port != url.port or origin.path not in ("", "/")
            or origin.query or origin.fragment or origin.username is not None):
            raise ValueError("Select the exact existing operator startup JSON")
        self.port, self.token = url.port, tokens[0]
        self.workspace = identifier(value["workspace_key"])

    def json(self, path, body=None):
        if not path.startswith("/api/") or "\r" in path or "\n" in path:
            raise ValueError("Choose an original local operator API")
        data = canonical(body) if body is not None else None
        if data is not None and len(data) > MAX_JSON:
            raise ValueError("The original operator JSON limit is 4 MiB")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        try:
            headers = {"Authorization": "Bearer " + self.token, "Accept": "application/json"}
            if data is not None:
                headers.update({"Content-Type": "application/json", "Content-Length": str(len(data))})
            connection.request("POST" if data is not None else "GET", path, body=data, headers=headers)
            response = connection.getresponse()
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ValueError("The original operator response exceeds the declared JSON capacity")
            declared = response.getheader("Content-Length")
            if declared is not None and (not declared.isdecimal() or int(declared) != len(raw)):
                raise ValueError("The complete operator response length differs")
            value = json.loads(raw)
            if not 200 <= response.status < 300:
                error = value.get("error", {})
                raise RuntimeError(str(response.status) + " " + str(error.get("code", "OPERATOR")) +
                                   ": " + str(error.get("message", value)))
            return value
        finally:
            connection.close()

    def query(self, path, **values):
        return self.json(path + "?" + urllib.parse.urlencode({
            "workspace": self.workspace, **{k: v for k, v in values.items() if v is not None}}))

    def submit(self, request):
        if (not isinstance(request, dict) or set(request) != {"workspace", "action", "payload", "operation_id"}
            or request["workspace"] != self.workspace or request["action"] not in ACTIONS
            or not isinstance(request["payload"], dict)
            or not isinstance(request["operation_id"], str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", request["operation_id"])):
            raise ValueError("Supply the full frozen rehearsal request for this exact original workspace")
        return self.json("/api/actions", request)

    def task(self, key):
        return self.json("/api/task?" + urllib.parse.urlencode({"id": identifier(key)}))

    def resume(self, key):
        current = self.task(key)
        if current["action"] not in ACTIONS or current["workspace"] != self.workspace:
            raise ValueError("Select this workspace's original rehearsal task")
        return self.json("/api/task/resume", {"id": current["id"]})

    def download(self, ticket, destination, *, progress=None):
        return receive_download(self.port, self.token, ticket, destination, progress=progress)

    def download_all(self, tickets, directory, *, task=None, progress=None):
        source = {"workspace": self.workspace}
        if task is not None:
            source["task"] = identifier(task)
        return receive_cohort(self.port, self.token, tickets, directory,
                              source=source, progress=progress)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", type=Path, required=True, help="Original operator startup JSON; contains the private local capability")
    parser.add_argument("--workspace", help="Select an existing workspace on the same operator")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("overview")
    select = sub.add_parser("record")
    select.add_argument("--id", required=True)
    select.add_argument("--revision", type=int)
    submit = sub.add_parser("submit")
    submit.add_argument("--file", type=Path, required=True, help="Complete frozen workspace/action/payload/operation_id object")
    task = sub.add_parser("task")
    task.add_argument("--id", required=True)
    resume = sub.add_parser("resume")
    resume.add_argument("--id", required=True)
    download = sub.add_parser("download")
    download.add_argument("--task", required=True)
    download.add_argument("--member", required=True, help="Exact _downloads filename or ticket ID")
    download.add_argument("--out", type=Path, required=True)
    download.add_argument("--progress", action="store_true", help="Write durable byte progress to stderr")
    cohort = sub.add_parser("download-all", help="Receive every original file from one completed task")
    cohort.add_argument("--task", required=True)
    cohort.add_argument("--out", type=Path, required=True, help="Directory for the complete selected cohort")
    cohort.add_argument("--progress", action="store_true", help="Write durable per-member progress to stderr")
    args = parser.parse_args()
    client = Client(args.connection)
    if args.workspace:
        client.workspace = identifier(args.workspace)
    if args.command == "overview":
        value = client.query("/api/rehearsals/overview")
    elif args.command == "record":
        value = client.query("/api/rehearsals/record", id=identifier(args.id), revision=args.revision)
    elif args.command == "submit":
        value = client.submit(read_json(args.file))
    elif args.command == "task":
        value = client.task(args.id)
    elif args.command == "resume":
        value = client.resume(args.id)
    else:
        task = client.task(args.task)
        if task["workspace"] != client.workspace or task["state"] != "complete":
            raise ValueError("Select a completed task in the current workspace")
        progress = (lambda value: print(json.dumps(value, ensure_ascii=False), file=sys.stderr, flush=True)) if args.progress else None
        if args.command == "download-all":
            value = client.download_all(task.get("_downloads", []), args.out,
                                        task=task["id"], progress=progress)
        else:
            matches = [item for item in task.get("_downloads", [])
                       if args.member in (item["id"], item["filename"])]
            if len(matches) != 1:
                raise ValueError("Choose one exact original download filename or ticket ID")
            value = client.download(matches[0], args.out, progress=progress)
    print(json.dumps(value, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
