# Issue #53 — nativer Windows-Fensterstart

Bezug: https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53

## Befund und Stand

Erstfassung: Basis `aa151677f7d36b43d7c0a8203b12e313bd479e16`, Kandidat `701e0b2`.
Alle zwölf Issue-Kommentare einschließlich ihrer Berichtigungen wurden gelesen.
Am 12. November 2026 wurde `main` (`c982d54`) einschließlich seiner
Frontend-Reload-Unterstützung in den PR integriert. Die Nachkorrektur behandelt
die im Hardwaretest der Erstfassung gemeldeten Fokus- und Minimierungsregressionen.
Die Nachkorrektur muss auf dem betroffenen Windows-/GTX-1060-Rechner erneut geprüft werden.

- Der Vergleich von 0.1.2 mit #61 hat zwei Fehler vermischt. Das Rennen um den
  registrierten Startup-Zustand wurde durch #49 behoben. Die korrigierte Reihe
  belegt keinen zusätzlichen Zuverlässigkeitsgewinn durch #61:
  [Berichtigung](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53#issuecomment-6550513662).
- Die Fokusbeobachtung wurde berichtigt: Vor dem Heilversuch waren sowohl schwarze
  als auch saubere Hauptfenster im Vordergrund. Fokus, 1-px-Resize,
  `SWP_FRAMECHANGED` und das Abschalten der Chromium-Verdeckungserkennung halfen
  nicht. Native Sichtbarkeitswechsel heilten die dokumentierten Fälle:
  [Ursachenreihe](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53#issuecomment-6560139101).
- ACLs erklären den Effekt nicht; die Fehlerrate hängt auch nicht allein an der
  Startdauer:
  [Berichtigung](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53#issuecomment-6577536198).
- Das bisherige `SetIsVisible` am WebView2-Controller steckt bereits in 0.1.3.
  Trotz erfolgreicher Controller-Aufrufe und Frame-Callbacks blieben Fenster
  schwarz. Natives `ShowWindow(SW_HIDE)` / `ShowWindow(SW_SHOW)` heilte dort
  23 von 23 schwarzen Starts:
  [letzter Testbericht](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53#issuecomment-6585427726).

Der [Hardwarebericht zu PR #83](https://github.com/rabbitfiremediacreation/music-generator-desktop/pull/83#issuecomment-6712328902)
vergleicht je 50 abwechselnde Starts auf Windows 10 / GTX 1060: acht Schwarzbilder
mit `aa15167`, keines mit `701e0b2`. Allerdings blieb das PR-Fenster bei allen
40 normalen Starts im Hintergrund, und schnelles Minimieren löste in einer
gezielten Zusatzreihe 7 Startfehler bei 22 Versuchen aus. Die Reihe nutzte dieselben
App-Daten und konnte normale gespeicherte Fenstergröße nicht tatsächlich testen;
MSI, frisches Setup, zweite Monitore/DPI und echte Benutzereingaben blieben offen.

Diese Messungen stammen aus den verlinkten Berichten, nicht aus einer lokalen
Hardwareprüfung dieser Änderung. Die Ursache im Windows-/WebView2-Compositing
ist weiterhin unbekannt.

## Änderung

Die äußere HWND-Sichtbarkeit ersetzt die widerlegte Controller-Korrektur.
Der Ablauf bleibt `startup_show_main` → zwei Frontend-Frame-Callbacks →
`startup_complete`. Erst innerhalb von `startup_complete` wird unter Windows
höchstens einmal pro Versuch ein nativer Sichtbarkeitszyklus ausgeführt:

1. Auf dem UI-Thread Sichtbarkeit, Minimierung und aktuellen Zustand prüfen.
   Ein bereits minimiertes oder verborgenes Fenster bleibt unverändert.
2. Nur wenn das Hauptfenster aktuell im Vordergrund ist, seine Aktivierung mit
   `SetActiveWindow` an das sichtbare eigene Splash übergeben. Danach das
   Haupt-HWND mit `SW_HIDE` verbergen. Windows darf dadurch nicht mehr selbst
   irgendein nächstes Fenster als unbeständige Aktivierungsreferenz auswählen.
   Ist das Hauptfenster im Hintergrund, findet keine Aktivierungsübergabe statt.
   Eine während `SW_HIDE` erfolgte Minimierung wird erneut geprüft und als
   übersprungene Korrektur behandelt; eine nötigenfalls verborgene Taskleisten-
   Repräsentation wird nur minimiert und ohne Aktivierung wieder sichtbar gemacht.
3. Asynchron 800 ms warten. Diese Dauer entspricht dem dokumentierten externen
   Heilversuch; sie ist keine nachgewiesene Mindestdauer. Der UI-Thread bleibt frei.
4. Auf dem UI-Thread mit `SW_SHOWNA` wieder zeigen; Position, Größe und
   Maximierung bleiben erhalten. Nur wenn die Aktivierung tatsächlich an unser
   Splash übergeben wurde und dieses weiterhin im Vordergrund ist, wird über
   das reguläre `SetForegroundWindow` die Aktivierung an das Hauptfenster
   zurückgegeben. Eine andere Vordergrund-App, fehlgeschlagene Übergabe oder
   inzwischen erfolgte Minimierung verhindert das. Pointerbewegungen allein
   lassen die Aktivierungsabsicht unverändert. `GetLastInputInfo` und dessen
   unbeständiger Zeitstempel werden hierfür nicht mehr verwendet.
   Minimierte Fenster bleiben mit `SW_SHOWMINNOACTIVE` minimiert.
5. Erst nach der nativen Rückmeldung den bisherigen `ready`-Übergang ausführen
   und das Splash zerstören.

Die Show-Modi folgen der [ShowWindow-Dokumentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow).
[`SetActiveWindow`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setactivewindow)
aktiviert eine Hintergrundanwendung nicht im Vordergrund; die Rückgabe verwendet
[`SetForegroundWindow`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
ohne Umgehung der Windows-Aktivierungsregeln.

Es gibt keinen Größen-, Maximierungs- oder `SW_RESTORE`-Eingriff und keinen
Controller-Bounds-Schreibzugriff. Insbesondere werden die kleinen Clientmaße
eines minimierten Fensters nicht mehr an WebView2 übertragen. Das bestehende
Window-State-Plugin speichert weiterhin die Geometrie; die Korrektur schreibt
keine Einstellungsdatei.

Der Zyklus erfolgt auch nach erfolgreichen Frame-Callbacks: Gerade die schwarzen
Starts hatten diese bereits bestätigt. Ein rAF- oder `ready`-Signal erkennt hier
keine tatsächlich gezeichneten Pixel. Ein gezielter Pixel-Fallback lässt sich
daraus nicht zuverlässig ableiten. Sichtbares kurzes Ausblenden und bis zu
800 ms zusätzlicher Startaufwand sind die bewussten Kosten dieses Workarounds.

Die ursprüngliche 15-Sekunden-Frist umfasst Anzeigen, Frontend-Handshake und
Korrektur gemeinsam. Jeder native UI-Aufruf prüft Versuch, Fehlerstatus und
Frist unmittelbar vor dem Zugriff. Bei Timeout/Fehler bleibt das Splash mit
Wiederholen verfügbar; veraltete Rückmeldungen dürfen weder nach Timeout noch
nach Wiederholung oder `ready` ein Fenster wieder zeigen. Ein wegen eines
Fehlers verborgenes Hauptfenster bleibt bis zum nächsten Startversuch verborgen.

Splash-Fallback, frühes Windows-Logging, Registrierung vor Fenstererzeugung,
Installationserkennung und Übersetzungen bleiben erhalten. Linux und macOS
führen keinen nativen Sichtbarkeitszyklus aus.

## Diagnose

Unter Windows liegt das Log normalerweise unter:

```text
%LOCALAPPDATA%\de.alphatester.music-generator\logs\desktop.log
```

Zusätzlich zu den bisherigen Prozess-/Splash-Meldungen erscheinen:

```text
Main presentation requested ...
Main presentation completed; awaiting frontend frames ...
Main frontend frames acknowledged; pixels unverified ...
Native presentation stage=before_hide visible=... minimized=... maximized=... foreground=... outer_ok=... outer=... client_ok=... client=... ...
Native presentation focus_handoff was_foreground=... splash_available=... handoff_active=... foreground_splash=... ...
Native presentation stage=hidden ...
Native presentation stage=shown ...
Native presentation completed activation_requested=... activation_succeeded=...; pixels unverified ...
```

Bei übersprungener Korrektur steht nach `before_hide`:
`Native presentation skipped: minimized or hidden`. Bei einer während des
Verbergens erfolgten Minimierung erscheinen `stage=minimized_during_hide` und
`Native presentation skipped: minimized during hide`. Alle Einträge enthalten PID,
Versuch und Laufzeit. Rechteckabfragen haben eigene Erfolgsfelder; ein positives
API-Ergebnis wird ausdrücklich nicht als Heilung des Schwarzbilds ausgegeben.
Die alten `WebView2 presentation visible=...`-Einträge entfallen.

## Prüfung der Erstfassung `701e0b2`

System: macOS/arm64, Rust 1.99.1, Node 26.12.0. Automatisierte Tests verwenden
Temp-Verzeichnisse und Mock-/Testdaten. Es wurde keine installierte App mit
produktiven Songs, Modellen oder Einstellungen gestartet.

Erfolgreich:

- `npm run build`, `npm run lint`, `npm test`: 466 Tests in 52 Dateien.
- `npm run test:desktop`: 34 bestanden, ein vorhandener Windows-MSI-Test
  plattformbedingt übersprungen.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib startup::`:
  30 bestanden. Neue Regressionen prüfen die asynchrone 800-ms-Grenze,
  übersprungene Schritte, Fehler, Aktivierungsentscheidungen, ursprüngliche
  Gesamtfrist, Wiederholung, verspätete UI-Aufrufe und doppelte Fertigmeldung.
- Die übrige Rust-Suite besteht mit genau einer umgebungsbedingten Ausnahme:
  `-- --skip mcp::settings::tests::network_scope_rebinds_fixed_port_and_authenticates_real_lan_requests`.
  326 Tests bestehen. Ohne diesen Skip schlägt der unveränderte Test beim Zugriff auf
  `http://10.90.0.0:<port>/mcp` mit `AddrNotAvailable` fehl. Innerhalb der Sandbox
  sind zusätzlich lokale TCP-Listener gesperrt; die Suite wurde deshalb mit
  erlaubten lokalen Ports ausgeführt. Ein bereits ignorierter Test bleibt ignoriert.

Zusätzlich wurden `windows.rs`, `recovery.rs` und deren Tests in einem temporären
Compile-Harness für `x86_64-pc-windows-msvc` mit echten Tauri-2.12.4-/Win32-0.62-APIs
und `cargo clippy ... --tests -- -D warnings` geprüft. Nur der umgebende
Startup-Zustand war im Harness ersetzt; die Windows-Quelldateien waren unverändert.
Die Rust-Standardbibliothek wurde dafür mit `-Z build-std=std,panic_abort` gebaut.
Das prüft native API-Typen und Callback-Lebensdauern, ersetzt aber weder einen
vollständigen Windows-App-/Paketbuild noch das Ausführen der Windows-Tests.

Die Windows-Tests der Erstfassung erzeugen eigene User32-HWNDs und prüfen normale und
maximierte Fensterplatzierung, das Auslassen minimierter Fenster und Minimierung
zwischen Verbergen und Zeigen. Sie sind hier nur kompiliert, nicht ausgeführt.
Keine lokale Windows-/GPU-Abnahme, kein Nachweis gegen schwarze Pixel.

## Nachkorrektur vom 12. November 2026

Die Nachkorrektur integriert `main c982d54` und behält insbesondere idempotente
Fertigmeldungen nach einem Frontend-Reload bei. Die Korrektur darf bei einem
Reload keinen zweiten HWND-Zyklus ausführen. Ein bestehender PR-Test erwartet
nun entsprechend dem neuen Vertrag eine erfolgreiche wiederholte Fertigmeldung,
prüft aber weiterhin genau eine Präsentation und verwirft veraltete UI-Aufrufe.

Zusätzliche Regressionen decken die Aktivierungsentscheidung und einen nativen
User32-Reentranzfall ab: Beim Verbergen wird aus `WM_WINDOWPOSCHANGED` minimiert,
bevor `ShowWindow(SW_HIDE)` zurückkehrt. Der Test verlangt danach Erfolg mit
übersprungener Korrektur sowie ein sichtbares, minimiertes HWND mit unveränderter
normaler Fensterplatzierung. Ein weiterer nativer Test prüft die Aktivierungs-
übergabe an ein eigenes Splash und dass Hintergrundstarts sie unterlassen.
Alle erzeugten HWNDs und Verzeichnisse gehören ausschließlich den Tests.

Lokale Prüfung der Nachkorrektur (macOS/arm64):

- Frontend-Build und ESLint erfolgreich; 517 Frontend-Tests bestanden.
- Desktop-Skripte: 34 bestanden, ein Windows-spezifischer Test übersprungen.
- 33 Startup-/Reload-Tests sowie insgesamt 331 Rust-Tests bestanden. Der bereits
  bekannte LAN-Adapter-Test wurde wie oben beschrieben ausgelassen; zwei bereits
  ignorierte Tests bleiben ignoriert. Die übrige Suite lief mit erlaubten lokalen
  Ports und isolierten temporären Daten.
- Rustfmt und Clippy (`--all-targets -- -D warnings`) erfolgreich.

Die lokalen Startup-/Reload-Tests und die neue Windows-API-Cross-Compile-Prüfung
ersetzen keine Wiederholung der Hardware-Startreihe. Die folgenden Punkte müssen
mit dem neuen PR-Artefakt erneut geprüft werden.

## Noch nötige Windows-Abnahme

In Windows Sandbox oder einem separaten Windows-Testkonto mit eigenen App-Daten,
WebView-Profil und Fensterzustand prüfen. Ein portables ZIP allein isoliert diese
Daten nicht. Vorhandene Nutzerdaten nicht überschreiben oder für die Startreihe
verwenden. Studio und frisches Setup mit separaten Testdaten prüfen.

Auf Windows 10 / GTX 1060 mindestens 50 Starts je Vergleichsstand, abwechselnd
aktuelles `main` und Kandidat, gleicher Pakettyp und Installationsort. ZIP und MSI
getrennt auswerten. Keine kausale Aussage aus einem einzelnen erfolgreichen Start.

1. Zehn normale Starts mit vollständigem Beenden.
2. Zehn schnelle Neustarts nach Alt+F4; alten Prozess vorher vollständig beenden.
3. Zehn Starts mit über die Oberfläche gespeichertem maximiertem Fenster.
4. Zehn Starts mit gespeichertem normalem Fenster; bei Bedarf zweiter Monitor/DPI.
5. Fünf Starts mit Startmenü/anderer App im Vordergrund, insbesondere während des
   verborgenen Intervalls. Kein Zurückholen gegen die Benutzerwahl erwarten. Zusätzlich während des
   verborgenen Intervalls nur den Pointer bewegen: Ohne Vordergrundwechsel soll
   die App nach dem Einblenden weiterhin aktiv sein.
6. Fünf Starts mit Minimierung vor der Korrektur beziehungsweise während des Starts.
   Die im Bericht verwendete schnelle Minimierung etwa 30 ms nach `before_hide`
   zusätzlich gezielt wiederholen und Startfehler getrennt von Schwarzbildern zählen.
   Keine automatische Wiederherstellung erwarten; anschließend manuell wiederherstellen.

Pro Start tatsächliches sichtbares, bedienbares Studio/Setup, Schwarz-/Weißbild,
Fensterzustand, Fokus und Dauer erfassen. Bei Fehler zuerst Screenshot und Log ab
`Startup process pid=...` sichern, dann erst manuell minimieren/wiederherstellen.
Vor und nach normalem/maximiertem Start Position, Größe und gespeicherten Zustand
vergleichen. Ein Song mit Export dient danach als Funktionsprobe.

Die Nachkorrektur bleibt bis zu dieser erneuten Prüfung unbestätigt. Insbesondere sind Wirksamkeit
auf der GTX 1060, Fokusverhalten bei echter Benutzereingabe, Mehrmonitor/DPI,
User32-Laufzeittests und Windows-Paketbuild hier noch offen.
