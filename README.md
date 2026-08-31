# Paseo Semantic Index

Paseo Semantic Index is a worktree-aware semantic code indexing service,
agent tool, and operational interface managed by a Paseo daemon.

The project reuses the proven indexing engine from Kilo Code, removes the
Kilo agent harness from the runtime boundary, and exposes the engine to any
Paseo-managed agent through Model Context Protocol (MCP). The first target is
Oh My Pi (OMP), but the indexing service is deliberately harness-independent.

> **Status:** functional pre-release implementation. The engine, service,
> control CLI, MCP tools, Paseo plugin runtime, dashboard, workspace panel, and
> isolated qualification environment are implemented. CI produces an immutable
> Linux deployment package; fleet topology remains outside this repository.

## Implemented Surface

- Kilo-derived Qdrant indexing with OpenAI-compatible embeddings;
- primary-checkout baselines and changed-file worktree overlays;
- persistent manager registrations, baseline-first restoration, and watcher
  cleanup;
- authenticated loopback control API and `indexctl`;
- Streamable HTTP MCP with `semantic_search` and `index_status`;
- OMP workspace binding through MCP `roots/list`;
- Paseo plugin lifecycle, typed RPC, global dashboard, workspace panel, and
  Command Center entries;
- deterministic Docker qualification with real Git worktrees, Qdrant, an
  OpenAI-compatible embedder, pinned Paseo, and pinned OMP.

## Why This Exists

Agent orchestration and code indexing are separate concerns.

OMP provides the orchestration model needed for automated and interactive
work: named agents, controlled spawn graphs, concurrent fan-out, asynchronous
result delivery, and structured completion. Paseo provides process
supervision, projects, managed Git worktrees, remote control, and a common
interface across local and remote machines.

Neither system should need to reimplement a semantic code index. Kilo Code
already has a capable implementation with:

- incremental file scanning;
- language-aware chunking;
- configurable embeddings;
- Qdrant and local vector-store support;
- persistent hash caches;
- filesystem watching;
- primary-checkout indexes;
- worktree-specific overlays;
- shadowing for changed and deleted files;
- merged baseline and overlay search.

That indexing implementation is already organized as a standalone package,
`@kilocode/kilo-indexing`, under the MIT license. This repository treats Kilo
Code as the donor implementation while building a stable, harness-neutral
service around it.

## Goals

- Preserve Kilo Code's indexing and search behavior rather than designing a
  new indexer.
- Run one isolated indexing runtime for each Paseo daemon identity.
- Use Paseo projects as stable primary-checkout identities.
- Use Paseo workspaces as the lifecycle boundary for worktree overlays.
- Keep every active primary checkout and worktree incrementally indexed while
  files change.
- Expose semantic search to OMP and other agents through MCP.
- Expose deterministic lifecycle operations through a non-agent control API
  and a small CLI.
- Present indexing health, progress, errors, and actions in the native Paseo
  interface.
- Preserve process and credential isolation between runner identities.
- Support identical deployment on interactive machines and automated runners.
- Make failures observable rather than leaving indexing as a black box.

## Non-Goals

- Building a new parser, chunker, embedder, vector store, or ranking algorithm.
- Requiring a Kilo agent, Kilo session, or Kilo model invocation at runtime.
- Giving agents direct Qdrant credentials or unrestricted collection access.
- Letting model-generated paths select arbitrary directories on the machine.
- Replacing Paseo project, workspace, or worktree management.
- Letting OMP create a second, competing layer of Git worktrees.
- Building a fleet-wide control plane or depending on Paseo Hub.
- Adding LSP functionality in the first implementation. LSP may use a similar
  integration later, but semantic search is independently useful.
- Making index mutations such as purge or reindex available to ordinary agent
  tools.

## Core Decisions

1. **Paseo owns workspaces.** A workflow creates a Paseo workspace from a
   registered Paseo project. Agents receive the workspace returned by Paseo
   and do not reconstruct paths.
2. **The indexing service receives explicit placement.** Registration includes
   the workspace path and its primary project path. It does not need to guess
   the relationship from directory names.
3. **Kilo's engine remains the search authority.** Searches run through the
   engine's manager and search service, not through ad hoc Qdrant queries.
4. **The Paseo plugin is the operational host.** Paseo starts, stops, reloads,
   logs, and presents the indexing runtime.
5. **The heavy work remains out of the Paseo daemon process.** Paseo plugins run
   as supervised subprocesses. Parsing, watching, and indexing cannot block the
   daemon event loop.
6. **MCP is the agent interface.** The plugin hosts a Streamable HTTP MCP
   endpoint for read-only search operations.
7. **A separate control surface owns lifecycle.** Workspace registration,
   release, reindex, and purge are not model-callable MCP tools.
8. **One runtime serves one security identity.** Each runner user or
   interactive user gets its own Paseo daemon, plugin process, cache, token,
   and manager registry.
9. **One Qdrant cell serves one daemon identity.** Qdrant processes may share a
   physical index host, but collections, credentials, storage, and failure
   boundaries never cross daemon cells. Cross-daemon baseline deduplication is
   deliberately absent.

## System Context

```text
Paseo client (desktop, web, or mobile)
        |
        | existing Paseo connection and plugin RPC
        v
Paseo daemon for one Unix identity
        |
        | supervises
        v
Paseo Semantic Index plugin subprocess
        |-- Kilo-derived indexing engine
        |-- project and workspace manager registry
        |-- filesystem watchers
        |-- local cache
        |-- Streamable HTTP MCP endpoint
        |-- lifecycle/control API
        `-- Paseo plugin RPC handlers and UI bundle
               |
               | embeddings and vectors
               v
         Assigned embedder and dedicated Qdrant cell

