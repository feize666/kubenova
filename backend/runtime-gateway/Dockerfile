FROM golang:1.25.0-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w -X main.version=$VERSION -X main.gitCommit=$GIT_COMMIT -X main.buildTime=$BUILD_TIME" -o /out/runtime-gateway ./cmd/runtime-gateway

FROM alpine:3.20
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /out/runtime-gateway /app/runtime-gateway
EXPOSE 4100
CMD ["/app/runtime-gateway"]
