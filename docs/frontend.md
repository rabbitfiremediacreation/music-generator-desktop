# React-Frontend

Die Hauptoberfläche und das separate Splash-Webview werden mit React 19 und TypeScript gerendert. Vite baut weiterhin zwei HTML-Einstiege. `launch.ts` prüft zunächst `startup_allowed`; Import- und Initialisierungsfehler werden über `startup_error` an das Splash gemeldet. Dessen statische Startdarstellung überbrückt das Laden des React-Moduls.

## Navigation und Zustand

TanStack Router verwendet typisierte, programmatisch definierte Routen mit Hash-History: `/setup` und `/studio`. Die Root-Route lädt Bootstrap genau einmal pro Fenster. Ein erforderliches Setup sperrt direkte Studio-Navigation. Die fertige Setup-Prüfung bleibt sichtbar, bis „Studio öffnen“ gewählt wird.

Das Desktop-Layout hält den Studiozustand bei einem Besuch des Assistenten gemountet. Formularentwurf, historische Modellwahl, Bibliotheksfilter und Player bleiben erhalten. Erst ein erfolgreich abgeschlossener Assistent übernimmt die bestätigte Modellkonfiguration. `startup_complete` folgt auf das initialisierte Setup beziehungsweise die initiale Bibliothek, Formpräferenzen und Modellauswahl.

Unter macOS öffnen `⌘,` und **Music Generator → Einstellungen…** denselben Settings-Dialog wie das Zahnrad. Der native Menüeintrag folgt der Sprache der Oberfläche und ist während des Setups oder anderer blockierender Aktionen deaktiviert. Wiederholtes Öffnen behält den aktuellen Einstellungsentwurf.

**Einstellungen → Modelle und Hardware** zeigt zuerst die installierten lokalen Modelle mit Typ, Quantisierung, Größe und Prüfstatus. Vollständig geprüfte, erlaubte Profile lassen sich direkt aus der Liste aktivieren. „Modell hinzufügen“ öffnet den Downloader als zusätzlichen modalen Dialog; Escape oder Schließen kehrt zur installierten Liste zurück und erhält den Settings-Entwurf. „Modelle wählen“ im Studio öffnet dieselbe Settings-Seite. Modellaktionen werden sofort angewendet. „Expert Mode übernehmen“ speichert nur diese Einstellung, ohne den Dialog zu schließen. Laufende Downloads bleiben nach Schließen des Zusatzdialogs auf der Settings-Seite sichtbar und abbrechbar; währenddessen bleiben Generierungszugänge gesperrt.

Der zusätzliche Downloader-Dialog zeigt links durchsuchbare Klangmodellfamilien mit Filtern für alle, geprüfte installierte und hardwareempfohlene Modelle. Rechts stehen Varianten/Quantisierung, Sprachmodell, Dateigröße, Ressourcenbedarf und die benötigten Dateien. Ein Klick in die Liste ändert nur den Entwurf; erst die Download-/Übernehmen-Aktion aktiviert ihn. Auf schmalen Flächen stehen Liste und Details untereinander. Recheneinheit und Expert Mode bleiben unterhalb der installierten Liste in den Settings erreichbar.

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

Nach `npm ci` prüfen `npm run check`, `npm run lint`, `npm test` und `npm run build` das Frontend. `npm run dev` baut zuerst die eingebettete Handy-Oberfläche und startet dann Vite unter `http://127.0.0.1:1420` sowie die native App. React Fast Refresh übernimmt Komponentenänderungen direkt im App-Fenster; CSS-Änderungen werden ebenfalls ohne Neustart geladen. `npm run dev:frontend` startet nur Vite. Änderungen an der Handy-Oberfläche benötigen erneut `npm run build:mobile`, da das Rust-Backend diese Dateien einbettet. Die vorhandenen Desktop- und Rust-Prüfungen bleiben erforderlich.

Wenn Vite statt Fast Refresh einen vollständigen Seitenreload auslöst, verbindet sich das neue Dokument mit dem bereits gestarteten Backend. Es lädt die aktuellen Bootstrap-Daten ohne erneute Dateninitialisierung oder Warten auf laufende Generierungen. Der abgeschlossene native Start bleibt `ready`; wiederholte Aufrufe von `startup_show_main` und `startup_complete` desselben Versuchs sind dann wirkungslos. Veraltete und fehlgeschlagene Versuche bleiben gesperrt. Das verhindert den stillen UI-Abbruch durch `startup_attempt_expired` nach einem Reload; der Windows-Darstellungsfehler aus Issue #53 ist damit nicht als behoben nachgewiesen.

Neue Verhaltenstests laufen mit React Testing Library und Happy DOM an gerenderter Oberfläche und öffentlicher Tauri-Grenze. Router, Provider und QueryClient bleiben echt; IPC, Fenster- und Medienressourcen werden an der Systemgrenze simuliert. Reine Fachtests bleiben getrennt. Die Tests decken insbesondere Navigation, Cache-Aktualisierung, Ereignisrennen, StrictMode-Bereinigung, Speicherschutz und Sprachwechsel ab. Sie ersetzen keine native Plattform-, Mikrofon- oder Screenreader-Abnahme.
