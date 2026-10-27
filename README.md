# Music Generator

Lokale Musikgenerierung als rahmenlose **Tauri-Desktop-App** für macOS, Windows und Linux. Rust verwaltet Modelle, Warteschlange und Bibliothek; [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp) übernimmt die Musikberechnung.

**Herunterladen, entpacken, öffnen.** Keine Installer und keine Python-/Node-Installation beim Anwender. Der Startassistent lädt die benötigten Modelle und prüft die Hardware. Danach funktioniert die Musikgenerierung offline.

## Projektstatus

**Stand: 27. Oktober 2026 · Entwicklungsstand: 0.1.2** (siehe [`package.json`](package.json) und [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)). Die Anwendung nutzt inzwischen Tauri, Rust und eine TypeScript-/JavaScript-Oberfläche. In diesem Repository ersetzt die Desktop-App den Python-Webserver mit Installations- und ON/OFF-Skripten. Die Web-App wird im Repository [music-generator](https://github.com/rabbitfiremediacreation/music-generator) weiter gepflegt.

ACE-Step ist die unterstützte Musikmodellfamilie. Der aktuelle Stand enthält eine Modellauswahl direkt im Studio, automatische lokale Songtitel, Echtzeit-Fortschritt und native Audio-/Text-/ZIP-Exporte. Die Versionsangabe beschreibt den Quellcode; verfügbare Downloads können einen anderen Stand haben.

## Oberfläche

![Music Generator mit Modellauswahl und Songgenerator links sowie Bibliothek, Wiedergabe und Downloads rechts](assets/music-generator-overview.png)

*Beispielaufnahme vom 25. Oktober 2026: links Modelle und Vorgaben für neue Songs, rechts die Bibliothek. Die gezeigten Titel, vier Songs und 65 MB sind Beispieldaten. Unter Zahnrad › Anordnung lässt sich zwischen untereinander und nebeneinander wechseln.*

## Herunterladen und starten

| Plattform | Bundle |
| --- | --- |
| macOS 14+, Apple Silicon | DMG und ZIP mit `Music Generator.app` |
| macOS 13.3+, Intel x64 (experimentell) | Eigenes DMG und ZIP, ausschließlich CPU |
| Windows 10/11, x64 | ZIP mit EXE, Engine und WebView2 |
| Linux, x64 | AppImage mit Vulkan/CPU-Engine; separate CUDA-Ausgabe für NVIDIA |

Intel-Macs verwenden das separate `macos-x64`-Bundle. Sprachmodell und Klangerzeugung rechnen auf der CPU; ein Song kann viele Minuten dauern. Mit 10 Sekunden, dem 0.6B-Sprachmodell und dem Standard-Klangmodell beginnen. Der Assistent prüft den Engine-Start und überspringt den GPU-Test. Native Builds werden auf macOS 15 geprüft; echte Generierung auf weiteren Intel-Macs und der Mindestversion bleibt manuell abzunehmen.

Die ersten Bundles sind unsignierte Testausgaben. Betriebssystem-Warnungen sind möglich. Downloads werden unter [Releases](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases) veröffentlicht; lokal gebaute Pakete liegen in `release/`.

## Funktionen

- Oberfläche in zwölf Sprachen, Bibliothek, Suche, Favoriten, Ordner und 1–10 Varianten pro Auftrag.
- Echtzeit-Fortschritt mit Modellladephasen, Sprachmodell, gemessenen DiT-Schritten und VAE-Decodierung.
- Länge, BPM, IT, VAR und Versionen bleiben beim nächsten Start erhalten, auch nach Songübernahme oder Audioanalyse. **Grundeinstellungen zurücksetzen** stellt 90 Sekunden, BPM Auto, die hardware- und modellabhängige IT-Empfehlung (CPU oder unbekannt: höchstens 30), VAR 1,2 und 2 Versionen wieder her. Titel, Prompt, Stil und Lyrics werden dafür nicht gespeichert.
- **IT und VAR (ACE-Step):** IT sind die Iterationen der Klangerzeugung im unterstützten Bereich 1–200 (auf CPU oder bei unbekanntem Rechengerät höchstens 30 als Standard, auf GPU die Modellempfehlung, bei Standard/XL 80), VAR die Varianz des Sprachmodells (Standard 1,2). Mehr Schritte brauchen mehr Zeit; höhere Varianz erzeugt freiere Ergebnisse, niedrigere hält sich enger an Stil und Prompt. Für andere Modellfamilien zeigt der ModelPicker eine ausdrückliche Schritte-Empfehlung. Historische Songanfragen bleiben erhalten; für neue Aufträge, Varianten und Wiederholungen werden bis zu 200 Schritte tatsächlich ausgeführt. Gültige gespeicherte Formularwerte bleiben erhalten. Ältere Ergebnisse behalten die damals tatsächlich ausgeführten Schritte; eine frühere Begrenzung auf 100 wird nicht nachträglich als 120 oder 200 ausgegeben. Ab 30 Iterationen auf CPU oder bei unbekanntem Rechengerät werden der IT-Regler rot und Laufzeithinweise sichtbar. Über 30 erscheint standardmäßig ein Dialog mit „Mit 30 starten“, „Trotzdem starten“ und „Abbrechen“. „Diese Entscheidung merken“ speichert die automatische Begrenzung auf höchstens 30 oder den unveränderten Start ohne Rückfrage; unter Einstellungen → Verhalten bei hohen CPU-Iterationen lässt sich das jederzeit ändern. Niedrigere Werte bleiben erhalten. Rote Markierung und Hinweise bleiben unabhängig von der gemerkten Antwort ab 30 sichtbar. Auch beim Wiederholen wird gewarnt; „Mit 30 starten“ erstellt dabei einen neuen Song. „Sprachmodell: Nur CPU“ allein ist kein CPU-Betrieb der Klangerzeugung. Für einen ersten CPU-Versuch empfehlen wir 10 Sekunden Musik.
- Mikrofonideen und Audioanalyse, Waveform-Player und native WAV-/TXT-/ZIP-Exporte.
- Wahlweise MP3-Export mit 192 kbit/s für Einzeldateien und ZIPs; die Bibliothek behält das Original-WAV.
- Gewünschte Songlänge von 10 Sekunden bis 10 Minuten. Bibliothek und Player zeigen die aus der WAV-Datei gemessene Dauer; vorhandene WAVs werden ebenfalls geprüft, ohne die ursprünglichen Songanfragen umzuschreiben. Deutlich zu kurze Sprachmodell-Ausgaben erhalten vor der einmaligen Synthese höchstens einen zusätzlichen Sprachmodellversuch. Bleibt eine erhebliche Abweichung bestehen, zeigt der Song einen Hinweis mit Soll- und Ist-Dauer. Es werden keine Stille oder Audioschleifen angehängt. Oberhalb von fünf Minuten gibt es Hinweise auf hohen Zeit- und Speicherbedarf. Lange Songs sind auf Intel-Macs und Rechnern mit 8 GB noch nicht praktisch geprüft.
- Sprachmodell wahlweise automatisch oder nur auf CPU; die Synthese kann weiterhin die Grafikkarte nutzen.
- **Rechen-Backend sichtbar:** Im Studio steht das geprüfte verfügbare Backend (zum Beispiel Metal) schon vor der ersten Generierung kompakt neben der Sprache. Tooltip und zugänglicher Text unterscheiden Bereitschaft und später anhand aktueller Engine-Logs bestätigte Ausführung. Sprachmodell und Klangerzeugung bleiben getrennt, mit belegbaren Gründen für CUDA-Ausweichlösungen oder CPU-Auswahl. Noch ungetestete Komponenten bleiben ausdrücklich unbestätigt. Details und Windows-/GTX-1060-Buildnachweise: [Rechen-Backend und CUDA-Kompatibilität](docs/backend-status.md).
- **Automatische Songtitel:** Titel leer lassen; ein kleines gemeinsames lokales Textmodell benennt den fertigen Song für ACE-Step. Lyrics und deren Sprache haben Vorrang vor dem Prompt. Scheitert die Benennung nach erfolgreicher Audiogenerierung, wird ein kurzer Zufallstitel gespeichert und ein Hinweis angezeigt. Rund 640 MB zusätzlicher Download im Assistenten oder ModelPicker; danach offline. Eigene Titel und vorhandene Songs bleiben erhalten.
- **Modelle wählen:** Direkt in der Creator-Ansicht bietet ein Drop-down die Hardware-Empfehlungen für Standard und, bei ausreichendem RAM, XL. Bereits geprüfte lokale Modelle lassen sich dort ohne Download wechseln. Erweiterte Auswahl, Prüfung und Downloads stehen unter Zahnrad › **Modelle verwalten und herunterladen** bereit. Das passende Sprachmodell wird automatisch zugeordnet. Unter Zahnrad › **Expert Mode** lässt sich der vollständige Katalog mit weiteren Familien, Turbo-Modellen, Sprachmodellgrößen und Quantisierungen freischalten. Die Einstellung ist standardmäßig aus, wird gespeichert und wirkt ohne Neustart. Fortsetzbare Downloads werden per SHA-256 geprüft. Details: [Modellauswahl](docs/model-picker.md).
- Übernahme einer alten Installation; Originaldaten bleiben erhalten.
- Modelle und Songs außerhalb der App, mit wählbaren Speicherorten. Updates durch Austausch des Bundles.
- macOS App Sandbox mit gespeicherten Ordnerfreigaben und vererbter Sandbox für die Engine.

## Erster Song

1. Das passende Bundle herunterladen, entpacken und öffnen. Unter Windows EXE, `engine` und `WebView2` zusammenlassen. Unter Linux die AppImage zunächst ausführbar machen. Einzelheiten stehen in der [Desktop-Anleitung](docs/desktop.md#start).
2. Im Startassistenten Sprache, Modell- und Song-Ordner sowie ein Modellprofil auswählen. Optional eine bestehende Bibliothek importieren. Downloads und Prüfungen abschließen; spätere Starts öffnen das Studio direkt, die Engine startet bei Bedarf.
3. Im Modell-Drop-down der Creator-Ansicht zwischen den empfohlenen Standard-/XL-Profilen wählen; XL erscheint nur bei ausreichendem RAM für die gesamte Kombination. Das empfohlene Sprachmodell steht fest. Der vollständige Katalog ist im **Expert Mode** verfügbar. Im Screenshot sind SFT Q8_0 und das 4B-Sprachmodell Q8_0 ausgewählt.
4. **Prompt und Stil** eingeben, zum Beispiel „nächtliche Autofahrt durch eine Neonstadt, langsam und hypnotisch“ und „trip hop, dark, dub bass“. Die Würfel liefern Vorschläge. Einen eigenen Titel eingeben oder das Feld für einen automatisch erzeugten Titel leer lassen.
5. **Länge, BPM und Lyrics** festlegen. Standard ist Instrumental; im Lyrics-Bereich eigenen Text eingeben oder automatische Lyrics aktivieren. Unter **Erweitert** stehen unter anderem Iterationen, Varianz, Tonart, Takt und Seed bereit.
6. **Versionen** auswählen und **Generieren** drücken. Die Warteschlange verarbeitet die Songs nacheinander und zeigt die Berechnungsphasen an.

Beim Ausschalten des Expert Mode bleibt eine zuvor aktive erweiterte Modellauswahl erhalten. Neue Aufträge und Wiederholungen damit benötigen den Expert Mode oder eine ausdrücklich übernommene Hardware-Empfehlung. Es gibt keinen stillen Modellwechsel oder automatischen Download beim Umschalten. Bereits angenommene Aufträge werden fertiggestellt, auch nach einem Neustart. Heruntergeladene Modelle, vorhandene Songs, Wiedergabe und Export bleiben erhalten.

## Bibliothek, Vorlagen und Export

- **Abspielen und verwalten:** Play startet den Waveform-Player. Mit dem Stern favorisieren, über die Suche filtern, Titel umbenennen und Songs in Ordnern organisieren.
- **Varianten und Einstellungen:** **+** an einem Song erzeugt eine weitere Variante. Der Pfeil nach oben übernimmt dessen Vorgaben ins Formular; neue Songs speichern auch ihre Modellkombination.
- **Exportieren:** **WAV** bzw. **MP3** öffnet den nativen Speicherdialog. Das Exportformat wird im Setup gewählt. **TXT** zeigt vorhandene Lyrics mit Textdownload. **Alle laden** bzw. der Ordnerdownload exportiert fertige Audiodateien als ZIP.
- **Audio als Anregung:** Eine Datei auf das Wellenform-Logo oben links ziehen oder das Logo anklicken. Die lokale Analyse liefert Vorschläge für Beschreibung, Stil, Tempo und weitere Songparameter.
- **Idee aufnehmen:** Den Mikrofonknopf für eine 5–30 Sekunden lange Aufnahme gedrückt halten und summen, pfeifen oder singen. Beschreibung, Tempo und Tonart dienen als Anregung; die Melodie selbst wird nicht übernommen. Stil und Länge bleiben frei wählbar.

## Daten und Updates

Bibliothek und Einstellungen liegen in `music.db`; Modelle und Songs bleiben außerhalb des App-Bundles. Standardmäßig verwendet die App diese Datenordner:

| Plattform | Datenordner |
| --- | --- |
| macOS | `~/Library/Containers/de.alphatester.music-generator/Data/Library/Application Support/de.alphatester.music-generator/` |
| Windows | `%LOCALAPPDATA%\de.alphatester.music-generator\` |
| Linux | `$XDG_DATA_HOME/de.alphatester.music-generator/`, normalerweise `~/.local/share/de.alphatester.music-generator/` |

Modell- und Song-Ordner lassen sich separat wählen. Auf macOS externe Ordner über den Auswahldialog freigeben. Protokolle stehen unter `logs/`, insbesondere `desktop.log`, `ace-server.log` und bei separatem Sprachmodell `ace-lm.log`.

Updates erfolgen durch Austausch des Bundles. Für eine Sicherung die App schließen und den Datenordner sowie separat gewählte Song-Ordner kopieren; Modelle können zusätzlich gesichert oder erneut geladen werden. Beim Wechsel von älteren Installationen die Importfunktion verwenden, damit die ursprünglichen Daten erhalten bleiben. Details zu Ordnerfreigaben und Profilwechseln: [Daten und Updates](docs/desktop.md#data-and-updates).

## Erprobung und bekannte Grenzen

Automatisierte Frontend-, Rust- und Pakettests sowie native CI-Prüfungen sind im Projekt vorhanden. Die [Verifikationsdokumentation](docs/verification.md) hält die jeweiligen Teststände und tatsächliche Generierungsversuche auf Apple Silicon fest. Paket- und Engine-Starttests ersetzen keine vollständige Prüfung auf jeder Zielhardware.

- Intel-Macs sind experimentell und rechnen ausschließlich auf der CPU.
- Echte Generierung mit allen Modellfamilien und Quantisierungen sowie mit der Linux-CUDA-Ausgabe auf unterstützter NVIDIA-Hardware bleibt gesondert zu prüfen.
- Zehn-Minuten-Songs auf Intel-Macs und Rechnern mit 8 GB sowie vollständige GUI-/Audio-Tests auf den Mindestversionen der Betriebssysteme stehen noch aus.
- Physische Mikrofonaufnahme und tatsächliche VoiceOver-/NVDA-/JAWS-Bedienung sind in der dokumentierten Abnahme noch offen.
- Die Testausgaben haben keine Developer-ID-Signierung/Notarisierung für macOS; Warnungen des Betriebssystems sind möglich.

## Entwickeln und bauen

Node.js 24+, Rust und die nativen [Tauri-Bauvoraussetzungen](https://v2.tauri.app/start/prerequisites/) werden nur für die Entwicklung benötigt.

```sh
npm ci
npm run engine:prepare
npm run dev
```

```sh
npm run lint
npm run build
npm test
npm run test:desktop
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run bundle
```

Die plattformspezifischen Pipelines stehen in `.github/workflows/desktop.yml`. Build, Datenablage, Import, Signierung und manuelle Abnahme beschreibt [docs/desktop.md](docs/desktop.md).

## Aufbau

| Bereich | Inhalt |
| --- | --- |
| `frontend/` | Vite-Oberfläche, TypeScript-Tauri-Schnittstelle, Assistent und erhaltene Studio-Bedienung |
| `src-tauri/` | Rust-Backend, SQLite, Queue, Download- und Engine-Verwaltung |
| `models/` | Versionierte Modell-/Engine- und WebView2-Downloadmanifeste |
| `scripts/desktop/` | Vorbereitung der Engine und fertige Plattformpakete |
| `static/` | Styles, Bilder und vendorter Waveform-Player |
| `assets/music-generator-overview.png` | Beispiel-Screenshot für diese README |
| `docs/legacy/` | Archivierter Ubuntu-Installer mit historischem Kontext, gilt nicht für Desktop |

In diesem Repository ersetzt der Desktopbetrieb den Python-Webserver und die Installations-/ON/OFF-Skripte. Die Web-App und ihre weitere Pflege bleiben im Repository [music-generator](https://github.com/rabbitfiremediacreation/music-generator) erhalten. Die alten Installationsanleitungen und PDF-Dokumentwerkzeuge wurden aus diesem Desktop-Repository entfernt.

## Lizenz

Der Anwendungscode steht unter [MIT](LICENSE). Hinweise zu Engine, Modellen und weiteren Komponenten: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
