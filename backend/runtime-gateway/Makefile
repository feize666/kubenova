.PHONY: run tidy release-build release-run

run:
	go run ./cmd/runtime-gateway

tidy:
	GOPROXY=https://goproxy.cn,direct go mod tidy

release-build:
	@echo "Use deploy/docs/deb-rpm.md for documented binary/package build steps."

release-run:
	@if [ -x ../../.release/runtime-gateway ]; then \
		PORT=$${PORT:-4100} RUNTIME_TOKEN_SECRET=$${RUNTIME_TOKEN_SECRET:-dev-runtime-token-secret} ../../.release/runtime-gateway; \
	else \
		echo ".release/runtime-gateway not found. Build it first by deploy/docs/deb-rpm.md"; \
		exit 1; \
	fi