Paseo-managed OMP agent
        |
        | MCP semantic_search
        v
Paseo Semantic Index plugin
```

## Runtime Topology

The deployment unit is a Paseo daemon identity, not a physical host.

```text
Physical host
|-- runner identity A
|   |-- Paseo daemon A
|   `-- semantic-index plugin process A
|-- runner identity B
|   |-- Paseo daemon B
|   `-- semantic-index plugin process B
`-- runner identity C
    |-- Paseo daemon C
    `-- semantic-index plugin process C
```

The same plugin can run under an interactive user's Paseo daemon. Code and UI
remain identical; configuration supplies identity-specific paths, credentials,
ports, and limits.

Each daemon points at its own Qdrant instance. Several independent Qdrant
containers can be placed on one index-services machine while retaining unique
ports, data directories, API keys, resource limits, and disk quotas. The
embedding endpoint may be shared by several cells because it is stateless.

```text
Index-services host
|-- Qdrant cell A <--- Paseo daemon A plugin
|-- Qdrant cell B <--- Paseo daemon B plugin
|-- Qdrant cell C <--- Paseo daemon C plugin
`-- shared OpenAI-compatible embedder
```

Collection names therefore need to be unique only inside one cell. The
Kilo-derived path hash remains valid without a fleet namespace.

Paseo plugins are trusted, unsandboxed code. Backend contributions can access
the daemon user's files, processes, credentials, and network. This plugin must
therefore be treated as part of the trusted runner toolchain.

## Why A Paseo Plugin

The indexing engine needs more than an MCP schema. It needs lifecycle,
visibility, health reporting, local resources, and an administrative surface.

The Paseo plugin supplies:

- a daemon-managed backend subprocess;
- cleanup on reload, disable, removal, disconnect, and daemon shutdown;
- captured logs available through the Paseo CLI and Settings;
- typed plugin RPC between the client and backend;
- a native sidebar surface;
- workspace-specific panels;
- Command Center actions;
- host selection when the plugin is installed on multiple daemons;
- the same interface on desktop, web, iOS, and Android.

The plugin does not run inside the daemon's Node process. The subprocess
boundary is intentional crash and performance isolation while preserving one
operational lifecycle.

### Current Paseo Plugin Limits

The initial plugin system does not yet provide:

- contributed CLI subcommands;
- workspace and agent lifecycle hooks;
- contributed agent or MCP tools;
- automatic restart after an unexpected plugin-process crash.

