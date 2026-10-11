IMAGE ?= hack-apertus-ost-track2a:2026
INPUT ?= /data/cases.jsonl
OUTPUT ?= /output/predictions.jsonl
DATA_DIR ?= $(PWD)/data
OUTPUT_DIR ?= $(PWD)/output

.PHONY: build run test prepare-dev evaluate-dev

build:
	docker build --file Dockerfile --tag $(IMAGE) .

run: build
	mkdir -p $(OUTPUT_DIR)
	docker run --rm --init \
		--volume $(DATA_DIR):/data:ro \
		--volume $(OUTPUT_DIR):/output \
		--env BASE_URL --env API_KEY --env MODEL_NAME \
		--env CONTEXT_STRATEGY --env MAX_CONTEXT_CHARS \
		$(IMAGE) --input $(INPUT) --output $(OUTPUT)

test:
	python -m unittest discover -s tests -p 'test_*.py'

prepare-dev:
	python prepare_dev.py --dataset $(DATASET) --cases $(CASES) --gold $(GOLD)

evaluate-dev:
	python evaluate_dev.py --gold $(GOLD) --predictions $(PREDICTIONS)
