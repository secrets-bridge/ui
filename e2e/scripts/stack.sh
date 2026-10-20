#!/usr/bin/env bash
# Throwaway stack for the browser security suite (ui#152).
#
#   stack.sh up     start a dev Vault and the published api against an
#                   empty Postgres + Redis
#   stack.sh seed   users, roles, projects, environments, a Vault secret,
#                   an enrolled agent, discovery, a binding, a reveal policy
#   stack.sh scan   fail if any generated secret or canary is in test output
#   stack.sh down   stop the containers and remove the state dir
#
# Every password, key and canary is generated here, per run. Values are
# passed to docker by name (-e VAR) and to jq on stdin (printf is a
# builtin), never on a command line where ps could see them, masked in
# GitHub Actions, and kept only in $E2E_STATE (mode 700), which is never
# uploaded. Postgres and Redis come from the caller (CI service
# containers, or anything local) through E2E_DATABASE_URL and
# E2E_REDIS_URL; the database must be empty.
set -euo pipefail

E2E_STATE=${E2E_STATE:-$(cd "$(dirname "$0")/.." && pwd)/.state}
E2E_API_IMAGE=${E2E_API_IMAGE:-ghcr.io/secrets-bridge/api:dev}
E2E_AGENT_IMAGE=${E2E_AGENT_IMAGE:-ghcr.io/secrets-bridge/agent:dev}
E2E_VAULT_IMAGE=${E2E_VAULT_IMAGE:-hashicorp/vault:2.2}
E2E_API_PORT=${E2E_API_PORT:-8080}
E2E_VAULT_PORT=${E2E_VAULT_PORT:-8200}
E2E_OUT=${E2E_OUT:-$(cd "$(dirname "$0")/.." && pwd)/.out}
API=http://127.0.0.1:$E2E_API_PORT
VAULT=http://127.0.0.1:$E2E_VAULT_PORT
CONTAINER=sb-e2e-api
AGENT=sb-e2e-agent
VAULTC=sb-e2e-vault

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
    echo "export E2E_VAULT_TOKEN='$(rnd 16)'"
    echo "export E2E_VAULT_URL='$VAULT'"
    # The secret's two values in Vault; the reveal specs look for them.
    echo "export E2E_VALUE_USER='e2e-value-user-$(rnd 8)'"
    echo "export E2E_VALUE_PASS='e2e-value-pass-$(rnd 8)'"
    # Cross-team: a key the patch must leave alone, and the two values a
    # value provider fills in.
    echo "export E2E_KEEP='e2e-keep-$(rnd 8)'"
    echo "export E2E_FILL_1='e2e-fill-one-$(rnd 8)'"
    echo "export E2E_FILL_2='e2e-fill-two-$(rnd 8)'"
  } > "$E2E_STATE/secrets.env"
  # shellcheck disable=SC1091
  source "$E2E_STATE/secrets.env"
  for v in "$SB_WRAP_MASTER_KEY" "$E2E_ADMIN_PASSWORD" "$E2E_USER_PASSWORD" "$E2E_CANARY" \
           "$E2E_VAULT_TOKEN" "$E2E_VALUE_USER" "$E2E_VALUE_PASS" "$E2E_KEEP" "$E2E_FILL_1" "$E2E_FILL_2"; do mask "$v"; done
  printf 'X-Vault-Token: %s\n' "$E2E_VAULT_TOKEN" > "$E2E_STATE/vault.hdr"

  export VAULT_DEV_ROOT_TOKEN_ID=$E2E_VAULT_TOKEN
  docker rm -f "$VAULTC" >/dev/null 2>&1 || true
  docker run -d --name "$VAULTC" --network host --cap-add IPC_LOCK \
    -e VAULT_DEV_ROOT_TOKEN_ID -e VAULT_DEV_LISTEN_ADDRESS="127.0.0.1:$E2E_VAULT_PORT" \
    "$E2E_VAULT_IMAGE" >/dev/null
  for _ in $(seq 60); do
    [[ $(curl -s -o /dev/null -w '%{http_code}' "$VAULT/v1/sys/health") == 200 ]] && break
    sleep 1
  done

  export DATABASE_URL=$E2E_DATABASE_URL REDIS_URL=$E2E_REDIS_URL
  export SB_BOOTSTRAP_ADMIN_EMAIL=$E2E_ADMIN_EMAIL SB_BOOTSTRAP_ADMIN_PASSWORD=$E2E_ADMIN_PASSWORD
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" --network host \
    -e DATABASE_URL -e REDIS_URL -e SB_WRAP_MASTER_KEY \
    -e SB_BOOTSTRAP_ADMIN_EMAIL -e SB_BOOTSTRAP_ADMIN_PASSWORD \
    -e API_ADDR="127.0.0.1:$E2E_API_PORT" -e SB_ENV=dev -e LOG_LEVEL=info \
    -e SB_ALLOW_INSECURE_VAULT_ADDR=true \
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
  st=$(printf '%s\n%s\n' "$E2E_ADMIN_EMAIL" "$E2E_ADMIN_PASSWORD" | jq -Rn '{email: input, password: input}' |
    curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/api/v1/auth/login" -c "$E2E_STATE/admin.jar" -H 'Content-Type: application/json' --data-binary @-)
  need "$st" 200 admin-login

  local requester approver outsider filler lead
  requester=$(mkuser e2e-requester@example.com Requester)
  lead=$(mkuser e2e-lead@example.com Lead)
  approver=$(mkuser e2e-approver@example.com Approver)
  outsider=$(mkuser e2e-outsider@example.com Outsider)
  filler=$(mkuser e2e-filler@example.com Filler)

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
  local eqdev; eqdev=$(jq -r .id "$E2E_STATE/last.json")
  # Team members: the requester and approver in alpha, the value provider
  # in beta (the inbox is per team).
  local m
  for m in "$ta:$requester" "$ta:$approver" "$ta:$lead" "$tb:$filler"; do
    need "$(api POST "/api/v1/teams/${m%%:*}/members" "{\"user_id\":\"${m##*:}\"}")" 201 "member-${m##*:}"
  done

  need "$(api GET /api/v1/roles)" 200 roles
  rid() { jq -r --arg n "$1" '(if type=="array" then . else .items end)[] | select(.name==$n) | .id' "$E2E_STATE/last.json"; }
  local rdev rappr rvp; rdev=$(rid developer); rappr=$(rid approver); rvp=$(rid value_provider)
  # Submitting a request needs a global secret.request grant, so the
  # requester is a global developer; the outsider is scoped to the other
  # project only and stands in for "another team".
  need "$(api POST /api/v1/user-roles "{\"user_id\":\"$requester\",\"role_id\":\"$rdev\",\"scope\":{}}")" 201 grant-requester
  need "$(api POST /api/v1/user-roles "{\"user_id\":\"$outsider\",\"role_id\":\"$rdev\",\"scope\":{\"project_id\":\"$q\"}}")" 201 grant-outsider
  need "$(api POST /api/v1/user-roles "{\"user_id\":\"$approver\",\"role_id\":\"$rappr\",\"scope\":{}}")" 201 grant-approver
  # The lead and the value provider can both approve, so the only thing
  # that stops them verifying a cross-team request is separation of duties.
  # value_provider is global because fill and refuse refuse a team-scoped
  # grant today (api#166).
  local g
  for g in "$lead:$rdev" "$lead:$rappr" "$filler:$rvp" "$filler:$rappr"; do
    need "$(api POST /api/v1/user-roles "{\"user_id\":\"${g%%:*}\",\"role_id\":\"${g##*:}\",\"scope\":{}}")" 201 "grant-${g}"
  done

  # The secret lives in Vault (KV v2), the agent enrolls and discovers it,
  # and the catalog row comes from that discovery, the same path as a real
  # install. Values go to Vault on stdin, the token from a 600 header file.
  local vs
  vs=$(curl -sS -o /dev/null -w '%{http_code}' -H @"$E2E_STATE/vault.hdr" -X POST "$VAULT/v1/sys/mounts/sbkv" -d '{"type":"kv","options":{"version":"2"}}')
  need "$vs" 204 vault-mount
  vs=$(printf '%s\n%s\n' "$E2E_VALUE_USER" "$E2E_VALUE_PASS" | jq -Rn '{data:{DB_USER: input, DB_PASSWORD: input}}' |
    curl -sS -o /dev/null -w '%{http_code}' -H @"$E2E_STATE/vault.hdr" -X POST "$VAULT/v1/sbkv/data/team-alpha/e2e/db" --data-binary @-)
  need "$vs" 200 vault-secret
  vs=$(printf '%s\n' "$E2E_KEEP" | jq -Rn '{data:{UNTOUCHED: input}}' |
    curl -sS -o /dev/null -w '%{http_code}' -H @"$E2E_STATE/vault.hdr" -X POST "$VAULT/v1/sbkv/data/team-beta/e2e/app" --data-binary @-)
  need "$vs" 200 vault-destination

  need "$(api POST /api/v1/provider-connections "{\"name\":\"e2e-vault\",\"type\":\"vault\",\"auth_method\":\"token\",\"cluster_name\":\"e2e-cluster\",\"scope\":{\"address\":\"$VAULT\",\"mount\":\"sbkv\"},\"discover_enabled\":true,\"discover_interval_seconds\":3600}")" 201 connection
  local c; c=$(jq -r .id "$E2E_STATE/last.json")
  need "$(api POST "/api/v1/provider-connections/$c/bindings" "{\"project_id\":\"$p\",\"purpose\":\"destination\"}")" 201 connection-binding
  need "$(api POST "/api/v1/provider-connections/$c/agent-enrollment-token" '{"name":"e2e-agent","expected_cluster_name":"e2e-cluster","expected_provider_type":"vault"}')" 201 enrollment-token
  SB_ENROLLMENT_TOKEN=$(jq -j .enrollment_token "$E2E_STATE/last.json")
  mask "$SB_ENROLLMENT_TOKEN"
  : > "$E2E_STATE/last.json"
  export SB_ENROLLMENT_TOKEN SB_VAULT_TOKEN=$E2E_VAULT_TOKEN
  docker rm -f "$AGENT" >/dev/null 2>&1 || true
  docker run -d --name "$AGENT" --network host --tmpfs /var/lib/sb-agent:rw,uid=65532,gid=65532,mode=0700 \
    -e SB_CP_ENDPOINT="$API" -e SB_INSECURE_TRANSPORT=true \
    -e SB_ENROLLMENT_ENABLED=true -e SB_ENROLLMENT_TOKEN -e SB_IDENTITY_FILE=/var/lib/sb-agent/identity.json \
    -e SB_AGENT_NAME=e2e-agent -e SB_PROVIDER_TYPE=vault -e SB_CLUSTER_NAME=e2e-cluster \
    -e SB_VAULT_ADDR="$VAULT" -e SB_VAULT_TOKEN -e SB_VAULT_KV_MOUNT=sbkv \
    -e SB_CLAIM_INTERVAL=2s -e SB_HEARTBEAT_INTERVAL=15s \
    "$E2E_AGENT_IMAGE" >/dev/null
  unset SB_ENROLLMENT_TOKEN SB_VAULT_TOKEN
  local ok=""
  for _ in $(seq 60); do
    api GET "/api/v1/provider-connections/$c/agents" >/dev/null
    if jq -e '(if type=="array" then . else (.items // .agents) end) | any(.status=="active")' "$E2E_STATE/last.json" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  [[ -n $ok ]] || { echo "agent did not become active"; exit 1; }

  for _ in $(seq 30); do
    [[ $(api POST "/api/v1/provider-connections/$c/discover-now" '{}') == 202 ]] && break
    sleep 2
  done
  local sid="" did=""
  for _ in $(seq 60); do
    api GET /api/v1/secrets >/dev/null
    sid=$(jq -r '(if type=="array" then . else .items end)[] | select(.secret_ref=="team-alpha/e2e/db") | .id' "$E2E_STATE/last.json")
    did=$(jq -r '(if type=="array" then . else .items end)[] | select(.secret_ref=="team-beta/e2e/app") | .id' "$E2E_STATE/last.json")
    [[ -n $sid && -n $did ]] && break
    sleep 1
  done
  [[ -n $sid && -n $did ]] || { echo "discovery didn't find both secrets"; exit 1; }

  # The bootstrap admin role has no integration.bind (the smoke runs hit
  # the same gap), so the admin takes the binder role for the binding.
  need "$(api GET /api/v1/roles)" 200 roles-again
  local rbind admin
  rbind=$(rid provider_connection_binder)
  admin=$(psqlq "SELECT id FROM local_users WHERE email = '$E2E_ADMIN_EMAIL'")
  need "$(api POST /api/v1/user-roles "{\"user_id\":\"$admin\",\"role_id\":\"$rbind\",\"scope\":{}}")" 201 grant-binder
  need "$(api POST "/api/v1/projects/$p/secrets" "{\"secret_id\":\"$sid\",\"environment_id\":null,\"allowed_ops\":[\"read\",\"patch\"],\"allowed_keys\":[\"DB_USER\",\"DB_PASSWORD\"]}")" 201 binding
  # The cross-team destination: patch only, two keys, in the other team's project.
  need "$(api POST "/api/v1/projects/$q/secrets" "{\"secret_id\":\"$did\",\"environment_id\":\"$eqdev\",\"allowed_ops\":[\"patch\"],\"allowed_keys\":[\"CT_KEY1\",\"CT_KEY2\"]}")" 201 destination-binding

  # Non-prod direct reveal with the shortest TTL the api takes, so the
  # auto-hide spec doesn't wait long. Prod stays blocked by the invariant.
  need "$(api GET /api/v1/workflows)" 200 workflows
  local wf; wf=$(jq -r '(if type=="array" then . else .items end)[] | select(.is_default==true) | .id' "$E2E_STATE/last.json")
  need "$(api POST /api/v1/policies "{\"name\":\"e2e-direct-reveal\",\"selector\":{\"project_id\":\"$p\",\"environment_kind\":\"non_prod\",\"operation\":\"reveal\"},\"workflow_id\":\"$wf\",\"priority\":100,\"enabled\":true,\"direct_reveal_allowed\":true,\"requires_mfa\":true,\"reveal_ttl_seconds\":10}")" 201 reveal-policy

  jq -n --arg p "$p" --arg q "$q" --arg edev "$edev" --arg eprod "$eprod" --arg sid "$sid" \
        --arg eqdev "$eqdev" --arg tb "$tb" --arg c "$c" \
        --arg admin "$E2E_ADMIN_EMAIL" --arg requester e2e-requester@example.com \
        --arg approver e2e-approver@example.com --arg outsider e2e-outsider@example.com --arg filler e2e-filler@example.com --arg lead e2e-lead@example.com \
    '{project:$p, otherProject:$q, envDev:$edev, envProd:$eprod, secretId:$sid, secretRef:"team-alpha/e2e/db",
      otherEnv:$eqdev, otherTeam:$tb, connection:$c, destinationRef:"team-beta/e2e/app",
      users:{admin:$admin, requester:$requester, approver:$approver, outsider:$outsider, filler:$filler, lead:$lead}}' > "$E2E_STATE/fixtures.json"
  rm -f "$E2E_STATE/admin.jar" "$E2E_STATE/last.json"
  echo "seeded: 5 users, 2 teams, 2 projects, 3 environments, an enrolled agent, 2 discovered and bound secrets, 1 reveal policy"
}

scan() {
  umask 077
  # shellcheck disable=SC1091
  source "$E2E_STATE/secrets.env"
  local hits=0 where
  mkdir -p "$E2E_OUT"
  docker logs "$CONTAINER" > "$E2E_STATE/api.log" 2>&1 || true
  docker logs "$AGENT" >> "$E2E_STATE/api.log" 2>&1 || true
  # The generated secrets plus anything a test read off a page and
  # recorded (TOTP setup keys, via keepOutOfArtifacts).
  local values=("$SB_WRAP_MASTER_KEY" "$E2E_ADMIN_PASSWORD" "$E2E_USER_PASSWORD" "$E2E_CANARY"
    "$E2E_VAULT_TOKEN" "$E2E_VALUE_USER" "$E2E_VALUE_PASS" "$E2E_KEEP" "$E2E_FILL_1" "$E2E_FILL_2")
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
  docker rm -f "$CONTAINER" "$AGENT" "$VAULTC" >/dev/null 2>&1 || true
  rm -rf "$E2E_STATE"
}

"$@"
