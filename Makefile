.PHONY: all up down lint test fmt lint-go lint-ts test-go test-ts fmt-go fmt-ts

GO_MODULES := ./services/location-service/... ./services/matching-service/... ./shared/geospatial/... ./shared/matching-algorithms/... ./shared/models/go/... ./shared/dynamo-client/go/...

all: lint test

up:
	@echo "Local environment 'up' target is not yet implemented (will be added in a later module)."

down:
	@echo "Local environment 'down' target is not yet implemented (will be added in a later module)."

lint: lint-go lint-ts

lint-go:
	golangci-lint run $(GO_MODULES)

lint-ts:
	npm run lint

test: test-go test-ts

test-go:
	go test $(GO_MODULES)

test-ts:
	npm test

fmt: fmt-go fmt-ts

fmt-go:
	gofmt -w -l .

fmt-ts:
	npm run format
