GO ?= go

.PHONY: build check fmt run run-schelling run-sirs run-forest-fire run-standalone test tidy vet

run: run-schelling

run-schelling:
	$(GO) run ./schelling

run-sirs:
	$(GO) run ./sirs

run-forest-fire:
	$(GO) run ./forest_fire

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
