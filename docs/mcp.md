# Music Generator per MCP steuern

Der optionale MCP-Server steuert die **laufende Desktop-App**. Er verwendet dieselbe Datenbank, dieselben Modellprüfungen, dieselbe Engine und denselben Queue-Worker. Aktionen erscheinen auch in der Oberfläche. Ein MCP-Client startet keine zweite Datenbankinstanz und keine zweite Engine.

## Aktivieren

Den ersten Startassistenten in der Desktop-App abschließen. Unter **Einstellungen → MCP** den Dienst aktivieren, den Zugriff auf **diesen Rechner** oder das **lokale Netzwerk** wählen und mit dem eigenen MCP-Knopf anwenden. Die Auswahl bleibt nach einem App-Neustart erhalten; standardmäßig ist MCP deaktiviert und nur für diesen Rechner konfiguriert.

Der Dienst bietet **Streamable HTTP** über Loopback-HTTP oder über HTTPS im Netzwerkmodus. Neue Profile verwenden Port `32123`; `0` wählt bei jedem Start einen freien Port. Für eine dauerhaft konfigurierte Verbindung einen festen Port verwenden.

Im Netzwerkmodus die Adresse des Rechners auswählen, auf dem Music Generator läuft, zum Beispiel `https://192.168.1.20:32123/mcp`. Der Bereich zeigt den tatsächlichen Dienststatus und die verfügbaren Adressen. Die HTTP-Client-Konfiguration lässt sich direkt kopieren; ein separater stdio-Prozess ist dafür nicht nötig. Zugangsdaten werden erst nach einer ausdrücklichen Benutzeraktion geladen, der Schlüssel wird zunächst verdeckt angezeigt.

MCP-Änderungen gelten sofort und unabhängig vom allgemeinen **Speichern** oder **Abbrechen** des Einstellungsdialogs. Deaktivieren schließt den TCP-Zugang und entfernt die aktuelle Verbindungsdatei. Bereits angenommene Generierungsaufträge bleiben in der gemeinsamen Warteschlange und werden dadurch nicht abgebrochen. Die Desktop-App muss für den Dienst geöffnet bleiben.

### Zugriff im lokalen Netzwerk

- Auf dem anderen Rechner die angezeigte Netzwerkadresse verwenden. `127.0.0.1` bezeichnet immer den eigenen Rechner.
- Der gewählte TCP-Port muss in der Firewall des Music-Generator-Rechners erreichbar sein. Die App ändert keine Firewall-Regeln.
- Der Netzwerkmodus verlangt TLS. Der Client prüft die Zertifikatskette und die IP-Adresse in der URL. Wer den Zugangsschlüssel besitzt, kann Musik erzeugen und die Bibliothek verwalten.
- Nach einem Netzwerkwechsel den Dienst aus- und wieder einschalten, damit die Adressen neu erkannt werden. Die App filtert ungeeignete IPv4-Adressen des Rechners. Gibt es mehrere nutzbare LAN-Adressen, wähle vor dem Kopieren die Adresse, die dein Client erreichen kann. Genau diese Adresse steht in der kopierten HTTPS-Konfiguration.

### Bestehende LAN-Clients auf HTTPS umstellen

1. Deaktiviere MCP und ersetze den bisherigen, über HTTP verwendeten Schlüssel. Für den automatisch erzeugten Schlüssel die App beenden, `mcp-token` im App-Datenordner entfernen und die App neu starten. Bei Verwendung von `MUSIC_GENERATOR_MCP_TOKEN` den Wert in der Startumgebung ersetzen. Anschließend MCP wieder im Netzwerkmodus aktivieren.
2. Kopiere **nur** `mcp-lan-tls/certificate.crt` aus dem App-Datenordner über einen vertrauenswürdigen Weg zum Client. Das ist das öffentliche CA-Zertifikat im DER-Format. Vergleiche den SHA-256-Wert der Kopie mit dem Fingerabdruck in **Einstellungen → MCP**. Mit OpenSSL: `openssl x509 -inform DER -in certificate.crt -noout -fingerprint -sha256`.
3. Importiere die CA in den Vertrauensspeicher, den der konkrete MCP-Client für TLS verwendet. Manche Clients nutzen einen eigenen Speicher. Für einen Client, dessen Prozess eine PEM-Datei erwartet, konvertiere mit `openssl x509 -inform DER -in certificate.crt -out music-generator-mcp-ca.pem`. Verwende einen Client, der die CA und die IP-Adresse prüft.
4. Kopiere die neue HTTPS-Konfiguration aus den MCP-Einstellungen. Ersetze den alten HTTP-Endpunkt und den alten Schlüssel; verwende genau die angezeigte IP-Adresse. Bei einem Zertifikatsfehler prüfe CA und Adresse und lass die Zertifikatsprüfung aktiv.

