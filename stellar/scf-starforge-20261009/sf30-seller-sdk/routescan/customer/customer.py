#!/usr/bin/env python3
"""Python access to the same original SF88 native inbox used by customer.mjs."""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


class RoutescanCustomerError(RuntimeError):
    def __init__(self, message, result=None):
        super().__init__(message)
        self.result = result


class RoutescanCustomer:
    """The Node adapter uses the original SDK; Python creates no purchase state."""

    def __init__(self, *, runtime, state, inbox, profile=None, node=None, adapter=None):
        self.node = node or os.environ.get("STELLAR_FORGE_NODE", "node")
        self.adapter = str(adapter or Path(__file__).with_name("customer.mjs"))
        self.common = ["--runtime", str(runtime), "--state", str(state), "--inbox", str(inbox)]
        if profile:
            self.common += ["--profile", str(profile)]

    def command(self, mode, **values):
        args = [self.node, self.adapter, mode, *self.common]
        for name, value in values.items():
            if value is not None:
                args += ["--" + name.replace("_", "-"), str(value)]
        return args

    def call(self, mode, **values):
        """Read/prepare using the original adapter. Execute retains the terminal."""
        if mode == "execute":
            completed = subprocess.run(self.command(mode, **values), check=False)
            original = self.call("inspect", intent=values["intent"])
            return {"processExitCode": completed.returncode, "original": original}
        completed = subprocess.run(self.command(mode, **values), check=False, text=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if completed.returncode:
            try:
                error = json.loads(completed.stderr)
            except json.JSONDecodeError:
                error = {"error": "The original Routescan customer command failed.", "exitCode": completed.returncode}
            raise RoutescanCustomerError(error.get("error", "Customer command failed."), error)
        if mode == "csv":
            return completed.stdout
        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise RoutescanCustomerError("The original command did not return a complete JSON result.") from error

    def initialize(self):
        return self.call("init")

    def prepare(self, *, client, operation, inputs, intent, max_atomic, accept=0, workspace=None):
        return self.call("prepare", client=client, operation=operation, inputs=inputs,
                         intent=intent, max_atomic=max_atomic, accept=accept, workspace=workspace)

    def review(self, intent, output=None):
        return self.call("review", intent=intent, output=output)

    def execute(self, intent, workspace=None, review_file=None):
        return self.call("execute", intent=intent, workspace=workspace, review_file=review_file)

    def inspect(self, intent):
        return self.call("inspect", intent=intent)

    def recover(self, intent):
        return self.call("recover", intent=intent)

    def response(self, intent):
        return self.call("response", intent=intent)

    def json(self, intent):
        return self.call("json", intent=intent)

    def csv(self, intent):
        return self.call("csv", intent=intent)

    def download(self, intent, output):
        return self.call("download", intent=intent, output=output)

    def finalize(self, intent, workspace):
        return self.call("finalize", intent=intent, workspace=workspace)

    def report(self, output, workspace=None):
        return self.call("report", output=output, workspace=workspace)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "prepare", "attach", "review", "execute", "inspect",
                                           "recover", "response", "download", "json", "csv", "finalize", "report", "list"])
    for name in ("runtime", "state", "inbox"):
        parser.add_argument("--" + name, required=True)
    for name in ("profile", "client", "operation", "inputs", "intent", "max-atomic", "accept",
                 "output", "workspace", "review-file", "node"):
        parser.add_argument("--" + name)
    args = vars(parser.parse_args())
    customer = RoutescanCustomer(runtime=args.pop("runtime"), state=args.pop("state"), inbox=args.pop("inbox"),
                                 profile=args.pop("profile"), node=args.pop("node"))
    command = args.pop("command")
    result = customer.call(command, **{name: value for name, value in args.items() if value is not None})
    if command == "csv":
        sys.stdout.write(result)
    else:
        print(json.dumps(result, indent=2))
    if command == "execute" and result["processExitCode"]:
        sys.exit(result["processExitCode"])


if __name__ == "__main__":
    try:
        main()
    except RoutescanCustomerError as error:
        print(json.dumps(error.result or {"error": str(error)}), file=sys.stderr)
        sys.exit(1)
