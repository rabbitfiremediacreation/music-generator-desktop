# Issue #53 — Windows-Testbuild für den Fensterstart

Bezug: https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53

Dieser Build enthält einen Fix-Kandidaten für das schwarze Hauptfenster und einen
separaten Schutz gegen ausbleibende Frame-Callbacks im Splash. Die ursprüngliche
Windows-/GPU-Konstellation steht lokal nicht zur Verfügung. Eine erfolgreiche CI
belegt Kompilierung, automatisierte Tests und Paketprüfung, nicht die Behebung des
Compositing-Problems. Der PR bleibt bis zur externen Abnahme ein Entwurf.

## Änderungen

- Nach `show()` wird unter Windows der WebView2-Controller einmal ausgeblendet.
  Ein separat an den UI-Thread übergebener Aufruf setzt den Wry-Container und die
  WebView auf die aktuelle physische Clientgröße und blendet den Controller ein.
  Beide Aufrufe werden asynchron bestätigt; COM-Objekte bleiben auf dem UI-Thread.
  Die äußere Fenstergeometrie wird dabei nicht geändert.
- Die gesamte Übergabe einschließlich des anschließenden Frontend-Frame-Handshakes
  liegt innerhalb derselben 15-Sekunden-Frist. Bei Fehlern bleibt das Splash mit
  der vorhandenen Wiederholen-Funktion verfügbar. Veraltete native Aufrufe prüfen
  Versuch und Frist unmittelbar vor dem Zugriff auf den Controller.
- Ausschließlich das Splash darf nach 500 ms ohne Frame-Callbacks fortfahren,
  nachdem Statusabfrage und Event-Verbindung funktioniert haben. Timer und
  ausstehende Frame-Anforderung werden bereinigt. Das Hauptfenster bekommt keinen
  zeitgesteuerten Erfolgs-Fallback.
- Windows öffnet `desktop.log` vor der Fenstererzeugung. Jeder Prozess erhält eine
  Startzeile mit PID, Version, Build, Plattform und Architektur. Splash-Fortschritt,
  Frame-Fallback und native Übergabe erhalten Versuch und Laufzeit. In GitHub CI
  bezeichnet `build` den Workflow-Checkout (`GITHUB_SHA`, bei PRs den Merge-Commit);
  lokale Builds sind als `local` markiert.
- macOS behält seine Installationsprüfung vor dem Anlegen von App-Daten. Der
  native Controller-Eingriff ist ausschließlich für Windows kompiliert.

`ready` und zwei Frame-Callbacks sind weiterhin kein Nachweis sichtbarer Pixel.
Die Controller-Aktualisierung erfolgt deshalb bei jeder ersten Übergabe pro
Startversuch, auch wenn der Frontend-Handshake ohne Verzögerung funktioniert.

## Paket für externe Tester

Im PR unter **Test builds** das Windows-x64-Artefakt herunterladen. GitHub liefert
ein äußeres Artefakt-ZIP; darin liegen das portable Programm-ZIP, das MSI und die
jeweiligen SHA256-Prüfsummen. Für diese Untersuchung zuerst das portable ZIP in
einen eigenen Ordner entpacken, einschließlich seines `WebView2`-Unterordners.
Die bisherige Programmversion vollständig beenden und die EXE aus diesem neuen
Ordner starten. Alle benötigten Laufzeitdateien sind im Paket enthalten.

Die portable Variante verwendet dieselben vorhandenen App-Einstellungen und
Bibliotheksdaten. Es werden keine Modelle oder Datenformate für diesen Fix geändert.
Einrichtungsdialog und bestehendes Studio sollen beide getestet werden, soweit
die entsprechende Testumgebung vorhanden ist.

## Testablauf

Auf dem ursprünglich betroffenen Windows-10-/GTX-1060-Rechner und nach Möglichkeit
zusätzlich auf dem Windows-11-Rechner mit dem Splash-Timeout jeweils 50 Starts:

1. Zehn normale Starts, jeweils vollständig beenden.
2. Zehn schnelle Neustarts nach Alt+F4. Vor dem nächsten Start prüfen, dass der
   vorherige Prozess beendet ist.
3. Fünfzehn Starts mit zuvor gespeichertem maximiertem Fenster.
4. Fünf Starts im normalen Fenster; bei mehreren Monitoren auch auf dem zweiten
   Monitor beziehungsweise bei anderer DPI-Skalierung.
5. Fünf Starts, bei denen während des Starts das Startmenü oder eine andere App
   in den Vordergrund kommt; anschließend zur App zurückkehren.
6. Fünf Starts mit Minimieren/Wiederherstellen während des Starts.

Pro Start festhalten: Nummer, Szenario, sichtbares Studio/Setup, schwarze Fläche,
Fehlermeldung und ungefähre Dauer. Ein Erfolg bedeutet sichtbare, bedienbare Inhalte;
eine `ready`-Zeile allein zählt nicht. Nach der Serie einen Song erzeugen und exportieren.

Bei einer schwarzen Fläche zuerst einen Screenshot und die zugehörigen Logzeilen
sichern. Danach prüfen, ob Minimieren/Wiederherstellen die Oberfläche repariert.
Bei einer Fehleranzeige auch „Erneut versuchen“ und „Beenden“ prüfen. Kein endloses
automatisches Wiederholen und keine zurückbleibenden App-/Engine-Prozesse erwarten.

## Rückmeldung und Logs

Das Log liegt normalerweise unter:

```text
%LOCALAPPDATA%\de.alphatester.music-generator\logs\desktop.log
```

Bitte Windows-Version, GPU, Skalierung, Monitoranordnung, verwendetes PR-Artefakt
und das vollständige Ergebnis der Serie angeben. Für fehlgeschlagene Starts den
Abschnitt ab `Startup process pid=...` mitsenden. Erwartete Diagnoseeinträge:

```text
Startup process pid=... version=... build=... platform=windows ...
Splash progress stage=Connecting ...
Splash progress stage=Subscribing ...
Splash progress stage=Synchronizing ...
Splash progress stage=WaitingForFrames ...
Splash progress stage=FramesObserved ...  (oder FrameTimeout)
Splash handshake received ...
Main presentation requested ...
WebView2 presentation visible=false width=... height=... ...
WebView2 presentation visible=true width=... height=... ...
Main presentation completed; awaiting frontend frames ...
```

Diagnosemeldungen sind vom Splash-Handshake unabhängig und können sich zeitlich
überschneiden. Fehlende Fortschrittsmeldungen helfen, Bundle-/IPC-Stillstände vom
Frame-Warten zu unterscheiden. Ein `FrameTimeout` mit erfolgreichem Start ist ein
ausgelöster Fallback und soll ebenfalls im Testbericht erwähnt werden.

## Automatisierte Absicherung

Regressionstests decken keinen/lediglich einen Splash-Frame, verspätete Callbacks,
Timerbereinigung, blockierte Event-Verbindung, blockierte Diagnose-IPC und die
weiterhin verpflichtende Frame-Rückmeldung des Hauptfensters ab. Rust-Tests prüfen
native Bestätigung vor Freigabe, Controller-Fehler, fehlende native Rückmeldung,
Fristüberschreitung sowie verworfene Aufrufe nach Timeout und nach einem Retry.
Die Controller-Ergebnisse werden in diesen Tests simuliert; echte WebView2-Pixel
werden damit nicht geprüft.
