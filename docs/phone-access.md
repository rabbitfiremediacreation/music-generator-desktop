# Phone access

Phone access lets the native iPhone app ("Music Generator Remote") and the mobile web app control the desktop app on the home network: browse and play the library, download songs, mark favorites, move songs between folders, create folders, start generations and analyze a recorded idea. It is off by default. One switch starts and stops both access methods.

## Usage

Use the **Phone access** switch at the top of Settings or directly below the language selector in the setup screen. It remains available before model setup is complete and while models are downloading. When switched on, the block shows:

- **iPhone app**: a QR code with `musicgenerator://connect?server=<first address>&token=<key>&alt=<second address>`; the iPhone camera opens the app, which takes over address and key,
- **Web app / PWA**: a second QR code and a selectable link with `http://<host>:8767/mobile/#token=<key>`; the browser takes over and remembers the key automatically, then opens the one-time certificate setup and the HTTPS app,
- the addresses (`http://<LocalHostName>.local:8767` on macOS or the host name elsewhere, plus the LAN IP),
- the read-only access key and **New key**, which replaces the key immediately; the phone must then scan again.

Switching and key changes apply immediately (not through **Save**). The switch and key are stored in the library database (`settings` keys `phone_access` and `phone_access_token`); a switched-on server starts again with the next launch. The computer must stay awake while the phone uses it.

To disable external access, choose Settings → **Phone access** → **Off**. This closes the listener and interrupts ongoing phone uploads and audio transfers. Access stays off after restarting the desktop app. Turning it back on keeps the same access key, so the phone can reconnect without pairing again. Songs already submitted for generation remain in the desktop queue.

### Install the web app

1. Scan **Web app / PWA** while the phone and computer are on the same network.
2. Compare the certificate's SHA-256 fingerprint with the value shown in the desktop settings before trusting it. On iPhone, choose the configuration-profile download (`/mobile-ca.mobileconfig`) in Safari; Android uses the certificate download (`/mobile-ca.crt`). Both contain only the same public CA certificate.
3. Install and trust that certificate on the phone. On iPhone, install the downloaded profile under Settings → General → VPN & Device Management, then enable full trust under General → About → Certificate Trust Settings. The profile simplifies importing the certificate; the website cannot approve installation or trust on your behalf. On Android, find **Install a certificate** in Settings and choose a CA certificate; menu names vary by manufacturer. See [Apple's profile installation instructions](https://support.apple.com/en-ie/102400), [Apple's trust instructions](https://support.apple.com/en-gb/102390) and [Google's certificate instructions](https://support.google.com/pixelphone/answer/2844832?hl=en).
4. Return to the browser and choose **Open HTTPS web app**. The key is carried in the fragment, removed from the address bar immediately and sent to the API only as a Bearer header.
5. Use the browser's install action or, in Safari, Share → Add to Home Screen. QR/Web-link pairing remembers the key on this device automatically. Clear **Remember on this device** for memory-only use; **Disconnect** removes the saved connection.

The HTTPS login screen also offers a camera button to scan a web-app or native-app connection QR code directly. Camera access starts only after pressing the button and stops after success, cancellation or leaving the page. On the initial non-secure HTTP page, use the phone's camera app to open the QR link; browser camera access becomes available after HTTPS is trusted. Manual key entry remains available.

The certificate belongs to this desktop installation. Its private key stays on the computer; only the public certificate is downloadable. If the computer changes networks or IP address, switch access off and on to issue a server certificate for the current addresses. The trusted CA remains the same. If the local library data is replaced, a new CA must be trusted.

HTTPS is required for PWA installation and service workers on a phone; see [MDN's installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). HTTP serves certificate onboarding; remote controls use HTTPS on port 8768. The PWA caches only its static interface, so opening it offline can show the interface but playback, library changes and generation require the desktop connection. API responses, songs, certificates and pairing keys are never stored in the service-worker cache. The mobile interface supports German and English.

## Server

`src-tauri/src/phone_access.rs` runs axum HTTP/1 servers inside the app process: HTTP on `0.0.0.0:8767` for the native app and onboarding, HTTPS on `0.0.0.0:8768` for the PWA. Both ports are bound before either server starts; an occupied port leaves access off and reports a translated error. Switching off cancels both listeners, in-flight requests and response streams. Port 8766 remains available for the separate Python web app.

The Tauri commands are `phone_access_status` and `set_phone_access { enabled?, newToken? }`; both return `{enabled, port, token, addresses, web_port, web_addresses, certificate_fingerprint}`. Public `/mobile/connection.json` returns only HTTPS addresses, certificate/profile download paths and the certificate fingerprint; it never returns the token.

The mobile entry under `frontend/mobile/` is built separately into `dist-mobile/` by `npm run build`. `build.rs` embeds that exact asset tree. Only those allowlisted assets are served under `/mobile/`; desktop resources and arbitrary filesystem paths are inaccessible. The CA identity lives under the library data directory's `phone-access-tls/`, with a private directory and private key permissions on Unix. A fresh leaf certificate is issued on activation using the current hostname and LAN IP, while the persisted CA remains stable.

## Security model

- Every API request needs `Authorization: Bearer <key>`. The key is 18 random bytes, URL-safe Base64 (24 characters), created on first activation. Comparison uses SHA-256 digests compared in constant time. Missing or wrong key: `401 {"detail": …}`. Keys in query parameters or cookies do not authenticate requests.
- Public routes are limited to `/mobile/` assets, `/mobile/connection.json`, `/mobile-ca.crt` and `/mobile-ca.mobileconfig`. `/api/remote`, `/api/shutdown`, `/api/update/…` and any non-GET `/api/settings` answer `403`, as in the web app. The desktop server implements only the endpoints below; it has no settings, delete, export-to-path or model endpoints at all, so the phone cannot read or rotate the key, change settings or touch files outside the library.
- Error texts for 401/403 follow the `X-Lang` header (all twelve UI languages, English fallback).
- The native iPhone API keeps its existing HTTP transport. The PWA uses local HTTPS after certificate onboarding. Anyone who learns the shared access key can use the API while access is on; **New key** revokes it for both clients. Trust the CA only after checking its desktop fingerprint.
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
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib phone_access
npx vitest run frontend/mobile frontend/phone-access.test.ts frontend/react/settings/PhoneAccessField.test.tsx
```

The Rust tests run real servers on ephemeral ports against a temporary library: missing/wrong/rotated keys (401), blocked and non-API paths (403), song/folder/queue JSON, patch and folder creation, full, partial, suffix and unsatisfiable ranges, download names, generation and analysis errors, the switch, interruption of unfinished uploads and downloads when switching off, re-enabling access, key rotation and occupied HTTP/HTTPS ports. HTTPS tests verify trust, stable CA identity, private file permissions and shutdown during an unfinished TLS handshake. Mobile client tests cover pairing, generation, playback cleanup, revoked keys, certificate onboarding and the static-only service-worker cache.

A manual check served a temporary library with one finished WAV on port 8767 and was queried with `curl`: 401 without or with a wrong key (German text with `X-Lang: de`), 403 for `/api/remote`, `/api/shutdown` and `/`, song/folder/queue JSON as above, `Range: bytes=0-99` → `206`, `Content-Range: bytes 0-99/352844`, `Content-Length: 100`, `Content-Type: audio/wav`, the full file as a valid WAV, the download name, a favorite/unsorted patch, and the setup-incomplete error from `/api/generate`.
