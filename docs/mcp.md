# Music Generator per MCP steuern

Der optionale MCP-Server steuert die **laufende Desktop-App**. Er verwendet dieselbe Datenbank, dieselben Modellprüfungen, dieselbe Engine und denselben Queue-Worker. Aktionen erscheinen auch in der Oberfläche. Ein MCP-Client startet keine zweite Datenbankinstanz und keine zweite Engine.

## Aktivieren

Den ersten Startassistenten in der Desktop-App abschließen. Die App vollständig beenden und mit `MUSIC_GENERATOR_MCP_PORT` starten. `0` wählt einen freien lokalen Port, eine Zahl wie `32123` einen festen Port. Ohne diese Variable bleibt MCP deaktiviert.

macOS, installiertes Bundle:

```sh
MUSIC_GENERATOR_MCP_PORT=0 "/Applications/Music Generator.app/Contents/MacOS/music-generator"
```

Linux:

```sh
MUSIC_GENERATOR_MCP_PORT=0 ./Music-Generator-0.1.2-linux-x64.AppImage
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

Pro Start wird ein zufälliger Schlüssel erzeugt. Für einen dauerhaft konfigurierten HTTP-Client kann `MUSIC_GENERATOR_MCP_TOKEN` auf einen eigenen zufälligen Schlüssel mit 32–512 Zeichen gesetzt werden (Buchstaben, Ziffern und `-._~+/=`). Schlüssel nicht in Git einchecken oder in Screenshots aufnehmen. Unter Unix ist `mcp.json` nur für den aktuellen Benutzer lesbar und schreibbar (`0600`); unter Windows gelten die Zugriffsrechte des persönlichen App-Datenordners.

## MCP-Client verbinden

### Streamable HTTP

Die `url` aus `mcp.json` als MCP-Endpunkt und `Authorization: Bearer <token>` als HTTP-Header konfigurieren. Beispiel für Clients mit diesem JSON-Konfigurationsformat:

```json
{
  "mcpServers": {
    "music-generator": {
      "url": "http://127.0.0.1:32123/mcp",
      "headers": {"Authorization": "Bearer YOUR_RANDOM_TOKEN"}
    }
  }
}
```

Die genauen Feldnamen hängen vom MCP-Client ab. Der Server verwendet das offizielle [Rust-MCP-SDK](https://github.com/modelcontextprotocol/rust-sdk) und unterstützt dessen Protokollverhandlung, einschließlich älterer Clients mit `initialize`. Der Endpunkt liefert JSON-Antworten; Fortschritt wird über Werkzeuge und Ressourcen abgefragt.

Es wird ausschließlich an `127.0.0.1` gebunden. Verwende genau diese Adresse, nicht `localhost`. Anfragen ohne gültigen Schlüssel, mit fremdem `Host` oder mit Browser-`Origin` werden abgelehnt. Der Server ist für lokale native MCP-Clients gedacht.

### stdio

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

`tools/list` ist die verbindliche Beschreibung aller Argumente, Grenzen und Auswirkungen. Unbekannte Felder, falsche Typen und Werte außerhalb der erlaubten Bereiche werden vor der Ausführung zurückgewiesen. Erfolgreiche Ergebnisse stehen in `structuredContent.result` und zusätzlich als Text für ältere Clients. Fachliche Fehler verwenden MCP `isError: true`.

| Bereich | Werkzeuge | Verhalten |
| --- | --- | --- |
| Zustand | `get_status`, `get_settings`, `get_generation_policy` | Bereitschaft, Hardware, Engine, Einstellungen und Iterationsregeln lesen |
| Musik | `generate_music`, `create_variants`, `retry_song` | Neue Aufträge mit Modell-Snapshot in die bestehende Queue stellen |
| Fortschritt | `get_queue`, `get_song`, `wait_song` | Aufträge, Berechnungsphase, Ergebnis und lokalen Audiopfad lesen |
| Abbruch/Löschen | `cancel_song`, `delete_song` | Abbruch ohne Löschen fertiger Ergebnisse; Löschen nur für abgeschlossene Aufträge mit `confirm: true` |
| Bibliothek | `list_songs`, `update_song` | Suche, Favoriten, Status-/Gruppen-/Ordnerfilter, Titel und Ordnerzuordnung |
| Ordner | `list_folders`, `save_folder`, `delete_folder` | Anlegen, umbenennen, entfernen; beim Entfernen bleiben Songs erhalten |
| Modelle | `list_models`, `select_models`, `install_models`, `download_title_model` | Katalog, Hardwareempfehlungen, geprüfte Auswahl und Downloads |
| Einstellungen | `update_settings`, `preview_library_move` | Expert Mode, CPU-Verhalten, Sprachmodellgerät, Exportformat, Timeout und vorab prüfbarer Bibliotheksort |
| Audio | `analyze_audio`, `export_file` | Analyse lokaler Dateien; Audio, Lyrics und ZIP exportieren |
| Übernahme | `preview_import`, `import_library` | Bestehende Installation prüfen und in eine leere Bibliothek importieren |
| Hintergrundaufträge | `get_operation`, `list_operations`, `cancel_operation` | Fortschritt, Ergebnis, Fehler, Wiederfinden nach Verbindungsabbruch und gezielten Abbruch längerer Aktionen |

Generierung unterstützt Prompt, Stil, Caption, Lyrics, Instrumentalmodus, Titel, Dauer von 10–600 Sekunden, BPM, Tonart, Takt, Sprache, Seed, 1–10 Varianten, 1–200 Iterationen, Varianz, Gruppen, Ordner und konkrete Modellkombinationen. Nicht angegebene Samplingwerte übernehmen die gespeicherten Studio-Werte beziehungsweise die Hardware-/Modellempfehlung. Ein leerer Titel nutzt die automatische lokale Titelvergabe und kann den Download des gemeinsamen Titelmodells auslösen.

`create_variants` übernimmt die gespeicherte Anfrage und erlaubt gezielte `overrides`. Modelle und Expert-Mode-Regeln werden wie in der Oberfläche geprüft. Bei CPU oder unbekanntem Backend gilt das gespeicherte Verhalten für mehr als 30 Iterationen. Bei `ask` muss der Agent `cpu_iteration_decision: "limit_30"` oder `"continue"` übergeben; eine gespeicherte Begrenzung bleibt maßgeblich. Eine begrenzte Wiederholung erzeugt einen neuen Song und erhält die ursprüngliche Anfrage.

`list_songs` bietet `limit` (1–100, Standard 25), `offset`, `total` und `next_offset`; auch Bibliotheken mit mehr als 500 Einträgen sind vollständig erreichbar. `folder: "none"` wählt unzugeordnete Songs. `wait_song` wartet höchstens 30 Sekunden. Ein Timeout beendet keinen Song.

Modellinstallation, Titelmodelldownload, Audioanalyse, Import und Export liefern sofort eine `operation_id`. `get_operation` liefert `running`, `cancelling`, `completed`, `cancelled` oder `failed`, Fortschritt und Ergebnis. Die letzten 100 Operationsdatensätze werden bis zum App-Neustart aufbewahrt; Songaufträge sind unabhängig davon dauerhaft in der Bibliothek gespeichert. Abbruch betrifft nur den gewählten MCP-Auftrag. Bereits veröffentlichte Ergebnisse werden durch eine spätere Abbruchanfrage nicht entfernt.

## Typischer Ablauf

1. `get_status`, `list_models` und `get_generation_policy` lesen.
2. Bei Bedarf eine vorhandene Modellkombination mit `select_models` aktivieren. Downloads über `install_models` ausdrücklich starten und den Auftrag verfolgen.
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

4. Für die zurückgegebenen IDs `wait_song` oder `get_song` abfragen. Erst `status: "done"` bestätigt ein fertiges Ergebnis. `result_meta` enthält tatsächliche Dauer und mögliche Warnungen.
5. Optional `update_song` für Favorit/Ordner aufrufen und `export_file` mit `kind: "audio"`, Song-`id` und absolutem `destination` starten. Anschließend `get_operation` bis zum Abschluss abfragen.

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
