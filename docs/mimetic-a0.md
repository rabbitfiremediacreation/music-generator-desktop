# Mimetic A0 im Studio

Unter **Einstellungen → Modelle und Hardware → Modell hinzufügen** das Profil **Mimetic A0 · Short Clips** öffnen. Der ModelPicker zeigt Quellen, Größen und Lizenzhinweise vor dem Bezug. **Herunterladen und verwenden** lädt das Profil in den Modellordner, setzt abgebrochene Downloads fort und aktiviert erst nach Prüfung aller Dateien. Für lokalen Import die Dateien mit den Katalognamen in denselben Modellordner kopieren, **Modelldateien neu einlesen** und dann **Prüfen und verwenden** wählen.

Im Studio eine Beschreibung, BPM und 1, 2 oder 4 Takte eingeben. Tonart, Akkorde, Spielweise und Instrumente gehören in die Beschreibung. Das Profil arbeitet im 4/4-Takt und berechnet die Länge als `240 × Takte ÷ BPM`. Zulässig sind ganzzahlige BPM von 1 bis 300 sowie Ergebnisse bis einschließlich 16 Sekunden. Für vier Takte sind damit mindestens 60 BPM erforderlich. Der WAV-Export enthält jeweils `⌊48 000 × 240 × Takte ÷ BPM⌋` Stereo-Sampleframes in PCM24. Die Bibliothek speichert die aus dem WAV gelesene Dauer, die Prozesslaufzeit, den Seed und die Modell-/Runtime-Pins.

Über den Handy-Zugriff gelten dieselben Eingaben. Für MCP verwendet `generate_music` die Felder `prompt`, `bpm`, `bars` und optional `seed`. Der modellinterne Seed ist eine Zahl von 0 bis 4.294.967.295. Bei `-1` vergibt die Warteschlange einen Seed.

## Runtime und Quellen

