.PHONY: all up down logs smoke-test lint test fmt lint-go lint-ts test-go test-ts fmt-go fmt-ts tf-init tf-plan tf-validate tf-fmt

GO_MODULES := ./services/event-forwarder/... ./services/location-service/... ./services/matching-service/... ./shared/geospatial/... ./shared/matching-algorithms/... ./shared/models/go/... ./shared/dynamo-client/go/...

all: lint test

up:
	docker compose up -d
	bash scripts/wait-for-localstack.sh

down:
	docker compose down -v

logs:
	docker compose logs -f localstack

smoke-test:
	bash scripts/smoke-test-localstack.sh

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

tf-init:
	cd infra && terraform init -backend=false

tf-plan:
	cd infra && terraform plan -var-file=local.tfvars

tf-validate:
	cd infra && terraform validate

tf-fmt:
	cd infra && terraform fmt -recursive
