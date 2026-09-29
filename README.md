# readwise-supernote-digest

A Supernote plugin that syncs [Readwise](https://readwise.io) highlights to and from your
Supernote — cache your highlights on-device, insert any quote into the note you're working on,
and mirror them into Supernote's native Digest app (with a two-way bridge back to Readwise).

## Features

### Connect your Readwise account and cache highlights on-device

Paste your [Readwise access token](https://readwise.io/access_token) once; the plugin validates
it, does a full export sync, and keeps a local SQLite cache so everything after that is instant
and works offline.

<img src="docs/screenshots/01-setup.png" width="360" alt="Connect Readwise screen">

### Insert any highlight into the note you're writing

The plugin opens on the **Insert a Quote** tab. Search across all cached highlights by text,
book, or author, and insert one as a real textbox directly onto the current page.

<img src="docs/screenshots/03-insert-quote-picker.png" width="360" alt="Insert a Quote tab with search">

The result is a normal textbox on the page — resizable/movable like anything else in NOTE:

<img src="docs/screenshots/04-note-with-quote.png" width="360" alt="Note page with an inserted Readwise quote">

### Sync and Export tab

Highlight count, manual "Sync now", and toggles for the two Digest integrations below.

<img src="docs/screenshots/02-home.png" width="360" alt="Sync and Export tab">

### Real integration with Supernote's native Digest app

Highlights get synced into the actual on-device Digest app (Settings/NOTE sidebar → Digest),
not a lookalike — tagged with a `Readwise` category so they're easy to filter, alongside anything
you save to Digest yourself.

<img src="docs/screenshots/05-digest-entry.png" width="360" alt="A synced highlight in the native Digest app, tagged Category: Readwise">

<img src="docs/screenshots/06-digest-list.png" width="360" alt="Digest app Manual Entry list showing synced highlights">

### Export your own Digest entries back to Readwise

Anything *you* save to Digest (not synced in from Readwise) can be exported back to your Readwise
library, with automatic loop-prevention so Readwise-sourced entries never get re-exported.

## How it works

- **Local cache**: `sn-plugin-lib` SQLite storage, keyed to the Readwise API's `export`/`highlights`
  endpoints (see [Readwise's API docs](https://readwise.io/api_deets)).
- **Insert into note**: a real `TYPE_TEXT` TextBox element via `PluginCommAPI`/`PluginFileAPI`.
- **Digest integration**: direct `ContentResolver` calls against Supernote's own
  `content://com.ratta.supernote.knowledge.provider` — undocumented by Supernote, reverse-engineered
  by decompiling the on-device APK. Full writeup: [`docs/KNOWLEDGE_PROVIDER.md`](docs/KNOWLEDGE_PROVIDER.md).

See [`plans/plan.md`](plans/plan.md) for the full task-by-task design/implementation history
(including three dead ends that turned out not to be dead ends after more digging), and
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the dev/build/deploy workflow.

## Known gaps

Only Manual Entry Digest entries are exported to Readwise so far. Exporting **Documents** highlights
is in progress: reading title and author from PDFs and EPUBs is implemented and tested, but not yet
wired into the export. See "Open issues" in [`plans/plan.md`](plans/plan.md).

## Device

Supernote Nomad at `100.103.149.40` (adb over Wi-Fi/Tailscale, port 5555).

## Quick start

```bash
adb connect 100.103.149.40:5555
scripts/snplg-deploy.sh              # build + install
scripts/snplg-hotreload.sh --build   # JS-only fast iteration
scripts/snplg-logs.sh                # tail plugin logs
```

See `docs/DEVELOPMENT.md` for the full environment setup (Android SDK, JDK, etc.) and dev loop.