Der macOS-arm64-Build enthält einen einmal pro Auftrag gestarteten Launcher mit eingebettetem CPython, PyTorch und Stable Audio Tools. Gewichte und Encoder bleiben im separaten Modellordner. Die Generierung lädt T5 ausschließlich aus diesem Ordner. Das Profil setzt 50 Diffusionsschritte und CFG 6 wie die Upstream-Beispiele ein. Der Sampler setzt mit 16 Sekunden Kontext an und die Laufzeit schneidet die Ausgabe auf die berechnete Samplezahl. [Mimetic A0 Runtime](https://github.com/micknoise/mimetic-a0/tree/c4331b95f2db653c6268973a3096c8f0a77a4a61) · [Stable Audio Tools](https://github.com/Stability-AI/stable-audio-tools/tree/3241adba4fc2a85cf5b29d9eb68d42f40a28e820)

Der Katalog enthält pro Datei Repository-Pfad, feste Revision, exakte Byte-Größe und SHA-256. Die fünf Dateien umfassen insgesamt 1.914.701.826 Byte. Im Safetensors-Header des FP16-Checkpoints stehen 365 `pretransform.*`-Tensoren für den eingefrorenen ACE-Step-1.5-VAE, darunter Encoder- und Decoder-Gewichte. Der Herausgeber hat den VAE in das Layout von Stable Audio Tools konvertiert. Der lokale T5-Encoder lädt aus dem veröffentlichten Safetensors-Checkpoint von T5-base mit Konfiguration und `tokenizer.json`. [Modellkatalog](../models/catalog.json) · [Mimetic A0 Gewichte und SHA256SUMS](https://huggingface.co/micknoisemachine/mimetic-a0/tree/5f21e1807517cda2e6d72051cdb81dafc3931077) · [T5-base](https://huggingface.co/google-t5/t5-base/tree/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1)

Mimetic A0, sein VAE und Stable Audio Tools stehen unter MIT. T5-base steht unter Apache-2.0. Beide Modellquellen sind öffentlich zugänglich. Bei Weitergabe gelten die Lizenz- und Hinweispflichten der einzelnen Komponenten. Im Mimetic-NOTICE sind von Uploadenden als CC0 gekennzeichnete Freesound-Clips und eigene synthetische Daten dokumentiert. Einige synthetische Daten nutzen GeneralUser GS 2.0.3, bei dem die Herkunft einzelner Samples laut dessen Autor unklar ist. Die MIT-Lizenz enthält keine gesonderte Output-Klausel. [Drittanbieterhinweise](../THIRD_PARTY_NOTICES.md) · [Mimetic A0 NOTICE](https://huggingface.co/micknoisemachine/mimetic-a0/blob/5f21e1807517cda2e6d72051cdb81dafc3931077/NOTICE)

## Lokaler Abnahmelauf

Die automatischen Tests prüfen die Taktgrenzen, die Übernahme von BPM und Seed in die Aufträge, das erwartete WAV-Format und die Samplezahl. Der manuelle Test `offline_queue_and_wav_export` verwendet die gepinnten Gewichte, den gemeinsamen ModelDownloader für den lokalen Import, den Worker und den normalen WAV-Export. Er benötigt auf macOS arm64 ein vorbereitetes `resources/engine/mimetic-synth` und den Supervisor aus dem Desktop-Build.

Am 19. November 2026 wurden alle fünf Quelldateien vollständig gehasht und mit den Katalogwerten abgeglichen. `resumes_real_checkpoint` ergänzte die letzten 2 MiB eines echten Mimetic-`.part` von Hugging Face. Der gemeinsame Downloader prüfte die vollständigen 1.021.661.156 Byte und übernahm die Datei nach erfolgreicher SHA-256-Prüfung.

Der Runtime-Selbsttest auf dem MacBook Pro mit Apple M5 Pro, 64 GiB gemeinsamem Speicher und macOS 26.6.2 meldete isoliertes CPython 3.11.14, PyTorch 2.7.1, SoundFile 0.14.0 und verfügbares Metal (MPS). Der Launcher lädt diesen Interpreter direkt im eigenen Prozess. Bei der ersten Ausführung dauerte die macOS-Signaturprüfung der nativen Bibliotheken auf dem Testrechner mehrere Minuten.

Die vorbereitete Runtime belegt rund 618 MiB ohne Modellgewichte. In einem separat lokal signierten Testbundle startete der echte Desktop-Supervisor den Launcher mit geerbtem App Sandbox. Der Selbsttest lief erfolgreich und die Sandbox verweigerte den Zugriff auf eine nicht ausgewählte Datei. Der ModelPicker gibt macOS arm64 mit Metal ab 16 GiB RAM frei. Diese Untergrenze ist eine konservative Produktanforderung, gemessen wurde auf dem 64-GiB-Gerät. Ein separater Metal-Lauf mit vier Takten bei 90 BPM erreichte einen vom Betriebssystem gemeldeten Prozess-Speicherhöchstwert von 5.730.897.040 Byte.

Der CPU-Aufruf desselben Launchers auf dem Apple M5 Pro schrieb bei 120 BPM und einem Takt genau 96.000 Sampleframes. Zwei erfolgreiche Offline-Aufträge mit Seed 42 dauerten 156,84 und 163,98 Sekunden und lieferten identische WAV-Bytes (SHA-256 `ea6321201b866610ad2b3168979d716e5825418d28bc42c79c4300e54bdb2cf3`). Der Studio-Pfad nutzt Metal. CUDA, macOS Intel, Windows und Linux sind für dieses Profil offen. Die vollständige Installation des Release-Bundles ist ebenfalls offen.

### Metal-Messreihe

Die sieben Aufträge liefen über die gemeinsame Warteschlange mit gesperrtem Netzwerk und leerem Hugging-Face-Cache. Der Worker verwendete jeweils einen neuen Prozess. Alle Dateien stimmen mit der berechneten Samplezahl überein und enthalten 48 kHz Stereo in PCM24. Die Einzel-Exporte und die sieben Dateien im Bibliotheks-ZIP stimmen byteweise mit den gespeicherten WAVs überein. Der Auftrag mit leerem Titel erhielt einen Fallback-Titel aus der Bibliothek.

| WAV | Takte | BPM | Seed | Sampleframes | WAV-Dauer in s | Prozesslaufzeit in s | Tempo aus Onsets |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `drums.wav` | 4 | 90 | 31 | 512.000 | 10,666666667 | 57,93 | 89 |
| `drums-repeat.wav` | 4 | 90 | 31 | 512.000 | 10,666666667 | 38,23 | 89 |
| `bass.wav` | 2 | 115 | 2718 | 200.347 | 4,173895833 | 40,23 | 105 |
| `melody.wav` | 4 | 60 | 31415 | 768.000 | 16,000000000 | 32,89 | 64 |
| `one-bar.wav` | 1 | 124 | 42 | 92.903 | 1,935479167 | 36,01 | 123 |
| `bass-2.wav` | 2 | 100 | 17 | 230.400 | 4,800000000 | 39,07 | 85 |
| `melody-2.wav` | 2 | 120 | 23 | 192.000 | 4,000000000 | 37,06 | 121 |

Die beiden Drum-WAVs mit Seed 31 sind bytegleich (SHA-256 `43218665f3bfa4a1496e80a236c8b61e4b80b9ce4c37d528b2fc380b0c385505`). Die Prozesszeiten enthalten Modellladen, Diffusion, VAE und WAV-Schreiben und wurden unter gleichzeitiger Systemlast gemessen. Der Tempo-Schätzer sucht per Onset-Autokorrelation in einem Fenster von ±18 % um die Vorgabe. Bei den Drumclips liegt sein Ergebnis nahe an der Vorgabe. Bei den beiden Bassclips sind die Abweichungen größer.

### Taktübergänge und Loop-Naht

Die Tabelle zeigt den maximalen Sprung zwischen zwei aufeinanderfolgenden Sampleframes an den berechneten 4/4-Taktgrenzen und beim Sprung vom letzten zum ersten Sampleframe. Die Werte sind in dBFS angegeben.

| WAV | Interne Taktgrenzen mit Samplesprung | Loop-Naht |
| --- | --- | ---: |
| `drums.wav` | 2,667 s (−57,30), 5,333 s (−42,76), 8,000 s (−46,98) | −25,20 |
| `bass.wav` | 2,087 s (−71,64) | −10,21 |
| `melody.wav` | 4,000 s (−43,92), 8,000 s (−33,30), 12,000 s (−28,21) | −9,01 |
| `one-bar.wav` | Ein Takt | −39,66 |
| `bass-2.wav` | 2,400 s (−40,66) | −12,00 |
| `melody-2.wav` | 2,000 s (−62,49) | −38,38 |

Bei `bass.wav` und `melody.wav` sind die Loop-Nähte deutlich stärker als die internen Übergänge. Für die Tonarten lagen bei `bass.wav` 20 von 20 dominanten Frequenzspitzen im vorgegebenen C-Moll-Tonvorrat, bei `melody.wav` 80 von 80 in A-Moll, bei `bass-2.wav` 23 von 24 in D-Moll und bei `melody-2.wav` 15 von 15 in C-Dur. Die Messung prüft jeweils den Tonvorrat. Das Abhören auf Klicks und die Prüfung der gewünschten Akkordfolgen bleiben offen. [Messskript](qa/issue-130/measure.py)

### Reproduktion

```sh
cargo build --manifest-path src-tauri/Cargo.toml --bin music-engine-supervisor
ln -sf ../music-engine-supervisor src-tauri/target/debug/deps/music-engine-supervisor
export MIMETIC_QA_MODELS=/absolute/path/to/verified/models
export MIMETIC_QA_RESOURCES="$PWD/src-tauri/resources"
export MIMETIC_QA_OUTPUT=/tmp/mimetic-fresh-qa
sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  cargo test --offline --manifest-path src-tauri/Cargo.toml --lib \
  engine::mimetic::acceptance::offline_queue_and_wav_export -- --ignored --nocapture
```

Das Zielverzeichnis muss neu sein. Die Beschreibungen und Seeds stehen im [Abnahmetest](../src-tauri/src/engine/mimetic/acceptance.rs). Auf dem Testrechner liegt das Export-ZIP unter `/tmp/music-gen-130-qa-complete/library.zip` mit SHA-256 `4b0720c6be25c92b1120029d3e7514e56b57e4a04b999eff1e340cca0085072a`.
