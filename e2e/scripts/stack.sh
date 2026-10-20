#!/usr/bin/env bash
# Throwaway stack for the browser security suite (ui#152).
#
#   stack.sh up     start the published api against an empty Postgres + Redis
#   stack.sh seed   users, roles, projects, environments, a catalog secret
#   stack.sh scan   fail if any generated secret or canary is in test output
#   stack.sh down   stop the api container and remove the state dir
#
# Every password, key and canary is generated here, per run. Values are
# passed to docker by name (-e VAR), never on a command line, masked in
# GitHub Actions, and kept only in $E2E_STATE (mode 700), which is never
# uploaded. Postgres and Redis come from the caller (CI service
# containers, or anything local) through E2E_DATABASE_URL and
# E2E_REDIS_URL; the database must be empty.
set -euo pipefail

E2E_STATE=${E2E_STATE:-$(cd "$(dirname "$0")/.." && pwd)/.state}
E2E_API_IMAGE=${E2E_API_IMAGE:-ghcr.io/secrets-bridge/api:dev}
E2E_API_PORT=${E2E_API_PORT:-8080}
E2E_OUT=${E2E_OUT:-$(cd "$(dirname "$0")/.." && pwd)/.out}
API=http://127.0.0.1:$E2E_API_PORT
CONTAINER=sb-e2e-api

mask() { if [[ -n ${GITHUB_ACTIONS:-} ]]; then echo "::add-mask::$1"; fi; }
rnd() { openssl rand -hex "$1"; }
psqlq() { psql "$E2E_DATABASE_URL" -v ON_ERROR_STOP=1 -q -At -c "$1"; }

up() {
  : "${E2E_DATABASE_URL:?}" "${E2E_REDIS_URL:?}"
  umask 077
  mkdir -p "$E2E_STATE"
  {
    echo "export SB_WRAP_MASTER_KEY='$(openssl rand -base64 32)'"
    echo "export E2E_ADMIN_EMAIL='e2e-admin@example.com'"
    echo "export E2E_ADMIN_PASSWORD='Adm-$(rnd 16)'"
    echo "export E2E_USER_PASSWORD='Usr-$(rnd 16)'"
    echo "export E2E_CANARY='e2e-canary-$(rnd 12)'"
  } > "$E2E_STATE/secrets.env"
  # shellcheck disable=SC1091
  source "$E2E_STATE/secrets.env"
  for v in "$SB_WRAP_MASTER_KEY" "$E2E_ADMIN_PASSWORD" "$E2E_USER_PASSWORD" "$E2E_CANARY"; do mask "$v"; done

  export DATABASE_URL=$E2E_DATABASE_URL REDIS_URL=$E2E_REDIS_URL
  export SB_BOOTSTRAP_ADMIN_EMAIL=$E2E_ADMIN_EMAIL SB_BOOTSTRAP_ADMIN_PASSWORD=$E2E_ADMIN_PASSWORD
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" --network host \
    -e DATABASE_URL -e REDIS_URL -e SB_WRAP_MASTER_KEY \
    -e SB_BOOTSTRAP_ADMIN_EMAIL -e SB_BOOTSTRAP_ADMIN_PASSWORD \
    -e API_ADDR="127.0.0.1:$E2E_API_PORT" -e SB_ENV=dev -e LOG_LEVEL=info \
    "$E2E_API_IMAGE" >/dev/null
  for _ in $(seq 90); do
    [[ $(curl -s -o /dev/null -w '%{http_code}' "$API/readyz") == 200 ]] && break
    sleep 1
  done
  [[ $(curl -s -o /dev/null -w '%{http_code}' "$API/readyz") == 200 ]] || { echo "api not ready"; docker logs --tail 20 "$CONTAINER" 2>&1 | grep -v -i -e password -e secret; exit 1; }
  echo "api ready: $(docker image inspect "$E2E_API_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' | cut -c1-7)"
}

# api <METHOD> <path> [json]: admin call through a cookie jar; prints the status, body in $E2E_STATE/last.json
api() {
  local args=(-sS -o "$E2E_STATE/last.json" -w '%{http_code}' -X "$1" "$API$2" -b "$E2E_STATE/admin.jar" -c "$E2E_STATE/admin.jar")
  [[ -n ${3:-} ]] && args+=(-H 'Content-Type: application/json' --data-binary "$3")
  curl "${args[@]}"
}
need() { [[ $1 == "$2" ]] || { echo "seed step $3 answered $1, want $2"; exit 1; }; }

mkuser() { # email name -> id (password is $E2E_USER_PASSWORD)
  local hash
  hash=$(printf %s "$E2E_USER_PASSWORD" | python3 -I -c 'import bcrypt,sys;print(bcrypt.hashpw(sys.stdin.read().encode(),bcrypt.gensalt(12)).decode())')
  psqlq "INSERT INTO local_users (email, password_hash, display_name) VALUES ('$1', convert_to('$hash','UTF8'), '$2') RETURNING id"
}

