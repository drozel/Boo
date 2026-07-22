package main

import (
	"runtime/debug"
	"sync"
	"time"
)

// Build metadata shown in the app's status bar.
//
// buildCommit/buildDate are meant to be injected at link time:
//
//	go build -ldflags "-X main.buildCommit=abc1234 -X main.buildDate=2026-07-22T09:00:00Z"
//
// which is what the Docker build does, since .dockerignore keeps .git out of
// the build context. When they're empty (plain `go run .` / `go build` inside
// the repo) we fall back to the VCS stamp Go embeds in the binary.
var (
	buildCommit string
	buildDate   string
	repoURL     = "https://github.com/drozel/Boo"
)

const shortCommitLen = 7

type buildInfo struct {
	Commit  string `json:"commit"` // short hash, "dev" when unknown
	Date    string `json:"date"`   // RFC3339 UTC, empty when unknown
	RepoURL string `json:"repoUrl"`
}

// currentBuild is resolved once — neither ldflags nor the VCS stamp change at runtime.
var currentBuild = sync.OnceValue(func() buildInfo {
	commit, date, dirty := buildCommit, buildDate, false

	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				if commit == "" {
					commit = s.Value
				}
			case "vcs.time":
				if date == "" {
					date = s.Value
				}
			case "vcs.modified":
				dirty = s.Value == "true"
			}
		}
	}

	if len(commit) > shortCommitLen {
		commit = commit[:shortCommitLen]
	}
	if commit == "" {
		commit = "dev"
	}
	if dirty {
		commit += "-dirty"
	}
	if t, err := time.Parse(time.RFC3339, date); err == nil {
		date = t.UTC().Format(time.RFC3339)
	} else {
		date = ""
	}

	return buildInfo{Commit: commit, Date: date, RepoURL: repoURL}
})
