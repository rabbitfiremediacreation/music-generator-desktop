---
title: Installation
description: Music Generator Desktop unter macOS, Windows oder Linux installieren und einrichten.
sidebar:
  order: 1
---

Stand: **8. November 2026**. Diese Anleitung gilt für **Music Generator 0.2.0**. Die [Release-Seite](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.2.0) enthält die Pakete nach Abschluss der Plattform-Builds. [Was ist neu in v0.2.0?](../release-0-2-0/)

## Passendes Paket herunterladen

Öffne die [Release-Seite von 0.2.0](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.2.0) und lade unter **Assets** das passende Paket herunter. Zu jedem Paket gibt es eine `.sha256`-Datei zur Integritätsprüfung.

| Rechner | Paket für 0.2.0 | Voraussetzungen |
| --- | --- | --- |
| Mac mit Apple Silicon (M1 oder neuer) | `Music-Generator-0.2.0-macos-arm64.dmg` oder `.zip` | macOS 14 oder neuer |
| Intel-Mac (experimentell) | `Music-Generator-0.2.0-macos-x64.dmg` oder `.zip` | macOS 13.3 oder neuer, mindestens 8 GiB RAM; nur CPU |
| Windows-PC | `Music-Generator-0.2.0-windows-x64.msi` oder `.zip` | Windows 10/11 x64, aktueller Grafiktreiber |
| Linux-PC, Vulkan/CPU | `Music-Generator-0.2.0-linux-x64.AppImage` | x64, Ubuntu 22.04 oder kompatible neuere Distribution, aktueller Grafiktreiber |
| Linux-PC, NVIDIA CUDA/CPU | `Music-Generator-0.2.0-linux-x64-cuda.AppImage` | Gleiche Linux-Basis; für CUDA unterstützte NVIDIA-GPU und Treiber ab 570.124.06 |

