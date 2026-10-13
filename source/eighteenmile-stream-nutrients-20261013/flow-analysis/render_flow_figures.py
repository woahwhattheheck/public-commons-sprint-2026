"""Render retained stream-flow coverage with Matplotlib for print/export."""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def render(application, analysis, output):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    application = Path(application).resolve(strict=True)
    analysis = Path(analysis).resolve(strict=True)
    output = Path(output).resolve()
    inputs = json.loads((analysis / "input-manifest.json").read_text(encoding="utf-8"))
    daily = next(row for row in inputs["inputs"] if row["role"] == "daily")
    body = (application / daily["path"]).resolve(strict=True)
    if not body.is_relative_to(application):
        raise ValueError("Original daily source is outside the application")
    raw = body.read_bytes()
    if len(raw) != daily["bytes"] or hashlib.sha256(raw).hexdigest() != daily["sha256"]:
        raise ValueError("Original daily source differs")
    manifest = json.loads((analysis / "model-sources.json").read_text(encoding="utf-8"))
    for name in ("activity-flow.csv", "flow-thresholds.csv"):
        entry = next(row for row in manifest["entries"] if row["path"] == name)
        raw = (analysis / name).read_bytes()
        if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Retained analysis differs: " + name)
    daily_rows = [row for row in read_csv(body) if row["site"] == "02186702"]
    activities = read_csv(analysis / "activity-flow.csv")
    thresholds = {row["year"]: row for row in read_csv(analysis / "flow-thresholds.csv")}
    years = sorted({row["date"][:4] for row in daily_rows})
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "pdf.fonttype": 42, "svg.fonttype": "none"})
    fig, axes = plt.subplots(len(years), 1, figsize=(8.27, 11.69), squeeze=False)
    for year, (ax,) in zip(years, axes):
        rows = [row for row in daily_rows if row["date"].startswith(year)]
        values = np.array(sorted((float(row["reported_mean_cfs"]) for row in rows), reverse=True))
        exceedance = 100 * (np.arange(len(values)) + .5) / len(values)
        sample_dates = {row["date"] for row in activities if row["date"].startswith(year)}
        sample_values = [float(row["reported_mean_cfs"]) for row in rows if row["date"] in sample_dates]
        sample_x = [100 * (np.count_nonzero(values > value) + .5 * np.count_nonzero(values == value)) / len(values)
                    for value in sample_values]
        ax.plot(exceedance, values, color=".45", linewidth=1, label="All original daily means")
        ax.scatter(sample_x, sample_values, color=".08", s=13, zorder=3, label="Unique sampling dates")
        p95 = float(thresholds[year]["p95_cfs"])
        ax.axhline(p95, color=".65", linewidth=.7, linestyle="--")
        ax.text(.985, .90, year + " · " + str(len(sample_dates)) + " sample dates",
                transform=ax.transAxes, ha="right", va="top")
        ax.text(.985, .68, "P95 = " + format(p95, ".5g") + " cfs",
                transform=ax.transAxes, ha="right", va="top", color=".35")
        ax.set_yscale("function", functions=(np.log1p, np.expm1))
        ticks = [0, 10, 30, 100, 300, 1000, 3000]
        ticks = [value for value in ticks if value <= values.max() * 1.1]
        ax.set_yticks(ticks, [str(value) for value in ticks])
        ax.set_xlim(0, 100)
        ax.set_ylim(0, values.max() * 1.1)
        ax.set_ylabel("Daily mean\ncfs")
        ax.set_xticks([0, 25, 50, 75, 100])
        ax.grid(axis="y", linewidth=.35, color=".85")
    axes[-1, 0].set_xlabel("Exceedance rank (%) · empirical midrank")
    axes[0, 0].legend(loc="lower left", frameon=False, fontsize=8)
    fig.suptitle("Eighteenmile stream sampling and original gauge flow, 2020–2025",
                 y=.988, fontsize=12)
    fig.text(.5, .008,
             "USGS 02186702 daily means; original WQP sample dates. Vertical scale: log(1 + cfs).\n"
             "Flow is regional daily context. Original point locations and network relations remain separate.",
             ha="center", fontsize=8)
    fig.tight_layout(rect=(0, .04, 1, .97), h_pad=.8)
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for extension in ("pdf", "svg", "png"):
        path = output / ("flow-duration-print." + extension)
        options = {"dpi": 200} if extension == "png" else {}
        fig.savefig(path, **options)
        raw = path.read_bytes()
        files.append({"path": path.name, "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest()})
    plt.close(fig)
    result = {"schema": "upstate.stream-flow-figures/v1", "original_daily_sha256": daily["sha256"],
              "gauge": "02186702", "days": len(daily_rows),
              "unique_sample_dates": len({row["date"] for row in activities}),
              "files": files}
    (output / "figure-files.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--analysis", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(render(args.application, args.analysis, args.output), sort_keys=True))


if __name__ == "__main__":
    main()
