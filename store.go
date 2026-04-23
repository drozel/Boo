package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type Store struct {
	path  string
	mu    sync.RWMutex
	state State
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		s.state = State{Resources: []Resource{}, Bookings: []Booking{}}
		if err := s.persistLocked(); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		s.state = State{Resources: []Resource{}, Bookings: []Booking{}}
	} else if err := json.Unmarshal(data, &s.state); err != nil {
		return nil, err
	}
	if s.state.Resources == nil {
		s.state.Resources = []Resource{}
	}
	if s.state.Bookings == nil {
		s.state.Bookings = []Booking{}
	}
	return s, nil
}

func (s *Store) persistLocked() error {
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) Snapshot() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cp := State{
		Resources: make([]Resource, len(s.state.Resources)),
		Bookings:  make([]Booking, len(s.state.Bookings)),
	}
	copy(cp.Resources, s.state.Resources)
	copy(cp.Bookings, s.state.Bookings)
	return cp
}

func (s *Store) AddResource(r Resource) (Resource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r.ID = newID("res")
	if err := r.validate(); err != nil {
		return Resource{}, err
	}
	s.state.Resources = append(s.state.Resources, r)
	if err := s.persistLocked(); err != nil {
		return Resource{}, err
	}
	return r, nil
}

func (s *Store) UpdateResource(id string, patch Resource) (Resource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Resources {
		if s.state.Resources[i].ID != id {
			continue
		}
		cur := s.state.Resources[i]
		if patch.Name != "" {
			cur.Name = patch.Name
		}
		if patch.Color != "" {
			cur.Color = patch.Color
		}
		if patch.Icon != "" {
			cur.Icon = patch.Icon
		}
		cur.Description = patch.Description
		if patch.Links != nil {
			cur.Links = patch.Links
		}
		if err := cur.validate(); err != nil {
			return Resource{}, err
		}
		s.state.Resources[i] = cur
		if err := s.persistLocked(); err != nil {
			return Resource{}, err
		}
		return cur, nil
	}
	return Resource{}, ErrNotFound
}

func (s *Store) DeleteResource(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i, r := range s.state.Resources {
		if r.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return ErrNotFound
	}
	s.state.Resources = append(s.state.Resources[:idx], s.state.Resources[idx+1:]...)
	kept := s.state.Bookings[:0]
	for _, b := range s.state.Bookings {
		if b.ResourceID != id {
			kept = append(kept, b)
		}
	}
	s.state.Bookings = kept
	return s.persistLocked()
}

func (s *Store) resourceExistsLocked(id string) bool {
	for _, r := range s.state.Resources {
		if r.ID == id {
			return true
		}
	}
	return false
}

func (s *Store) AddBooking(b Booking) (Booking, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b.ID = newID("bk")
	if err := b.validate(); err != nil {
		return Booking{}, err
	}
	if !s.resourceExistsLocked(b.ResourceID) {
		return Booking{}, ErrNotFound
	}
	for _, other := range s.state.Bookings {
		if overlaps(b, other) {
			return Booking{}, ErrConflict
		}
	}
	s.state.Bookings = append(s.state.Bookings, b)
	if err := s.persistLocked(); err != nil {
		return Booking{}, err
	}
	return b, nil
}

func (s *Store) UpdateBooking(id string, patch Booking) (Booking, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i, b := range s.state.Bookings {
		if b.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return Booking{}, ErrNotFound
	}
	cur := s.state.Bookings[idx]
	if patch.ResourceID != "" {
		cur.ResourceID = patch.ResourceID
	}
	if patch.User != "" {
		cur.User = patch.User
	}
	if patch.CoBookers != nil {
		cur.CoBookers = patch.CoBookers
	}
	if !patch.Start.IsZero() {
		cur.Start = patch.Start
	}
	if !patch.End.IsZero() {
		cur.End = patch.End
	}
	cur.Note = patch.Note
	if err := cur.validate(); err != nil {
		return Booking{}, err
	}
	if !s.resourceExistsLocked(cur.ResourceID) {
		return Booking{}, ErrNotFound
	}
	for i, other := range s.state.Bookings {
		if i == idx {
			continue
		}
		if overlaps(cur, other) {
			return Booking{}, ErrConflict
		}
	}
	s.state.Bookings[idx] = cur
	if err := s.persistLocked(); err != nil {
		return Booking{}, err
	}
	return cur, nil
}

func (s *Store) DeleteBooking(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, b := range s.state.Bookings {
		if b.ID == id {
			s.state.Bookings = append(s.state.Bookings[:i], s.state.Bookings[i+1:]...)
			return s.persistLocked()
		}
	}
	return ErrNotFound
}
