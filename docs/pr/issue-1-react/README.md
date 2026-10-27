# Issue #1: native React-Abnahme

Die Screenshots stammen aus einer lokal mit der Tauri-CLI gebauten macOS-Debug-App. Die Abnahme verwendet ein separates App-Kennzeichen und das temporäre Profil `/private/tmp/music-generator-react-qa`. Die Studio-Bibliothek enthält einen künstlichen Drei-Sekunden-WAV-Ton und Beispiel-Lyrics; es wurden dafür keine Modelle heruntergeladen und keine Musik generiert.

- `setup-de.png`: echter Erststart im React-Assistenten.
- `setup-error-de.png`: lokalisierte Validierung eines relativen Modellpfads; der Start ist gesperrt.
- `studio-side-de.png`: Zweispaltenlayout mit Favorit, Lyrics und abgeschlossenem Waveform-Player.
- `models-de.png`: React-Modellverwaltung mit Hardwareempfehlung und Downloadbedarf.

Native Prüfung bestätigt Erststart und erneuten Start, Pfadvalidierung, WAV-Wiedergabe einschließlich gemessener Uhr, Favoriten, Lyrics und Einstellungen. Weitere tatsächlich ausgeführte Abnahmen und Grenzen stehen im PR und in der Verifikationsdokumentation. Automatisierte Tests simulieren Fortschrittsereignisse und Medienberechtigungen; solche Simulationen sind keine Hardwarezertifizierung.
