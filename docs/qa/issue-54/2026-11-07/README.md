# Issue #54: Verifikation auf aktuellem main

Prüfung durch Codex (gpt-6.1-sol, Ultra Reasoning) am 7. November 2026.
Geprüfter Quellstand: `aa151677f7d36b43d7c0a8203b12e313bd479e16`.

## Ergebnis und Entscheidung

Die bestehenden Maßnahmen aus [PR #65](https://github.com/rabbitfiremediacreation/music-generator-desktop/pull/65)
und [PR #71](https://github.com/rabbitfiremediacreation/music-generator-desktop/pull/71)
sind auf dem aktuellen `main` enthalten. Es wurde kein zusätzlicher Implementierungsfehler
belegt, der einen weiteren Produktcode-Fix rechtfertigt. Der Produktcode bleibt unverändert;
dieser Ordner enthält lokale Prüfnachweise und die dafür verwendeten Hilfsprogramme.
Die Modellqualität ist damit nicht allgemein als fehlerfrei nachgewiesen.

## Quellen und geprüfter Codepfad

[Issue #54](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/54)
und alle drei Kommentare wurden über GitHub neu gelesen. Der vollständige
[Messkommentar samt Berichtigungen](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/54#issuecomment-6552584211)
wurde berücksichtigt: 29 von 310 eindeutigen Läufen, keine Nutzungsquote,
17 von 20 für `English` und `en`, keine belegte echte Retry-Prüfung im damaligen Beitrag,
keine pauschale Aussage zur Textlänge. Diese historischen Zahlen werden hier nicht neu bestätigt.

- `db.rs::enqueue` entfernt Leerraum aus eigenen Lyrics und setzt bei Instrumentalaufträgen
  `[Instrumental]`. `EngineClient::generate` entfernt leere Felder aus der LM-Anfrage.
- `normalize_vocal_request` schreibt die zehn Picker-Codes als englische Sprachnamen und
  begrenzt die Temperatur bei fehlenden Lyrics auf höchstens 0,85. Eigene Texte behalten
  ihre gewählte Temperatur. Vor der Synthese wird der ursprüngliche Sprachcode wieder eingesetzt.
- `complete_codes` wiederholt bei fehlendem Text trotz gewünschtem Gesang auch dann einmal,
  wenn die Audiocodes bereits ausreichend lang sind. Gesungene, ausreichend lange Kandidaten
  dürfen auch mit etwas weniger Codes gewinnen. Fehler und Abbruch bleiben behandelt.
- Formularstandard, Zurücksetzen, MCP-Beschreibungen und Tooltips in allen zwölf Übersetzungen
  verwenden 0,85. Gültige gespeicherte Werte bleiben absichtlich erhalten.

## Echte Engine, isolierte Daten

Die Umgebung und Prüfsummen stehen in [environment.json](environment.json).
Hardware: Apple M5 Pro, 64 GiB RAM, macOS 26.6.2. Das Engine-Protokoll bestätigt
`LM backend: MTL0` und `Apple M5 Pro`. Dies ist kein Test auf Ralfs Mac mini M4 mit 24 GB RAM.

Runtime: `b7ba6d9-sandbox2-steps200`, Source-Revision
`b7ba6d9ce2f19ca7627fb8f340032c3ebe8ae253`, aus dem macOS-Arm64-CI-Artefakt von `main`.
Die ZIP-Prüfsumme stimmt mit der beigefügten SHA256-Datei überein. Die Runtime wurde nach
`/private/tmp/issue54-runtime` kopiert und nur dort für den direkten Start ad hoc signiert.
Der App-Sandbox-Helfer aus dem installierten Bundle ließ sich aus einem fremden Prozess
nicht direkt starten; dieser erste Abbruch ist kein Lyrics-Befund.

Das 4B-Q8-Modell, Standard-DiT, Text-Encoder und VAE wurden per Copy-on-Write in einen eigenen
temporären Modellordner kopiert. Alle vier SHA-256-Werte stimmen mit `models/manifest.json`
überein. Eigene Prozesse und dynamische localhost-Ports; keine App-Bedienung, keine Benutzer-
Datenbank, keine Bibliotheksänderung. Vor dem Start waren keine App-/ace-server-Prozesse sichtbar.
Die Engine-Prozesse werden vom Prüfprogramm im `finally`-Block beendet.

### Acht direkte LM-Proben

In [lm/](lm/) liegen sämtliche Requests, die unveränderten JSON-Inhalte der Antworten
und das Engine-Protokoll. Die Namen mit `before` bezeichnen gezielte Anfragen mit früheren
Parameterwerten; es wurde dafür kein alter App-Checkout gestartet.

Konstant: 120 Sekunden, 110 BPM, Song-Seed 12345, leeres/fehlendes Lyrics-Feld,
`use_cot_caption: true`, Stil
`synthwave, retro pop, layered female vocals, analog synths, driving bass, wide reverb`.
`lm_seed` wurde für die Diagnose ausdrücklich festgelegt. Die normale App tut dies beim
ersten Versuch nicht. Proben wurden nacheinander ausgeführt.

- `en-before-3`: `en`, 1,2, LM-Seed 3. Überwiegend Englisch mit unpassendem `quá` und
  sprachlichen Fehlern. Kein Nachweis des gesamten ursprünglich gemeldeten Kauderwelschs.
- `en-current-3`: `English`, 0,85, Seed 3. Englischer, stark repetitiver Text.
- `en-current-6`: `English`, 0,85, Seed 6. `[Instrumental]`, 598 Codes trotz Gesangsauftrag.
- `en-current-7`: `English`, 0,85, Seed 7. Englischer Text, 599 Codes; enthält das fragwürdige
  Wort `Aanyeon`. Keine pauschale Bewertung als fehlerfreier Songtext.
- `de-before-3`: `de`, 0,85, Seed 3. Kein deutscher Text; skandinavisch wirkende, entstellte Zeilen.
- `de-current-3`: `German`, 0,85, Seed 3. Deutscher Text mit grammatischen Fehlern und Wiederholungen.
- `de-current-6`: `German`, 0,85, Seed 6. `[Instrumental]`, 598 Codes trotz Gesangsauftrag.
- `de-current-7`: `German`, 0,85, Seed 7. Deutscher Text, 600 Codes; Fantasiewort `Mitarathon`.

Die Einordnung der Sprache erfolgte durch Lesen der Texte. Dies ist eine kleine diagnostische
Stichprobe. Insbesondere belegt ein Vorher-/Nachher-Paar keine Erfolgsquote und isoliert bei
Englisch nicht den Effekt von Sprachname und Temperatur voneinander. Es werden keine neuen
Prozentwerte, Signifikanzbehauptungen oder allgemeinen Qualitätsgarantien daraus abgeleitet.

### Retry durch den Produktionscode

Der zusätzliche Durchlauf mit dem unveränderten `EngineClient::generate` aus `main`
ist erfolgreich abgeschlossen. In [pipeline/](pipeline/) liegen die HTTP-Mitschnitte,
echten LM-Antworten, finale Metadaten, Clientausgabe und das Engine-Protokoll.

Damit der seltene erste Stille-Fall reproduzierbar ist, setzt ein lokaler Prüfproxy
**ausschließlich beim ersten LM-Request** `lm_seed: 6`. Der Originalrequest des Clients
wird vorher gesondert gespeichert. Weitere Requests und alle Engine-Antworten werden
unverändert weitergereicht. Weder die LM-Ausgaben noch die Synthese sind Attrappen.
Der Proxy stellt keinen SSE-Logstream bereit; der Client verwendet dafür seine vorhandene
Fortschrittsanzeige nach verstrichener Zeit. Das vollständige echte Engine-Log wird separat erfasst.

Beobachteter Ablauf:

1. Eingabe: `vocal_language: en`, leere Lyrics, Varianz 1,2, 120 Sekunden, Song-Seed 12345.
2. Tatsächlicher erster LM-Request: `English`, **0,85**, kein Lyrics-Feld und vor dem
   Prüfproxy **kein** `lm_seed`. Damit ist die Temperaturgrenze direkt am echten HTTP-Request belegt.
3. Echte erste Antwort mit dem injizierten Seed 6: `[Instrumental]`, 598 Audiocodes.
4. Der Produktionscode löst selbst die Wiederholung aus und sendet **Seed 7**;
   `English`, 0,85 und Song-Seed 12345 bleiben erhalten.
5. Echte zweite Antwort: englischer Text, 599 Codes. Genau ein Synthese-Request übernimmt
   diese Antwort und setzt die Gesangssprache wieder auf **`en`**.
6. Echte Standard-DiT-/VAE-Synthese auf Metal. Finale Metadaten bestätigen `lm_attempts: 2`,
   `lm_retry_seed: 7`, `lm_seed: 7`, `vocal_language: en`, Song-Seed 12345 und fünf tatsächlich
   ausgeführte Iterationen. Die WAV-Datei hat **119,84 Sekunden**, Stereo, 48 kHz, 16 Bit.

Die fünf Syntheseschritte dienen der technischen Pipeline-Prüfung und sind keine Messung
der Audioqualität mit den üblichen Standard-Einstellungen. Die WAV wurde nicht abgehört;
aus dem Vorhandensein von Lyrics wird keine Aussage über tatsächlich hörbaren Gesang abgeleitet.
Die 22-MiB-WAV liegt nur unter `/private/tmp/issue54-real-pipeline/song.wav`, nicht im Repository.
Der Fall „gesungener zweiter Versuch mit weniger Codes“ bleibt durch den vorhandenen
Integrationstest mit Attrappe abgedeckt; hier hatte der zweite Versuch einen Code mehr.

### Hilfsprogramme für eine Wiederholung

[probes/issue54_probe.py](probes/issue54_probe.py) führt die acht direkten LM-Anfragen aus.
[probes/issue54_pipeline.py](probes/issue54_pipeline.py) startet die echte Engine und den
Prüfproxy und führt den Rust-Prüfclient aus. Beide benötigen Python 3 ohne Zusatzpakete.
[probes/issue54_probe.rs](probes/issue54_probe.rs) ist ausschließlich ein Aufrufer des
unveränderten Produktionsclients; für die Messung wurde er vorübergehend als Cargo-Example
gebaut und danach wieder aus `src-tauri/examples` entfernt. Keine neue öffentliche API,
kein Testschalter und keine Seed-Sonderbehandlung im Produktcode.

Mit einer geeigneten separat lauffähigen Runtime, geprüften Modellkopien und erlaubten
localhost-Ports lässt sich die Prüfung aus der Repository-Wurzel wiederholen:

```sh
python3 docs/qa/issue-54/2026-11-07/probes/issue54_probe.py \
  --engine /private/tmp/issue54-runtime/ace-server \
  --models /private/tmp/issue54-models --output /private/tmp/issue54-repeat-lm

cp docs/qa/issue-54/2026-11-07/probes/issue54_probe.rs src-tauri/examples/issue54_probe.rs
cargo build --offline --locked --manifest-path src-tauri/Cargo.toml --example issue54_probe
rm src-tauri/examples/issue54_probe.rs
python3 docs/qa/issue-54/2026-11-07/probes/issue54_pipeline.py \
  --engine /private/tmp/issue54-runtime/ace-server \
  --models /private/tmp/issue54-models \
  --client "$PWD/src-tauri/target/debug/examples/issue54_probe" \
  --output /private/tmp/issue54-repeat-pipeline
```

Vorher `npm ci` und `npm run build`, falls die Rust-Buildvoraussetzungen noch fehlen.
Die Pipeline-Assertions erwarten gezielt den hier beobachteten Seed-6-Fall und können auf
anderer Hardware/Runtime anders ausfallen. Die ursprünglichen Antworten bleiben unverändert
erhalten; die Wiederholung schreibt in neue Ausgabeordner.

## Regressionen und Buildchecks

Die unveränderten lokalen Ausgaben stehen unter [checks/](checks/).

- `npm ci`: Lockdatei unverändert; einzelne Pakete fehlten im Offline-Cache und wurden geladen.
- `npm run build`: erfolgreich, einschließlich TypeScript-Prüfung sowie Desktop- und Mobile-Webassets.
- `npm run lint`: erfolgreich.
- `npm test`: 466 Tests in 52 Dateien bestanden.
- `npm run test:desktop`: 34 bestanden, 1 plattformabhängig übersprungen.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: erfolgreich.
- `cargo clippy --offline --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: erfolgreich.
- Sechs gezielte Unit-Tests in `engine::generation::tests`: bestanden.
- `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --test engine --test audio_duration --test generation_parameters --test generation_limits`:
  31 Integrationstests bestanden, darunter `an_instrumental_answer_to_a_vocal_request_is_retried`
  und `a_worse_second_take_does_not_replace_the_first`. Diese bestehenden Tests nutzen Engine-Attrappen.

Die TCP-Integrationstests benötigen eine Ausführung außerhalb der Sandbox; darin ist bereits
`bind(127.0.0.1:0)` verboten. Der vollständige lokale `cargo test`-Versuch außerhalb der Sandbox
war **nicht vollständig grün**: 171 Unit-Tests bestanden, einer wurde übersprungen, der separate
MCP-Test `network_scope_rebinds_fixed_port_and_authenticates_real_lan_requests` scheiterte an
`AddrNotAvailable` für `10.90.0.0`. Der Lauf endete daher vor den Integrationstests; die relevanten
31 wurden anschließend mit obigem separaten Befehl erfolgreich ausgeführt. Kein Fix an diesem
anderen Thema vorgenommen.

Die [Desktop-CI für exakt diesen main-Commit](https://github.com/rabbitfiremediacreation/music-generator-desktop/actions/runs/42376912765)
ist für Windows x64 und macOS arm64 erfolgreich, einschließlich vollständiger Tests, Clippy,
Build und Paketprüfung. Das wurde über die GitHub-Jobdaten und den Checkout-SHA in den bereits
vorliegenden CI-Logs überprüft. Lokal wurde kein neues signiertes Release-Bundle gebaut.

## Grenzen

- Original-Stil, Tempo, Länge, Modellquantisierung und Logs des Melders fehlen.
- Kein M4-/24-GB-, Windows-/CUDA- oder allgemeiner Mehrsprachen-Vergleich in dieser Prüfung.
- Automatische Texte können weiterhin Fantasiewörter, Grammatikfehler und Sprachabweichungen
  enthalten. Die vorhandene Erkennung prüft Text außerhalb von Abschnittsmarken, nicht seine Sprache.
- Ein fehlendes `lyrics`-Feld in der Antwort löst absichtlich keinen Stille-Retry aus.
  Nach zwei textlosen Antworten gibt es weiterhin keine Gesangsgarantie. Der Issue-Kontext und
  PR #65 benennen diese Grenzen bereits; die vorliegenden Daten begründen keinen pauschalen neuen Filter.
- Bei manuell gewählter Varianz über 0,85 bleibt der gespeicherte/angezeigte Anfragewert erhalten,
  obwohl automatische Lyrics mit höchstens 0,85 angefragt werden. Das ist das dokumentierte
  Verhalten aus #65; #71 gleicht den Standardwert an und migriert gültige alte Präferenzen nicht.
- Keine GitHub-Kommentare, kein Pull Request, kein Merge und kein Schließen des Issues durch diese Prüfung.
