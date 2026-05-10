package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/Feize1995/aiops-k8s-manager/runtime-gateway/internal/httpapi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
)

var (
	version           = "dev"
	gitCommit         = "unknown"
	buildTime         = "unknown"
	frontendAssetHash = "unknown"
	apiSchemaVersion  = "unknown"
)

type versionResponse struct {
	Version           string `json:"version"`
	GitCommit         string `json:"gitCommit"`
	BuildTime         string `json:"buildTime"`
	FrontendAssetHash string `json:"frontendAssetHash"`
	APISchemaVersion  string `json:"apiSchemaVersion"`
	UptimeSeconds     int64  `json:"uptimeSeconds"`
}

func main() {
	if os.Getenv("NODE_ENV") == "production" {
		secret := strings.TrimSpace(os.Getenv("RUNTIME_TOKEN_SECRET"))
		if secret == "" || secret == "dev-secret" {
			log.Fatal("RUNTIME_TOKEN_SECRET must be set to a strong secret in production; refusing to start with default or empty value")
		}
	}

	r := chi.NewRouter()

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	startTime := time.Now()
	var initialized atomic.Bool
	staticServer := httpapi.NewStaticServer(os.Getenv("FRONTEND_STATIC_DIR"))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	r.Get("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if !initialized.Load() || !staticServer.Ready() {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("not ready"))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready"))
	})

	r.Get("/version", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		payload := versionResponse{
			Version:           version,
			GitCommit:         gitCommit,
			BuildTime:         buildTime,
			FrontendAssetHash: frontendAssetHash,
			APISchemaVersion:  apiSchemaVersion,
			UptimeSeconds:     int64(time.Since(startTime).Seconds()),
		}
		if err := json.NewEncoder(w).Encode(payload); err != nil {
			log.Printf("write /version response failed: %v", err)
		}
	})

	r.Get("/ws/terminal", httpapi.TerminalWS)
	r.Get("/ws/logs", httpapi.LogsWS)
	r.NotFound(staticServer.ServeHTTP)

	httpServer := &http.Server{
		Addr:              ":4100",
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	if port := os.Getenv("PORT"); port != "" {
		httpServer.Addr = ":" + port
	}

	initialized.Store(true)
	log.Printf("runtime-gateway listening on %s", httpServer.Addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
