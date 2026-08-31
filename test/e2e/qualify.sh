#!/bin/bash
set -euo pipefail

ROOT=/opt/paseo-semantic-index
INDEXCTL=(node "$ROOT/packages/indexctl/dist/cli.js")

wait_http() {
  local url=$1
  for _ in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

wait_search() {
  local id=$1
  local query=$2
  local mode=$3
  local marker=$4
  local output=""
  for _ in $(seq 1 60); do
    output=$("${INDEXCTL[@]}" search --id "$id" --query "$query" --max-results 20)
    if printf '%s' "$output" | node "$ROOT/test/e2e/assert-search.mjs" "$mode" "$marker" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  printf '%s' "$output" | node "$ROOT/test/e2e/assert-search.mjs" "$mode" "$marker" || true
  echo "Timed out waiting for search marker $marker to be $mode" >&2
  return 1
}

wait_http http://embedder:8001/healthz
wait_http http://qdrant:6333/healthz

paseo plugin install "$ROOT/packages/paseo-plugin"
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:7790/healthz | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.exit(JSON.parse(s).status==="ready"?0:1))'; then
    break
  fi
  sleep 1
done
wait_http http://127.0.0.1:7790/healthz

rm -rf /workspace/primary /workspace/worktree
mkdir -p /workspace/primary/src
git -C /workspace/primary init -b main
git -C /workspace/primary config user.name "Semantic Index E2E"
git -C /workspace/primary config user.email "semantic-index@example.invalid"
cat > /workspace/primary/src/auth.ts <<'EOF'
// Heliotrope authentication validates bearer credentials before request dispatch.
export function validateBearerCredential(token: string): boolean {
  return token.startsWith("Bearer ")
}
EOF
cat > /workspace/primary/src/payments.ts <<'EOF'
// Vermillion settlement ledger reconciles completed invoices.
export function reconcileSettlementLedger(invoiceId: string): string {
  return `settled:${invoiceId}`
}
EOF
git -C /workspace/primary add .
git -C /workspace/primary commit -m "fixture: add semantic markers"
git -C /workspace/primary worktree add -b qualification /workspace/worktree

"${INDEXCTL[@]}" register --id fixture-primary --path /workspace/primary --wait --timeout 3m
wait_search fixture-primary "heliotrope authentication bearer" contains "Heliotrope authentication"

"${INDEXCTL[@]}" register --id fixture-worktree --path /workspace/worktree --baseline /workspace/primary --wait --timeout 3m
wait_search fixture-worktree "heliotrope authentication bearer" contains "Heliotrope authentication"

cat > /workspace/worktree/src/auth.ts <<'EOF'
// Cerulean credential rotation replaces expired session material atomically.
export function rotateSessionCredential(sessionId: string): string {
  return `rotated:${sessionId}`
}
EOF
wait_search fixture-worktree "cerulean credential rotation" contains "Cerulean credential rotation"
wait_search fixture-worktree "heliotrope authentication bearer" absent "Heliotrope authentication"

rm /workspace/worktree/src/payments.ts
wait_search fixture-worktree "vermillion settlement ledger" absent "Vermillion settlement ledger"

git -C /workspace/worktree checkout -- src/auth.ts src/payments.ts
wait_search fixture-worktree "heliotrope authentication bearer" contains "Heliotrope authentication"
wait_search fixture-worktree "vermillion settlement ledger" contains "Vermillion settlement ledger"

SEMANTIC_INDEX_MCP_URL=http://127.0.0.1:7790/mcp \
  node "$ROOT/test/e2e/mcp-smoke.mjs" /workspace/worktree "Heliotrope authentication"

