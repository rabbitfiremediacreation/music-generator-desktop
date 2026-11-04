# React-Frontend

Die Hauptoberfläche und das separate Splash-Webview werden mit React 19 und TypeScript gerendert. Vite baut weiterhin zwei HTML-Einstiege. `launch.ts` prüft zunächst `startup_allowed`; Import- und Initialisierungsfehler werden über `startup_error` an das Splash gemeldet. Dessen statische Startdarstellung überbrückt das Laden des React-Moduls.

## Navigation und Zustand

TanStack Router verwendet typisierte, programmatisch definierte Routen mit Hash-History: `/setup` und `/studio`. Die Root-Route lädt Bootstrap genau einmal pro Fenster. Ein erforderliches Setup sperrt direkte Studio-Navigation. Die fertige Setup-Prüfung bleibt sichtbar, bis „Studio öffnen“ gewählt wird.

Das Desktop-Layout hält den Studiozustand bei einem Besuch des Assistenten gemountet. Formularentwurf, historische Modellwahl, Bibliotheksfilter und Player bleiben erhalten. Erst ein erfolgreich abgeschlossener Assistent übernimmt die bestätigte Modellkonfiguration. `startup_complete` folgt auf das initialisierte Setup beziehungsweise die initiale Bibliothek, Formpräferenzen und Modellauswahl.

Backend-Daten liegen in TanStack Query. Lokale Formulare, Dialogentwürfe und Darstellungsoptionen liegen in React. Die SQLite-Datenbank bleibt die dauerhafte Quelle; es gibt keine zusätzliche persistierte Query-Datenbank. Sämtliche lokalen IPC-Queries und Mutations verwenden `networkMode: "always"`. Schreibende Aktionen werden nicht automatisch wiederholt.

## Queries und Ereignisse

`react/data.ts` definiert gemeinsame Query Keys und Optionen. Songs werden einschließlich Suche, Favoriten und Ordner gefiltert abgelegt; Details, Ordner, Queue, Settings, Katalog, Richtlinie, Formpräferenzen und Health haben getrennte Schlüssel. Mutations invalidieren die betroffenen Domänen. Partielle Schreibantworten ersetzen keine vollständig angereicherten Lesedaten.

Die Event-Bridge registriert Tauri-Listener vor dem ersten Bibliotheksabruf:

| Ereignis | Wirkung |
| --- | --- |
| `library-changed` | Nach 100 ms gebündelt Songs, Details, Ordner und Queue aktualisieren; Ereignisse während Abrufen nachholen |
| `generation-progress` | Fortschritt je Job mit monotoner Sequenz; Queue-Snapshot ergänzt Wiederherstellung |
| `settings-changed`, `models-changed` | Settings, Katalog, Richtlinie und Health gezielt invalidieren |
| `setup-progress`, `setup-stage` | Assistentenfortschritt im Query Cache |
| `model-download-progress`, `import-progress` | Download- und Importfortschritt im Query Cache |

Bei Listenerfehlern oder fehlgeschlagenen Bibliotheksabrufen werden temporär alle 1,5 Sekunden Snapshots nachgeladen; die Verbindung wird nach 3 Sekunden erneut aufgebaut. Wiederverbindung löst einen frischen Snapshot aus. Im fehlerfreien Leerlauf gibt es kein Bibliothekspolling. Health wird im Studio alle 15 Sekunden geprüft. Eine autoritative neue Policy verwirft ältere Healthantworten; neuere bestätigte Ausführung oder ein gestoppter Prozess behalten Vorrang.

Alle Listener, verspätet abgeschlossenen Registrierungen und Timer werden beim Unmount bereinigt. WaveSurfer, ResizeObserver, Recorder und Mikrofonstreams haben ebenfalls explizite Lebenszyklen. Die Generierungszugänge teilen ein einziges Admission-Gate für frische Richtlinien, CPU-Bestätigung, Settings-Sperren und Duplikatschutz.

## Übersetzungen und Styles

Die zwölf vorhandenen Kataloge werden zentral registriert. `useI18n()` stellt Sprache, Setter und Übersetzung bereit; native Dialogadapter verwenden dieselbe Sprachauswahl. Gespeicherte Sprache hat Vorrang vor Systemsprache und Englisch. Der Textfallback bleibt gewählte Sprache → Englisch → Deutsch → Schlüssel. Neue Meldungen müssen in allen zwölf Sprachen vorliegen.

Tailwind 4 verarbeitet `react/styles.css` über das Vite-Plugin; Dateien in `static/` werden unverändert kopiert. Gemeinsame Komponentenklassen liegen in Tailwind-Layern. Spezialstyles für Slider, Waveform, reduzierte Animationen und native Fensterleisten bleiben CSS. Die Layoutoptionen `auto`, `stack`, `side` sowie der Zweispalten-Breakpoint bei 1000 px bleiben erhalten.

## Entwickeln und prüfen

Nach `npm ci` prüfen `npm run check`, `npm run lint`, `npm test` und `npm run build` das Frontend. `npm run dev` startet die native App mit eingebauten Assets; nach Quelländerungen neu bauen/starten. Die vorhandenen Desktop- und Rust-Prüfungen bleiben erforderlich.

Neue Verhaltenstests laufen mit React Testing Library und Happy DOM an gerenderter Oberfläche und öffentlicher Tauri-Grenze. Router, Provider und QueryClient bleiben echt; IPC, Fenster- und Medienressourcen werden an der Systemgrenze simuliert. Reine Fachtests bleiben getrennt. Die Tests decken insbesondere Navigation, Cache-Aktualisierung, Ereignisrennen, StrictMode-Bereinigung, Speicherschutz und Sprachwechsel ab. Sie ersetzen keine native Plattform-, Mikrofon- oder Screenreader-Abnahme.
