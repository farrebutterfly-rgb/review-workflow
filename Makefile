PYTHON ?= python3
export PYTHON
.PHONY: install demo test test-ts test-py typecheck eval live check
install:    ## pinned dependencies from package-lock.json (Python part is stdlib only)
	npm ci
demo:       ## fixture demo, scripted models, no API key, no cost
	npm run --silent demo
test: test-py test-ts
test-ts:    ## TypeScript tests (they call the Python validator through child_process)
	npm test
test-py:    ## Python validator unit tests; run with PYTHON=python3.10 to check 3.10
	$(PYTHON) -m unittest discover -s validator
typecheck:
	npm run typecheck
eval:       ## baseline vs planner/worker on all labelled documents, writes evidence/eval-fixture-*
	npm run --silent eval
live:       ## real model comparison on five documents, needs ANTHROPIC_API_KEY, costs money
	npm run --silent live
check: typecheck test demo