Die MCP-CA gehört zum Desktop-Datenprofil und ist von der Handy-CA unabhängig. Beim Wiedereinschalten wird ein Serverzertifikat für die aktuellen Adressen ausgestellt. Nach einem Profilwechsel oder Verlust der CA ist ein neuer Vertrauensaufbau nötig. Bis zur Umstellung kann ein Client auf demselben Rechner den Modus **Dieser Rechner** oder die mitgelieferte lokale stdio-Brücke nutzen.

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

Die Variable muss beim Start des eigentlichen App-Prozesses gesetzt sein; das erneute Öffnen einer bereits laufenden Instanz ändert ihre Konfiguration nicht. Sobald die Dateninitialisierung abgeschlossen ist, schreibt die App `mcp.json` in ihren Datenordner. Die Datei enthält `url`, `token` und `pid`. Im Netzwerkmodus enthält sie zusätzlich das öffentliche CA-Zertifikat für die lokale Brücke. Die Standardordner stehen in der [README](../README.md#daten-und-updates). Ein Portkonflikt oder ungültige Konfiguration wird in `logs/desktop.log` protokolliert; die Oberfläche bleibt benutzbar.

Der automatisch erzeugte Zugangsschlüssel bleibt in der privaten Datei `mcp-token` erhalten, sodass ein HTTP-Client bei festem Port auch nach einem Dienst- oder App-Neustart verbunden werden kann. `MUSIC_GENERATOR_MCP_TOKEN` kann einen eigenen Schlüssel mit 32–512 Zeichen vorgeben (Buchstaben, Ziffern und `-._~+/=`). Unter Unix sind die Schlüsseldatei und `mcp.json` nur für den aktuellen Benutzer lesbar und schreibbar (`0600`); unter Windows gelten die Zugriffsrechte des persönlichen App-Datenordners. `mcp-settings.json` speichert nur Aktivierung, Port und Zugriffsbereich.

Die kopierte HTTP-Konfiguration enthält den Zugangsschlüssel. Sie gehört in die private Client-Konfiguration, nicht in Git, öffentliche Screenshots oder Logs. Allgemeine Einstellungsabfragen und MCP-Werkzeuge geben den Schlüssel nicht aus.

## MCP-Client verbinden

### Streamable HTTP

Die Konfiguration aus den React-Einstellungen im Client einfügen oder die angezeigte Adresse als MCP-Endpunkt und `Authorization: Bearer <token>` als HTTP-Header konfigurieren. Beispiel für Clients mit diesem JSON-Konfigurationsformat:

```json
{
  "mcpServers": {
    "music-generator": {
      "url": "https://192.168.1.20:32123/mcp",
      "headers": {"Authorization": "Bearer YOUR_RANDOM_TOKEN"}
    }
  }
}
```

Die genauen Feldnamen hängen vom MCP-Client ab. Der Server verwendet das offizielle [Rust-MCP-SDK](https://github.com/modelcontextprotocol/rust-sdk) und unterstützt dessen Protokollverhandlung, einschließlich älterer Clients mit `initialize`. Der Endpunkt liefert JSON-Antworten; Fortschritt wird über Werkzeuge und Ressourcen abgefragt.

Im lokalen Modus bleibt `http://127.0.0.1:PORT/mcp` verfügbar. Im Netzwerkmodus wird HTTPS an alle IPv4-Schnittstellen einschließlich Loopback gebunden. Als Client-Adresse eine der angezeigten IP-Adressen verwenden, nicht die Bindeadresse `0.0.0.0`. Anfragen ohne gültigen Schlüssel, mit einem nicht freigegebenen `Host` oder mit Browser-`Origin` werden abgelehnt. Der Server ist für native MCP-Clients gedacht.

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

Es ist keine Node-/Python-Installation nötig. stdout enthält ausschließlich MCP-Nachrichten, Diagnosemeldungen gehen an stderr. Die Brücke verbindet sich direkt mit dem Loopback-Endpunkt ohne Proxy oder Weiterleitungen. Im Netzwerkmodus prüft sie das Zertifikat gegen die CA aus der lokalen Verbindungsdatei und prüft die Loopback-IP. Das Beenden des Clients beendet weder die App noch bereits angenommene Songs.

## Werkzeuge

`tools/list` ist die verbindliche Beschreibung aller Argumente, Grenzen und Auswirkungen. Unbekannte Felder, falsche Typen und Werte außerhalb der erlaubten Bereiche werden vor der Ausführung zurückgewiesen. Erfolgreiche Ergebnisse stehen in `structuredContent.result` und zusätzlich als Text für ältere Clients. Fachliche Fehler verwenden MCP `isError: true`.

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
| Stem-Modelle | `list_stem_models`, `set_stem_model` | Trennprofile und Engine prüfen, installierte Revision aktivieren oder die Katalogrevision samt Engine einrichten |
| Trennung | `separate_song`, `list_stem_jobs`, `get_stem_job`, `cancel_stem_job`, `retry_stem_job` | Audioquelle und Zeitbereich trennen, Vorschau erzeugen, Projekt verfolgen und erneut starten |
| Mixer | `list_stem_mixes`, `save_stem_mix`, `add_stem_track`, `generate_stem_track` | Mischfassungen lesen und speichern, externe oder mit ACE-Step erzeugte Spuren als Kanal hinzufügen |
| Stem-Reparatur | `scan_stem_artifacts`, `preview_stem_repair`, `repair_stem_track` | Spur durchsuchen, Vorher-Nachher-WAVs erzeugen und eine ausgerichtete Ersatzspur rendern |
| Stem-Export | `export_stems`, `list_stem_exports`, `get_stem_export`, `cancel_stem_export` | Einzelspuren, Mix oder ZIP rendern und lokale Ergebnisdateien ermitteln |
| Hintergrundaufträge | `get_operations` | Alle aktiven/letzten Aufträge oder einen Auftrag per `operation_id` lesen; Abbruch über `cancel_job` |

`list_models` mit `{"view":"installed"}` liefert vollständig verifizierte Modellkombinationen mit `selection`, Ausgabetyp, Verfügbarkeit und gegebenenfalls dem Grund einer Sperre. Ohne Argumente liefert das Tool den vollständigen Katalog. Für einen Modellvergleich pro Profil dessen `selection` an `get_context` mit `sections: ["policy"]` übergeben und anschließend als `model_selection` in einem eigenen `generate_music`-Aufruf verwenden. Jeder Song speichert seine Modellwahl. `set_models` ändert die Studio-Voreinstellung.

Die Fähigkeiten des gewählten Profils bestimmen Dauer, Varianten und Eingaben. Dazu gehören je nach Profil Prompt, Stil, Lyrics, Instrumentalmodus, Seed, Taktzahl für kurze Clips oder YuE2-Samplingparameter. Text2midi liefert MIDI. ACE-Step übernimmt ausgelassene Samplingwerte aus dem Studio oder der Hardwareempfehlung. Bei einem leeren Titel kann ACE-Step das gemeinsame Titelmodell herunterladen.

`generate_music` mit `source_song_id` übernimmt die gespeicherte Anfrage und erzeugt standardmäßig eine Variante. Direkt mitgegebene Generierungsparameter überschreiben gezielt die geerbten Werte; ohne Quellsong gelten die Studio-Vorgaben. Modelle und Expert-Mode-Regeln werden wie in der Oberfläche geprüft. Bei CPU oder unbekanntem Backend gilt das gespeicherte Verhalten für mehr als 30 Iterationen. Bei `ask` muss der Agent `cpu_iteration_decision: "limit_30"` oder `"continue"` übergeben; eine gespeicherte Begrenzung bleibt maßgeblich. Eine begrenzte Wiederholung erzeugt einen neuen Song und erhält die ursprüngliche Anfrage.

`get_context` liefert standardmäßig den gesamten Arbeitskontext. Für Fortschritt reicht `{"sections":["queue"]}`, für Ordner `{"sections":["folders"]}`. Weitere Bereiche sind `status`, `settings` und `policy`. Eine optionale `selection` erlaubt die Iterationsprüfung für eine andere Modellkombination, `refresh` aktualisiert den Hardwarebeleg.

`list_songs` bietet `limit` (1–100, Standard 25), `offset`, `total` und `next_offset`; auch Bibliotheken mit mehr als 500 Einträgen sind vollständig erreichbar. `folder: "none"` wählt unzugeordnete Songs. `get_song` liest standardmäßig sofort und wartet mit `wait_seconds` höchstens 30 Sekunden. Die Ergebnisstruktur bleibt gleich; `completed`, `timed_out` und `progress` ergänzen die Songdaten. Ein Timeout beendet keinen Song.

Modellinstallation, Titelmodelldownload, Audioanalyse, Import und Export liefern sofort eine `operation_id`. `get_operations` liefert immer eine `operations`-Liste mit `running`, `cancelling`, `completed`, `cancelled` oder `failed`, Fortschritt und Ergebnis. Mit `operation_id` enthält sie nur diesen Auftrag, ohne Filter alle verfügbaren Aufträge. Die letzten 100 Operationsdatensätze werden bis zum App-Neustart aufbewahrt; Songaufträge sind unabhängig davon dauerhaft in der Bibliothek gespeichert. `cancel_job` erwartet `target: "song"` oder `"operation"` und die passende `id`. Abbruch betrifft nur diesen Auftrag; fertige Songs werden dabei niemals gelöscht.

## Typischer Ablauf

1. `list_models` mit `{"view":"installed"}` und die Generierungsregeln über `get_context` lesen.
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

## Vom Song zum Stem-Mix

1. Mit `list_stem_models` die verfügbaren Rollen und den Status des Trennmodells prüfen. Für eine Installation `set_stem_model` mit `download_missing: true` aufrufen. In `pin` gehören `model` (die Katalog-`id`), `repository` und `revision`. Das Tool richtet bei Bedarf auch die Trenn-Engine ein. Den Auftrag mit `get_operations` verfolgen.
2. `separate_song` nimmt genau eine Quelle entgegen. `song_id` bezeichnet einen Bibliothekstitel, `source_id` die verwaltete Quelle eines früheren Projekts und `path` eine zugängliche Audiodatei auf dem Desktop-Rechner. Das folgende Beispiel trennt acht Sekunden Gesang und Begleitung.

   ```json
   {"song_id":"SONG_ID","model_id":"htdemucs","name":"Refrain","start":12,"end":20,"preview":true,"outputs":["vocals","instrumental"]}
   ```

3. Mit der zurückgegebenen Projekt-ID `get_stem_job` aufrufen. Bei `status: "done"` liefert `include_mix: true` den `default_mix` mit den tatsächlichen Kanälen und dem vollständigen Framebereich. Für eine vorhandene Fassung `list_stem_mixes` verwenden.
4. Im Mix beispielsweise am Kanal `vocals` den Wert `gain_db` auf `-3` setzen. Kanal-EQ, Kompressor, Limiter, Stereobreite und Filter stehen in `fx`. `first` und das exklusive `end` verwenden Projektframes, Fades verwenden Sekunden. Mit `save_stem_mix` Projekt-`id`, `name` und den bearbeiteten `mix` speichern. Zum Aktualisieren die ID der Fassung im Feld `version` mitsenden.
5. Die ID der gespeicherten Fassung als `version_id` an `export_stems` übergeben. Der Export übernimmt ihren Zustand beim Einreihen. Bei Einzelspuren und Paketen übernimmt er die Export-Häkchen, wenn `selected` fehlt. Auch ein direkt übergebener `mix` wird unterstützt.

   ```json
   {"request":{"project_id":"PROJEKT_ID","version_id":"FASSUNGS_ID","kind":"mix","format":"wav","wav_format":"pcm24"}}
   ```

6. Mit der Export-ID `get_stem_export` abfragen. Bei `export.status: "done"` enthält `local_files` die fertigen Dateien auf dem Desktop-Rechner.

### KI-Spuren und Reparatur

- `generate_stem_track` erzeugt mit einem installierten ACE-Step 1.5 Base- oder XL Base-Profil eine Instrumentenspur zum Mix. Dafür ein verfügbares Profil aus `list_models(view=installed)` als `selection` übergeben. `project_id`, `track` (zum Beispiel `"bass"`) und `name` sind erforderlich. Optional sind `prompt` und entweder ein gespeicherter `version_id` oder ein direkt übergebener `mix`. Ohne beides dient der Standardmix als Grundlage. Die Modellauswahl gilt pro Auftrag und unterliegt den Expert-Mode- und Hardware-Regeln.
- `scan_stem_artifacts` erhält `project_id` und die Spur-`role`, zum Beispiel `"vocals"`. Der Scan markiert mögliche tonale Artefakte über die ganze Spur. Jeder Fund in `result.regions` kann direkt als `selection` für Vorschau oder Reparatur dienen.
- `preview_stem_repair` erhält Projekt, Rolle, `selection` und einen vorhandenen absoluten Ordner als `destination`. Es schreibt zwei zeitgleiche Stereo-WAVs in einen neuen Unterordner und liefert die lokalen Pfade in `result.before` und `result.after` sowie `first_frame`, `frames` und `rate`. Die Auswahl darf bis zu 20 Sekunden umfassen. Die WAVs enthalten an beiden Enden bis zu 250 ms Kontext.
- `repair_stem_track` erzeugt eine Ersatzspur in voller Projektlänge und erhält die ursprüngliche Audiodatei. Eine Spektralauswahl enthält `first`, `end`, `low_hz`, `high_hz` und `reduction_db`. Für De-Click oder De-Crackle die Frequenzangaben durch `"effect":{"kind":"de_click","sensitivity":60}` beziehungsweise `"de_crackle"` ersetzen. `whole_track: true` wendet das gewählte Verfahren auf die gesamte Spur an. In der Vorschau geben `first` und `end` bei dieser Einstellung den Hörbereich an.

Alle vier Aufrufe liefern eine `operation_id`. Status und Ergebnis stehen in `get_operations`, bei der KI-Spur zusätzlich der Generierungsfortschritt. Zum Abbrechen `cancel_job` mit `target: "operation"` und der ID aufrufen. Für eine neue KI-Spur zum Beispiel `{"role":"LAYER_ID","name":"Bass","gain_db":0,"pan":0,"mute":false,"solo":false,"fade_in":0,"fade_out":0}` an `mix.tracks` anhängen. Für eine reparierte Spur die zurückgegebene Rolle als `replacement` am vorhandenen Kanal setzen. Beide Änderungen werden mit `save_stem_mix` gespeichert. Dynamischer EQ und De-Esser stehen im Mix-Snapshot und werden beim Abspielen und Rendern berechnet.

## Ressourcen und Prompt

Es gibt JSON-Ressourcen unter `music://status`, `music://settings`, `music://models` und `music://queue`, sowie Templates `music://songs/{id}` und `music://operations/{id}`. Audiopfade gehören zum Computer, auf dem die Desktop-App läuft; Audiodateien werden nicht als große Base64-Blöcke in den Modellkontext kopiert. Der Prompt `create_music` mit Argument `brief` beschreibt den vollständigen Arbeitsablauf.

## Dateizugriff und Grenzen

- Die erste Modelleinrichtung und neue macOS-Ordnerfreigaben erfolgen über die nativen Dialoge. MCP umgeht die App Sandbox nicht. Analyse-, Import- und Exportpfade müssen absolut und für die App zugänglich sein.
- Audioanalyse akzeptiert dieselben Formate wie die Oberfläche und höchstens 60 MiB. Modell-/Konfigurationsarbeiten nutzen dieselbe exklusive Laufzeitsteuerung wie die Oberfläche; Konflikte liefern verständliche Fehler.
- Bibliotheksexporte mit `export_file` benötigen eine freie aktive Laufzeit; bereits eingereihte Songs laufen anschließend weiter. Sie nutzen das eingestellte WAV-/MP3-Format; die Dateiendung muss passen. Vorhandene Dateien bleiben ohne `overwrite: true` erhalten. Exporte werden zunächst separat erstellt und erst nach Erfolg veröffentlicht. Datenbank-, Modell- und Original-Song-Verzeichnisse sind als Exportziele gesperrt.
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
