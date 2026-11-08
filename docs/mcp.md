# Music Generator per MCP steuern

Der optionale MCP-Server steuert die **laufende Desktop-App**. Er verwendet dieselbe Datenbank, dieselben Modellprüfungen, dieselbe Engine und denselben Queue-Worker. Aktionen erscheinen auch in der Oberfläche. Ein MCP-Client startet keine zweite Datenbankinstanz und keine zweite Engine.

## Aktivieren

Den ersten Startassistenten in der Desktop-App abschließen. Unter **Einstellungen → MCP** den Dienst aktivieren, den Zugriff auf **diesen Rechner** oder das **lokale Netzwerk** wählen und mit dem eigenen MCP-Knopf anwenden. Die Auswahl bleibt nach einem App-Neustart erhalten; standardmäßig ist MCP deaktiviert und nur für diesen Rechner konfiguriert.

Der Dienst bietet **Streamable HTTP über TCP**. Neue Profile verwenden Port `32123`; `0` wählt bei jedem Start einen freien Port. Für eine dauerhaft konfigurierte Verbindung einen festen Port verwenden.

Im Netzwerkmodus die Adresse des Rechners auswählen, auf dem Music Generator läuft, zum Beispiel `http://192.168.1.20:32123/mcp`. Der Bereich zeigt den tatsächlichen Dienststatus und die verfügbaren Adressen. Die HTTP-Client-Konfiguration lässt sich direkt kopieren; ein separater stdio-Prozess ist dafür nicht nötig. Zugangsdaten werden erst nach einer ausdrücklichen Benutzeraktion geladen, der Schlüssel wird zunächst verdeckt angezeigt.

MCP-Änderungen gelten sofort und unabhängig vom allgemeinen **Speichern** oder **Abbrechen** des Einstellungsdialogs. Deaktivieren schließt den TCP-Zugang und entfernt die aktuelle Verbindungsdatei. Bereits angenommene Generierungsaufträge bleiben in der gemeinsamen Warteschlange und werden dadurch nicht abgebrochen. Die Desktop-App muss für den Dienst geöffnet bleiben.

### Zugriff im lokalen Netzwerk

- Auf dem anderen Rechner die angezeigte Netzwerkadresse verwenden. `127.0.0.1` bezeichnet immer den eigenen Rechner.
- Der gewählte TCP-Port muss in der Firewall des Music-Generator-Rechners erreichbar sein. Die App ändert keine Firewall-Regeln.
- Der Dienst verwendet HTTP ohne TLS. Nur in einem vertrauenswürdigen Netzwerk verwenden; wer den Zugangsschlüssel besitzt, kann Musik erzeugen und die Bibliothek verwalten.
- Nach einem Netzwerkwechsel den Dienst aus- und wieder einschalten, damit die Adressen neu erkannt werden. Bei mehreren Netzwerkadaptern die vom Client erreichbare Adresse wählen.

### Per Umgebungsvariable

Alternativ die App vollständig beenden und mit `MUSIC_GENERATOR_MCP_PORT` starten. Diese Vorgabe aktiviert ausschließlich den lokalen Zugriff und hat Vorrang vor der gespeicherten Auswahl; die Oberfläche kennzeichnet sie und sperrt Änderungen, solange die App damit läuft. Ohne diese Variable gilt die gespeicherte MCP-Einstellung.

macOS, installiertes Bundle:

```sh
MUSIC_GENERATOR_MCP_PORT=0 "/Applications/Music Generator.app/Contents/MacOS/music-generator"
```

Linux:

```sh
MUSIC_GENERATOR_MCP_PORT=0 ./Music-Generator-0.2.0-linux-x64.AppImage
```

Windows, PowerShell im entpackten Paket:

```powershell
$env:MUSIC_GENERATOR_MCP_PORT = "0"
& ".\Music Generator.exe"
```

Entwicklung:

```sh
MUSIC_GENERATOR_MCP_PORT=0 npm run dev
```

