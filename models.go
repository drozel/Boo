package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

type Resource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Color       string `json:"color"`
	Icon        string `json:"icon"`
	Description string `json:"description,omitempty"`
}

type Booking struct {
	ID         string    `json:"id"`
	ResourceID string    `json:"resourceId"`
	User       string    `json:"user"`
	CoBookers  []string  `json:"coBookers,omitempty"`
	Start      time.Time `json:"start"`
	End        time.Time `json:"end"`
	Note       string    `json:"note,omitempty"`
}

type State struct {
	Resources []Resource `json:"resources"`
	Bookings  []Booking  `json:"bookings"`
}

func newID(prefix string) string {
	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	return prefix + "_" + hex.EncodeToString(buf)
}

func normalizeCoBookers(primary string, names []string) []string {
	seen := map[string]bool{strings.TrimSpace(primary): true}
	out := make([]string, 0, len(names))
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

func (r *Resource) validate() error {
	if strings.TrimSpace(r.Name) == "" {
		return errors.New("name is required")
	}
	if r.Color == "" {
		r.Color = "#6366f1"
	}
	if r.Icon == "" {
		r.Icon = "server"
	}
	return nil
}

func (b *Booking) validate() error {
	if b.ResourceID == "" {
		return errors.New("resourceId is required")
	}
	if strings.TrimSpace(b.User) == "" {
		return errors.New("user is required")
	}
	if b.Start.IsZero() || b.End.IsZero() {
		return errors.New("start and end are required")
	}
	if !b.End.After(b.Start) {
		return errors.New("end must be after start")
	}
	b.User = strings.TrimSpace(b.User)
	b.CoBookers = normalizeCoBookers(b.User, b.CoBookers)
	return nil
}

func overlaps(a, b Booking) bool {
	return a.ResourceID == b.ResourceID && a.Start.Before(b.End) && a.End.After(b.Start)
}
