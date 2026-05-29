# Changelog

All notable changes to `secrets-bridge/ui` are tracked here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [SemVer](https://semver.org/).

Until `v0.1.0` ships, every change lands under `[Unreleased]`. The
rolling `:dev` container tag (published by
`.github/workflows/docker-publish.yml`) reflects whatever is currently
on `main`.

## [Unreleased]

### Added
- Docker image publishing workflow — multi-arch (amd64 + arm64),
  pushed to `ghcr.io/secrets-bridge/ui`. Tags: rolling `dev` on every
  push to `main`; semver tags + `latest` activate post-`v0.1.0`.
  `VITE_API_BASE_URL` is deliberately NOT baked in — same-origin
  ingress routing chooses the host at runtime.

---

## How to cut a release (post-v0.1.0)

1. Land all release-bound work on `main`.
2. Update this file: move `[Unreleased]` entries under a new
   `[vX.Y.Z] — YYYY-MM-DD` heading. Add a fresh empty `[Unreleased]`
   on top.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `docker-publish` workflow picks up the tag and publishes:
   - `ghcr.io/secrets-bridge/ui:vX.Y.Z`
   - `ghcr.io/secrets-bridge/ui:vX.Y`
   - `ghcr.io/secrets-bridge/ui:latest` (only for non-prerelease)
5. Create the GitHub Release pointing at the tag.
