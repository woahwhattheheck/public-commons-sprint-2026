UPSTREAM ?= upstream
COMMIT   ?= 7a6e803
BUILT    ?= $(shell date +%Y-%m-%d)

.PHONY: all upstream build report test clean

all: build report

upstream:
	@test -d $(UPSTREAM) || git clone https://github.com/GSA/dcat-us.git $(UPSTREAM)
	@git -C $(UPSTREAM) fetch --quiet origin && git -C $(UPSTREAM) checkout --quiet $(COMMIT)
	@echo "upstream at $$(git -C $(UPSTREAM) rev-parse --short HEAD)"

build: upstream
	python -m dcat_us_binding.cli --upstream $(UPSTREAM)/jsonschema

report: build
	python -c "from pathlib import Path; from dcat_us_binding.report import write_report; \
	print(write_report(Path('build/measurements.json'), Path('reports/REPORT.md'), '$(COMMIT)', '$(BUILT)'))"

test:
	python -m pytest -q

clean:
	rm -rf build reports/REPORT.md
