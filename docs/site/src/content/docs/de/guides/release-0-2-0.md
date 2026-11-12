---
title: Neu in Version 0.2.0
description: Änderungen seit 0.1.3, Installation und bekannte Grenzen von Music Generator 0.2.0.
sidebar:
  order: 2
---

**8. November 2026** · [Release und Downloads](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.2.0) · [Installationsanleitung](../installation/)

## Studio und Einstellungen

Die Desktop-Oberfläche wurde auf React und TypeScript umgestellt. Alle zwölf Oberflächensprachen, lokale Generierung, Bibliothek, Warteschlange und native Exporte bleiben verfügbar.

Die Einstellungen haben eigene Seiten für **Generierung**, **Modelle und Hardware**, **Bibliothek & Export**, **Darstellung**, **Handy-Zugriff**, **MCP & Integrationen** und **Über die App**. Unter **Modelle und Hardware** siehst du installierte Modelle, Status und Speicherbedarf. **Modell hinzufügen** öffnet den Katalog mit Downloads und Prüfung. Für die erweiterte Auswahl den **Expert Mode** aktivieren und übernehmen. Modellwechsel und Downloads gelten sofort; andere ungespeicherte Einstellungen bleiben erhalten.

Der dreistufige Einrichtungsassistent führt durch Sprache und optionalen Import, Modelle und Speicherorte sowie Downloads und Hardwaretest. Ein Hinweis erklärt vor dem Wechsel des Songordners, dass vorhandene Songs verschoben werden. Für einen späteren Hardwaretest öffne **Einstellungen → Modelle und Hardware → Hardwaretest im Einrichtungsassistenten …**.

## Zugriff vom Handy und per KI-Assistent

**Handy-Zugriff** verbindet die native iPhone-App oder die mobile Web-App/PWA mit dem Studio im lokalen Netzwerk. Per QR-Code werden Adresse und Zugriffsschlüssel übernommen. Danach lassen sich Bibliothek und Wiedergabe bedienen, Songs herunterladen, Favoriten und Ordner verwalten, Musik generieren und Audioideen analysieren.

Für die Web-App prüfst du den angezeigten Zertifikat-Fingerabdruck, installierst und vertraust dem lokalen Zertifikat und öffnest anschließend HTTPS. Auf dem iPhone hilft ein Konfigurationsprofil bei der Installation; das Vertrauen bestätigst du selbst in den Systemeinstellungen. Die PWA kann über den Browser installiert werden. Der Rechner muss wach und die Desktop-App geöffnet bleiben. Der Zugriff ist zunächst aus; Ausschalten stoppt auch laufende Handy-Übertragungen. [Ausführliche Einrichtung und API](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.2.0/docs/phone-access.md).

**MCP & Integrationen** bietet einen separat schaltbaren Dienst mit Zugriffsschlüssel und kopierbarer Client-Konfiguration. KI-Assistenten können damit Generierung, Varianten, Bibliothek, Warteschlange, Modelle, Einstellungen, Analyse, Import und Export steuern. [MCP-Anleitung und Werkzeuge](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.2.0/docs/mcp.md).

## Weitere Verbesserungen

- VAR verwendet standardmäßig **0,85**, auch beim Zurücksetzen und über MCP. Bei automatisch erfundenen Lyrics wird die Varianz für den Durchgang auf höchstens 0,85 begrenzt. Das Textfeld nennt die gewünschte Gesangssprache.
- Die Windows-Engine und ihre CPU-Prüfung unterstützen Unicode in Installations-, Modell- und Audiopfaden.
- Die CUDA-Einrichtung berücksichtigt freien Platz für Download und Entpacken auf den betroffenen Laufwerken.
- Die Wiedergabe lädt Audio anhand der Song-ID und kann sich nach Medienfehlern erholen.
- Das gemeinsame Titelmodell erscheint nicht mehr als fehlendes Musikmodell im Registry-Abgleich.
- Für die Entwicklung unterstützen React und CSS Fast Refresh; Neuladen der Oberfläche verwendet den abgeschlossenen nativen Startzustand weiter.

## Installation und Grenzen

Die Release-Pipeline erzeugt DMG und ZIP für Apple Silicon und Intel, MSI und ZIP für Windows sowie AppImages für Linux Vulkan/CPU und separat CUDA/CPU. Zu jedem Paket gehört eine SHA-256-Datei. Die Dateien erscheinen nach erfolgreichem Build auf der Release-Seite.

Vor dem Update die App schließen und Bibliotheksdaten sowie separat gewählte Songordner sichern. Modelle, Songs und Einstellungen liegen außerhalb des Programmpakets. [Installation und Datenordner](../installation/).

Die Pakete bleiben Testausgaben ohne reguläre macOS Developer-ID-Signierung und Notarisierung. Intel-Unterstützung ist experimentell und auf CPU begrenzt. Paketprüfungen bestätigen keine echte NVIDIA-Generierung oder vollständige Hardwareabnahme auf allen Mindestversionen. Der schwarze Windows-Hauptbildschirm aus [Issue #53](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53) bleibt gesondert zu prüfen. Beginne auf CPU mit Standard, dem 0.6B-Sprachmodell und zehn Sekunden Musik.
