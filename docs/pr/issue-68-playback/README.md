# Issue #68: Player-Ladeweg

Die Screenshots zeigen die implementierte React-Player-Komponente mit dem mitgelieferten WaveSurfer und den echten App-Styles in einer separaten Chromium-Testseite auf macOS. Die Tauri-IPC-Schnittstelle ist simuliert; der Testton ist eine synthetische, fünfminütige PCM-WAV-Datei (48 kHz, Stereo, 16 Bit, 57.600.044 Bytes). Es handelt sich nicht um einen Windows-Hardwaretest und nicht um die betroffene Originaldatei.

- `playback-de.png`: WAV tatsächlich decodiert, Wellenform gerendert, Uhr bis 0:01 / 5:00 fortgeschritten und anschließend pausiert.
- `playback-error-de.png`: simulierter Lesefehler wird angezeigt; Wiedergabestatus und Uhr sind zurückgesetzt.
- `verification.json`: Ergebnisse der lokalen Integrationsprüfung. Nach dem Lesefehler wurde dieselbe Song-ID erneut geladen, erfolgreich abgespielt und per Leertaste pausiert. Keine unbehandelten JavaScript-Fehler.

Die Rust-Regressionstests in `src-tauri/tests/playback.rs` prüfen echte Dateizugriffe über die Bibliothek, einschließlich Leerzeichen, Umlauten, Unicode, `[ ]`, `#` und `%` in Ordnern und Dateinamen, erneutem Öffnen der Datenbank sowie fehlenden/leeren Dateien und ungültigen Pfaden. Die Frontendtests prüfen außerdem beide Tauri-Antwortformen (ArrayBuffer und Byte-Array), Medienfehler ohne beendeten Lade-Promise, erneutes Laden, Songwechsel während ausstehender Ladevorgänge, Lautstärke und Löschen.

Die ursprüngliche Ursache auf dem betroffenen Windows-System ist nicht abschließend reproduziert. Der neue Ladeweg umgeht Asset-URLs und deren Dateipfad-/Protokollbehandlung. `allow_directory(..., false)` bleibt unverändert: Die direkt im Songordner gespeicherten Dateien sind damit bereits freigegeben.

## Noch ausstehende Windows-Abnahme

Mit dem Windows-Testpaket den bestehenden Songordner mit Leerzeichen öffnen, die betroffene WAV abspielen und prüfen, dass Wellenform, Gesamtdauer und laufende Uhr erscheinen und Ton hörbar ist. Danach einen weiteren Song wählen, pausieren/fortsetzen und die App neu starten. Falls weiterhin ein Fehler auftritt, den nun sichtbaren Fehlertext festhalten. ZIP und MSI sollten jeweils den gleichen Player-Ladeweg verwenden.
