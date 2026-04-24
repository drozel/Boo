package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	xdraw "golang.org/x/image/draw"
)

type Broker struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

func newBroker() *Broker {
	return &Broker{clients: make(map[chan string]struct{})}
}

func (b *Broker) subscribe() chan string {
	ch := make(chan string, 8)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Broker) unsubscribe(ch chan string) {
	b.mu.Lock()
	delete(b.clients, ch)
	b.mu.Unlock()
}

func (b *Broker) publish(event, data string) {
	msg := "event: " + event + "\ndata: " + data + "\n\n"
	b.mu.Lock()
	for ch := range b.clients {
		select {
		case ch <- msg:
		default:
		}
	}
	b.mu.Unlock()
}

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

func resizePNG(src image.Image, w, h int) image.Image {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)
	return dst
}

func main() {
	port := getenv("PORT", "8080")
	dataFile := getenv("DATA_FILE", "./data/data.json")

	store, err := NewStore(dataFile)
	if err != nil {
		log.Fatalf("store init failed: %v", err)
	}

	broker := newBroker()

	uploadsDir := filepath.Join(filepath.Dir(dataFile), "icons")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		log.Fatalf("uploads dir: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.Snapshot())
	})

	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		ch := broker.subscribe()
		defer broker.unsubscribe(ch)

		fmt.Fprintf(w, ": connected\n\n")
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}

		for {
			select {
			case msg := <-ch:
				fmt.Fprint(w, msg)
				if f, ok := w.(http.Flusher); ok {
					f.Flush()
				}
			case <-r.Context().Done():
				return
			}
		}
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

	mux.HandleFunc("POST /api/resources/order", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if err := store.ReorderResources(body.IDs); err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
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
		updated, err := store.SetResourceIcon(id, iconURL)
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
		if data, jerr := json.Marshal(created); jerr == nil {
			broker.publish("booking:add", string(data))
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
		if data, jerr := json.Marshal(updated); jerr == nil {
			broker.publish("booking:update", string(data))
		}
		writeJSON(w, http.StatusOK, updated)
	})

	mux.HandleFunc("DELETE /api/bookings/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := store.DeleteBooking(id); err != nil {
			writeErr(w, mapStoreError(err), err.Error())
			return
		}
		broker.publish("booking:delete", `{"id":"`+id+`"}`)
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
