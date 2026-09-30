# Plan: Read-only mode

Status: **proposed, not implemented.** Decisions that need an answer are listed at the end.

## Goal

A setting, **on by default**, that makes it impossible for the plugin to change anything in the
user's Readwise account. While it is on:

- no feature may send a `POST`/`PUT` (or any other mutating request) to Readwise;
- this is **enforced in the Readwise API handling code**, not just by disabling buttons, so a UI
  bug, a new screen, or a future feature cannot write by accident;
- the UI disables every "send to Readwise" control and says why, until the user turns read-only
  mode off.

Non-goals: restricting anything that does not touch Readwise (inserting quotes into notes, syncing
into the Supernote Digest, the local cache, reading from Readwise).

## What exists today (checked in the code)

- `plugin/src/readwise/client.ts` is the only file that talks to Readwise. It has three `fetch`
  calls: `validateToken` (GET `/auth/`), `fetchExportPage` (GET `/export/`) and
  `createHighlights` (**POST `/highlights/`**, the only write).
- `createHighlights` has one caller: `exportPendingDigestEntries` in `src/lib/digestExport.ts`,
  reached from the "Export to Readwise now" button and from "Sync now" when the export toggle is on.
- Settings live in the SQLite `settings` table (`SettingsKey` in `src/db/schema.ts`), read with
  `getSetting`. The UI switches are `DigestSyncEnabled` and `ReadwiseExportEnabled`.
- "Disconnect Readwise" deletes only the token. `clearAllData` exists but nothing calls it, so
  **settings survive a disconnect**.
- The jest env (`__tests__/helpers/env.ts`) replaces `readwise/client` entirely with fakes, so the
  current export tests never run the real HTTP layer. New tests need a mode that does.

The write surface is small, which is what makes a hard guarantee practical.

## Design

### 1. What counts as a write

Any HTTP method other than `GET` or `HEAD`, compared case-insensitively. So `POST` and `PUT` are
covered, and so are `PATCH`, `DELETE`, a lowercase `'post'`, and anything unknown. The rule is an
allowlist of safe methods, not a blocklist of dangerous ones.

### 2. The setting (fails closed)

New key `SettingsKey.ReadwiseWritesEnabled = 'readwise_writes_enabled'`.

The stored value is the *inverse* of the UI label on purpose: **only the exact string `'1'`
permits writes.** Missing, empty, `'0'`, garbage, or an unreadable database all mean read-only. The
default therefore needs no migration and no initialisation step that could be skipped.

### 3. Enforcement, in layers

1. **One choke point in `client.ts`.** A private `readwiseFetch(url, init)` becomes the only
   function that calls `fetch`. `validateToken`, `fetchExportPage` and `createHighlights` all go
   through it. For a write method it first awaits `assertReadwiseWritesAllowed()`; if that fails it
   throws `ReadwiseReadOnlyError` **before any network I/O**.
2. **The guard reads the database on every write request** (new `src/readwise/writeGuard.ts`,
   importing `db` directly). No in-memory cache, so there is no stale flag; flipping the switch
   takes effect on the very next request. The client imports the guard itself instead of having the
   app inject it at start-up, so forgetting an init call cannot leave the client unguarded.
   Any error while reading the setting is treated as "read-only".
3. **Early exit in the feature code.** `exportPendingDigestEntries` checks the guard first, before
   resolving titles, prompting for file access, or reading files, and throws the same error. This is
   efficiency and clarity, not the safety net: layer 1 still stands if someone removes it.
4. **A test and a lint rule that keep the choke point the only door.** A jest test fails if any file
   under `src/` other than `client.ts` calls `fetch`; an ESLint `no-restricted-globals` rule on
   `fetch` (disabled only in `client.ts`) catches it earlier in the editor and in CI.
5. **Invariant for bookkeeping:** a blocked write leaves no trace. Nothing is added to
   `exported_digest_entries` or `exported_text_keys`, so turning read-only off later exports exactly
   what was pending.

Rejected: monkey-patching the global `fetch` to block writes to `readwise.io`. It would also catch
stray calls, but it depends on start-up order, it fails open if the patch is not installed, and it
makes every `fetch` in the app behave surprisingly. The choke point plus the static check gives the
same coverage without that.

Known limit: the check and the request are separate awaits, so a flip that lands between them can
still let that one in-flight request through. That is inherent to a single-process check-then-send,
and is bounded to one request (at most one batch of up to 100 highlights).

### 4. Flipping mid-export

Each batch is a separate `createHighlights` call and re-checks the guard. Turning read-only on
during an export stops it before the next batch. Batches already sent stay marked as exported
(existing behaviour), and the UI shows "Stopped: read-only mode was turned on."

## UX

**Where:** a "Read-only mode" switch at the top of the Export section of the Sync and Export tab,
above "Export Digest to Readwise". Subtext: *"On: nothing is ever sent to Readwise. Turn off to
allow exporting."*

**Default:** on.

**While on:**
- the "Export Digest to Readwise" switch is disabled (its stored value is kept, so it resumes
  when read-only is turned off);
- "Export to Readwise now" is disabled, with subtext *"Read-only mode is on. Turn it off to
  export."*;
- the pending count ("3 Digest entries not yet on Readwise.") is still shown, since counting reads
  only local data;
- "Sync now" still imports from Readwise and still syncs into Digest, but **skips the export step**
  even if the export switch is on, and says so in the status line.

