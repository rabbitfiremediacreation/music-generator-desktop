---
title: Installation
description: Music Generator Desktop unter macOS, Windows oder Linux installieren und einrichten.
sidebar:
  order: 1
---

Stand: **27. Oktober 2026**. Diese Anleitung bezieht sich auf den verfügbaren Desktop-**Pre-Release 0.1.2**. Downloadnamen und Plattformen sind mit den [Release-Dateien von v0.1.2](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.1.2) abgeglichen. Der Quellcode auf `main` kann bereits weitere Änderungen enthalten.

## Passendes Paket herunterladen

Öffne die [Release-Seite von 0.1.2](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.1.2) und lade unter **Assets** das passende Paket herunter. Zu jedem Paket gibt es eine `.sha256`-Datei zur Integritätsprüfung.

| Rechner | Paket für 0.1.2 | Voraussetzungen |
| --- | --- | --- |
| Mac mit Apple Silicon (M1 oder neuer) | `Music-Generator-0.1.2-macos-arm64.dmg` oder `.zip` | macOS 14 oder neuer |
| Intel-Mac (experimentell) | `Music-Generator-0.1.2-macos-x64.dmg` oder `.zip` | macOS 13.3 oder neuer, mindestens 8 GiB RAM; nur CPU |
| Windows-PC | `Music-Generator-0.1.2-windows-x64.zip` | Windows 10/11 x64, aktueller Grafiktreiber |
| Linux-PC, Vulkan/CPU | `Music-Generator-0.1.2-linux-x64.AppImage` | x64, Ubuntu 22.04 oder kompatible neuere Distribution, aktueller Grafiktreiber |

Die Plattformvoraussetzungen stammen aus der [Desktop-Anleitung zu v0.1.2](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.1.2/docs/desktop.md#start). Intel-Unterstützung ist experimentell; vollständige Tests auf allen Mindestversionen der Betriebssysteme sind noch offen. Die Testpakete sind noch nicht regulär signiert beziehungsweise notarisiert.

Für die Nutzung brauchst du kein Python, Node.js, Git oder einen Compiler. Die erste Einrichtung benötigt Internetzugang und mehrere GB freien Speicher für Modelle. Der genaue Bedarf hängt vom ausgewählten Modellprofil ab.

## macOS

1. Öffne die heruntergeladene DMG-Datei.
2. Ziehe **Music Generator** auf **Programme / Applications** oder kopiere die App in einen anderen beschreibbaren Ordner.
3. Wirf das Disk-Image aus und starte die kopierte App aus ihrem Zielordner.

Beim ZIP-Paket entpackst du die vollständige App und startest diese Kopie. Nutze für die dauerhafte Installation die kopierte App außerhalb des Disk-Images.

Bei diesen Testpaketen kann Gatekeeper den Start blockieren. Im [Testlauf zu Issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) wurde der Weg über **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen** dokumentiert. Prüfe vorher, dass das Paket aus dem oben verlinkten Repository stammt.

Auf Intel-Macs rechnen Sprachmodell und Klangerzeugung auf der CPU. Beginne mit **Standard**, dem **0.6B-Sprachmodell** und einem **10-Sekunden-Song**; auf älteren CPUs kann schon das mehrere Minuten dauern.

## Windows

1. Entpacke das **gesamte ZIP** auf ein lokales, beschreibbares Laufwerk.
2. Lass die EXE sowie die Verzeichnisse `engine` und `WebView2` zusammen im entpackten Ordner.
3. Öffne **Music Generator** aus diesem Ordner.

WebView2 wird mitgeliefert. Bei den unsignierten Testpaketen kann SmartScreen eine Warnung anzeigen. Der [Testlauf zu Issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) nennt **Weitere Informationen → Trotzdem ausführen**. Prüfe auch hier zunächst die Herkunft des Downloads.

## Linux

Die AppImage von 0.1.2 verwendet Vulkan oder CPU. Eine separate CUDA-Ausgabe ist in diesem Pre-Release nicht enthalten; das bestätigen die [Versionshinweise zu 0.1.2](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.1.2).

Markiere die heruntergeladene Datei als ausführbar und starte sie. Für die Vulkan/CPU-Ausgabe von 0.1.2:

```sh
chmod +x Music-Generator-0.1.2-linux-x64.AppImage
./Music-Generator-0.1.2-linux-x64.AppImage
```

Wenn FUSE nicht verfügbar ist:

```sh
./Music-Generator-0.1.2-linux-x64.AppImage --appimage-extract
./squashfs-root/AppRun
```

Der [Testlauf in Issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) enthielt keine Linux-Abnahme; Paketprüfungen ersetzen keinen echten Generierungstest auf deiner Hardware.

## Erste Einrichtung

1. Wähle die Sprache der App.
2. Optional: Importiere eine alte Music-Generator-Bibliothek. Das ist nur bei leerer Zielbibliothek möglich; die Quelldaten bleiben erhalten.
3. Prüfe die Hardware-Empfehlung und wähle Modell- und Song-Ordner.
4. Wähle ein empfohlenes Modellprofil. XL ist optional und benötigt zusätzlichen Speicher.
5. Schließe Modelldownloads, Prüfsummenprüfung und Hardwaretest ab. Downloads lassen sich abbrechen und fortsetzen.

Nach abgeschlossener Einrichtung öffnet die App bei späteren Starts das Studio direkt. Musikgenerierung und Wiedergabe laufen lokal; die Engine startet bei Bedarf. Den vollständigen Assistenten erreichst du über **Einstellungen → Einrichtungsassistent erneut öffnen …**. Grundlage: [Ersteinrichtung in der Desktop-Anleitung zu v0.1.2](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.1.2/docs/desktop.md#first-run-assistant).

## Daten sichern und aktualisieren

Bibliothek, Modelle und Songs liegen außerhalb des Programmbundles. Schließe die App und sichere den Datenordner sowie separat gewählte Song-Ordner, bevor du das vollständige Bundle austauschst.

| System | Standard-Datenordner |
| --- | --- |
| macOS | `~/Library/Containers/de.alphatester.music-generator/Data/Library/Application Support/de.alphatester.music-generator/` |
| Windows | `%LOCALAPPDATA%\de.alphatester.music-generator\` |
| Linux | `$XDG_DATA_HOME/de.alphatester.music-generator/`, normalerweise `~/.local/share/de.alphatester.music-generator/` |

Die Datenbank heißt `music.db`; Modelle und Songs können in separat ausgewählten Ordnern liegen. Weitere Details: [Daten und Updates zu v0.1.2](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.1.2/docs/desktop.md#data-and-updates).
