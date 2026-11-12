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
- Pick people by name (api#240): Assignments and team members show names and emails, and search by either to grant a role or add a member. A pasted id still works. Someone without a global `user_role.edit` or `team.edit` keeps the plain id box.
- Argo CD targets (`/gateways`, ui#173, ADR 0002 S5): the discovered target catalog and a team's bindings, filtered by the server to the caller's teams, for team-scoped `gateway.bind` holders and platform admins. A target never appears by name alone. A project narrows the list to what it can bind, and production environments aren't offered to a team admin. Suspended bindings show their reason and next step.
- Connector approval for discovery: map AppProjects to teams in their own drawer, and approve the reviewed scope by its digest. Approve waits until the replicas agree, the next catalog has arrived and every AppProject has a team.
- Docker image publishing workflow — multi-arch (amd64 + arm64),
  pushed to `ghcr.io/secrets-bridge/ui`. Tags: rolling `dev` on every
  push to `main`; semver tags + `latest` activate post-`v0.1.0`.
  `VITE_API_BASE_URL` is deliberately NOT baked in — same-origin
  ingress routing chooses the host at runtime.

### Changed
- The remaining pages follow the design. The request page opens with one header panel holding the state and the route. Secret details sit beside the list when there's room. Agents shows each connection's health and says what to do about a stale agent. New request offers its two operations as cards, and Audit is Audit log in the sidebar.
- Phones get bottom tabs, picked from what the person can open, and dialogs and drawers rise from the bottom as sheets.
- Administration is one entry in the sidebar, with its own grouped navigation: people and access, projects and secrets, approval rules, infrastructure, sign-in and security. On a phone the sections are a select. Users is now Accounts, Assignments is Role assignments and Sign-in is Sign-in methods.
- Overview puts the one next thing first: counters, Next up with its context and action, the rest as rows, and a right rail. The scope moved to a top bar. A request past its deadline can't take Next up.
- Approvals is its own screen, with decisions moved out of Requests. Someone who only approves lands there, and someone whose approver role is limited to a team or project gets a sentence saying why it's empty.
- The Switchboard identity replaces the old look: warm graphite, a chartreuse accent and blue for success in both themes, Geist, Geist Mono and Bricolage Grotesque (self-hosted), rounder corners, larger type and controls, status shapes per group, a checkpoint route on the request page, production tags inverted with a hatch, and a grouped sidebar. Behaviour, labels and API calls are unchanged. ESLint now refuses lime on text, borders and rings.
- `hasGlobalPermission` joins `hasPermission`. The Gateway admin pages gate on it, so a team-scoped grant no longer shows links and buttons that answer 403.
- Agent onboarding v2 (skills#116). Enroll an agent now creates a
  one-time token that you copy once, then shows the
  `secrets-bridge-agent enroll` command that reads it on stdin, creates
  the X25519 private key on your machine and pipes the credential into
  AWS Secrets Manager, Vault or a Kubernetes Secret, an optional
  ExternalSecret, and the chart install with `identity.existingSecret`.
  The private key and agent secret never reach the browser. The agent
  details show the registered key fingerprint and version, and Rotate
  key creates a one-time rotation token behind a fresh second factor.
  The old token-in-a-Secret, enroll-on-first-boot and PVC flow is gone.
- Major dependency upgrades: vite 8 with @vitejs/plugin-react 6,
  react-router-dom 7, tailwindcss 4 (CSS-first config in
  `src/index.css`, `tailwind.config.js` removed, PostCSS via
  `@tailwindcss/postcss`), zod 4, @hookform/resolvers 5, eslint 10
  and eslint-plugin-react-hooks 7. The rendered UI is unchanged.

### Fixed
- Request again reopens the same kind of request. A change request came back as a read and a cross-team request opened the plain drawer; both now keep their operation, keys and reason, and new values are never carried over. Named keys no longer widen to every key on a binding that allows them all. A failed request on the Overview offers Request again.

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
