# HeartMuLa-Abnahme (#125)

## Gewichtsnachweis

Der native Loader aus audio.cpp v0.9.5 liest den offiziellen Checkpoint `HeartMuLa-oss-3B-happy-new-year` und den Decoder `HeartCodec-oss-20260123` als Safetensors. `HeartMuLaGen` liefert Tokenizer und Generierungskonfiguration. Der Modellkatalog pinnt die drei Revisionen sowie jeden Dateipfad, die Bytezahl und SHA-256. [Modellkatalog](../../../models/catalog.json) · [audio.cpp-Modellspezifikation](https://github.com/0xShug0/audio.cpp/blob/61c7838baf1f7f34769b5b7bd369c0d78edf9535/model_specs/heartmula.json) · [HeartCodec-Modellkarte](https://huggingface.co/HeartMuLa/HeartCodec-oss-20260123/blob/58ec14fd02a123316e4fdaa9fe49fa7a902d1a6f/README.md)

Alle zwölf heruntergeladenen Dateien mit zusammen 22.400.063.577 Bytes wurden lokal gelesen. Die Dateigrößen und SHA-256-Werte stimmten mit dem Katalog überein.

Die Modellkarte und das unverändert als F32 verpackte `mula_weights/muq_linear.bias` identifizieren das von audio.cpp angebotene Q8_0-GGUF als Ableitung des früheren 3B-Checkpoints. Der Q8_0-Header von MindMuse nennt die HNY-Version und `HeartCodec-oss-20260123`. Die beiden geprüften MindMuse-Tensoren stimmen bytegenau mit den gepinnten Originalen überein. Das belegt die Herkunft dieser Tensoren. Für die vollständige Quantisierung fehlt eine reproduzierbare Attestierung auf konkrete Quellrevisionen. Das F32-Profil lädt die Originaldateien. [audio.cpp-Modelllizenzen zur Runtime-Revision](https://github.com/0xShug0/audio.cpp/blob/61c7838baf1f7f34769b5b7bd369c0d78edf9535/docs/model_licenses.md) · [audio.cpp-GGUF](https://huggingface.co/audio-cpp/audio.cpp-gguf/blob/32c1ce1fea57a513eb9386aa62408d47b1cf7ab2/HeartMuLa-GGUF/heartmula-q8_0.gguf) · [MindMuse-GGUF](https://huggingface.co/themindstudio/HeartMuLa-GGUF/blob/b5e55eac99ff25f01608be9d2d978c00a2e8bf63/heartmula-q8_0.gguf)

| Quelle | Bytebereich für `muq_linear.bias`, inklusive Endpunkte | SHA-256 des Bereichs |
| --- | ---: | --- |
| Offizieller früherer 3B, Revision `08d8474`, Shard 4 | 906523232–906535519 | `abf1943dbd0072463d154de36b48754c05e2a92e4f3dba58e0c95fdb35e869c9` |
| Offizieller HNY, Revision `41d4faa`, Shard 4 | 906523232–906535519 | `e21f89630abe4e79497b66cef18fb2e967e41a744a81b6afd96bc37b65001014` |
| audio.cpp Q8_0, Revision `32c1ce1` | 6860041120–6860053407 | `abf1943dbd0072463d154de36b48754c05e2a92e4f3dba58e0c95fdb35e869c9` |
| MindMuse Q8_0, Revision `b5e55ea` | 6859952672–6859964959 | `e21f89630abe4e79497b66cef18fb2e967e41a744a81b6afd96bc37b65001014` |

Der F32-Tensor `flow_matching.cond_feature_emb.bias` des offiziellen 20260123-Codecs hat SHA-256 `0c96c43a1de1ab056e4c1e09fe0fb6420b3b303743bfb7ff200c8b156e8a373f` in Shard 1 bei Bytes 45432–47479. MindMuse (Bytes 9303104–9305151) und audio.cpp (Bytes 9391552–9393599) enthalten dieselben Bytes. Die Offsets stammen aus den Safetensors- und GGUF-Headern.

## Native Paketierung

Auf Apple Silicon enthält das App-Paket die gepinnte native Bibliothek und einen Launcher, der dieselbe C-API wie die Runtime verwendet. Der Launcher übernimmt den macOS-Dateizugriff per Bookmark und schreibt PCM16-WAV. Der Pakettest prüft die Runtime-Inventarliste, Hashes und den Start unter der App Sandbox. Die Build-Pins enthalten die audio.cpp-Revision, das Bibliotheksarchiv und die Modellspezifikation. Die Gewichte liegen separat im gewählten Modellordner. [Runtime-Pins](../../../models/audio-cpp-runtime.json) · [Sandbox-Pakettest](../../../src-tauri/src/sandbox/probe.rs)

Das Archiv `audio-v0.9.5-lib-macos-arm64-metal.tar.gz` der Revision `61c7838baf1f7f34769b5b7bd369c0d78edf9535` hatte 15.181.943 Bytes und den bestätigten SHA-256 `6c66ce9515c3e0bcf298186f6497881a124e97fd9c986afd25e244f43103bd48`. `model_specs/heartmula.json` hatte 9.556 Bytes und SHA-256 `0029cb67e67695a9e62db938d95a0269979b6d1e9a156c30a2d1de8d456cf123`. Die Datei stimmte bytegenau mit der Spezifikation im CLI-Release überein. Auf einem Apple M5 Pro meldete der erzeugte Launcher `audio.cpp 0.9.5`. `otool` zeigte die mitgelieferte Bibliothek und macOS-Systembibliotheken als Laufzeitabhängigkeiten. [Veröffentlichte Archiv-Prüfsummen](https://github.com/0xShug0/audio.cpp/releases/expanded_assets/v0.9.5)

## Offline-Lauf auf Apple Silicon

Die Desktop-App lief isoliert auf einem Apple M5 Pro mit 64 GiB Unified Memory und macOS 26.6.2. Das Betriebssystem sperrte ausgehende Netzwerkverbindungen. Nur Loopback für die lokale MCP-Steuerung blieb zugelassen. Der ModelPicker prüfte die Größe und SHA-256 aller zwölf bereits bezogenen Dateien und aktivierte das Profil. Der Auftragsweg über MCP verwendete den tatsächlichen Worker, den nativen Metal-Launcher, die Bibliotheksdatenbank und die normalen WAV-Exporte.

Alle Aufträge verwendeten Seed 42, die Tags `indie pop, soft drums, warm vocals, acoustic guitar` und denselben englischen Text mit Strophe und Refrain. Die Zeilen begannen mit „The paper kite follows the river“ und „Carry me home, carry me home“. Die Zeitmessung umfasst den Launcher, Modellladen, Synthese und WAV-Ausgabe. Die Audiozeit wurde aus der WAV gemessen und mit dem Bibliothekseintrag verglichen.

| Probe | Angeforderte Zeit | WAV | Prozesslaufzeit | WAV-SHA-256 |
| --- | ---: | ---: | ---: | --- |
| Kurz | 5 s | 5,04 s | 200,70 s | `cbbcd6de99c0a81abb988ebbf260f64b5b3b60c6dd4af9a9d520f0ad98d178bc` |
| Länger | 30 s | 30,08 s | 214,62 s | `6337dc9610c08706faea9eccf8e1c6ddd7c566860b8ab63fa67a3f9767f2be1b` |
| Wiederholung | 5 s | 5,04 s | 223,28 s | `cbbcd6de99c0a81abb988ebbf260f64b5b3b60c6dd4af9a9d520f0ad98d178bc` |

Die WAVs sind 48-kHz-Stereo in PCM16. Der kurze Clip hatte −1,50 dBFS Spitzenpegel, −18,38 dBFS RMS und keine Samples an der PCM-Grenze. Im längeren Clip wurden 0,00 dBFS Spitzenpegel, −15,43 dBFS RMS und fünf Samples an der PCM-Grenze gemessen. Die Metal-Runtime meldete 15.021,96 MiB für die Generatorgewichte und 6.000,73 MiB für die Codecgewichte. Das sind die beiden protokollierten Gewichtspuffer im Unified Memory. Die Laufzeiten stammen von diesem Rechner unter paralleler Hostlast.

Die lokale Whisper-Stichprobe erkannte im längeren WAV zwischen 0 und 19 Sekunden alle vier vorgegebenen Textzeilen und danach eine ungefähre Wiederholung des Refrains. Im kurzen WAV erkannte sie den Anfang der ersten Zeile. Die menschliche Hörprüfung von Verständlichkeit, Gesang und Störgeräuschen ist offen. [Whisper-Prüfpfad](../issue-105/README.md#ergänzende-automatische-transkription)

Der Wiederholungsauftrag mit identischem Seed und Eingaben war byteidentisch zum ersten WAV. Der Abbruch eines laufenden Auftrags hinterließ sowohl den gespeicherten Status `cancelled` als auch einen sauberen Ausgabeordner ohne Teil-WAV. Der normale WAV-Export war byteidentisch mit dem Bibliotheksoriginal. Die drei leeren Titel erhielten Fallback-Titel und der Titelmodellpfad blieb leer.

Ein lokal ad hoc signiertes Testbundle aus den vorhandenen gepinnten ACE-Step-Ressourcen und den aktuellen Rust- und audio.cpp-Binaries bestand die strikte Signaturprüfung. Darin startete der Launcher über den Supervisor unter der macOS App Sandbox und konnte die nicht freigegebene Testdatei nicht lesen. Auch die ACE-Step-, Titel- und MP3/ZIP-Probes bestanden. Der vollständige Paketbuild endete zuvor am Zeitlimit des bestehenden ACE-Step-Registry-Tests.

Der optionale Rust-Hardwaretest vollzieht Verifikation, Warteschlange, erneuten Auftrag, Abbruch und Export mit denselben Modelldateien nach. Er erhält den Modelle-Ordner, den Ressourcenordner und einen neuen Ausgabepfad über `MUSIC_HEARTMULA_QA_MODELS`, `MUSIC_HEARTMULA_QA_RESOURCES` und `MUSIC_HEARTMULA_QA_OUTPUT`. Das mit `cargo test --lib --no-run` gebaute Testprogramm wird neben `music-engine-supervisor` kopiert und mit `--ignored --exact jobs::heartmula_hardware::offline_queue_library_export_and_cancel --nocapture` in einer Umgebung ohne ausgehende Verbindungen aufgerufen. [Hardwaretest](../../../src-tauri/src/jobs/heartmula_hardware.rs)

## GGUF-Profile

Die GGUF-Profile verwenden dasselbe gepinnte audio.cpp 0.9.5 und übergeben die ausgewählte Datei direkt aus `heartmula-gguf/`. Jedes Paket enthält seinen Codec und Tokenizer. Der Hardwaretest wählt das Profil über `MUSIC_HEARTMULA_QA_PROFILE`, prüft die vollständige SHA-256 über den App-Modellinstaller und startet einen fünfsekündigen Auftrag. Er prüft den Metal-Backend-Eintrag, die Gewichtspins im gespeicherten Auftrag, ein nicht stummes 48-kHz-Stereo-PCM16-WAV und den bytegleichen WAV-Export.

| Profil | Gemessene WAV-Dauer | Native Laufzeit | WAV-SHA-256 |
| --- | ---: | ---: | --- |
| HeartMuLa 3B Q8_0 | 5,04 s | 11,53 s | `1fd3969a5e6b43c9ad1ee1312ca5d0ecd84f7056a8dd90885c0aedbe86034e89` |
| HeartMuLa 3B Happy New Year Q8_0 | 5,04 s | 10,10 s | `e737b7c5dce1716c3af18b3ccf6f29433b1f1aec5278eb8d6c421093f1cbb34a` |

Das HNY-Q8_0-Paket ließ sich mit dem veröffentlichten GGUF-Header und den gepinnten HNY- und Codec-Safetensors vollständig bytegleich reproduzieren. Wiederholungstests in den endgültigen Katalogpfaden lieferten dieselben WAV-Prüfsummen. Beim Originalprofil reproduzierte die App die WAV-Prüfsummen aus den F32-Referenzläufen. Abbruch und Export bestanden auch mit beiden GGUFs im Modellordner.

## Weitere Plattformen und Testabdeckung

Der eigenständige CPU-Launcher lud beide originalen Gewichtspuffer und erreichte die autoregressive Generierung. Beim Zeitlimit nach 260 Sekunden lag kein WAV vor.

CUDA-Laufzeit und VRAM auf einem NVIDIA-System sowie die Vulkan-Inferenz auf Linux und Windows sind offen. Für HeartMuLa gibt der ModelPicker den Metal-Pfad auf Apple Silicon mit mindestens 64 GiB frei. Der Bereich von 5 bis 30 Sekunden ist die getestete App-Grenze. Die Upstream-Langform gehört zu einer eigenen Hardware-Abnahme.

Bestanden haben 536 Frontend-Tests, TypeScript, ESLint, die Desktop- und PWA-Produktionsbuilds sowie 39 Tests für die Paketierung. Die gezielten Rust-Suiten für Katalog, Downloads, Profil- und Seed-Snapshots, ACE-Step-Expert Mode, Auftragsvalidierung und die autorisierten Handy- und MCP-Endpunkte bestanden. Die breiteren Rust-Tests hatten Start-Timeouts in vier MP3-Lifecycle-Fixtures sowie in den MCP-Konsolen- und macOS-Syntheseprobe-Fixtures. Regulärer Export, Bibliothek und Wiedergabe bestanden.
