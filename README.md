# readwise-supernote-digest
A Supernote plugin that pushes digest data to Readwise.

## Status
Dev environment set up (adb workflow, vendored SDK skill). Plugin scaffold pending — see
`docs/DEVELOPMENT.md` for the full workflow and `.claude/skills/supernote-plugin-dev/` for the
SDK reference.

## Device
Supernote Nomad at `100.103.149.40` (adb over Wi-Fi/Tailscale, port 5555).

## Quick start
```bash
adb connect 100.103.149.40:5555
scripts/snplg-deploy.sh          # build + install
scripts/snplg-hotreload.sh --build  # JS-only fast iteration
scripts/snplg-logs.sh            # tail plugin logs
```

See `docs/DEVELOPMENT.md` for details.