if [[ -n "${ZHIPU_API_KEY:-}" ]]; then
  cat > /workspace/worktree/.mcp.json <<'EOF'
{
  "mcpServers": {
    "semantic-index": {
      "type": "http",
      "url": "http://127.0.0.1:7790/mcp",
      "headers": {
        "Authorization": "Bearer e2e-mcp-token-value-only"
      }
    }
  }
}
EOF
  OMP_OUTPUT=$(runuser -u paseo -- env HOME=/home/paseo ZHIPU_API_KEY="$ZHIPU_API_KEY" omp \
    --cwd /workspace/worktree \
    --model zhipu-coding-plan/glm-5.1 \
    --print \
    --no-session \
    --approval-mode yolo \
    --tools mcp__semantic_index_semantic_search,mcp__semantic_index_index_status \
    --no-lsp \
    --no-skills \
    --no-rules \
    --max-time 5m \
    "You must use semantic_search to find the Heliotrope authentication implementation. Return its exact relative file path and the complete marker phrase.")
  [[ "$OMP_OUTPUT" == *"src/auth.ts"* ]]
  [[ "$OMP_OUTPUT" == *"Heliotrope authentication"* ]]
  echo "Direct OMP semantic_search qualification passed"

  WORKSPACE_JSON=$(paseo workspace create \
    --isolation local \
    --path /workspace/worktree \
    --title "Semantic index OMP qualification" \
    --json)
  WORKSPACE_ID=$(printf '%s' "$WORKSPACE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).workspaceId))')
  PASEO_RUN=$(paseo run \
    --provider omp \
    --model zhipu-coding-plan/glm-5.1 \
    --mode full \
    --title "Semantic index OMP qualification" \
    --workspace "$WORKSPACE_ID" \
    --wait-timeout 10m \
    --json \
    "Use the semantic_search MCP tool before answering. Find the Heliotrope authentication implementation and return its exact relative file path and complete marker phrase. Do not modify files.")
  AGENT_ID=$(printf '%s' "$PASEO_RUN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).agentId))')
  PASEO_OUTPUT=$(paseo agent logs "$AGENT_ID" --filter text)
  PASEO_TOOLS=$(paseo agent logs "$AGENT_ID" --filter tools)
  if [[ "$PASEO_OUTPUT" != *"src/auth.ts"* || "$PASEO_OUTPUT" != *"Heliotrope authentication"* ]]; then
    echo "Paseo-managed OMP output did not contain the expected semantic result:" >&2
    printf '%s\n' "$PASEO_OUTPUT" >&2
    exit 1
  fi
  if [[ "$PASEO_TOOLS" != *"semantic_search"* ]]; then
    echo "Paseo-managed OMP timeline did not include semantic_search" >&2
    printf '%s\n' "$PASEO_TOOLS" >&2
    exit 1
  fi
  echo "Paseo-managed OMP semantic_search qualification passed"
fi

paseo plugin reload paseo-semantic-index
for _ in $(seq 1 90); do
  if "${INDEXCTL[@]}" status --id fixture-worktree >/dev/null 2>&1; then break; fi
  sleep 1
done
"${INDEXCTL[@]}" status --id fixture-worktree --wait --timeout 3m
wait_search fixture-worktree "heliotrope authentication bearer" contains "Heliotrope authentication"

PLUGIN_LOGS=$(paseo plugin logs paseo-semantic-index --json)
if [[ "$PLUGIN_LOGS" == *"Missing tree-sitter"* || "$PLUGIN_LOGS" == *"Failed to initialize tree-sitter"* ]]; then
  echo "Tree-sitter WASM failed to load" >&2
  exit 1
fi

collection_count() {
  curl -fsS -H 'api-key: e2e-qdrant-api-key' http://qdrant:6333/collections \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.collections.filter(c=>c.name.startsWith("ws-")).length))'
}

[[ "$(collection_count)" == "2" ]]
"${INDEXCTL[@]}" release --id fixture-worktree --purge
[[ "$(collection_count)" == "1" ]]
"${INDEXCTL[@]}" release --id fixture-primary
[[ "$(collection_count)" == "1" ]]
paseo plugin ls --json