**Turning it off** shows a confirmation, because it lets the plugin write to the user's Readwise
account: *"Turn off read-only mode? Exporting will be able to add highlights to your Readwise
account."* with Cancel / Turn off. Turning it on needs no confirmation.

**Disabled state on e-ink:** the existing `buttonDisabled` style is opacity 0.5, which is faint on
the Nomad's display. Use a clearly distinct style for disabled buttons (dashed border and muted
text) so it reads as unavailable, not as a rendering glitch.

**Setup screen:** one sentence under the token field: *"The plugin starts in read-only mode: it only
reads from Readwise until you turn that off in Sync and Export."*

**Unaffected:** Insert a Quote, Sync to Digest (writes to the local Supernote Digest, not Readwise),
the import sync, token validation.

## Defaults and migration

- Existing installs have no stored value, so they become read-only on update. **Exports stop until
  the user turns read-only off**, even where the export switch was on. Intended, but it is a
  visible behaviour change: call it out in the release notes.
- A fresh connection should not inherit permission from an earlier one: **Disconnect deletes the
  setting** (back to read-only), alongside the token. The export switch value is left alone.

## Implementation steps

1. `db/schema.ts`: add `SettingsKey.ReadwiseWritesEnabled`.
2. `readwise/writeGuard.ts` (new): `isReadwiseWriteAllowed()`, `assertReadwiseWritesAllowed()`,
   `setReadwiseWritesEnabled(boolean)`, `ReadwiseReadOnlyError`. Fails closed on any error.
3. `readwise/client.ts`: add `readwiseFetch` with the method allowlist; route all three calls
   through it; export the error type.
4. `lib/digestExport.ts`: early guard check; make sure a blocked run marks nothing.
5. `screens/SyncExport.tsx`: switch, confirmation dialog, disabled states, skipped-export message,
   handling of `ReadwiseReadOnlyError`; Disconnect deletes the setting.
6. `screens/Setup.tsx`: the one-line notice.
7. ESLint `no-restricted-globals` for `fetch` with an override for `client.ts`.
8. Tests (below), docs (README feature list, `docs/DEVELOPMENT.md`), refreshed screenshots.

## Tests

**Guard matrix** (`writeGuard.test.ts`, real guard, real SQLite):

| Stored value | Result |
|---|---|
| missing | blocked |
| `'1'` | allowed |
| `'0'`, `''`, `'true'`, `'yes'`, `' 1'`, `'01'` | blocked |
| database read throws | blocked |

**Client enforcement** (`readwiseClient.test.ts`, real `client.ts`, `global.fetch` mocked):

- every method in `POST, PUT, PATCH, DELETE, post, Post, UNKNOWN` is rejected in read-only mode and
  `fetch` is **never called**; `GET`/`HEAD` go through;
- `createHighlights`, `validateToken`, `fetchExportPage` each behave correctly in both modes;
- the setting is re-read per request: allowed, then blocked, then allowed again within one test;
- an empty `highlights` array still returns `[]` without touching the network in either mode.

**Feature level** (extend `digestExport.test.ts` and `documentExport.test.ts` with a real-client mode
of `loadEnv`; the default `loadEnv` should set writes *enabled* so the existing tests keep meaning
what they mean today):

- read-only export throws `ReadwiseReadOnlyError`, calls `fetch` zero times, prompts for no
  permissions, reads no files, marks no entries exported and stores no export text;
- after a blocked run, turning read-only off exports everything that was pending, once;
- flipping to read-only between two batches sends the first batch and blocks the second; a rerun
  after re-enabling resumes with the rest;
- "Sync now" with the export switch on and read-only on still imports.

**Static** (`noDirectFetch.test.ts`): only `src/readwise/client.ts` contains `fetch(`.

**Mutation checks** (same practice as the rest of the suite): remove the method check, invert the
default, cache the setting, swallow the guard's error, call `fetch` directly from
`createHighlights`. Each must fail at least one test.

**UI:** the screens have no automated tests today. Check on the device, with screenshots: fresh
state is read-only with controls disabled; the confirmation appears; export becomes available after
turning it off.

## On-device verification

1. Install the build on the Nomad: read-only mode is on, the export controls are disabled, the
   pending count still shows.
2. With a temporary probe (removed afterwards) call `createHighlights` while read-only is on:
   expect `ReadwiseReadOnlyError` and no request. This checks enforcement without sending
   anything to the real account.
3. Turn read-only off through the confirmation, then confirm "Export to Readwise now" is enabled.
   Only perform a real export if there is a deliberate test entry to send.

## Acceptance criteria

- With the setting absent (a fresh database), no code path can send a non-GET request to Readwise.
- Enforcement is in `client.ts`; removing every UI check leaves writes blocked.
- A blocked write leaves the database exactly as it was.
- The switch takes effect on the next request without restarting anything.
- Adding a second `fetch` call anywhere else in `src/` fails CI.

## Decisions for you

1. **Switch semantics.** Store "writes enabled" (only `'1'` permits) rather than "read-only" so that
   the default and every failure mode are read-only. *Recommended.*
2. **Confirmation when turning read-only off.** One extra tap, for a setting that affects a
   real account. *Recommended: yes.*
3. **Disconnect resets to read-only.** *Recommended: yes.* The alternative is that read-only state
   follows the device, not the connection.
4. **Existing users lose exports until they opt in.** This follows from "default on". *Recommended:
   accept, and say so in the release notes.*
5. **Optional, not planned:** turning read-only back on automatically after a period, so it cannot be
   left off by accident. Easy to add later; say if you want it.
