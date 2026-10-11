"""Consume an operator-provided SF88 config, or recover its already-saved data.

python buy_dataset.py --checkout /work/public-commons-sprint-2026 \
    --state /private/data-buyer --config /private/order.json

To read an existing result without calling the seller:
python buy_dataset.py --checkout /work/public-commons-sprint-2026 \
    --state /private/data-buyer --recover weekly-data-2026-10-11
"""
import argparse
import json

from stellar_forge_buyer import Buyer

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--checkout", required=True)
parser.add_argument("--state", required=True)
mode = parser.add_mutually_exclusive_group(required=True)
mode.add_argument("--config")
mode.add_argument("--recover")
parser.add_argument("--format", choices=("json", "csv", "binary"), default="json")
args = parser.parse_args()
buyer = Buyer(checkout=args.checkout, state_dir=args.state)
if args.config:
    operation = buyer.from_config(args.config)
    review = operation.review()
    print(json.dumps(review.native, indent=2))
    result = operation.execute(review=review)
else:
    operation = buyer.operation(args.recover)
    result = operation.recover()
if result is None:
    raise SystemExit(json.dumps(operation.inspect(), indent=2))
print(json.dumps({"nativeStatus": result.status, "delivery": result.delivery}, indent=2))
if args.format == "json":
    print(json.dumps(result.json(), indent=2))
elif args.format == "csv":
    for row in result.csv_rows():
        print(json.dumps(row))
else:
    with result.open() as stream:
        print("Verified binary bytes:", stream.seek(0, 2))
