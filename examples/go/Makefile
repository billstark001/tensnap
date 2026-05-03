GO ?= go

.PHONY: build check fmt run run-schelling run-standalone test tidy vet

run: run-schelling

run-schelling:
	$(GO) run ./schelling

run-standalone:
	$(GO) run ./standalone

build:
	$(GO) build ./...

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

fmt:
	$(GO) fmt ./...

tidy:
	$(GO) mod tidy

check: fmt vet test