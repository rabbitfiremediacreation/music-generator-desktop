# Bereinigung temporärer Exportdateien

Bezug: [Issue #18](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/18).

## Dateien und Lebensdauer

Für eine MP3-Konvertierung legt die App unter ihrem internen Datenordner
`export/temporary-<id>` an. Die ID besteht aus den 32 kleinen Hexadezimalzeichen
einer UUID v4. `source.wav` ist eine lokale Kopie des Bibliotheksoriginals, damit
der Konverter keine Berechtigung für einen externen Songordner benötigt.
`encoded.mp3` enthält zunächst das Konvertierungsergebnis.

Nach erfolgreicher Konvertierung wandert die MP3 in den vorhandenen Cache unter
`export/<Song-Hash>-<Größe>-<Änderungszeit>-192.mp3`. Dieser Cache bleibt bewusst
für weitere Exporte erhalten und wird mit dem Song gelöscht. Er ist kein
temporäres Arbeitsverzeichnis. Fertige WAV-, MP3-, Text- und ZIP-Exporte liegen am
im Speicherdialog gewählten Ziel.

## Erfolg, Fehler und Abbruch

Das Arbeitsverzeichnis bleibt so lange erhalten, wie die Dateikopie oder der
Konvertierungsprozess es benötigen. Auch wenn die aufrufende Aufgabe verworfen
wird, behält die bereits gestartete oder eingereihte Hintergrundkopie einen
Besitzer des Verzeichnisses. Erst nach dem tatsächlichen Kopierende kann die
letzte Referenz die Dateien entfernen. Nach der Kopie wird der Abbruchstatus
erneut geprüft, bevor ein Konverter startet.

Nach Erfolg, Konvertierungsfehler, Timeout oder Abbruch wird der Konverter zuerst
beendet und anschließend das Arbeitsverzeichnis entfernt. Ein Abbruch des
Speicherdialogs startet keinen Export und erzeugt keine Arbeitsdateien.
ZIP-Exporte behalten ihre getrennte Vorbereitung und den bestehenden Austausch
des ausgewählten Ziels.

## Wiederherstellung beim Start

Bei einem Prozessabsturz oder sofortigen App-Ende können Aufräumaktionen ausfallen.
Die App bereinigt solche Reste einmal während der Startinitialisierung, bevor
Exporte möglich sind. Sie entfernt ausschließlich echte Verzeichnisse mit dem
oben beschriebenen Namen im internen Exportordner. Symbolische Verknüpfungen,
andere Namen, reguläre Dateien, der MP3-Cache und fertige Exporte bleiben erhalten.
Auch ein symbolisch verknüpfter Exportordner wird nicht durchsucht.

Die Bereinigung läuft weder beim erneuten Öffnen der Datenbank noch bei späteren
Exporten oder erneuten Startanfragen mit bereits vorhandenem Anwendungszustand.
Das gilt auch für einen manuellen Start-Neuversuch mit neuer Versuchsnummer.
Dadurch bleiben Arbeitsdateien paralleler Exporte erhalten.

Unter Windows werden Löschfehler wegen Zugriff, Dateisperren oder eines noch nicht
leeren Verzeichnisses bis zu zweimal nach jeweils 100 ms erneut versucht.
Bleiben Dateien gesperrt oder anderweitig unzugänglich, protokolliert die App den
Pfad und versucht es beim nächsten Start erneut. Ein erfolgreicher Export und
der App-Start werden dadurch nicht als fehlgeschlagen gemeldet. Neue sichtbare
Meldungen oder Übersetzungsschlüssel sind nicht erforderlich.

## Regressionstests

Der Cargo-Testtarget `export_lifecycle` verwendet einen kontrollierbaren
Fixturekonverter mit dem echten Prozess-Supervisor. Die künstlichen MP3-Bytes
prüfen Dateilebensdauer und Exportinhalt, nicht die Audioqualität des echten Codecs.
Die Kopierregression belegt den einzigen Blocking-Thread eines eigenen Runtimes,
verwirft die aufrufende Future und gibt die Kopie anschließend wieder frei. Damit
ist die Lebensdauer unabhängig von Dateigröße und Betriebssystemgeschwindigkeit
reproduzierbar.

Die Starttests prüfen Altlasten, geschützte Dateien und Verknüpfungen sowie den
Erhalt aktiver Arbeitsverzeichnisse bei einer erneuten Startanfrage. Vorhandene
Frontendtests sichern den Dialogabbruch und die übersetzten MP3-Fehler ab.

Lokale Prüfung auf macOS nach Integration des Hauptbranches am 29. Oktober 2026:
226 Rust-Tests einschließlich neun neuer Prozess-/Exportfälle, 391 Frontendtests
und 32 Desktop-Scripttests bestanden.
Typechecking, Frontend-Build, ESLint, Rustfmt und Clippy ohne Warnungen waren
erfolgreich. Die beiden
zentralen Regressionen wurden vor ihrer jeweiligen Korrektur rot nachgewiesen.
Der zusätzliche Windows-Test für vorübergehend gesperrte Dateien ist hier nicht
ausgeführt; auch ein neu gebautes App-Bundle mit echtem MP3-Codec wurde für diesen
Fix nicht geprüft.
