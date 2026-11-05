# Music Generator 0.1.3 — Pre-Release

## Änderungen seit 0.1.2

- Windows erhält zusätzlich zum portablen ZIP einen MSI-Installer mit Startmenüeintrag, Deinstallation und Upgrade-Unterstützung. Engine, Visual-C++-Bibliotheken und die feste WebView2-Runtime sind enthalten; Modelle, Songs und Einstellungen bleiben in den bestehenden Benutzerdatenordnern.
- Der Windows-Fensterstart synchronisiert die WebView2-Darstellung vor der Übergabe an das Hauptfenster. Begrenzte Wartezeiten, Wiederholen im Splash und zusätzliche Startdiagnosen helfen bei Startproblemen. Die Abnahme auf den ursprünglich betroffenen Windows-/GPU-Systemen steht weiterhin aus.
- Der Windows-Einrichtungsassistent erklärt fehlende CUDA-Laufzeitdateien und bietet deren optionalen Download an. Treiberprobleme erhalten einen passenden Hinweis und eine aufklappbare Diagnose.
- Der Startablauf und das Wiederholen nach einem Startfehler sind gegen konkurrierende Startversuche abgesichert. Der aus Windows 0.1.2 gemeldete Fehler `state not managed for field startup` (#45/#60) wird durch Registrierung des Startup-State vor der Fenstererzeugung behoben (#49). Ein schwarzes Hauptfenster (#53) wird gesondert untersucht.
- Abgebrochene Einrichtung wird lokalisiert angezeigt. Ordnerhinweise berücksichtigen die jeweilige Plattform; Songtitel werden bereinigt.
- Der Songordner lässt sich direkt aus den Einstellungen öffnen.
- Temporäre Exportdateien bleiben bis zum Abschluss des Exports verfügbar; zurückgelassene Dateien werden beim nächsten Start aufgeräumt.
- Eine zweisprachige Produkt- und Dokumentationswebsite ergänzt die Projektdokumentation.

## Downloads und Installation

Die Release-Builds erzeugen folgende Pakete, jeweils mit einer SHA-256-Datei:

- macOS Apple Silicon: DMG und ZIP, ab macOS 14.
- macOS Intel: DMG und ZIP, ab macOS 13.3; experimenteller CPU-Betrieb.
- Windows x64: MSI und portables ZIP, Windows 10/11.
- Linux x64: AppImage für Vulkan/CPU, Ubuntu 22.04 oder kompatible neuere Distribution.
- Linux x64 CUDA: separates AppImage für NVIDIA CUDA/CPU; für CUDA ist ein unterstützter NVIDIA-Grafikprozessor mit Treiber 570.124.06 oder neuer erforderlich.

Vor dem Update die App schließen. Auf macOS die App aus dem DMG in einen normalen Ordner kopieren, das Image auswerfen und die kopierte App starten. Portable ZIPs vollständig entpacken und alle enthaltenen Dateien zusammenlassen. Modelle und Bibliotheksdaten liegen außerhalb des Programmpakets.

## Bekannte Grenzen

- Experimenteller Pre-Release. Die Testpakete sind nicht mit einer macOS Developer ID notarisiert; Betriebssystem-Warnungen sind möglich.
- Automatisierte Paketprüfungen ersetzen keine Hardwareabnahme. Insbesondere Windows-WebView-Darstellung, Windows-/Linux-NVIDIA-Inferenz und Mindestversionen der Betriebssysteme benötigen weiterhin Tests auf den jeweiligen Geräten.
- Der Linux-CUDA-Build wird in CI ohne NVIDIA-GPU auf CPU-Start und Laufzeitabhängigkeiten geprüft; echte CUDA-Generierung ist damit nicht bestätigt.
- Die gewünschte Musikdauer bleibt eine Modellvorgabe; Abweichungen können auftreten.
