# Phone access

Phone access lets the native iPhone app ("Music Generator Remote") use the desktop app on the home network exactly as it uses the Python web app: browse and play the library, download songs, mark favorites, move songs between folders, create folders, start generations and analyze a recorded idea. It is off by default.

## Usage

Settings → **Phone access** → **On**. The block below shows:

- a QR code with `musicgenerator://connect?server=<first address>&token=<key>&alt=<second address>`; the iPhone camera opens the app, which takes over address and key,
- the addresses (`http://<LocalHostName>.local:8767` on macOS or the host name elsewhere, plus the LAN IP),
- the read-only access key and **New key**, which replaces the key immediately; the phone must then scan again.

Switching and key changes apply immediately (not through **Save**). The switch and key are stored in the library database (`settings` keys `phone_access` and `phone_access_token`); a switched-on server starts again with the next launch. The computer must stay awake while the phone uses it.

## Server

`src-tauri/src/phone_access.rs` runs an axum HTTP/1 server inside the app process on `0.0.0.0:8767` (`phone_access::PORT`). Port 8766 is the web app's phone access, so both apps can run on one computer. The listener is bound before the server task starts: a busy port returns `phone_access_port_busy` to the settings dialog (translated) and leaves the switch off; it never stops the app. Switching off cancels the server; connections that are still open (for example a paused stream) are refused from then on.

The Tauri commands are `phone_access_status` and `set_phone_access { enabled?, newToken? }`; both return `{enabled, port, token, addresses}`.

## Security model

- Every request needs `Authorization: Bearer <key>`. The key is 18 random bytes, URL-safe Base64 (24 characters), created on first activation. Comparison uses SHA-256 digests compared in constant time. Missing or wrong key: `401 {"detail": …}`.
- Only `/api/*` is served. `/api/remote`, `/api/shutdown`, `/api/update/…` and any non-GET `/api/settings` answer `403`, as in the web app. The desktop server implements only the endpoints below; it has no settings, delete, export-to-path or model endpoints at all, so the phone cannot read or rotate the key, change settings or touch files outside the library.
- Error texts for 401/403 follow the `X-Lang` header (all twelve UI languages, English fallback).
- Plain HTTP on the local network, like the web app. Anyone on the same network who learns the key can use the API; **New key** revokes it.
- macOS: the sandbox already grants `com.apple.security.network.server`. With the macOS firewall on, the system asks once whether Music Generator may accept incoming connections; until that is allowed, requests from the phone time out while `127.0.0.1` works.

## API contract

All bodies are JSON; errors are `{"detail": "…"}`.

| Request | Response |
| --- | --- |
| `GET /api/health` | engine health, as the studio's `health` command |
| `GET /api/songs?q=&favorites=true&folder=&group=` | array of songs, newest first, at most 500. `folder`: `""` all, `none` unsorted, otherwise a folder ID |
| `GET /api/songs/{id}` | one song |
| `PATCH /api/songs/{id}` with any of `favorite`, `title`, `folder_id` (`null` = unsorted) | updated song |
| `GET /api/songs/{id}/audio` | audio with `Accept-Ranges: bytes`; `Range: bytes=a-b`, `a-` and `-n` answer `206` with `Content-Range`, unsatisfiable ranges `416` |
| `GET /api/songs/{id}/audio?download=true` | same, as attachment `<title>_<seed>.<ext>`; MP3 when Settings → Export is MP3 (same converter and cache as the studio export) |
| `GET /api/folders` | `{folders:[{id,name,count}], all, none}` |
| `POST /api/folders {name}` | `{id, name}` |
| `GET /api/queue` | `{running:[{id,status,message,caption}], queued, library:{count,bytes}, active, progress}` |
| `POST /api/generate` | `{group_id, ids}` |
| `POST /api/analyze`, multipart field `audio` | `{caption, lyrics, bpm, keyscale, timesignature, vocal_language, duration}` |

A song carries the desktop fields (`id, group_id, title, caption, lyrics, status, message, favorite, letter, folder_id, created_at, result_meta, …`) plus `url` (`/api/songs/<id>/audio` for finished songs with audio, otherwise `null`). Local file paths are not sent. In `result_meta`, `duration` and `bpm` are numbers and `keyscale` and `vocal_language` strings, or absent.

### Generation

`POST /api/generate` accepts the web app's fields (`prompt, style, lyrics, instrumental, title, duration, bpm, keyscale, timesignature, vocal_language, variants, folder_id, inference_steps, lm_temperature`; also `caption`, `seed`, `keep_caption`). `bpm` and `inference_steps` may be decimals and are rounded. The request then takes the studio's path: `admission::generate` with the models selected in the desktop app, Expert Mode checks, model verification and the database limits. Empty lyrics with `instrumental: false` let the model write lyrics. Phone-created songs appear in the studio immediately (`library-changed`).

The studio asks before running more than 30 iterations without a confirmed GPU. The phone cannot answer that dialog, so the saved choice applies: "continue" keeps the requested iterations, "limit to 30" and "always ask" use 30.

### Analysis

`POST /api/analyze` uses the studio's analysis command (`commands::analyze_audio`): same 60 MB and file-type limits, same engine and models. As in the studio, analysis does not queue: while a song is rendering it answers `400 "Please wait for the current operation to finish"`.

## Differences from the web app

- Port 8767 instead of 8766.
- Song IDs are the desktop's 32-character IDs; the web app uses 12 characters. The phone treats IDs as opaque strings.
- Analysis is refused during a running generation (single engine operation at a time in the desktop app).
- Only the endpoints the iPhone app uses are served (no song delete/retry, folder rename/delete, ZIP download or settings).

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib phone_access
npx vitest run frontend/phone-access.test.ts
```

The Rust tests run real servers on ephemeral ports against a temporary library: missing/wrong/rotated keys (401), blocked and non-API paths (403), song/folder/queue JSON, patch and folder creation, full, partial, suffix and unsatisfiable ranges, download names, generation and analysis errors, the switch, key rotation and a busy port.

A manual check served a temporary library with one finished WAV on port 8767 and was queried with `curl`: 401 without or with a wrong key (German text with `X-Lang: de`), 403 for `/api/remote`, `/api/shutdown` and `/`, song/folder/queue JSON as above, `Range: bytes=0-99` → `206`, `Content-Range: bytes 0-99/352844`, `Content-Length: 100`, `Content-Type: audio/wav`, the full file as a valid WAV, the download name, a favorite/unsorted patch, and the setup-incomplete error from `/api/generate`.