Paseo tracks CLI contributions in
[getpaseo/paseo#3552](https://github.com/getpaseo/paseo/issues/3552) and
lifecycle hooks in
[getpaseo/paseo#3555](https://github.com/getpaseo/paseo/issues/3555).

Until those capabilities ship:

- the plugin hosts its own MCP and control endpoints;
- a small `indexctl` client calls the control endpoint;
- workspace setup and teardown invoke `indexctl` explicitly;
- the plugin persists enough registry state to restore watchers after restart;
- runner preflight verifies that the plugin is running and reloads a failed
  installation before starting agent work.

Plugin RPC is available over Paseo's protocol, but the official CLI does not
currently expose a stable generic `plugin call` command. The control client
will not depend on Paseo's internal client APIs.

## Paseo, OMP, And Indexing Responsibilities

### Paseo

- registers stable project roots;
- creates and archives managed workspaces;
- creates and removes Git worktrees;
- launches the OMP provider in the selected workspace;
- supervises the indexing plugin subprocess;
- provides remote visibility and plugin UI placement;
- records agent and workspace lifecycle.

### OMP

- dispatches a named workflow orchestrator;
- fans out work to controlled specialist agents;
- keeps children inside the Paseo workspace;
- exposes the semantic-search MCP tool to allowed agents;
- returns a structured workflow result.

### Paseo Semantic Index

- owns index manager and watcher lifetimes;
- keeps primary and worktree collections current;
- owns all access to embedding and vector-store credentials;
- resolves worktree searches against baseline and overlay state;
- reports health, progress, and failures;
- provides search to agents and lifecycle control to automation.

### Infrastructure Automation

- installs a pinned Paseo and plugin version;
- supplies identity-specific configuration and credentials;
- reconciles approved primary checkouts and Paseo projects;
- invokes workspace registration and release deterministically;
- verifies end-to-end semantic search.

## OMP Orchestration Model

The indexing service is independent from the agent hierarchy, but its first
consumer follows this bounded model:

```text
Paseo-managed OMP dispatcher
        |
        | invokes exactly one blocking named agent
        v
Workflow-specific orchestrator
        |
        | concurrent OMP task agents
        v
Specialist workers
```

The dispatcher validates a workflow identifier, invokes one allowlisted
orchestrator, passes an input payload, waits for its result, and propagates its
terminal status. It does not perform repository work.

The workflow orchestrator owns implementation decisions and worker fan-out.
Worker agents cannot spawn more workers unless a workflow explicitly adds
another bounded level. MCP access follows least privilege: the dispatcher does
not need semantic search, while orchestrators, scouts, implementers, and
reviewers may receive it.

All OMP children for this model operate in the same Paseo workspace. OMP-level
worktree isolation is disabled so there is one source of workspace ownership
and one unambiguous index registration.

## Project And Workspace Model

### Project

A Paseo project points to one stable primary Git checkout. The primary checkout
owns the persistent baseline index.

```text
Paseo project
`-- primary checkout
    `-- baseline Qdrant collection
```

Project registration is reconciled from infrastructure policy. Application
repository selection, checkout roots, and organization-specific rules remain
outside this public repository.

### Workspace

A Paseo workspace is a logical child of a project. For isolated work, Paseo
creates a managed Git worktree, commonly beneath its configured worktree root.

```text
Paseo workspace
`-- managed Git worktree
    `-- worktree delta collection
```

The physical worktree does not need to be nested beneath the primary checkout.
The service receives both canonical absolute paths when the workspace is
registered.

### Never Guess Paths

Automation uses the project ID and the workspace descriptor returned by Paseo.
It does not derive a directory from repository, branch, workflow, or run names.
Names and slugs remain useful for humans, but IDs and canonical paths are the
control-plane identity.

## Indexing Model

The donor engine derives a workspace collection from the canonical absolute
path. Compatibility with the existing convention is desirable:

```text
ws-<sha256(canonical-absolute-path)[:16]>
```

Different runner identities and worktrees therefore receive separate
collections even when they contain the same repository.

### Primary Baseline

The primary checkout is indexed completely and remains warm. Infrastructure
updates the checkout and the active watcher processes filesystem changes. A
restart performs an incremental reconciliation using persistent hashes.

### Worktree Overlay

A worktree manager receives `baselinePath` and indexes only worktree differences
where possible. Search combines:

1. worktree overlay results;
2. primary baseline results;
3. shadow information for modified and deleted files;
4. current filesystem hash validation.

When a file changes, the worktree overlay blocks stale baseline results while
new embeddings are in flight. Changed or deleted files shadow matching
baseline results. Reverting a file to baseline removes the shadow and exposes
the baseline result again.

### Why Agents Do Not Query Qdrant Directly

A direct vector query cannot correctly implement worktree semantics on its
own. It would need to reproduce in-memory blocked paths, changed-file shadows,
deleted-file filtering, baseline hash validation, overlay search, and result
merging.

Every search therefore runs through the Kilo-derived manager and search
service. Qdrant is an implementation detail behind the service, not an agent
interface.

## Manager Registry

The plugin keeps two related maps:

```text
registration ID -> canonical path and metadata
canonical path  -> manager, watcher, state, and reference count
```

Multiple Paseo workspace records can reference the same managed worktree. The
service disposes a manager only after the final registration releases that
path.

An initial registration model is:

```ts
interface IndexRegistration {
  id: string
  kind: "primary" | "worktree"
  projectId: string
  workspaceId?: string
  path: string
  baselinePath?: string
  purgeOnRelease: boolean
}
```

All supplied paths are canonicalized before use. A worktree registration must
resolve beneath an allowed Paseo-managed or configured workspace root, and its
baseline must match its registered project.

## Lifecycle

### Plugin Startup

1. Load service configuration and persisted registration metadata.
2. Validate Qdrant and embedder connectivity.
3. Validate persisted paths against allowed roots.
4. Recreate managers for persistent projects and active workspaces that still
   exist.
5. Start the MCP and control listeners.
6. Report readiness only after the service can answer status requests.

### Project Reconciliation

1. Infrastructure ensures the approved primary checkout exists.
2. Infrastructure updates the checkout.
3. Infrastructure creates or finds the Paseo project for that path.
4. `indexctl` registers the primary path.
5. The service starts or reuses its manager and watcher.
6. Reconciliation waits until the index reports ready.
7. Qualification performs a real semantic query and verifies a repository
   path in the result.

### Workspace Creation

1. Automation creates a Paseo worktree workspace from a project ID.
2. Paseo returns the workspace ID and canonical directory.
3. Setup registers the workspace ID, directory, and project baseline.
4. The service starts or reuses a worktree manager.
5. Initial reconciliation indexes only required overlay data.
6. OMP starts after the registration is accepted. Search can wait for readiness
   if reconciliation is still finishing.

### Active Work

1. OMP agents edit files in the Paseo worktree.
2. The engine watcher receives file events.
3. Changed paths become blocked before stale search results can escape.
4. New chunks are embedded and written to the overlay collection.
5. Search reads the current baseline, overlay, and shadow state.
6. Health and progress updates become visible in the Paseo panel.

### Workspace Archive

1. Automation requests release of the workspace registration.
2. The service stops accepting new searches for the releasing registration.
3. The manager drains active indexing work and closes its watcher when the final
   reference is gone.
4. Overlay collection retention policy is applied.
5. Paseo archives the workspace and removes its owned worktree when no other
   active workspace references it.

The service must dispose the watcher before the worktree directory disappears.
Cleanup belongs in deterministic workflow teardown until native Paseo plugin
lifecycle hooks are available.

### Restart And Recovery

Qdrant collections and local hash caches survive process restarts. Watchers do
not. On restart, persisted active registrations are replayed and managers run
incremental reconciliation before returning to ready state.

If the plugin process exits unexpectedly, Paseo currently marks the plugin as
failed but does not automatically restart it. Runner preflight and operational
alerts must make this failure visible. A future implementation may add a
bounded reload policy outside the agent execution path.

## Service Interfaces

The service exposes three deliberately different surfaces.

### Agent MCP

Transport: Streamable HTTP bound to loopback.

Implemented tools:

```text
semantic_search
index_status
```

Search input:

```json
{
  "query": "Where is authentication configured?",
  "path": "src",
  "maxResults": 20
}
```

Result:

```json
{
  "workspace": "project-worktree",
  "state": "Indexed",
  "results": [
    {
      "filePath": "src/auth/config.ts",
      "startLine": 12,
      "endLine": 48,
      "score": 0.82,
      "codeChunk": "..."
    }
  ]
}
```

The workspace binding is not a model-selected absolute path. The service asks
the connected client for `roots/list`, canonicalizes file roots, and requires
exactly one root already present in the manager registry. OMP and its child
agents share the parent MCP manager, so the root remains bound to the selected
Paseo workspace.

### Lifecycle And Control API

The control API is not exposed to ordinary agents. Its HTTP surface is:

```text
PUT    /v1/registrations/:id
GET    /v1/registrations/:id
DELETE /v1/registrations/:id
POST   /v1/registrations/:id/reindex
POST   /v1/registrations/:id/purge
GET    /v1/status
GET    /v1/registrations
POST   /v1/search
GET    /v1/operations/:id
GET    /healthz
```

`indexctl` is a thin client:

```text
indexctl register
indexctl status --wait
indexctl release
indexctl reindex
indexctl purge
indexctl service-status
```

Native Paseo plugin CLI contributions may replace or wrap these commands once
the upstream plugin API supports them.

### Paseo Plugin RPC

Typed, schema-validated plugin RPC supplies the Paseo client interface. It can
read status and perform authenticated administrative actions without exposing
credentials to client code.

Implemented RPC methods:

```text
semantic-index.status
semantic-index.workspace-status
semantic-index.register
semantic-index.release
semantic-index.reindex
```

Plugin RPC is scoped to the selected Paseo host. It is not used as the agent
tool transport.

## Paseo User Interface

The plugin contributes one global surface and one contextual workspace panel.

### Global Indexing Dashboard

The sidebar surface shows the selected daemon's indexing runtime:

- service version, phase, and current message;
- active index-manager count;
- active MCP-session count;
- registered primary projects and worktree overlays;
- indexing state and progress for each registration;
- current file counters and recent registration errors.

When the same plugin is installed on several connected daemons, Paseo provides
a host picker. The dashboard is intentionally host-scoped. Fleet aggregation
is not required for the initial service.

### Workspace Index Panel

The workspace panel shows:

- registration and manager state;
- baseline or worktree-overlay role;
- indexing progress and file counters;
- current failures;
- registration, reindex, and release controls;
- explicit confirmation before release.

### Command Center

Implemented actions are:

```text
Open indexing dashboard
Open workspace index status
```

Destructive operations require explicit human confirmation and remain absent
from the agent MCP tool catalog.

## Engine Extraction

The donor package is currently located in the Kilo Code repository as
`packages/kilo-indexing`. It declares the MIT license and describes itself as
a standalone indexing engine and host helper package.

It is not currently published to npm. Its package metadata also contains
monorepo-only dependency references such as `workspace:*` and `catalog:`.

The extraction performed was:

1. Record the exact donor repository and commit.
2. Preserve Kilo Code and OpenCode copyright and MIT notices.
3. Import the engine into `packages/engine` with provenance documentation.
4. Normalize workspace and catalog dependency versions.
5. Remove the Kilo agent-plugin shim from the engine boundary.
6. Remove or optionalize the Kilo Gateway embedding provider when the service
   uses an OpenAI-compatible embedder.
7. Make Qdrant-only builds avoid unnecessary native local-vector dependencies
   where practical.
8. Preserve algorithms and file formats during the initial import.
9. Establish parity tests before making behavioral changes.

The objective is extraction and packaging, not algorithmic redesign.

## Repository Layout

```text
.
|-- packages/
|   |-- engine/          # Kilo-derived indexing engine
|   |-- service/         # registry, control API, and Streamable HTTP MCP
|   |-- paseo-plugin/    # backend process and Paseo client surfaces
|   `-- indexctl/        # deterministic lifecycle CLI
|-- test/
|   |-- e2e/             # isolated Paseo/Qdrant/OMP qualification
|   `-- fixtures/        # deterministic OpenAI-compatible embedder
|-- scripts/
|   `-- e2e.sh
|-- LICENSE
|-- THIRD_PARTY_NOTICES.md
|-- package.json
|-- pnpm-workspace.yaml
`-- README.md
```

Paseo's plugin compiler successfully bundles the TypeScript dependencies.
Tree-sitter runtime and language WASM files are shipped as explicit assets and
resolved through `KILO_TREE_SITTER_WASM_DIR`.

## Security Model

### Unix Identity Boundary

One plugin installation belongs to one Paseo daemon and one Unix identity. A
plugin never indexes directories owned by another runner identity.

### Network Boundary

The MCP and control listeners bind to loopback. Loopback alone is not a Unix
user boundary on a multi-user host, so every installation also receives:

- a unique port or socket;
- a high-entropy bearer token stored in a mode `0600` file;
- separate MCP and control authorization scopes where possible.

### Credential Boundary

Qdrant, embedder, and control credentials remain in the backend process. They
are never:

- returned by MCP;
- included in model-visible tool arguments;
- rendered in the Paseo client;
- written to plugin logs;
- committed to this repository.

### Path Boundary

- Canonicalize paths before registration.
- Reject missing, relative, escaping, or disallowed paths.
- Validate worktree paths against configured roots and Paseo placement.
- Bind search tokens to a registration instead of accepting arbitrary paths.
- Treat symlinks and deleted directories explicitly.

### Tool Boundary

Agent tools are read-only. Lifecycle mutations use a different authenticated
surface. OMP agent definitions grant semantic search only to roles that need
repository context.

## Observability

Health is layered:

```text
Paseo plugin manager
`-- is the plugin subprocess running?

Plugin health endpoint and UI
`-- are the engine, managers, embedder, and Qdrant healthy?
```

The service should report:

- startup and readiness state;
- dependency reachability and latency;
- active managers and watchers;
- indexing queue depth;
- files scanned and chunks written;
- current operation and elapsed time;
- last successful index update;
- per-registration failures;
- cache and collection identity;
- cleanup and orphan status.

Plugin stdout and stderr are captured by Paseo and available through
`paseo plugin logs`. Structured operational state belongs in the plugin RPC and
UI, not only in text logs.

Logs must not include file contents, search queries by default, source-code
snippets, or credentials. Diagnostic logging that could contain repository
data must be explicit and short-lived.

## Failure And Recovery Semantics

### Embedder Unavailable

- Existing ready indexes remain queryable when the search path does not need a
  new query embedding cache entry only if the engine supports it; otherwise
  search reports dependency failure clearly.
- File changes remain queued or marked stale without returning stale worktree
  results as current.
- Health becomes degraded and records the dependency error.

### Qdrant Unavailable

- Search fails explicitly rather than falling back to incomplete local data.
- Indexing operations retry with bounded backoff.
- The watcher remains active only if queued work is bounded safely.

### Deleted Worktree

- The registration becomes stale.
- The watcher and manager are disposed.
- Collection purge follows configured retention policy.
- The primary baseline is never purged by worktree cleanup.

### Plugin Reload

- Stop accepting new work.
- Drain or cancel indexing operations with a bounded timeout.
- Close all watchers and network listeners.
- Persist registration state.
- Let Paseo stop the subprocess.
- Reconcile persisted registrations after the replacement process starts.

### Plugin Crash

- Paseo marks the plugin failed and retains recent logs.
- Agent MCP calls fail clearly.
- Runner preflight prevents a new indexed workflow from starting against a
  failed plugin.
- A bounded external reload policy may restore it; duplicate managers are
  prevented by the one-plugin-per-daemon model and port ownership.

## Cleanup And Retention

Disposing a manager stops the watcher but collection deletion is a separate
policy choice.

Initial defaults:

- retain primary baseline collections;
- purge ephemeral worktree overlays after the final workspace reference is
  archived;
- dispose the manager before deleting its directory or collection;
- make purge idempotent;
- maintain a janitor for registrations or collections orphaned by crashes;
- expose orphan candidates in the UI before broad destructive cleanup.

Retention may later support a short time-to-live for inexpensive workspace
restore, but correctness cannot depend on retained overlays.

## Configuration

The public project defines schemas and generic defaults. Deployment-specific
values stay in the consuming infrastructure repository.

Implemented configuration categories:

```text
service
  loopback bind address and shared listener port
  independent MCP and control bearer tokens
  state and cache directories
  allowed roots

qdrant
  URL
  API key source
  request limits

embedder
  OpenAI-compatible base URL
  model and dimensions
  API key source
  batch and concurrency limits

indexing
  search thresholds and result limits
  embedding batch size and retry limit
  optional file-extension allowlist
```

No real hostnames, runner identities, organization repository policy, tailnet
details, or credentials belong in this repository.

Configuration is loaded from `SEMANTIC_INDEX_CONFIG_FILE`. Secrets override
file values through:

```text
SEMANTIC_INDEX_CONTROL_TOKEN
SEMANTIC_INDEX_CONTROL_TOKEN_FILE
SEMANTIC_INDEX_MCP_TOKEN
SEMANTIC_INDEX_MCP_TOKEN_FILE
SEMANTIC_INDEX_QDRANT_API_KEY
SEMANTIC_INDEX_QDRANT_API_KEY_FILE
SEMANTIC_INDEX_EMBEDDER_API_KEY
SEMANTIC_INDEX_EMBEDDER_API_KEY_FILE
```

Direct values take precedence over files. File-based secrets are recommended
for long-lived installations; direct values are convenient for disposable
qualification environments.

## Infrastructure Handoff

This section is the installation and lifecycle contract for an infrastructure
implementation. Fleet topology, user creation, system services, Qdrant
placement, and repository policy remain outside this repository.

### Cell Contract

One semantic-index cell belongs to exactly one Paseo daemon identity:

```text
Paseo daemon identity
|-- one semantic-index plugin process
|-- one state directory
|-- one cache directory
|-- one control token
|-- one MCP token
`-- one dedicated Qdrant instance
```

An embedder may be shared by multiple cells. A Qdrant instance may not be
shared across cells. Several independent Qdrant containers may run on one
physical index host, provided they have separate ports, credentials, storage
directories, resource limits, and disk quotas.

The plugin never performs cross-daemon discovery, query routing, or baseline
deduplication. The selected Paseo daemon, its plugin, its Qdrant instance, and
its registered paths form one failure and security boundary.

### Required Software

- Paseo `0.6.1` or a qualified newer release;
- Node.js 20 or newer;
- pnpm `10.18.0` through Corepack;
- Qdrant `1.17.1` or a qualified compatible release;
- an OpenAI-compatible embedding endpoint;
- OMP `18.0.11` or a qualified newer release when OMP consumes MCP;
- Git for source installation and worktree operation.

The Qdrant REST endpoint and embedder must be reachable from the Paseo daemon
host. The MCP and control listener remains on daemon-local loopback.

### Suggested Filesystem Layout

Paths are examples. Infrastructure may use different deterministic roots.

```text
/opt/paseo-semantic-index/                 pinned source checkout
/opt/paseo-semantic-index-assets/          tree-sitter WASM assets
/etc/paseo-semantic-index/<daemon>/        non-secret service configuration
/run/secrets/paseo-semantic-index/<daemon>/
|-- control-token
|-- mcp-token
|-- qdrant-api-key
`-- embedder-api-key
/var/lib/paseo-semantic-index/<daemon>/
|-- state/
`-- cache/
```

The source and asset directories must be readable by the daemon user. State
and cache directories must be writable by that user. Secret files should be
owned by the daemon user with mode `0600`.

### Install A Pinned Package

Application CI publishes one ready-to-extract Linux package and checksum per
release tag. Infrastructure verifies the checksum and never runs package
installation or compilation on fleet hosts:

```bash
sha256sum --check paseo-semantic-index-v0.1.0-linux-x64.tar.gz.sha256
tar -xzf paseo-semantic-index-v0.1.0-linux-x64.tar.gz -C /opt
ln -sfn /opt/paseo-semantic-index/packages/indexctl/dist/cli.js \
  /usr/local/bin/indexctl
```

The package contains the pinned source, installed dependency closure, built
`indexctl`, tree-sitter WASM assets, license/provenance files, and build
metadata. Paseo compiles plugin TypeScript from this immutable installed path.

### Use Packaged Tree-Sitter Assets

The Paseo plugin compiler bundles JavaScript but does not copy language WASM
files. The package stages them at a stable path:

```bash
export KILO_TREE_SITTER_WASM_DIR=/opt/paseo-semantic-index/assets/tree-sitter
```

Set `KILO_TREE_SITTER_WASM_DIR` to that directory. Missing language assets make
the parser fall back to less precise chunking and should fail deployment
qualification.

### Create The Service Configuration

Create one JSON file per daemon identity. Do not place credentials in it:

```json
{
  "stateDirectory": "/var/lib/paseo-semantic-index/runner-01/state",
  "cacheDirectory": "/var/lib/paseo-semantic-index/runner-01/cache",
  "allowedRoots": [
    "/srv/paseo/projects",
    "/home/runner-01/.paseo/worktrees"
  ],
  "listen": {
    "host": "127.0.0.1",
    "port": 7790
  },
  "indexing": {
    "enabled": true,
    "provider": "openai-compatible",
    "model": "qwen3-embedding-4b-fp8",
    "dimension": 2560,
    "vectorStore": "qdrant",
    "openai-compatible": {
      "baseUrl": "https://embedder.example.invalid/v1"
    },
    "qdrant": {
      "url": "https://qdrant-cell-runner-01.example.invalid"
    },
    "searchMinScore": 0.4,
    "searchMaxResults": 50,
    "embeddingBatchSize": 20,
    "scannerMaxBatchRetries": 3
  }
}
```

Every configured allowed root must exist when the plugin starts. Paths are
resolved with `realpath`; registrations outside these roots are rejected.
Include both stable project-checkout roots and Paseo's managed-worktree root.

The embedding dimension must match the configured model. Changing model,
dimension, embedder identity, or vector-store compatibility profile requires a
controlled cell reindex.

### Create Secrets And Daemon Environment

Generate independent MCP and control tokens:

```bash
umask 077
openssl rand -hex 32 > /run/secrets/paseo-semantic-index/runner-01/control-token
openssl rand -hex 32 > /run/secrets/paseo-semantic-index/runner-01/mcp-token
```

Supply Qdrant and embedder credentials through equivalent mode-`0600` files.
The Paseo daemon process must pass these variables to the plugin subprocess:

```text
SEMANTIC_INDEX_CONFIG_FILE=/etc/paseo-semantic-index/runner-01/config.json
SEMANTIC_INDEX_CONTROL_TOKEN_FILE=/run/secrets/paseo-semantic-index/runner-01/control-token
SEMANTIC_INDEX_MCP_TOKEN_FILE=/run/secrets/paseo-semantic-index/runner-01/mcp-token
SEMANTIC_INDEX_QDRANT_API_KEY_FILE=/run/secrets/paseo-semantic-index/runner-01/qdrant-api-key
SEMANTIC_INDEX_EMBEDDER_API_KEY_FILE=/run/secrets/paseo-semantic-index/runner-01/embedder-api-key
KILO_TREE_SITTER_WASM_DIR=/opt/paseo-semantic-index-assets/tree-sitter
```

`indexctl` additionally reads:

```text
SEMANTIC_INDEX_URL=http://127.0.0.1:7790
SEMANTIC_INDEX_CONTROL_TOKEN_FILE=/run/secrets/paseo-semantic-index/runner-01/control-token
```

Paseo providers normally execute as the same Unix identity as the daemon. A
mode-`0600` secret file prevents access by other operating-system users but is
not a sandbox against a fully privileged agent running as that same identity.
The architecture keeps credentials outside model arguments and agent tools; a
deployment requiring stronger confidentiality must use a separate service
identity or equivalent operating-system isolation.

If the daemon service environment changes, restart that daemon during a safe
maintenance boundary so the plugin and subsequently launched providers inherit
the new values. A normal plugin source update with unchanged environment needs
only `paseo plugin reload`.

### Enable And Install The Paseo Plugin

Paseo plugins are trusted, unsandboxed code. Enable them only on the intended
daemon by setting this root field in that daemon's `config.json`:

```json
{
  "pluginsEnabled": true
}
```

Reload the daemon configuration, install the absolute plugin path, and verify
the runtime ID:

```bash
paseo reload --json
paseo plugin install /opt/paseo-semantic-index/packages/paseo-plugin
paseo plugin ls
paseo plugin logs paseo-semantic-index
```

The plugin can report `running` before its asynchronous service restoration is
complete. Poll service status before admitting work:

```bash
export SEMANTIC_INDEX_URL=http://127.0.0.1:7790
export SEMANTIC_INDEX_CONTROL_TOKEN_FILE=/run/secrets/paseo-semantic-index/runner-01/control-token

node /opt/paseo-semantic-index/packages/indexctl/dist/cli.js service-status
```

Require service phase `ready`. Treat phase `degraded`, an absent listener, or a
failed plugin status as a preflight failure. Current Paseo releases do not
automatically restart a crashed plugin process; use `paseo plugin reload
paseo-semantic-index` for bounded recovery.

### Configure OMP MCP

Create `~/.omp/agent/mcp.json` for the daemon user, or the corresponding named
profile file when OMP profiles are used:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "semantic-index": {
      "type": "http",
      "url": "http://127.0.0.1:7790/mcp",
      "headers": {
        "Authorization": "!cat /run/secrets/paseo-semantic-index/runner-01/mcp-token"
      },
      "timeout": 120000
    }
  }
}
```

OMP executes the `!cat` indirection at discovery time and does not require the
literal token in project files. `${SEMANTIC_INDEX_MCP_TOKEN}` expansion is also
supported when the token is deliberately supplied to the provider process.

OMP advertises its current workspace through MCP `roots/list`. The service
accepts search only when exactly one advertised file root resolves to an active
registration. Agents never pass absolute workspace paths to `semantic_search`.

### Register Projects And Worktrees

Automation should use IDs and paths returned by Paseo rather than reconstructing
managed-worktree paths.

Register and warm each persistent project baseline:

```bash
indexctl register \
  --id "$PROJECT_ID:primary" \
  --path "$PROJECT_ROOT" \
  --wait \
  --timeout 30m
```

After Paseo creates a workspace, register its overlay against that baseline:

```bash
indexctl register \
  --id "$WORKSPACE_ID" \
  --path "$WORKSPACE_PATH" \
  --baseline "$PROJECT_ROOT" \
  --wait \
  --timeout 30m
```

The baseline registration must exist first. Worktree registration is rejected
when its primary is absent. Once ready, launch OMP in that exact Paseo
workspace.

Release and purge the overlay after all agents and searches have stopped:

```bash
indexctl release --id "$WORKSPACE_ID" --purge
```

Keep the project baseline registered for future work. When a project is
retired, remove its final reference and optionally delete its collection:

```bash
indexctl release --id "$PROJECT_ID:primary" --purge
```

Until Paseo exposes plugin workspace-lifecycle hooks, put these calls in the
automation wrapper or repository `paseo.json` setup and teardown scripts. A
workflow wrapper is preferred when infrastructure policy should remain outside
application repositories.

### Verify A Cell

Minimum post-install checks are:

```bash
paseo plugin ls
paseo plugin logs paseo-semantic-index
indexctl service-status
indexctl list
indexctl status --id "$PROJECT_ID:primary" --wait --timeout 30m
indexctl search --id "$PROJECT_ID:primary" --query "known repository concept"
```

Also verify:

- Qdrant reports collections prefixed with `ws-`;
- the primary collection remains after ordinary registration release;
- a worktree collection disappears after `release --purge`;
- plugin logs contain no tree-sitter WASM initialization errors;
- OMP lists `mcp__semantic_index_semantic_search` and
  `mcp__semantic_index_index_status`;
- a Paseo-managed OMP agent calls semantic search in its registered workspace;
- the global dashboard and workspace panel render on the selected daemon host.

Run the repository's container qualification before promoting a new revision:

```bash
bash scripts/e2e.sh
```

The optional credentialed OMP path is enabled by supplying `ZHIPU_API_KEY` only
to that disposable command environment.

### Upgrade, Roll Back, And Remove

For an upgrade:

1. Stop admitting new work to the cell.
2. Fetch and check out the pinned release revision.
3. Run `corepack pnpm install --frozen-lockfile` and rebuild `indexctl`.
4. Restage the tree-sitter assets.
5. Run `paseo plugin reload paseo-semantic-index`.
6. Require service phase `ready` and wait for restored registrations.
7. Run a known semantic query before returning the cell to service.

For rollback, restore the previous source revision, dependencies, and assets,
then reload the plugin. Registration metadata, caches, and Qdrant collections
survive normal plugin reloads.

For removal, release active worktrees first, decide explicitly whether baseline
collections should remain, run `paseo plugin remove paseo-semantic-index`, and
then remove local state only after verifying no registrations are needed.

## Development And Qualification

```bash
pnpm install --frozen-lockfile
pnpm run verify
bash scripts/e2e.sh
```

The E2E script builds its own Paseo image and creates disposable named volumes,
networks, Qdrant data, Git repositories, and worktrees. It never invokes or
mounts the host Paseo daemon. The cleanup trap removes the complete stack.

Supplying `ZHIPU_API_KEY` additionally qualifies pinned OMP directly and
through `paseo run --provider omp`. The key is passed only as container runtime
environment and is not written into source, fixtures, images, or artifacts.

## Distribution

The repository is public because the implementation is generic and trusted
plugin code benefits from inspection.

Initial distribution does not require npm publication. Application CI builds
and publishes `paseo-semantic-index-v<version>-linux-x64.tar.gz` plus its
SHA-256 receipt. Infrastructure deploys that immutable artifact and runs
`paseo plugin install` against its absolute path.

npm publication is not required for fleet deployment and should not block the
initial infrastructure integration. Paseo installs this plugin from its source
directory, and `indexctl` is built as a local executable. Publishing the engine
or CLI can be evaluated after their compatibility surface and release process
stabilize.

Once package boundaries stabilize, candidates include:

```text
semantic index engine package
Paseo semantic index plugin package
indexctl package or standalone artifact
```

Release requirements include:

- immutable version tags;
- dependency lockfiles;
- checksums for built artifacts;
- provenance and third-party notices;
- a dependency and license inventory;
- an SBOM where practical;
- trusted-branch publishing with OIDC;
- public-fork CI that cannot reach private runner fleets or secrets.

## Qualification Evidence

The current revision has passed:

- 78 Kilo-derived engine parity tests;
- 9 service, configuration, persistence, and lifecycle tests;
- 1 `indexctl` client test;
- repository-wide TypeScript checks and production builds;
- production dependency vulnerability and license checks;
- isolated plugin installation and reload against Paseo `0.6.1`;
- primary indexing and worktree edit, delete, revert, and shadow behavior;
- direct MCP roots, tool listing, status, and semantic search;
- Qdrant worktree-overlay purge while retaining the baseline collection;
- direct OMP `18.0.11` semantic search with filesystem tools disabled;
- Paseo-managed OMP semantic search verified in its tool timeline;
- wide and compact web dashboard and workspace-panel interaction.

The qualification environment used disposable Docker containers, volumes,
networks, credentials, repositories, and worktrees. It did not use the host
Paseo daemon.

## Testing Strategy

### Donor Parity

- identical chunk boundaries for representative languages;
- identical collection naming and cache behavior;
- equivalent primary search results;
- equivalent worktree baseline and overlay results;
- equivalent change, delete, and revert shadow behavior.

### Engine Integration

- Qdrant collection creation and reuse;
- OpenAI-compatible embedding calls;
- initial and incremental indexing;
- watcher event handling;
- restart from persistent cache;
- concurrent manager behavior;
- disposal and purge.

### Worktree Correctness

- unchanged files come from the baseline;
- changed files come from the overlay;
- deleted files never appear from the baseline;
- in-flight changed files do not leak stale baseline content;
- reverting a file restores baseline visibility;
- updating a primary baseline refreshes active worktree behavior.

### Service And MCP

- authenticated registration and release;
- registration reference counting;
- workspace-scoped search authorization;
- MCP schema and transport behavior;
- cancellation, timeout, and bounded result sizes;
- no mutation tools in the agent catalog.

### Paseo Plugin

- installation, enable, disable, reload, and removal;
- async cleanup of managers, watchers, and listeners;
- plugin log capture;
- global dashboard on wide and compact layouts;
- workspace panel context;
- local and remote host selection;
- unavailable and failed-plugin states.

### OMP Qualification

- dispatcher invokes the expected blocking orchestrator;
- allowed workers receive semantic search;
- disallowed roles do not receive it;
- all agents search the current Paseo workspace;
- concurrent workers share one manager safely;
- workflow completion is independent from index watcher lifetime.

## Delivery Phases

The functional scope of phases 0 through 5 is implemented. The evidence above
records the tested surfaces; native mobile clients, long-duration soak, and
fleet-scale load remain outside the current qualification. Phase 6 is owned by
consuming infrastructure. Phase 7 remains future upstream evolution.

### Phase 0: Architecture And Provenance

- establish this public repository;
- record architecture and boundaries;
- inventory donor code and dependency licenses;
- select and record the Kilo donor commit.

### Phase 1: Engine Extraction

- import the donor package with notices;
- normalize dependencies;
- isolate optional Kilo-specific providers and plugin shims;
- establish donor parity tests.

### Phase 2: Standalone Service Core

- implement manager registry and persistence;
- implement explicit primary and worktree registration;
- implement health, lifecycle, disposal, and purge;
- verify restart recovery.

### Phase 3: MCP And Control Interfaces

- implement Streamable HTTP MCP;
- implement `semantic_search` and `index_status`;
- implement authenticated lifecycle API;
- implement `indexctl`;
- prove OMP workspace binding.

### Phase 4: Paseo Plugin Runtime

- package the service as a trusted Paseo plugin backend;
- qualify WASM, native, and generated assets with the plugin compiler;
- implement cleanup and persisted restoration;
- integrate plugin logs and health.

### Phase 5: Paseo User Interface

- implement global indexing dashboard;
- implement workspace index panel;
- add safe Command Center actions;
- verify wide and compact web behavior;
- qualify native mobile and additional themes before claiming those surfaces.

### Phase 6: Lifecycle And Deployment

- connect Paseo workspace setup and teardown;
- reconcile stable projects and baseline indexes;
- deploy one plugin per daemon identity;
- add qualification, monitoring, and orphan cleanup;
- publish pinned release artifacts.

These deployment tasks are not performed by this repository's code-validation
workflow.

### Phase 7: Upstream Evolution

- adopt native Paseo lifecycle hooks when released;
- adopt plugin CLI contributions when released;
- evaluate a native plugin MCP-tool contribution if Paseo adds one;
- evaluate LSP exposure separately;
- upstream generally useful extraction fixes where appropriate.

## Success Criteria

The first production-capable release is complete when:

- Kilo Code is not required as an executable or agent harness at runtime;
- a Paseo project primary checkout remains incrementally indexed;
- a newly created Paseo worktree receives a correct baseline-plus-overlay
  index;
- OMP agents can call semantic search through MCP;
- edits, deletions, and reverts produce correct worktree search results;
- workspace teardown stops watchers and removes configured ephemeral state;
- plugin and dependency health are visible remotely in Paseo;
- the same artifact runs for local and remote daemon identities;
- credentials and internal topology remain outside the public repository;
- end-to-end qualification passes without model-mediated index management.

## Open Decisions

- The default worktree overlay retention period.
- The bounded recovery policy for an unexpected plugin-process crash.
- Whether a future fleet-wide summary is valuable beyond Paseo's host picker.
- The exact compatibility and update process for future Kilo donor releases.

## Provenance And License

The indexing engine will be derived from Kilo Code's
`packages/kilo-indexing`, which is distributed under the MIT license.
Substantial copied or modified portions must retain the donor license notice,
including:

```text
Copyright (c) 2026 Kilo Code
Copyright (c) 2025 opencode
```

This repository will carry an MIT license and a third-party notices file before
donor source is imported. Every dependency and bundled grammar or native asset
must be reviewed for compatible distribution terms.

## Documentation

- [Paseo plugin quickstart](https://paseo.sh/docs/plugins.md)
- [Paseo plugin reference](https://paseo.sh/docs/plugins/reference.md)
- [Paseo CLI](https://paseo.sh/docs/cli.md)
- [Paseo worktrees](https://paseo.sh/docs/worktrees.md)
- [Kilo Code](https://github.com/Kilo-Org/kilocode)
