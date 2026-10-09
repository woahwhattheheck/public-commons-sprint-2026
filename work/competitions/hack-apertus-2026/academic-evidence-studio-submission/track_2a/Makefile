IMAGE ?= hack-apertus-academic-evidence-studio:track2a-2026
export LLM_NAME
export LLM_BASE_URL
export LLM_API_KEY
.PHONY: build run test
build:
	docker build --file Dockerfile --tag $(IMAGE) .
run: build
	docker run --rm --init --publish 127.0.0.1:8787:8787 --publish 127.0.0.1:8788:8788 --env LLM_NAME --env LLM_BASE_URL --env LLM_API_KEY $(IMAGE)
test:
	node --test src/test_runtime.mjs src/test.mjs src/workspace.test.mjs
