package httpapi

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"strings"
)

//go:embed static/*
var embeddedStatic embed.FS

type StaticServer struct {
	root     fs.FS
	hasIndex bool
}

func NewStaticServer(frontendStaticDir string) *StaticServer {
	if dir := strings.TrimSpace(frontendStaticDir); dir != "" {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			server := &StaticServer{root: os.DirFS(dir)}
			server.hasIndex = server.hasFile("index.html")
			if server.hasIndex {
				log.Printf("static assets: using FRONTEND_STATIC_DIR=%s", dir)
				return server
			}
			log.Printf("static assets: FRONTEND_STATIC_DIR has no index.html (%s), falling back to embedded assets", dir)
		} else {
			log.Printf("static assets: FRONTEND_STATIC_DIR unavailable (%s), falling back to embedded assets", dir)
		}
	}

	sub, err := fs.Sub(embeddedStatic, "static")
	if err != nil {
		// embedded path is build-time validated; panic keeps startup behavior explicit.
		panic(err)
	}
	server := &StaticServer{root: sub}
	server.hasIndex = server.hasFile("index.html")
	log.Print("static assets: using embedded assets")
	return server
}

func (s *StaticServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api") || strings.HasPrefix(r.URL.Path, "/ws") {
		http.NotFound(w, r)
		return
	}

	cleanPath := path.Clean("/" + r.URL.Path)
	cleanPath = strings.TrimPrefix(cleanPath, "/")
	if cleanPath == "" || cleanPath == "." {
		s.serveIndex(w, r)
		return
	}

	if info, err := fs.Stat(s.root, cleanPath); err == nil && !info.IsDir() {
		http.ServeFileFS(w, r, s.root, cleanPath)
		return
	}

	s.serveIndex(w, r)
}

func (s *StaticServer) serveIndex(w http.ResponseWriter, r *http.Request) {
	if !s.hasIndex {
		http.NotFound(w, r)
		return
	}
	http.ServeFileFS(w, r, s.root, "index.html")
}

func (s *StaticServer) Ready() bool {
	return s != nil && s.hasIndex
}

func (s *StaticServer) hasFile(name string) bool {
	_, err := fs.Stat(s.root, name)
	return err == nil
}
