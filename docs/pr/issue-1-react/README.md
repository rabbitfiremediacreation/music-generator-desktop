# Issue #1: native React-Abnahme

Die Screenshots stammen aus einer lokal mit der Tauri-CLI gebauten macOS-Debug-App. Die Abnahme verwendet ein separates App-Kennzeichen und das temporäre Profil `/private/tmp/music-generator-react-qa`. „Am Fluss“ ist ein künstlicher Drei-Sekunden-WAV-Ton mit Beispiel-Lyrics. „React Migration QA“ wurde anschließend tatsächlich lokal erzeugt: 10 Sekunden Vorgabe, 13 Iterationen, 9,44 Sekunden gemessene WAV-Dauer. Bereits vorhandene Modelle wurden unabhängig in das Testprofil kopiert; es gab keinen neuen Modelldownload.

- `setup-de.png`: echter Erststart im React-Assistenten.
- `setup-error-de.png`: lokalisierte Validierung eines relativen Modellpfads; der Start ist gesperrt.
- `studio-side-de.png`: Zweispaltenlayout mit Favorit, Lyrics und abgeschlossenem Waveform-Player.
- `models-de.png`: React-Modellverwaltung mit Hardwareempfehlung und Downloadbedarf.
- `setup-result-de.png`: erfolgreich abgeschlossener nativer Funktionstest; Ergebnis bleibt bis zum Studio-Klick sichtbar.
- `generation-progress-de.png`: Fortschritt eines echten Generierungsauftrags.
- `studio-stack-en.png`, `studio-narrow-en.png`: englische gestapelte Ansicht und schmales Fenster mit echtem Ergebnis und Waveform-Player.
- `export-en.png`: nativer WAV-Speicherdialog im temporären Testordner.

Native Prüfung bestätigt Erststart und erneuten Start, Pfadvalidierung, Modellprüfung, Setup-Abschluss, erhaltene Formularwerte und Fokus, echte Generierung auf Metal, Sprachwechsel, WAV-Wiedergabe einschließlich gemessener Uhr, Favoriten, Lyrics, Einstellungen, Layoutwechsel und Fenster-Schließen. Die exportierte WAV stimmt bytegenau mit dem erzeugten Original überein. Die Entwicklungskopien der Engine-Helfer wurden für den Test ohne App-Sandbox ad-hoc neu signiert; Release-Signing und Produktcode bleiben unverändert.

Weitere Abnahmen und Grenzen stehen im PR und in der Verifikationsdokumentation. Automatisierte Tests simulieren unter anderem Medienberechtigungen; solche Simulationen sind keine Hardwarezertifizierung.
