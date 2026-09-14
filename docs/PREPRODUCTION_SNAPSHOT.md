# Pre-production snapshot model and validation checkpoint

## Storage architecture

The existing owner-scoped architecture is retained:

- Firestore: `users/{userId}/projects/{rootProjectId}` remains a manifest containing revision, snapshot path, integrity hash, title, and update time.
- Firebase Storage: immutable JSON snapshots under `users/{userId}/projects/{rootProjectId}/snapshots/`.
- IndexedDB: complete local snapshots and sync baselines, using the existing offline and conflict-copy flow.
- Production attachments: `users/{userId}/projects/{rootProjectId}/files/{fileId}`, with metadata in the versioned JSON document. Storyboard images continue through the existing inline-image/cloud-image encoding path.

There is no migration to Firestore entity subcollections. Production metadata participates in the same atomic snapshot revision as the screenplay. Firestore manifest rules are unchanged. The new Storage files rule retains owner-only read/write/delete access and restricts MIME types and size (25 MB). It must be deployed before live attachment operations work; this checkpoint does not deploy it.

## Schema version 2

`Project.schemaVersion` is 2. Existing fields retain their names:

| Snapshot field | Meaning |
| --- | --- |
| `characters` | Screenplay characters, with optional casting and appearance fields |
| `locations` | Story locations; no physical coordinates |
| `panels` | Storyboard panels linked through `shotId` |
| `scenes` | Ordered screenplay scenes with stable semantic block IDs |
| `castMembers`, `shootingLocations` | Separate production people and physical locations |
| `breakdownItems`, `assets` | Scene requirements and reusable linked resources |
| `shots` | Shot design and structural block coverage; independent `order` |
| `characterLooks`, `continuityRecords` | Story-day appearance and scene/character/asset continuity |
| `shootDays`, `callSheets` | Production scene order and call-sheet annotations |
| `crewMembers`, `documents`, `budget` | Lightweight production support records |

Each episode remains an embedded `Project` workspace. Its production records use the episode ID as `projectId`; breakdown records also carry `episodeId`. Physical files use the root project's Storage directory. This preserves current episode isolation. Cross-episode shared cast/location libraries are not implemented in this checkpoint.

`memberships` defines future role vocabulary only. It does not grant access. Current Firebase access remains owner-only.

## Loading and migration

`migrateProjectSnapshot` performs additive migration and rejects unsupported future schema versions and malformed/out-of-scope production arrays. Missing production arrays default to empty arrays. Legacy storyboard panels acquire linked shot records with stable `legacy-shot-{panelId}` IDs; original images, descriptions, custom prompts, and existing fields remain intact.

`normalizeProject` is used on local loading, cloud loading, and local writes. Cloud snapshot integrity is verified on the downloaded representation **before** normalization, so migration cannot invalidate verification of a legitimate older snapshot. Series episodes migrate recursively. Legacy series conversion re-scopes production records to the resulting episode.

Semantic extraction reads only Character and Scene Heading blocks. Cues are normalized and supported voice/offscreen/continuation extensions are stripped for identity, while original screenplay cues remain intact. Valid scene headings separate location, INT/EXT, and time of day. Annotated older entities are retained rather than destructively deleting user work; broader cleanup/merge UX is not part of this checkpoint.

## Source review

Breakdown items, shots, panels, shoot days, and continuity records store source revisions and readable source snapshots. A changed or deleted source scene produces a review state without replacing manual data. Script scene reordering is excluded from scene content revisions. Storyboard review also compares its linked shot design. Call-sheet revisions include the day, screenplay scenes, cast, shooting locations, breakdown, and referenced assets; preview/PDF derive current data, with manual call times and notes preserved.

Review actions acknowledge the current source explicitly. Refreshing a generated storyboard prompt does not change its custom prompt or image. Source-linked production records and linked panels are retained when a scene is deleted; legacy panels without shot links retain the old deletion behavior.

## Copies and backups

`copyProjectSnapshot` creates fresh root and episode scope IDs while preserving all document-scoped scene/entity/block IDs. It rebases scope metadata, file destinations, and stored review snapshots. It preserves an already-stale review state.

`projectFileCopies` returns a deduplicated transfer plan **outside** the copied snapshot. Conflict resolution and versioned backup import await actual attachment transfer before publishing the copied project. A failed or unauthorized transfer leaves the source intact and fails the copy/import. Partial successful uploads can leave unreferenced destination files; no automatic cleanup is implemented yet.

Versioned full snapshots restore through this graph-preserving path. Legacy unversioned backups continue through the existing reconstruction/import validator, then migrate to version 2. No legacy reconstruction is used for a current full snapshot. JSON backups contain attachment metadata, not attachment binaries: copying/restoring those files requires access to the original authenticated Storage account. Other-account restoration fails explicitly instead of leaving dangling file pointers.

## Validation

Eight automated test files pass, including new production graph and mocked Storage-copy tests. The graph tests explicitly cover:

1. Fresh scope IDs for every copied production record.
2. Preserved internal entity IDs and references.
3. Character → Cast assignments.
4. Story Location → Shooting Location assignments.
5. Shot → Scene and screenplay block coverage.
6. Storyboard Panel → Shot.
7. Breakdown → Asset / Character / Story Location.
8. Shoot Day → Scene.
9. Continuity → Scene / Character / Asset / Look / Shoot Day / adjacent scenes.
10. No source-project scope remaining in copies, including attachment paths and saved review history.

Additional checks cover nested episodes, budgets/documents, legacy versus full-snapshot restoration, copy immutability, migration idempotence, future-version rejection, semantic extraction, structural coverage, source-change preservation, call-sheet derivation, and independent shooting order.

`npx tsc --noEmit` passes. The production Next.js build passes. The initial sandboxed build could not reach Google Fonts; the authorized network-enabled build fetched the existing fonts successfully. No font or hosting configuration was changed.

The configured `npm run lint` is blocked by the missing `tsgolint` executable. Package manifests were not changed. The available Oxlint engine was run using an ephemeral configuration outside the repository with only unavailable typed-engine options disabled. It reports 98 diagnostics, matching the tracked HEAD baseline, with no introduced diagnostics. Existing issues include unused imports, explicit `any`, image optimization guidance, and accessibility diagnostics. This is not a clean full-repository lint result.

## Remaining verification and implementation risks

- No live Firebase authentication, rules-emulator, file-transfer, or multi-device tests were run. Storage file copies were tested with mocked SDK operations.
- Browser/mobile interaction, actual camera capture, map/geolocation behavior, and visual PDF output have not been exercised. Responsive components and PDF code compile, which does not establish usability.
- Maps currently support external address search, coordinate entry, current-position pinning, embedded preview, and directions. In-app address results and arbitrary map-click pin selection remain unfinished.
- The UI is an initial connected implementation. It needs a focused usability pass, removal of inactive legacy view code, and richer scheduling constraints/estimates before being considered shoot-ready.
- Snapshot size and sync conflict frequency still grow with project size. The existing 50 MB snapshot limit remains; attachment binaries are stored separately.
- Uploading a file and committing the project snapshot are not one Firebase transaction. Failed snapshot saves or partial copy operations can leave orphaned files; recovery/cleanup needs a later pass.

Work is paused after this validation checkpoint, before any further major implementation phase.