seed() {
  : "${E2E_DATABASE_URL:?}"
  umask 077
  # shellcheck disable=SC1091
  source "$E2E_STATE/secrets.env"
  local st
  st=$(jq -n --arg e "$E2E_ADMIN_EMAIL" --arg p "$E2E_ADMIN_PASSWORD" '{email:$e,password:$p}' |
    curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/api/v1/auth/login" -c "$E2E_STATE/admin.jar" -H 'Content-Type: application/json' --data-binary @-)
  need "$st" 200 admin-login

  local requester approver outsider
  requester=$(mkuser e2e-requester@example.com Requester)
  approver=$(mkuser e2e-approver@example.com Approver)
  outsider=$(mkuser e2e-outsider@example.com Outsider)

  need "$(api POST /api/v1/teams '{"name":"e2e-alpha","description":"requesting team"}')" 201 team-alpha
  local ta; ta=$(jq -r .id "$E2E_STATE/last.json")
  need "$(api POST /api/v1/teams '{"name":"e2e-beta","description":"other team"}')" 201 team-beta
  local tb; tb=$(jq -r .id "$E2E_STATE/last.json")
  need "$(api POST /api/v1/projects "{\"name\":\"e2e-app\",\"team_id\":\"$ta\"}")" 201 project-app
  local p; p=$(jq -r .id "$E2E_STATE/last.json")
  need "$(api POST /api/v1/projects "{\"name\":\"e2e-other\",\"team_id\":\"$tb\"}")" 201 project-other
  local q; q=$(jq -r .id "$E2E_STATE/last.json")
  need "$(api POST /api/v1/environments "{\"project_id\":\"$p\",\"name\":\"dev\",\"type\":\"dev\",\"kind\":\"non_prod\"}")" 201 env-dev
  local edev; edev=$(jq -r .id "$E2E_STATE/last.json")
  need "$(api POST /api/v1/environments "{\"project_id\":\"$p\",\"name\":\"prod\",\"type\":\"prod\",\"kind\":\"prod\"}")" 201 env-prod
  local eprod; eprod=$(jq -r .id "$E2E_STATE/last.json")
  need "$(api POST /api/v1/environments "{\"project_id\":\"$q\",\"name\":\"dev\",\"type\":\"dev\",\"kind\":\"non_prod\"}")" 201 env-other-dev

  need "$(api GET /api/v1/roles)" 200 roles
  rid() { jq -r --arg n "$1" '(if type=="array" then . else .items end)[] | select(.name==$n) | .id' "$E2E_STATE/last.json"; }
  local rdev rappr; rdev=$(rid developer); rappr=$(rid approver)
  # Submitting a request needs a global secret.request grant, so the
  # requester is a global developer; the outsider is scoped to the other
  # project only and stands in for "another team".
  need "$(api POST /api/v1/user-roles "{\"user_id\":\"$requester\",\"role_id\":\"$rdev\",\"scope\":{}}")" 201 grant-requester
  need "$(api POST /api/v1/user-roles "{\"user_id\":\"$outsider\",\"role_id\":\"$rdev\",\"scope\":{\"project_id\":\"$q\"}}")" 201 grant-outsider
  need "$(api POST /api/v1/user-roles "{\"user_id\":\"$approver\",\"role_id\":\"$rappr\",\"scope\":{}}")" 201 grant-approver

  # A catalog secret bound for read and patch in every environment. Discovery
  # needs an agent, which this stack doesn't run, so the catalog row is
  # inserted directly, the same shape discovery writes.
  local sid
  sid=$(psqlq "INSERT INTO secrets (cluster_name, provider_type, secret_ref, provider_config, labels, status, last_seen_at)
               VALUES ('e2e-cluster', 'vault', 'team-alpha/e2e/db', '{}'::jsonb, '{}'::jsonb, 'present', now()) RETURNING id")
  # One binding per (project, secret); a NULL environment covers both.
  psqlq "INSERT INTO project_secrets (project_id, secret_id, environment_id, allowed_keys, allowed_ops, created_by)
         VALUES ('$p', '$sid', NULL, ARRAY['DB_USER','DB_PASSWORD'], ARRAY['read','patch'], 'e2e-seed')"

  jq -n --arg p "$p" --arg q "$q" --arg edev "$edev" --arg eprod "$eprod" --arg sid "$sid" \
        --arg admin "$E2E_ADMIN_EMAIL" --arg requester e2e-requester@example.com \
        --arg approver e2e-approver@example.com --arg outsider e2e-outsider@example.com \
    '{project:$p, otherProject:$q, envDev:$edev, envProd:$eprod, secretId:$sid, secretRef:"team-alpha/e2e/db",
      users:{admin:$admin, requester:$requester, approver:$approver, outsider:$outsider}}' > "$E2E_STATE/fixtures.json"
  rm -f "$E2E_STATE/admin.jar" "$E2E_STATE/last.json"
  echo "seeded: 3 users, 2 projects, 3 environments, 1 bound secret"
}

scan() {
  umask 077
  # shellcheck disable=SC1091
  source "$E2E_STATE/secrets.env"
  local hits=0 where
  mkdir -p "$E2E_OUT"
  docker logs "$CONTAINER" > "$E2E_STATE/api.log" 2>&1 || true
  # The generated secrets plus anything a test read off a page and
  # recorded (TOTP setup keys, via keepOutOfArtifacts).
  local values=("$SB_WRAP_MASTER_KEY" "$E2E_ADMIN_PASSWORD" "$E2E_USER_PASSWORD" "$E2E_CANARY")
  if [[ -f $E2E_STATE/test-secrets ]]; then
    while IFS= read -r line; do [[ -n $line ]] && values+=("$line"); done < "$E2E_STATE/test-secrets"
  fi
  for v in "${values[@]}"; do
    for where in "$E2E_OUT" "$E2E_STATE/api.log"; do
      if grep -rqF -- "$v" "$where" 2>/dev/null; then hits=$((hits + 1)); echo "secret value found in $(basename "$where")"; fi
    done
  done
  if grep -qF 'DEV SEEDER' "$E2E_STATE/api.log"; then hits=$((hits + 1)); echo "the dev seeder ran"; fi
  echo "leak scan: ${#values[@]} values, $hits hit(s)"
  [[ $hits == 0 ]]
}

down() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$E2E_STATE"
}

"$@"
