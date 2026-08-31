# Upstream Provenance

The semantic indexing engine is derived from the standalone Kilo Code package
at `packages/kilo-indexing`.

| Field | Value |
|---|---|
| Repository | `https://github.com/Kilo-Org/kilocode` |
| Revision | `6c5f31fc06d8e9bf12d7c958bee49dd53562ce61` |
| Package version | `7.5.5` |
| Imported | `2026-08-31` |
| License | MIT |

The imported code is kept under `packages/engine`. Host-specific changes are
limited to packaging, dependency isolation, status telemetry, and the initial
Qdrant plus OpenAI-compatible provider boundary. Core scanning, parsing,
chunking, hashing, caching, worktree-overlay, search, and watcher algorithms
remain attributable to the donor implementation.

Future upstream updates must:

1. Record the new full revision here.
2. Import upstream changes separately from local adaptations.
3. Run the baseline and worktree-overlay parity suites.
4. Re-run the containerized Paseo plugin qualification suite.
5. Review dependency licenses and security advisories.
