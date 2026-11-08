# Music Generator 0.2.0

8. November 2026 · [GitHub-Release und Downloads](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.2.0)

## Änderungen seit 0.1.3

- **Neues Studio mit React und TypeScript:** Die Oberfläche nutzt TanStack Router, TanStack Query und Tailwind CSS. Bibliothek, Warteschlange, Analyse, Wiedergabe und native Exporte bleiben mit dem Rust-Backend verbunden. Alle zwölf Oberflächensprachen bleiben verfügbar.
- **Einstellungen nach Themen:** Generierung, Modelle und Hardware, Bibliothek & Export, Darstellung, Handy-Zugriff, MCP & Integrationen und Über die App haben eigene Seiten. Unter Modelle und Hardware zeigt die App installierte Modelle mit Status und Speicherbedarf. **Modell hinzufügen** öffnet Auswahl, Prüfung und Downloads; Expert Mode erweitert den Katalog. Der vollständige Einrichtungsassistent bleibt für Speicherorte und Hardwaretests erreichbar.
- **Handy-Zugriff im lokalen Netzwerk:** Die native iPhone-App und die mobile Web-App/PWA können Bibliothek und Wiedergabe steuern, Songs herunterladen, Favoriten und Ordner verwalten, Generierungen starten und Audioideen analysieren. QR-Codes übernehmen Verbindung und Zugriffsschlüssel. Für die PWA führt die Einrichtung durch das Prüfen und Vertrauen des lokalen Zertifikats und den HTTPS-Start. Der Zugriff ist zunächst ausgeschaltet; Ausschalten beendet auch laufende Übertragungen. [Einrichtung und Grenzen](phone-access.md).
- **MCP für KI-Assistenten:** Ein optionaler Streamable-HTTP-Dienst mit Zugriffsschlüssel ermöglicht Generierung, Varianten, Warteschlange, Bibliothek, Modelle, Einstellungen, Analyse, Import und Export auf diesem Rechner oder im lokalen Netzwerk. Einstellungen zeigen die passende Client-Konfiguration; eine stdio-Brücke bleibt optional. [MCP-Anleitung](mcp.md).
- **Geführte Einrichtung:** Drei Schritte begleiten Sprache und optionale Bibliotheksübernahme, Modell-/Speicherwahl sowie Downloads und Hardwaretest. Beim Wechsel des Songordners erklärt die App, dass bestehende Songs an den neuen Ort verschoben werden.
- **VAR standardmäßig 0,85:** Studio, zurückgesetzte Vorgaben und MCP verwenden denselben Standard. Bei selbst erfundenen Lyrics wird die Varianz für diesen Durchgang auf höchstens 0,85 begrenzt. Das Textfeld nennt die gewünschte Gesangssprache; eigene Texte bleiben möglich.
- **Windows-Pfade mit Unicode:** Gebündelte Engine und CPU-Prüfung unterstützen Modell-, Audio- und Installationspfade mit Umlauten und anderen Unicode-Zeichen. Die ZIP-Prüfung testet das Verschieben in solche Pfade.
- **CUDA-Speicherbedarf:** Die Windows-Einrichtung berücksichtigt Download und Entpacken des CUDA-Pakets sowie den freien Platz auf den betroffenen Laufwerken. Bei zu wenig Platz erscheint der Hinweis vor dem Download. [Prüfnachweise](cuda-space-verification.md).
- **Robustere Wiedergabe und Modellprüfung:** Der Player lädt Audio anhand der Song-ID und kann sich nach Medienfehlern erholen. Das gemeinsame Titelmodell wird nicht als fehlendes Musikmodell im Registry-Abgleich gemeldet.
- **Entwicklung mit Fast Refresh:** React- und CSS-Änderungen erscheinen im laufenden Entwicklungsfenster. Ein Neuladen der Oberfläche verwendet den bereits abgeschlossenen nativen Startzustand weiter.

## Downloads und Installation

Die Release-Pipeline baut fünf Plattformausgaben mit insgesamt acht Paketen, jeweils mit einer `.sha256`-Datei. Die Dateien erscheinen nach erfolgreichem Build unter **Assets** auf der Release-Seite.

| System | Pakete | Voraussetzungen |
| --- | --- | --- |
| macOS Apple Silicon | `Music-Generator-0.2.0-macos-arm64.dmg` und `.zip` | macOS 14 oder neuer |
| macOS Intel, experimentell | `Music-Generator-0.2.0-macos-x64.dmg` und `.zip` | macOS 13.3 oder neuer, mindestens 8 GiB RAM; nur CPU |
| Windows x64 | `Music-Generator-0.2.0-windows-x64.msi` und `.zip` | Windows 10/11, aktueller Grafiktreiber |
| Linux x64 Vulkan/CPU | `Music-Generator-0.2.0-linux-x64.AppImage` | Ubuntu 22.04 oder kompatible neuere Distribution |
| Linux x64 CUDA/CPU | `Music-Generator-0.2.0-linux-x64-cuda.AppImage` | Gleiche Linux-Basis; für CUDA unterstützte NVIDIA-GPU und Treiber 570.124.06 oder neuer |

Vor dem Update die App schließen und Bibliotheksdaten sowie separat gewählte Songordner sichern. Modelle, Songs und Einstellungen liegen außerhalb des Programmpakets und bleiben beim Austausch erhalten. Auf macOS die App aus dem DMG kopieren, das Image auswerfen und die Kopie starten. Unter Windows den MSI installieren oder das portable ZIP vollständig entpacken; EXE, `engine` und `WebView2` zusammenlassen. [Desktop-Anleitung](desktop.md).

## Bekannte Grenzen

- Die Pakete sind weiterhin Testausgaben ohne reguläre macOS Developer-ID-Signierung und Notarisierung. Betriebssystem-Warnungen sind möglich.
- Paketprüfungen ersetzen keine Hardwareabnahme. Der schwarze Windows-Hauptbildschirm aus [Issue #53](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53), echte NVIDIA-Inferenz unter Windows/Linux und vollständige Tests auf den Mindestversionen der Betriebssysteme bleiben gesondert zu prüfen.
- Der Linux-CUDA-Build wird in CI ohne NVIDIA-GPU auf CPU-Start und Laufzeitabhängigkeiten geprüft. Echte CUDA-Generierung ist dadurch nicht bestätigt.
- Intel-Macs rechnen experimentell auf CPU; zunächst Standard, das 0.6B-Sprachmodell und zehn Sekunden Musik verwenden. Lange Songs können viel Zeit und Speicher benötigen. Die gewünschte Dauer bleibt eine Modellvorgabe.
- Handy-Zugriff und MCP benötigen die laufende Desktop-App. Die PWA speichert ihre Oberfläche für Offline-Start; Generierung und Bibliothekszugriff benötigen die Verbindung zum Rechner.
