package main

import (
	"embed"
	"encoding/json"
	"errors"
	"image/png"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed web
var webFS embed.FS

type apiError struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, apiError{Error: msg})
}

func mapStoreError(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrConflict):
		return http.StatusConflict
	default:
		return http.StatusBadRequest
	}
}

const iconSize = 32

func main() {
	port := getenv("PORT", "8080")
	dataFile := getenv("DATA_FILE", "./data/data.json")

	store, err := NewStore(dataFile)
	if err != nil {
		log.Fatalf("store init failed: %v", err)
	}

	uploadsDir := filepath.Join(filepath.Dir(dataFile), "icons")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		log.Fatalf("uploads dir: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.Snapshot())
	})

	mux.HandleFunc("POST /api/resources", func(w http.ResponseWriter, r *http.Request) {
		var res Resource
		if err := json.NewDecoder(r.Body).Decode(&res); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		created, err := store.AddResource(res)
		if err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, created)
	})

	mux.HandleFunc("PATCH /api/resources/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var patch Resource
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		updated, err := store.UpdateResource(id, patch)
		if err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
	})

	mux.HandleFunc("DELETE /api/resources/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := store.DeleteResource(id); err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		os.Remove(filepath.Join(uploadsDir, id+".png"))
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("POST /api/resources/{id}/icon", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := r.ParseMultipartForm(5 << 20); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid multipart form")
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "file field required")
			return
		}
		defer file.Close()

		src, err := png.Decode(file)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid PNG")
			return
		}

		resized := resizePNG(src, iconSize, iconSize)

		iconPath := filepath.Join(uploadsDir, id+".png")
		f, err := os.Create(iconPath)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "failed to save icon")
			return
		}
		if encErr := png.Encode(f, resized); encErr != nil {
			f.Close()
			writeErr(w, http.StatusInternalServerError, "failed to encode icon")
			return
		}
		f.Close()

		iconURL := "/uploads/" + id + ".png"
		updated, err := store.UpdateResource(id, Resource{Icon: iconURL})
		if err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
	})

	mux.HandleFunc("POST /api/bookings", func(w http.ResponseWriter, r *http.Request) {
		var b Booking
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		created, err := store.AddBooking(b)
		if err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, created)
	})

	mux.HandleFunc("PATCH /api/bookings/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var patch Booking
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		updated, err := store.UpdateBooking(id, patch)
		if err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
	})

	mux.HandleFunc("DELETE /api/bookings/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := store.DeleteBooking(id); err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("/uploads/", func(w http.ResponseWriter, r *http.Request) {
		filename := strings.TrimPrefix(r.URL.Path, "/uploads/")
		if filename == "" || strings.Contains(filename, "/") || strings.Contains(filename, "..") {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(uploadsDir, filename))
	})

	staticFS, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(staticFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	addr := ":" + port
	log.Printf("Boo listening on %s (data=%s)", addr, dataFile)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
