# Paseo Semantic Index

Paseo Semantic Index is a worktree-aware semantic code indexing service,
agent tool, and operational interface managed by a Paseo daemon.

The project reuses the proven indexing engine from Kilo Code, removes the
Kilo agent harness from the runtime boundary, and exposes the engine to any
Paseo-managed agent through Model Context Protocol (MCP). The first target is
Oh My Pi (OMP), but the indexing service is deliberately harness-independent.

> **Status:** architecture and repository bootstrap. No production package or
> compatibility guarantee exists yet.

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
        Embedder service and Qdrant

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

Initial tools:

```text
semantic_search
index_status
```

Conceptual search input:

```json
{
  "query": "Where is authentication configured?",
  "path": "src",
  "limit": 20
}
```

Conceptual result:

```json
{
  "status": "ready",
  "results": [
    {
      "path": "src/auth/config.ts",
      "startLine": 12,
      "endLine": 48,
      "score": 0.82,
      "content": "..."
    }
  ]
}
```

The workspace binding must not be a model-selected absolute path. The preferred
binding order is:

1. MCP roots or connection metadata supplied by the OMP client, after support
   is verified;
2. an opaque workspace registration ID injected into the agent's MCP
   configuration;
3. a service-issued scoped token bound to one workspace registration.

This binding is an implementation decision that must be proven with OMP before
the MCP contract is frozen.

### Lifecycle And Control API

The control API is not exposed to ordinary agents. A provisional HTTP shape is:

```text
PUT    /v1/registrations/:id
GET    /v1/registrations/:id
DELETE /v1/registrations/:id
POST   /v1/registrations/:id/reindex
POST   /v1/registrations/:id/purge
GET    /v1/health
GET    /v1/status
```

`indexctl` is a thin client:

```text
indexctl register
indexctl status --wait
indexctl release
indexctl reindex
indexctl purge
indexctl health
```

Native Paseo plugin CLI contributions may replace or wrap these commands once
the upstream plugin API supports them.

### Paseo Plugin RPC

Typed, schema-validated plugin RPC supplies the Paseo client interface. It can
read status and perform authenticated administrative actions without exposing
credentials to client code.

Candidate RPC methods:

```text
index.status
index.workspace.status
index.workspace.reindex
index.workspace.purge
index.health
index.errors.list
```

Plugin RPC is scoped to the selected Paseo host. It is not used as the agent
tool transport.

## Paseo User Interface

The plugin contributes one global surface and one contextual workspace panel.

### Global Indexing Dashboard

The sidebar surface shows the selected daemon's indexing runtime:

- plugin and engine version;
- Qdrant and embedder health;
- registered primary projects;
- active worktree overlays;
- ready, indexing, waiting, failed, and stopped counts;
- files and chunks indexed;
- active watcher and manager counts;
- current indexing operations;
- last successful update;
- recent errors;
- stale registrations and orphan candidates.

When the same plugin is installed on several connected daemons, Paseo provides
a host picker. The dashboard is intentionally host-scoped. Fleet aggregation
is not required for the initial service.

### Workspace Index Panel

The workspace panel shows:

- registration and manager state;
- primary baseline path and collection;
- worktree overlay path and collection;
- watcher status;
- indexing progress;
- changed, shadowed, and deleted file counts where available;
- last indexed event;
- current and recent failures;
- reindex and purge controls with confirmation.

### Command Center

Initial actions may include:

```text
Open indexing dashboard
Open workspace index status
Reindex current workspace
Purge released workspace overlay
```

Destructive operations require explicit human confirmation and remain absent
from the agent MCP tool catalog.

## Engine Extraction

The donor package is currently located in the Kilo Code repository as
`packages/kilo-indexing`. It declares the MIT license and describes itself as
a standalone indexing engine and host helper package.

It is not currently published to npm. Its package metadata also contains
monorepo-only dependency references such as `workspace:*` and `catalog:`.

The extraction plan is:

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

## Proposed Repository Layout

```text
.
|-- packages/
|   |-- engine/          # Kilo-derived indexing engine
|   |-- paseo-plugin/    # backend process and Paseo client surfaces
|   |-- mcp/             # MCP contracts and Streamable HTTP transport
|   `-- indexctl/        # deterministic lifecycle CLI
|-- test/
|   |-- parity/
|   |-- integration/
|   `-- fixtures/
|-- LICENSE
|-- THIRD_PARTY_NOTICES.md
|-- package.json
|-- pnpm-workspace.yaml
`-- README.md
```

The exact package split may change after a spike proves how Paseo's plugin
compiler handles the engine's WASM, native, and generated assets. Public APIs
should be frozen only after that qualification.

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

Expected configuration categories:

```text
service
  bind address
  MCP port
  control port or shared listener
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
  include and exclude rules
  chunking settings
  watcher debounce
  concurrency limits
  retention policy
```

No real hostnames, runner identities, organization repository policy, tailnet
details, or credentials belong in this repository.

## Distribution

The repository is public because the implementation is generic and trusted
plugin code benefits from inspection.

Initial distribution does not require npm publication. Infrastructure can
deploy a pinned Git commit or release artifact, install dependencies, and run
`paseo plugin install` against an absolute path.

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
- verify desktop, mobile, compact, and theme behavior.

### Phase 6: Lifecycle And Deployment

- connect Paseo workspace setup and teardown;
- reconcile stable projects and baseline indexes;
- deploy one plugin per daemon identity;
- add qualification, monitoring, and orphan cleanup;
- publish pinned release artifacts.

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

- The final MCP workspace-binding mechanism supported by OMP.
- Whether MCP and control share one HTTP listener with separate authorization
  scopes or use separate listeners.
- How the Paseo plugin compiler packages tree-sitter WASM and optional native
  vector-store dependencies.
- Whether to split the engine, plugin, MCP, and CLI into separately published
  packages after the initial spike.
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
