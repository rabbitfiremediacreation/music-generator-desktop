# Release-Abnahme 0.3.0

Stand 18. November 2026 · [Issue #106](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/106)

**Status: offen.** Bei der Prüfung stand GitHub `main` auf `c982d54c7abff35463c6c31517a3b3f69389b963` (0.2.0). Im Milestone waren 14 Issues offen. Die Release-Liste und die verfügbaren Desktop-Workflow-Artefakte enthielten keinen integrierten 0.3.0-Kandidaten. Die lokalen Prüfungen weiter unten sind Vorabproben.

## Kandidat und Pakete erfassen

1. Vollständigen Quell-SHA, Paketversion, Herkunft je Plattform (Workflow-Run und Artefakt-ID oder dokumentierter nativer Build) sowie die enthaltenen Milestone-Änderungen festhalten. Für die Abnahme die vorgesehenen Auslieferungsdateien verwenden. Stimmen SHA, Signatur oder Paketbytes nach einem Neubau nicht mehr überein, die Nachweise dem jeweils geprüften Paket zuordnen und die betroffenen Prüfungen wiederholen.
2. Je Plattform die komprimierten Actions-Artefakte in die gleichnamigen Unterverzeichnisse `Music-Generator-macos-arm64`, `Music-Generator-macos-x64`, `Music-Generator-windows-x64`, `Music-Generator-linux-x64` und `Music-Generator-linux-x64-cuda` entpacken. Bei nativen Builds die fertigen Pakete und ihre Sidecars entsprechend ablegen. Jedes Unterverzeichnis enthält die Pakete und die mitgelieferten `.sha256`-Dateien.
3. Das Inventar der acht Pakete aufzeichnen. Der Befehl prüft Paketnamen und SHA-256 gegen die mitgelieferten Sidecars. Quell-SHA, Signatur und Hardwareergebnisse werden separat erfasst.

   ```sh
   node scripts/desktop/verify-acceptance-packages.mjs v0.3.0 "$ARTIFACT_ROOT" > package-inventory.json
   ```

Ein PR-Lauf liefert laut [Desktop-Workflow](../../../.github/workflows/desktop.yml) vier Plattformvarianten ohne Linux CUDA und verwendet auf macOS Ad-hoc-Signaturen. Für einen unveröffentlichten Kandidaten lassen sich fehlende Varianten mit `npm ci` und `npm run bundle` auf nativen Hosts aus demselben integrierten SHA bereitstellen. Für Linux CUDA `MUSIC_GENERATOR_LINUX_BACKEND=cuda` setzen. Für macOS gelten die Deployment Targets der Matrix (arm64 `14.0`, Intel `13.3`). Die [Build-Anleitung](../../desktop.md) beschreibt Abhängigkeiten und Paketprüfungen. Die Prüfläufe sowie die Signierungsart je Variante erfassen. Die Abnahme kann vor Veröffentlichung erfolgen.

## Ausführung und Belege

- **Profil und Start.** Ein frisches OS-Testkonto oder einen frischen Systemstand je Paketversuch verwenden. Auf macOS die App unverändert aus dem DMG kopieren bzw. aus dem ZIP entpacken. Der Release-Build hat einen festen Container und der Debug-Datenpfad gilt nur für Debug-Builds. Auf Windows mit dem MSI installieren bzw. das vollständige portable ZIP entpacken. Linux vom AppImage starten. Keine bestehende Bibliothek übernehmen. Setup muss sichtbar und bedienbar sein. Nach erfolgreichem Setup neu starten und sichtbares Studio bestätigen.
- **Setup und Generierung.** Leere eigene Modell-, Song- und Exportordner verwenden. Standardprofil mit kleinstem freigegebenem Sprachmodell (0.6B, sofern angeboten), eine Variante, zehn Sekunden, Instrumental, Titel `QA 0.3.0`, Prompt `Instrumental synth-pop with a steady drum beat and a bright arpeggio`. Modelle über die App laden, Hardwaretest und tatsächliche Modellkonfiguration erfassen. Auftrag im Studio auslösen, Warteschlangenende und fertigen Bibliothekseintrag dokumentieren. Die tatsächlichen Einstellungen, Song-ID, Laufzeit, verwendeten Backends für Sprachmodell und Synthese sowie einen relevanten Logausschnitt ablegen. Einen beobachteten CPU-Fallback als eigene Kombination festhalten.
- **Wiedergabe und Export.** Den neuen Song in der App abspielen, hörbare Ausgabe, Fortschritt sowie Pause und Fortsetzung prüfen. WAV über den nativen Dialog exportieren, dann MP3 und ZIP über die App prüfen. Dateien extern öffnen bzw. das ZIP entpacken und dessen Audio abspielen. Dateinamen, Formate, Dauer, Größe, SHA-256 und gegebenenfalls Auffälligkeiten erfassen. Audio aus dem frisch erzeugten Auftrag nachweisen.
- **Windows-Sichtprüfung [#53](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53).** Für MSI und ZIP jeweils den ersten Start sowie den Neustart nach dem Setup beobachten. Sichtbaren Fensterinhalt und bedienbares UI mit Screenshot oder kurzem Video belegen. Bei Schwarzbild Zeitpunkt, Dauer, GPU/Treiber, Anzeige/DPI, WebView2-Version, sichtbaren Splash und Verhalten bei Fokuswechsel protokollieren. Ein Ready-Log allein lässt die Sichtprüfung offen.
- **Tastatur und Screenreader.** Den vollständigen Ablauf einmal ohne Maus und mit aktivem VoiceOver (macOS), NVDA (Windows) bzw. Orca (Linux) ausführen. Version und Sprache des Readers erfassen. Mit Tab/Umschalt+Tab und den Reader-Tasten durch Setup, native Dialoge, Studio und Export gehen. Fokus, Beschriftung und Zustände für die Generierungssteuerung, Warteschlange, Spiel/Pause und die Speicherbestätigung prüfen. Gehörte Ansagen und etwaige Blockaden je Schritt wörtlich protokollieren oder als Aufnahme belegen.
- **NVIDIA.** `nvidia-smi` vor und während des Jobs erfassen (GPU, Treiber, VRAM und Prozess, soweit das OS ihn ausweist). Mit dem Engine-Log die Auswahl von CUDA für die Synthese und den Gerätebezug des abgeschlossenen Auftrags belegen. Windows verwendet den CUDA-Laufzeitdownload der Einrichtung. Linux verwendet das CUDA-AppImage. Ein CPU-Fallback lässt die CUDA-Zeile offen.
- **macOS-Signierung.** Für arm64 und Intel die endgültige kopierte `.app` mit `codesign --verify --deep --strict "$APP"` und `codesign -dvvv "$APP"` prüfen. `spctl --assess --type execute --verbose=4 "$APP"` sowie `xcrun stapler validate "$APP"` und `xcrun stapler validate "$DMG"` ausführen. Exitcodes und Ausgaben festhalten, inklusive Signaturtyp, TeamIdentifier, Gatekeeper-Urteil und Ticket-Status. Ein ZIP wird anhand der enthaltenen App geprüft. Den beobachteten Erststart des Downloads mit normaler Quarantäne separat erfassen.

## Abnahmematrix für den integrierten Kandidaten

Die Betriebssystemangaben sind geplante Prüfpunkte nach der [aktuellen Paketbasis](../../release-0.2.0.md#downloads-und-installation). Je Geräte-/OS-/Paketkombination eine eigene Ergebniszeile anlegen.

| Paket | Systeme und Backend | Zusätzlicher Nachweis | 0.3.0 |
| --- | --- | --- | --- |
| macOS arm64 DMG und ZIP | Echter Apple-Silicon-Mac, macOS 14.0 und aktueller unterstützter Stand, Metal | VoiceOver, Signatur und Gatekeeper/Stapling | Offen · Kandidat und macOS 14.0 fehlen |
| macOS x64 DMG und ZIP | Echter Intel-Mac, macOS 13.3 und neuer, CPU, mindestens 8 GiB | VoiceOver, Signatur und Gatekeeper/Stapling | Offen · Kandidat und Gerät fehlen |
| Windows x64 MSI und ZIP | Physischer Windows-10- und Windows-11-Rechner, CPU/Standard-Backend | Sichtprüfung #53, NVDA, WebView2 des Pakets | Offen · Kandidat und Geräte fehlen |
| Windows x64 MSI und ZIP, NVIDIA | Physischer Windows-Rechner mit unterstützter NVIDIA-GPU und dokumentiertem Treiber | Sichtprüfung #53 und bestätigte CUDA-Synthese | Offen · Kandidat und Gerät fehlen |
| Linux x64 Vulkan-AppImage | Physischer x64-Rechner, Ubuntu 22.04 und neuer, Vulkan und dokumentierter CPU-Lauf | Treiber, Orca | Offen · Kandidat und Gerät fehlen |
| Linux x64 CUDA-AppImage | Physischer x64-Rechner, Ubuntu 22.04 und neuer, unterstützte NVIDIA-GPU, Treiber ab 570.124.06 nach aktuellem Pin | Bestätigte CUDA-Synthese, Orca | Offen · Kandidat und Gerät fehlen |

| Datum / Prüfer | Paketdatei / SHA-256 / Build-SHA / Quelle | Gerät / CPU / RAM / GPU / Treiber | OS-Build / WebView / Reader | Setup / Song-ID / Backend | Wiedergabe / Export | Sichtprüfung / Tastatur / Reader / Signatur | Ergebnis / Beleg |
| --- | --- | --- | --- | --- | --- | --- | --- |
| einzutragen | | | | | | | offen |

Ergebnis je Prüfschritt als **bestanden**, **fehlgeschlagen** oder **offen** erfassen. Bei offenen und fehlgeschlagenen Schritten jeweils Ursache und fehlenden Nachweis eintragen.

## Vorabproben 0.2.0 am 18. November 2026

Session-Hardware: MacBook Pro `Mac17,8`, Apple M5 Pro (arm64, 20 GPU-Kerne), 64 GB, macOS 26.6.2 (`25G83`). VoiceOver ist installiert. Die aktive Sitzung hatte bereits einen App-Container. Der native Sandbox-Probe legte für jede Ausführung ein eigenes temporäres Verzeichnis an. Ein isoliertes GUI-Testkonto war in der Sitzung nicht verfügbar. Intel, Windows, Linux und NVIDIA waren lokal und über verknüpfte T3-Umgebungen nicht verfügbar.

| Quelle | Geprüfte Datei | SHA-256 |
| --- | --- | --- |
| [Veröffentlichtes v0.2.0](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.2.0), Tag-SHA `2c9daeb86967a4667384c4543df3c5a3ac8d77c9`, [Release-Run 42428047216](https://github.com/rabbitfiremediacreation/music-generator-desktop/actions/runs/42428047216) | `Music-Generator-0.2.0-macos-arm64.dmg` | `249267ab85de38f5a609689bf10a0e1f345b59ba7da60c0acaf0d1d3a77d8d8e` |
| [CI-Artefakt 13949806368, Run 43226735483](https://github.com/rabbitfiremediacreation/music-generator-desktop/actions/runs/43226735483/artifacts/13949806368), SHA `c982d54c7abff35463c6c31517a3b3f69389b963` | `Music-Generator-0.2.0-macos-arm64.dmg` | `8f4718592bd0fc1c616c080477df06cae540479e0a620dae5de943744f1b9316` |
| Gleiches CI-Artefakt | `Music-Generator-0.2.0-macos-arm64.zip` | `a62847696576cb074d317e316ead789170ccc8b203e1495bc5b060926ba5b368` |

`shasum -a 256 -c` bestätigte alle drei Dateien. Der Paketprüfer aus `c982d54` lief für beide DMGs mit `node scripts/desktop/verify-bundle.mjs --dmg` und für das CI-ZIP ohne Flag erfolgreich. Zur Wiederholung je Quelle Paket und Sidecar in das `release/`-Verzeichnis eines separaten Checkouts kopieren. Die DMG-Probe prüfte die Installationsabfrage beim Start aus dem eingehängten Image und startete die kopierte App nach dem Auswerfen mit Testargumenten. Alle drei Proben prüften den gebündelten CPU-Engine-Start, Sandbox und Beenden des Supervisors. MP3- und ZIP-Export liefen mit einer synthetischen WAV-Fixture über die gebündelte Exportkette. Der modellfreie automatische Backend-Probe (`--synthesis-backend-probe "$APP/Contents/Resources/engine"`) meldete für die Apps aus dem Release-DMG und dem CI-ZIP auf diesem Gerät jeweils `"gpu"`.

Die untersuchten arm64-Apps meldeten Bundle-Version `0.2.0` und `LSMinimumSystemVersion=14.0`. `codesign --verify --deep --strict` war erfolgreich (Ad-hoc, keine Team-ID), `spctl` meldete `rejected` (Exit 3) und `stapler` meldete für beide Apps und das veröffentlichte DMG ein fehlendes Ticket (Exit 65). CDHashes: Release-App `f586a4336e271f9792158b76112dd8bb24f986c7`, CI-App `3a5f1061f6fb76079a098a0aeac98bf03ef6a26b`.

Offen bleiben ein vollständiger GUI-Durchlauf mit realer Inferenz, hörbarer Wiedergabe und Export des erzeugten Songs, die Mindestversionen und übrigen Geräte, #53, der Tastatur- und Screenreader-Durchlauf sowie die Prüfung der endgültigen macOS-Pakete. Alle Befunde in diesem Abschnitt gelten für die zugeordneten 0.2.0-Vorabpakete.