Die Plattformvoraussetzungen stammen aus der [Desktop-Anleitung zu v0.2.0](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.2.0/docs/desktop.md#start). Intel-Unterstützung ist experimentell; vollständige Tests auf allen Mindestversionen der Betriebssysteme sind noch offen. Die Testpakete sind noch nicht regulär signiert beziehungsweise notarisiert.

Für die Nutzung brauchst du kein Python, Node.js, Git oder einen Compiler. Die erste Einrichtung benötigt Internetzugang und mehrere GB freien Speicher für Modelle. Der genaue Bedarf hängt vom ausgewählten Modellprofil ab.

## macOS

1. Öffne die heruntergeladene DMG-Datei.
2. Ziehe **Music Generator** auf **Programme / Applications** oder kopiere die App in einen anderen beschreibbaren Ordner.
3. Wirf das Disk-Image aus und starte die kopierte App aus ihrem Zielordner.

Beim ZIP-Paket entpackst du die vollständige App und startest diese Kopie. Nutze für die dauerhafte Installation die kopierte App außerhalb des Disk-Images.

Bei diesen Testpaketen kann Gatekeeper den Start blockieren. Im [Testlauf zu Issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) wurde der Weg über **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen** dokumentiert. Prüfe vorher, dass das Paket aus dem oben verlinkten Repository stammt.

Auf Intel-Macs rechnen Sprachmodell und Klangerzeugung auf der CPU. Beginne mit **Standard**, dem **0.6B-Sprachmodell** und einem **10-Sekunden-Song**; auf älteren CPUs kann schon das mehrere Minuten dauern.

## Windows

Mit dem **MSI-Installer**: Datei öffnen, Installation mit Administratorrechten abschließen und Music Generator über das Startmenü starten. Spätere MSI-Versionen aktualisieren die App; die Deinstallation erfolgt über Windows → Einstellungen → Apps. Modelle und Bibliothek bleiben in den Benutzerdatenordnern.

Für das **portable ZIP**:

1. Entpacke das **gesamte ZIP** auf ein lokales, beschreibbares Laufwerk.
2. Lass die EXE sowie die Verzeichnisse `engine` und `WebView2` zusammen im entpackten Ordner.
3. Öffne **Music Generator** aus diesem Ordner.

WebView2 wird mitgeliefert. Bei den unsignierten Testpaketen kann SmartScreen eine Warnung anzeigen. Der [Testlauf zu Issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) nennt **Weitere Informationen → Trotzdem ausführen**. Prüfe auch hier zunächst die Herkunft des Downloads.

## Linux

Die reguläre AppImage verwendet Vulkan oder CPU. Für unterstützte NVIDIA-GPUs gibt es zusätzlich `Music-Generator-0.2.0-linux-x64-cuda.AppImage` mit CUDA/CPU. Für CUDA ist ein NVIDIA-Treiber ab **570.124.06** erforderlich. Die separate Ausgabe wird in CI ohne NVIDIA-GPU auf CPU-Start und Abhängigkeiten geprüft; echte CUDA-Generierung benötigt einen Test auf deiner Hardware.

Markiere die heruntergeladene Datei als ausführbar und starte sie. Für die Vulkan/CPU-Ausgabe von 0.2.0:

```sh
chmod +x Music-Generator-0.2.0-linux-x64.AppImage
./Music-Generator-0.2.0-linux-x64.AppImage
```

Wenn FUSE nicht verfügbar ist:

```sh
./Music-Generator-0.2.0-linux-x64.AppImage --appimage-extract
./squashfs-root/AppRun
```

Der [Testlauf in Issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) enthielt keine Linux-Abnahme; Paketprüfungen ersetzen keinen echten Generierungstest auf deiner Hardware.

## Erste Einrichtung

1. **Willkommen:** Sprache wählen und bei Bedarf eine alte Bibliothek übernehmen. Der Import benötigt eine leere Zielbibliothek; die Quelldaten bleiben erhalten.
2. **Modelle und Speicher:** Hardware-Empfehlung, Modell- und Songordner sowie empfohlenes Standard-/XL-Profil prüfen. Beim Wechsel des Songordners werden bestehende Songs an den neuen Ort verschoben. XL benötigt zusätzlichen Speicher.
3. **Einrichtung:** Downloads, Prüfsummen und Hardwaretest abschließen, dann **Zum Studio** wählen. Downloads lassen sich abbrechen und fortsetzen.

Nach erfolgreicher Einrichtung öffnet die App bei späteren Starts das Studio direkt. Musikgenerierung und Wiedergabe laufen lokal; die Engine startet bei Bedarf. Weitere Modelle findest du unter **Einstellungen → Modelle und Hardware → Modell hinzufügen**. Den vollständigen Assistenten erreichst du dort über **Hardwaretest im Einrichtungsassistenten …**; beim Abschließen wird ein empfohlenes Standard- oder XL-Profil eingerichtet.

Optional lassen sich **Handy-Zugriff** und **MCP & Integrationen** in den Einstellungen aktivieren. Für die Web-App/PWA zuerst das lokale Zertifikat prüfen und vertrauen. [Einrichtung und Hinweise zu v0.2.0](../release-0-2-0/).

## Daten sichern und aktualisieren

Bibliothek, Modelle und Songs liegen außerhalb des Programmbundles. Schließe die App und sichere den Datenordner sowie separat gewählte Song-Ordner, bevor du das vollständige Bundle austauschst.

| System | Standard-Datenordner |
| --- | --- |
| macOS | `~/Library/Containers/de.alphatester.music-generator/Data/Library/Application Support/de.alphatester.music-generator/` |
| Windows | `%LOCALAPPDATA%\de.alphatester.music-generator\` |
| Linux | `$XDG_DATA_HOME/de.alphatester.music-generator/`, normalerweise `~/.local/share/de.alphatester.music-generator/` |

Die Datenbank heißt `music.db`; Modelle und Songs können in separat ausgewählten Ordnern liegen. Weitere Details: [Daten und Updates zu v0.2.0](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.2.0/docs/desktop.md#data-and-updates).
