"""Original process-supervisor entrypoint."""
import argparse
from .native import supervise
def main():
    parser = argparse.ArgumentParser(description="Keep one original Hive process and its full log.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--deployment", required=True)
    parser.add_argument("--attempt", required=True)
    parser.add_argument("--lease-fd", type=int, required=True)
    args = parser.parse_args()
    return supervise(args.workspace, args.deployment, args.attempt, args.lease_fd)
if __name__ == "__main__":
    raise SystemExit(main())
