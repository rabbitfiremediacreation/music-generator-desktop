# Issue #45 — zuverlässiger Start und lokalisierte Fehler

## Änderung

Tauri erzeugt konfigurierte Fenster vor dem Setup-Hook. Deshalb deaktivieren sowohl
die allgemeine als auch die macOS-Fensterkonfiguration die automatische Erzeugung.
Der Startup-State wird registriert, bevor Splash und verborgenes Hauptfenster entstehen.
Ein Regressionstest beobachtet die Fenstererzeugung für beide Konfigurationen.

Startup-IPC und Bootstrap verwenden eine Versuchskennung. Ein manueller Retry lädt
beide Frontends neu; alte Handshakes, Fehler und Timer können den neuen Versuch nicht
überschreiben. Nach fehlender Splash-Bereitschaft erfolgt genau ein automatischer
Reload pro Prozess, mit jeweils 15 Sekunden Wartefrist. Das Hauptfenster bestätigt
nach dem Anzeigen zwei Animation-Frames; seine Frist wird im Backend überwacht.
Fehler verbergen Main und aktivieren das weiterhin vorhandene Splash.

Die Fehlerprotokollierung beginnt nach der Installationsprüfung und vor dem Warten
auf das Splash. Bekannte Fehlercodes werden in Splash und Main in allen zwölf
Oberflächensprachen übersetzt; unbekannte Diagnosen bleiben in den technischen Details.
Native Schließ-/Zerstörungsereignisse des Splash beenden die App vor erfolgreicher
Übergabe. Das Entfernen des Splash nach erfolgreichem Start beendet die App nicht.

## Automatisierte Prüfung

Am 27.10.2026 bestanden:

- 375 Frontend-Tests, einschließlich vollständiger Übersetzungen und Frame-Handshake.
- 32 Desktop-Skripttests.
- 208 Rust-Tests; ein absichtlich ignorierter Subprozess-Fixture-Test.
- Typecheck/Vite-Build, ESLint, Rustfmt und Clippy für alle Targets mit `-D warnings`.

Die neuen Regressionen wurden schrittweise rot/grün geprüft. Sie decken frühe
Fehlerlogs, Fenstererzeugung, beide Bereitschaftsfristen, automatische und manuelle
Erholung, doppelte Wiederholungen sowie verspätete Meldungen und Timer ab. Die
Rust-Suite lief außerhalb der Ausführungssandbox für lokale HTTP-Testserver und den
bestehenden macOS-Sandboxtest. Es wurden keine Engine- oder Versionsupdates vorgenommen.

## Native macOS-Prüfung

Ein lokal gebauter ARM64-Debugstand lief mit eigenem temporärem Datenverzeichnis
und echten Tauri-WebViews, ohne Modelle zu laden oder Songs zu erzeugen.

- Frischer Start: initialisierter Einrichtungsassistent sichtbar, Splash entfernt; `ready` nach
  648 ms. Das ist eine einzelne lokale Beobachtung, keine Windows-Laufzeitangabe.
- Mit exklusiv gesperrter Testdatenbank: deutsche Fehleranzeige nach rund 5,7 Sekunden,
  `database is locked` samt Versuch und Laufzeit im Log. Ein weiterer Versuch während
  bestehender Sperre blieb als Fehler bedienbar. Nach Freigabe der Datenbank führte
  „Erneut versuchen“ erfolgreich zum Assistenten (`attempt=3`, `ready`).
- Nach erfolgreichem Start und nach erfolgreichem Retry endete der Prozess über
  Cmd+Q jeweils mit Exitcode 0. Auch „Beenden“ im fehlgeschlagenen Splash beendete
  den Prozess mit weiterhin verborgenem Main mit Exitcode 0.
- Der framelose macOS-Splash reagierte nicht auf die native Menüaktion „Close Window“;
  ein nativer `CloseRequested`-Pfad wurde damit lokal nicht ausgelöst.

Die [native deutsche Fehleransicht](error-de.png) und das
[Protokoll der isolierten Teststarts](native-desktop.log) gehören zu dieser Prüfung.
Die Fehleransicht wurde für den PR am finalen Implementierungsstand `bcb231d` erneut aufgenommen.
Animation-Frames bestätigen einen reagierenden Frontendablauf, nicht korrekte GPU-Pixel.

## Bezug zu Issue #32 und Review

[Issue #32](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/32)
meldet denselben 15-Sekunden-Splash-Timeout unter macOS. Der automatische Einzelversuch,
die Übersetzung und das frühe Logging erfüllen die dort genannten konkreten Wünsche.
Die macOS-Fensterreihenfolge ist ebenfalls korrigiert. Der ursprüngliche Einzelfall
auf dem M1 mit 8 GiB wurde hier nicht reproduziert; schnelle Cmd+Q-Neustarts auf
diesem Gerät, einschließlich des ursprünglichen Quarantäne-/Translocation-Kontexts,
bleiben als Bestätigung offen. Eine gemeinsame Ursache ist plausibel, aber nicht
für diesen historischen Einzelfall nachgewiesen.

Der Standards-Review ergab keine Befunde. Der Spec-Review identifizierte zwei
Wettlaufsituationen: einen veralteten automatischen Splash-Reload während eines
manuellen neuen Versuchs und einen verspäteten lokalen IPC-Fehler, der dem neuen
Versuch zugeordnet wurde. Beide Pfade werden zusätzlich an die aktive Generation
gebunden beziehungsweise unter derselben Übergangssperre erneut geprüft.

## Offene Windows-Abnahme

Hier stand kein Windows-10-System zur Verfügung. Vor Release auf dem betroffenen
Windows-10-/GTX-1060-System 20-mal hintereinander starten, vollständig beenden und
sofort neu starten. Auch gespeicherte maximierte/Vollbildgeometrie, Alt+F4 im Splash,
manuellen Retry und einen zweiten Start während eines noch laufenden Starts prüfen.
Erwartung: kein fehlender State, kein schwarzes Hauptfenster trotz `ready`, keine
Endlosschleife und kein verbleibender Music-Generator-/Engine-Prozess. Die Ergebnisse
einschließlich `desktop.log` müssen vor einer bestandenen Windows-Abnahme ergänzt werden.
