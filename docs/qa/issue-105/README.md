# Issue #105 · Hörreihe mit ACE-Step 1.5

QA-Stichprobe vom 18. November 2026 zu [Issue #105](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/105), Ausgangsstand `c982d54c7abff35463c6c31517a3b3f69389b963`.

Die Engine-Proben ergänzen die [Fünf-Schritte-Prüfung aus #54](../issue-54/2026-11-07/README.md). Die menschliche Hörprüfung ist für alle Proben offen.

## Versuchsmatrix

| Faktor | Einstellung |
| --- | --- |
| Sprachaufträge | Deutsch (`de`), Englisch (`en`), Spanisch (`es`), jeweils mit automatisch erzeugten Lyrics |
| Instrumentalkontrollen | Ein Auftrag je Seed-Paar und LM-Größe, mit `[Instrumental]` in LM und Synthese und ohne Sprachvorgabe |
| LM-Größen | ACE-Step 5 Hz 0,6B, 1,7B und 4B, jeweils Q8_0 |
| Song-Seed / LM-Seed | `12345 / 3` und `67890 / 7`, für jede Sprache, Kontrolle und LM-Größe gleich |
| DiT | ACE-Step 1.5 Standard SFT Q8_0, 80 Schritte laut GPU-Empfehlung für dieses Modell im Studio ([Katalog](../../../models/catalog.json), [Backend-Policy](../../../src-tauri/src/synthesis_policy.rs)) |
| Weitere Parameter | 30 s, 110 BPM, LM-Temperatur 0,85, Caption beibehalten (`use_cot_caption: false`), WAV PCM16, `peak_clip: 0` |
| Stil | Synth-Pop mit analogen Tasten, geradem Schlagzeug und rundem Bass. Bei Gesangsaufträgen eine Leadstimme, bei den Kontrollen führen die Tasten die Melodie. Die exakten Prompts stehen in [probe.py](probe.py). |

Die Matrix umfasst 24 Aufträge (18 Gesangsaufträge, sechs Instrumentalkontrollen). Das Probeprogramm verwendet den ACE-Step-Server aus dem offiziellen Desktop-0.2.0-Bundle und ruft `/lm` und `/synth` direkt auf. Es sendet den ausgeschriebenen Sprachnamen ans LM und den Picker-Code an die Synthese. Je Auftrag lief ein LM-Versuch mit festem Seed. Die Stichprobe beschränkt sich auf diese Engine-Aufrufe. Studio-Warteschlange, automatischer LM-Retry und Geräteprofile wurden dabei umgangen.

## Technische Messung

Die veröffentlichte Desktop-Version 0.2.0 stammt von Tag `v0.2.0` (Commit `2c9daeb86967a4667384c4543df3c5a3ac8d77c9`). Der QA-Checkout bei `c982d54` liefert das Modellmanifest und die 80-Schritte-Einstellung. Die Messung lief auf einem Apple M5 Pro mit 64 GiB RAM, macOS 26.6.2 (arm64) und Metal. [environment.json](environment.json) enthält Bundle-Prüfsumme, Engine-Revision, Modellquelle und die mit dem Manifest verglichenen Modell-Hashes.

Die 24 WAVs haben 24 unterschiedliche SHA-256-Werte. Jede Engine-Antwort und jedes Syntheseprotokoll bestätigen 80 Schritte. Gemessen wurden 29,04 bis 30,80 s bei 48 kHz, Stereo und PCM16. Der RMS-Pegel lag zwischen −19,64 und −13,05 dBFS. Die Peaks runden auf 0,00 dBFS. Acht WAVs enthalten je einen Samplewert an einer PCM-Grenze. Das LM lieferte Text für alle 18 Gesangsaufträge und den Marker `[Instrumental]` für alle sechs Kontrollen.

In [measurements.csv](measurements.csv) steht pro Probe die tatsächlich bestätigte Schrittzahl sowie die unabhängig aus dem WAV-Header und den PCM-Samples neu berechnete Dauer, Kanalzahl, Abtastrate, der Spitzen- und RMS-Pegel in dBFS, die Anzahl der PCM-Grenzwert-Samples und der SHA-256-Hash. Die Laufzeiten in Sekunden umfassen den jeweiligen HTTP-Auftrag bis zum Ergebnisabruf. Die zwei getrennten Engine-Läufe sowie Hintergrundlast machen die Zeiten zu Laufprotokollen für diese Sitzung. `lm_language_label` stammt aus der Textmodell-Antwort. `lm_lyrics_kind` unterscheidet Text, ausschließlich Tags, leere Lyrics und den Marker `[Instrumental]`. Für die Synthese wurde der Picker-Code bei Gesangsaufträgen ausdrücklich gesetzt und bei Kontrollen weggelassen. Die Pegel und PCM-Grenzwerte decken die angegebenen Signalmerkmale ab. Klicks, Verzerrung, Gesang und Sprache erfordern Hörprüfung.

## Hörprotokoll

[listening.csv](listening.csv) hat eine Zeile je WAV. Die Hörfelder stehen durchgängig auf `pending` (Hörprüfung offen). Für die Hörprüfung neutrale Wiedergabebezeichnungen verwenden, die Ausgaben in zufälliger Reihenfolge bei angeglichener Abhörlautstärke vollständig abspielen und die Vorgaben erst danach abgleichen. Pro Zeile die folgenden Befunde erfassen.

- Hörbare Sprache mit Sprachcode, `gemischt`, `unklar` oder `entfällt` bei fehlendem Gesang.
- Gesang als `ja`, `nein` oder `unklar`. Wortlose Stimmen, Sprecher und Hintergrundstimmen mit Zeitangabe ergänzen.
- Verständlichkeit als `klar`, `teilweise`, `unverständlich` oder `entfällt`. Wenn möglich eine tatsächlich verstandene Wendung mit Zeitangabe notieren.
- Auffällige Wort-, Phrasen- oder Audiowiederholungen mit Zeitbereich und Beispiel erfassen. Einen erkennbar wiederkehrenden Refrain entsprechend kennzeichnen.
- Auffällige Störungen wie Klicks, harte Schnitte, Aussetzer oder Verzerrung mit Zeitangabe protokollieren. `keine aufgefallen` setzt vollständiges Abhören voraus.
- Kürzel der hörenden Person und Zeitmarken eintragen. Ungeprüfte oder akustisch nicht entscheidbare Beobachtungen entsprechend markieren.

## Ergänzende automatische Transkription

[transcripts.csv](transcripts.csv) enthält Whisper-Hypothesen mit Zeitbereichen, Modell-Sprachvorschlag und WAV-Prüfsumme. Whisper erhielt die WAV-Datei ohne vorgegebene Sprache, Caption oder Lyrics. Die ausgegebene Sprachwahrscheinlichkeit gehört zum ASR-Modell. Sie ist keine Wahrscheinlichkeit für hörbaren Gesang oder einen erfüllten Sprachauftrag. Auch eine leere Transkription lässt offen, ob Stimmen hörbar sind. Instrumentalmusik, Hintergrundstimmen und Gesang können Text- und Sprachhypothesen auslösen. Die Hypothesen können bei der Hörprüfung helfen, Zeitstellen zu finden.

Für `4B-de-67890` enthält die Hypothese die auch im LM-Text enthaltene Wendung „Es ist schon spät“. Für `4B-es-12345` schlug Whisper `ru` und die Silbe „Си“ vor. Selbst beim Instrumentalauftrag `4B-instrumental-67890` gab Whisper „You“ aus. Diese Stellen sind gezielte Kandidaten für die Hörprüfung.

Die Auswertung lief lokal mit faster-whisper 1.2.1, CTranslate2 4.9.0 und PyAV 15.1.0. Verwendet wurde Whisper Small multilingual auf der CPU (INT8) ohne VAD. SHA-256 der Gewichte (`model.bin`): `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671`. [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper/tree/v1.2.1) · [Modellrevision `536b066`](https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120)

Für eine Wiederholung `faster-whisper==1.2.1`, `ctranslate2==4.9.0` und `av==15.1.0` in einer separaten Python-Umgebung installieren und beim Aufruf auf das lokal abgelegte Modell der verlinkten Revision zeigen. Das Skript erwartet eindeutige WAV-Dateinamen und schreibt eine neue CSV-Datei.

```sh
HF_HUB_OFFLINE=1 python -B docs/qa/issue-105/transcribe.py \
  --model "$qa_whisper_model" --output "$qa_transcripts" \
  "$qa_output/"*.wav
```

## Reproduktion

Voraussetzungen sind Python 3.9+, das Desktop-0.2.0-Metal-Bundle oder eine entsprechend vorbereitete Runtime und ein eigener Modellordner mit den GGUF-Dateien aus [models/manifest.json](../../../models/manifest.json). Die Prüfroutine vergleicht die Modell-Hashes mit dem Manifest. Für den direkten macOS-Start wurde ausschließlich die temporäre Runtime-Kopie ad hoc signiert. Bibliothek, Browser und bestehendes App-Profil sind für die Messung nicht erforderlich.

```sh
python3 -B -m unittest discover -s docs/qa/issue-105 -v
python3 -B docs/qa/issue-105/probe.py \
  --engine "$qa_runtime/ace-server" \
  --models "$qa_models" \
  --output "$qa_output" \
  --size 4B 0.6B 1.7B
```

`--output` muss auf ein neues Verzeichnis zeigen. Der Probeprozess hält einen eigenen Server auf einem Loopback-Port und beendet ihn beim Verlassen. Das Ausgabeverzeichnis enthält den Modell- und Runtime-Nachweis, das Engine-Log, die einzelnen PCM-WAV-Dateien, dazugehörige Anfragen und Antworten als JSON sowie ein leeres Hörprotokoll. WAVs, Modelldateien und Audio-Code-Folgen liegen ausschließlich lokal. Auf dem Testrechner liegen die Originale in `/private/tmp/music-issue105.tIiELU/run-4B` und `/private/tmp/music-issue105.tIiELU/run-0.6B-1.7B`. Der Dateiname entspricht der Proben-ID plus `.wav`. Bei nachgenerierten WAVs im Hörprotokoll die tatsächlich gehörte Datei per SHA-256 zuordnen.

## Aussagegrenzen

Zwei Seed-Paare, eine Klangrichtung, kurze Aufträge, ein DiT und ein Rechner erlauben Fallbeobachtungen. Die Matrix vergleicht die LM-Größen innerhalb dieser Konfiguration. Tonart und Taktangabe wurden vom LM mitgeliefert und variierten. Die Instrumentalkontrollen verwenden eigene Captions und eigene LM-generierte Audiocodes. Für andere Musikstile, längere Stücke, XL-DiTs, weitere Quantisierungen und Plattformen sind eigene Proben nötig. Eine musikalische Erfolgsquote setzt breitere Stichproben und menschliche Hörurteile voraus.