Die Variable muss beim Start des eigentlichen App-Prozesses gesetzt sein; das erneute Öffnen einer bereits laufenden Instanz ändert ihre Konfiguration nicht. Sobald die Dateninitialisierung abgeschlossen ist, schreibt die App `mcp.json` in ihren Datenordner. Die Datei enthält `url`, `token` und `pid`. Die Standardordner stehen in der [README](../README.md#daten-und-updates). Ein Portkonflikt oder ungültige Konfiguration wird in `logs/desktop.log` protokolliert; die Oberfläche bleibt benutzbar.

Der automatisch erzeugte Zugangsschlüssel bleibt in der privaten Datei `mcp-token` erhalten, sodass ein HTTP-Client bei festem Port auch nach einem Dienst- oder App-Neustart verbunden werden kann. `MUSIC_GENERATOR_MCP_TOKEN` kann einen eigenen Schlüssel mit 32–512 Zeichen vorgeben (Buchstaben, Ziffern und `-._~+/=`). Unter Unix sind die Schlüsseldatei und `mcp.json` nur für den aktuellen Benutzer lesbar und schreibbar (`0600`); unter Windows gelten die Zugriffsrechte des persönlichen App-Datenordners. `mcp-settings.json` speichert nur Aktivierung, Port und Zugriffsbereich.

Die kopierte HTTP-Konfiguration enthält den Zugangsschlüssel. Sie gehört in die private Client-Konfiguration, nicht in Git, öffentliche Screenshots oder Logs. Allgemeine Einstellungsabfragen und MCP-Werkzeuge geben den Schlüssel nicht aus.

## MCP-Client verbinden

### Streamable HTTP

Die Konfiguration aus den React-Einstellungen im Client einfügen oder die angezeigte Adresse als MCP-Endpunkt und `Authorization: Bearer <token>` als HTTP-Header konfigurieren. Beispiel für Clients mit diesem JSON-Konfigurationsformat:

```json
{
  "mcpServers": {
    "music-generator": {
      "url": "http://192.168.1.20:32123/mcp",
      "headers": {"Authorization": "Bearer YOUR_RANDOM_TOKEN"}
    }
  }
}
```

Die genauen Feldnamen hängen vom MCP-Client ab. Der Server verwendet das offizielle [Rust-MCP-SDK](https://github.com/modelcontextprotocol/rust-sdk) und unterstützt dessen Protokollverhandlung, einschließlich älterer Clients mit `initialize`. Der Endpunkt liefert JSON-Antworten; Fortschritt wird über Werkzeuge und Ressourcen abgefragt.

Im lokalen Modus wird an `127.0.0.1` gebunden, im Netzwerkmodus an alle IPv4-Schnittstellen. Als Client-Adresse eine der angezeigten IP-Adressen verwenden, nicht die Bindeadresse `0.0.0.0`. Anfragen ohne gültigen Schlüssel, mit einem nicht freigegebenen `Host` oder mit Browser-`Origin` werden abgelehnt. Der Server ist für native MCP-Clients gedacht.

### Optionale lokale stdio-Brücke

Clients mit stdio starten die mitgelieferte Brücke. Die Desktop-App muss bereits mit aktiviertem MCP laufen. Die Brücke liest beim Start die aktuelle Verbindungsdatei; nach einem App-Neustart die MCP-Verbindung neu herstellen. Für macOS:

```json
{
  "mcpServers": {
    "music-generator": {
      "command": "/Applications/Music Generator.app/Contents/MacOS/music-generator",
      "args": [
        "--mcp-stdio",
        "/Users/YOUR_USER/Library/Containers/de.alphatester.music-generator/Data/Library/Application Support/de.alphatester.music-generator/mcp.json"
      ]
    }
  }
}
```

Unter Linux kann die AppImage mit denselben Argumenten verwendet werden. Unter Windows `music-generator-mcp.exe` neben `Music Generator.exe` als `command` verwenden, mit `--mcp-stdio` und dem absoluten Pfad zu `mcp.json`. Der separate Konsolenprozess hält die stdio-Schnittstelle unabhängig vom Windows-GUI-Subsystem.

Es ist keine Node-/Python-Installation nötig. stdout enthält ausschließlich MCP-Nachrichten, Diagnosemeldungen gehen an stderr. Die Brücke verwendet weder einen HTTP-Proxy noch Weiterleitungen und akzeptiert ausschließlich den lokalen Endpunkt. Das Beenden des Clients beendet weder die App noch bereits angenommene Songs.

## Werkzeuge

Die 20 öffentlichen Werkzeuge sind nach Aufgaben gebündelt. `tools/list` ist die verbindliche Beschreibung aller Argumente, Grenzen und Auswirkungen. Unbekannte Felder, falsche Typen und Werte außerhalb der erlaubten Bereiche werden vor der Ausführung zurückgewiesen. Erfolgreiche Ergebnisse stehen in `structuredContent.result` und zusätzlich als Text für ältere Clients. Fachliche Fehler verwenden MCP `isError: true`.

| Bereich | Werkzeuge | Verhalten |
| --- | --- | --- |
| Kontext | `get_context` | Bereitschaft, Hardware, Einstellungen, Iterationsregeln, Queue und Ordner; über `sections` gezielt auswählbar |
| Musik | `generate_music`, `retry_song` | Neue Songs, Varianten mit `source_song_id` und Wiederholungen in die bestehende Queue stellen |
| Songstatus | `get_song` | Metadaten und Ergebnis lesen; mit `wait_seconds` optional auf Abschluss warten |
| Abbruch/Löschen | `cancel_job`, `delete_song` | Einen Song-/Hintergrundauftrag abbrechen; fertige Songs nur mit `confirm: true` löschen |
| Bibliothek | `list_songs`, `update_song` | Suche, Favoriten, Status-/Gruppen-/Ordnerfilter, Titel und Ordnerzuordnung |
| Ordner | `save_folder`, `delete_folder` | Anlegen, umbenennen, entfernen; Liste über `get_context`, Songs bleiben beim Entfernen erhalten |
| Modelle | `list_models`, `set_models`, `download_title_model` | Katalog und Auswahl; `set_models` erlaubt Downloads nur mit `download_missing: true` |
| Einstellungen | `update_settings`, `preview_library_move` | Expert Mode, CPU-Verhalten, Sprachmodellgerät, Exportformat, Timeout und vorab prüfbarer Bibliotheksort |
| Audio | `analyze_audio`, `export_file` | Analyse lokaler Dateien; Audio, Lyrics und ZIP exportieren |
| Übernahme | `preview_import`, `import_library` | Bestehende Installation prüfen und in eine leere Bibliothek importieren |
| Hintergrundaufträge | `get_operations` | Alle aktiven/letzten Aufträge oder einen Auftrag per `operation_id` lesen; Abbruch über `cancel_job` |

Generierung unterstützt Prompt, Stil, Caption, Lyrics, Instrumentalmodus, Titel, Dauer von 10–600 Sekunden, BPM, Tonart, Takt, Sprache, Seed, 1–10 Varianten, 1–200 Iterationen, Varianz, Gruppen, Ordner und konkrete Modellkombinationen. Nicht angegebene Samplingwerte übernehmen die gespeicherten Studio-Werte beziehungsweise die Hardware-/Modellempfehlung. Ein leerer Titel nutzt die automatische lokale Titelvergabe und kann den Download des gemeinsamen Titelmodells auslösen.

`generate_music` mit `source_song_id` übernimmt die gespeicherte Anfrage und erzeugt standardmäßig eine Variante. Direkt mitgegebene Generierungsparameter überschreiben gezielt die geerbten Werte; ohne Quellsong gelten die Studio-Vorgaben. Modelle und Expert-Mode-Regeln werden wie in der Oberfläche geprüft. Bei CPU oder unbekanntem Backend gilt das gespeicherte Verhalten für mehr als 30 Iterationen. Bei `ask` muss der Agent `cpu_iteration_decision: "limit_30"` oder `"continue"` übergeben; eine gespeicherte Begrenzung bleibt maßgeblich. Eine begrenzte Wiederholung erzeugt einen neuen Song und erhält die ursprüngliche Anfrage.

`get_context` liefert standardmäßig den gesamten Arbeitskontext. Für Fortschritt reicht `{"sections":["queue"]}`, für Ordner `{"sections":["folders"]}`. Weitere Bereiche sind `status`, `settings` und `policy`. Eine optionale `selection` erlaubt die Iterationsprüfung für eine andere Modellkombination, `refresh` aktualisiert den Hardwarebeleg.

`list_songs` bietet `limit` (1–100, Standard 25), `offset`, `total` und `next_offset`; auch Bibliotheken mit mehr als 500 Einträgen sind vollständig erreichbar. `folder: "none"` wählt unzugeordnete Songs. `get_song` liest standardmäßig sofort und wartet mit `wait_seconds` höchstens 30 Sekunden. Die Ergebnisstruktur bleibt gleich; `completed`, `timed_out` und `progress` ergänzen die Songdaten. Ein Timeout beendet keinen Song.

Modellinstallation, Titelmodelldownload, Audioanalyse, Import und Export liefern sofort eine `operation_id`. `get_operations` liefert immer eine `operations`-Liste mit `running`, `cancelling`, `completed`, `cancelled` oder `failed`, Fortschritt und Ergebnis. Mit `operation_id` enthält sie nur diesen Auftrag, ohne Filter alle verfügbaren Aufträge. Die letzten 100 Operationsdatensätze werden bis zum App-Neustart aufbewahrt; Songaufträge sind unabhängig davon dauerhaft in der Bibliothek gespeichert. `cancel_job` erwartet `target: "song"` oder `"operation"` und die passende `id`. Abbruch betrifft nur diesen Auftrag; fertige Songs werden dabei niemals gelöscht.

## Typischer Ablauf

1. `get_context` und `list_models` lesen.
2. Bei Bedarf eine vorhandene Modellkombination mit `set_models` aktivieren. Downloads nur ausdrücklich mit `download_missing: true` erlauben und den zurückgegebenen Auftrag verfolgen.
3. `generate_music` aufrufen, beispielsweise:

   ```json
   {
     "prompt": "Ruhige nächtliche Autofahrt mit warmem E-Piano",
     "style": "trip hop, mellow, dub bass",
     "title": "Night Drive",
     "instrumental": true,
     "duration": 30,
     "variants": 2,
     "inference_steps": 20
   }
   ```

4. Für die zurückgegebenen IDs `get_song`, optional mit `wait_seconds: 30`, abfragen. Erst `status: "done"` bestätigt ein fertiges Ergebnis. `result_meta` enthält tatsächliche Dauer und mögliche Warnungen.
5. Optional `update_song` für Favorit/Ordner aufrufen und `export_file` mit `kind: "audio"`, Song-`id` und absolutem `destination` starten. Anschließend `get_operations` mit der `operation_id` bis zum Abschluss abfragen.

## Ressourcen und Prompt

Es gibt JSON-Ressourcen unter `music://status`, `music://settings`, `music://models` und `music://queue`, sowie Templates `music://songs/{id}` und `music://operations/{id}`. Audiopfade gehören zum Computer, auf dem die Desktop-App läuft; Audiodateien werden nicht als große Base64-Blöcke in den Modellkontext kopiert. Der Prompt `create_music` mit Argument `brief` beschreibt den vollständigen Arbeitsablauf.

## Dateizugriff und Grenzen

- Die erste Modelleinrichtung und neue macOS-Ordnerfreigaben erfolgen über die nativen Dialoge. MCP umgeht die App Sandbox nicht. Analyse-, Import- und Exportpfade müssen absolut und für die App zugänglich sein.
- Audioanalyse akzeptiert dieselben Formate wie die Oberfläche und höchstens 60 MiB. Modell-/Konfigurationsarbeiten nutzen dieselbe exklusive Laufzeitsteuerung wie die Oberfläche; Konflikte liefern verständliche Fehler.
- Exporte benötigen eine freie aktive Laufzeit; bereits eingereihte Songs laufen anschließend weiter. Sie nutzen das eingestellte WAV-/MP3-Format; die Dateiendung muss passen. Vorhandene Dateien bleiben ohne `overwrite: true` erhalten. Exporte werden zunächst separat erstellt und erst nach Erfolg veröffentlicht. Datenbank-, Modell- und Original-Song-Verzeichnisse sind als Exportziele gesperrt.
- `update_settings` wartet auf den Abschluss der Änderung, einschließlich eines Bibliotheksumzugs. Einen Umzug vorher mit `preview_library_move` prüfen; er benötigt eine leere Warteschlange.
- MCP steuert Backend-Aufgaben. Native Fensterdialoge, Mikrofonaufnahme, UI-Layout und Playerbedienung bleiben in der Oberfläche.
- Große Downloads und echte Musikberechnung benötigen weiterhin passende Modelle, Speicher und Rechenzeit. Die automatisierten MCP-Integrationstests verwenden eine isolierte Bibliothek und einen simulierten Tauri-Fensterlaufzeitkern; sie behaupten keine neue Hardware-/Audioabnahme.

## Entwicklung und Tests

Rust 1.88+ ist für das MCP-SDK erforderlich. Nach `npm ci` und `npm run build`:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
```

Die MCP-Tests prüfen Schema-/Protokollverhalten, echte lokale HTTP-Anfragen, Authentifizierung und Größenlimits, gemeinsame Bibliotheksänderungen, CPU-Regeln, Abbruchrennen, Seitennavigation, asynchrone Ergebnisse sowie Exportveröffentlichung ohne unbeabsichtigtes Überschreiben.
