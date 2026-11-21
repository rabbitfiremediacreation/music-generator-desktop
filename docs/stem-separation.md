# Lokale Stem-Separation

Nach der Ersteinrichtung der Desktop-App öffnet **In Spuren aufteilen** in der Bibliothek den Assistenten für den gewählten Titel. Über **Spurprojekte → Neue Trennung** lassen sich Audiodateien auswählen oder per Drag-and-drop hinzufügen. Der Assistent bündelt den Ablauf in **Audioquellen**, **Trennziel** und **Ergebnisprojekt**. Trennziel enthält die Auswahl installierter Modelle, Ausgabespuren, erweiterte Qualitätseinstellungen und eine optionale Vorschau. Die Einstellungen öffnen sich direkt aus dem Assistenten, wenn die Laufzeit oder ein einsatzbereites Modell fehlt.

Das Ergebnisprojekt zeigt den geschätzten Speicherbedarf automatisch an. **Trennung einreihen** prüft Quelle, Modell, Parameter und freien Platz beim Einreihen. Ein Stapel erzeugt pro Quelle einen eigenen Auftrag und ein eigenes Spurprojekt. Eine Vorschau verarbeitet bis zu zwölf Sekunden ab der gewählten Position. Die Qualität des Ausschnitts kann sich vom Ergebnis der vollständigen Berechnung unterscheiden.

Sobald ein Titel ein abgeschlossenes Spurprojekt hat, öffnet **Mixer** in seiner Bibliothekszeile direkt das neueste Projekt. Über **Spurprojekte** oder den Zurück-Pfeil im Mixer lassen sich frühere Projekte öffnen und mit **Spurprojekt entfernen** nach Bestätigung löschen. Dabei entfernt die App die zugehörigen Spuren, Mischfassungen und internen Exporte. Der Bibliothekstitel und außerhalb der App gespeicherte Exporte bleiben erhalten. Nach dem Entfernen des letzten Projekts erscheint wieder **In Spuren aufteilen**.

**Neue Trennung** im Mixer öffnet den Assistenten mit der Audioquelle des aktuellen Projekts. Nach einer Vorschau führt **Zurück** in denselben Assistenten. Beim Schließen des Assistenten bleiben die Mischung und ihr Undo-Verlauf erhalten. Das neue Ergebnis kannst du nach Abschluss aus den Spurprojekten öffnen.

Ein fertiges Spurprojekt öffnet den **Stem-Mixer** in der Hauptansicht. **Zurück** öffnet wieder die Spurprojekte oder den Assistenten einer Vorschau. **Bibliothek** schließt den Mixer und den Projekteinstieg. Die Konsole füllt die Arbeitsfläche unter der Fensterleiste. Fader und Pegelanzeigen wachsen mit der Fensterhöhe. Die Kanalbank scrollt bei Platzmangel horizontal, während der Master daneben sichtbar bleibt. In niedrigen Fenstern lassen sich die Bedienelemente vertikal erreichen. Eine neue Trennung erzeugt ein eigenes Ergebnis, zu dem sich mehrere Mischfassungen speichern lassen. Zusätzliche und ersetzende Audiospuren beginnen am Projektanfang. Die App resampelt sie auf die Projektzeitbasis und füllt kürzere Dateien mit Stille auf. Fehlt die gespeicherte Quelldatei, lässt sie sich mit einer Datei desselben SHA-256-Digests neu zuordnen.

## Modelle und Laufzeit

| Profil | Ausgabe | Hugging-Face-Revision |
| --- | --- | --- |
| HTDemucs | Gesang, Schlagzeug, Bass, übrige Begleitung | [cbc8a9b1a87023b7fd74e7b3412e6321c0eab003](https://huggingface.co/adefossez/HTDemucs/tree/cbc8a9b1a87023b7fd74e7b3412e6321c0eab003) |
| HTDemucs 6s | Zusätzlich Gitarre und Klavier | [3c5ee475be622df764938de97e4281a7b07ffa58](https://huggingface.co/adefossez/HTDemucs-6s/tree/3c5ee475be622df764938de97e4281a7b07ffa58) |

Beide Profile bieten Gesang und eine abgeleitete Instrumentalfassung. Die App summiert für das Instrumental die geschätzten Begleitspuren. Die Ergebnisse sind Rekonstruktionen aus der Mischung. Die Sechsspurvariante enthält laut Demucs eine experimentelle Klaviertrennung. [Demucs v4.0.1](https://github.com/facebookresearch/demucs/tree/v4.0.1)

Installiere die Demucs-Laufzeit unter **Einstellungen → Modelle → Engines**. Unter **Einstellungen → Modelle → Trennmodelle** listet die App die installierten Modellrevisionen mit Status, Speicherbedarf und verfügbaren Aktionen. **Modell hinzufügen** öffnet den Katalog mit Modellkarten, Prüfsummen und Hugging-Face-Suche. Laufende Downloads erscheinen auch in der Übersicht. Ein Modellpaket umfasst einen Safetensors-Checkpoint und seine Demucs-Konfiguration. Der Downloadservice setzt Dateien mit HTTP Range fort, prüft vor der Aktivierung beide SHA-256-Digests und lädt den Checkpoint probeweise in den festgelegten Adapter. Revisionen mit identischen Dateien verwenden dieselben gespeicherten Artefakte. Modellupdates werden gezielt installiert und aktivieren keine Revision für bereits eingereihte Aufträge.

Eine Hugging-Face-Modell-URL oder Repository-ID öffnet die Detailprüfung. Bei den kuratierten Repositories kann der Adapter neue Revisionen prüfen, sofern Checkpointformat, Konfiguration und Modellarchitektur unterstützt werden. Spiegel und private Repositories sind installierbar, wenn das bekannte Gewicht exakt übereinstimmt und die zugehörige Konfiguration vorliegt. Andere Treffer bleiben als unbestätigt gekennzeichnet. Die App sendet ein gespeichertes Lese-Token ausschließlich an den HTTPS-Hub-Ursprung. Die Tokenverwaltung unter **Einstellungen → Allgemeines → App-Einstellungen** legt die Zugangsdaten separat von SQLite im privaten Anwendungsdatenverzeichnis ab. Entfernen der Zugangsdaten oder Modellpakete hat keinen Einfluss auf berechnete Projekte. [Hugging Face Tokens](https://huggingface.co/docs/hub/security-tokens) · [Downloads mit Revision](https://huggingface.co/docs/huggingface_hub/guides/download)

| Plattform | Engine |
| --- | --- |
| macOS auf Apple Silicon | Demucs 4.0.1 im separaten PyTorch-Enginepaket der App mit CPython 3.11.14 und PyTorch 2.7.1 |
| Windows x64 und Linux x64 | Die App installiert Demucs 4.0.1 und PyTorch 2.8.0 CPU in einer privaten virtuellen Umgebung auf Basis eines vorhandenen Python 3.12 |
| macOS Intel und weitere Architekturen | Der Trennadapter steht dort nicht zur Verfügung |

Der Adapter verwendet CPU. Nach der Installation laufen Quellenanalyse, Trennung, Mixer und Export lokal. Die App verwendet Demucs mit festen Modellkonstruktoren und lädt Safetensors-Daten ohne Remote-Code oder Python-Pickle. Die WAV-, MP3-, FLAC- und OGG-Importe verwenden libsndfile. Für M4A steht abhängig vom System FFmpeg oder Core Audio zur Verfügung. Dateiimporte folgen dem vorhandenen Limit von 60 MiB. Die Bibliotheksquelle wird als app-eigene Kopie gespeichert. Die Laufzeit verwendet für die Trennung gemeinsamen Arbeitsspeicher für Quelle und Ergebnisse. Eine lange Audiodatei benötigt entsprechend mehr Speicher.

Demucs-Code steht unter MIT. Die Modellkarten der beiden geprüften Revisionen weisen keine separate Gewichtelizenz aus. Die veröffentlichte Demucs-Lizenz und die Lizenzdateien der eingebetteten Python-Abhängigkeiten bleiben im PyTorch-Paket erhalten. [Demucs LICENSE](https://github.com/facebookresearch/demucs/blob/v4.0.1/LICENSE) · [HTDemucs-Modellkarte](https://huggingface.co/adefossez/HTDemucs/blob/cbc8a9b1a87023b7fd74e7b3412e6321c0eab003/README.md) · [HTDemucs-6s-Modellkarte](https://huggingface.co/adefossez/HTDemucs-6s/blob/3c5ee475be622df764938de97e4281a7b07ffa58/README.md)

## Zeitbasis, Mix und Export

Die Architektur verwendet einen Sample-Zähler für sämtliche Spuren. Die Quellgrenzen werden auf native Frames gerundet. Demucs resampelt den ausgewählten Bereich auf 44,1 kHz und dupliziert Mono auf zwei Kanäle. Alle Ausgaben besitzen denselben Zeitoffset, dieselbe Framezahl und Stereo. Die überlappenden Modellsegmente werden durch Demucs zusammengeführt. Der Adapter verwendet vor der Trennung gemeinsamen Mittelwert und Standardabweichung und stellt den gemeinsamen Pegelbezug anschließend wieder her. Die gespeicherten IEEE-Float-WAVs behalten Spitzen außerhalb ±1.0. Die App prüft Header, Framezahl und endliche Samples vor der Übernahme.

Im Kanal durchläuft das Signal den bipolaren Filter, drei EQ-Bänder, den Kompressor, die Stereobreite, Balance und Fader einschließlich der Spurfades, den Limiter und das Mute/Solo-Gate. Das Kanal-Meter misst in dBFS hinter dem Gate. Die Mastersumme durchläuft Kompressor, Fader und Limiter. Das Master-Meter misst diese bearbeitete Stereosumme vor dem Abhörzweig. Das Meter zeigt echte Sample-Peaks je Seite, hält Spitzen für eine Sekunde und kann die gespeicherte Clip-Markierung per Klick zurücksetzen.

- **EQ und Filter** verwenden Biquads. LOW ist ein 100-Hz-Shelf, MID ein 1-kHz-Bell mit Q 0,7 und HIGH ein 10-kHz-Shelf. Der Filter hat eine OFF-Zone von ±3 % und blendet aus ihr weich ein. Die logarithmischen Grenzfrequenzen reichen auf der LP-Seite von bis zu 20 kHz bis 80 Hz und auf der HP-Seite von 20 Hz bis 5 kHz. Aktive Frequenzen bleiben unter 45 % der Samplerate.
- **COMP** verwendet bei Amount `a = Amount / 100` eine Schwelle von `−36 × a dBFS` und eine Ratio von `1 + 7 × a`. Attack beträgt 10 ms, Release 120 ms und das Soft Knee 6 dB. Die Pegelreduktion folgt dem höheren der beiden Kanalpegel und enthält kein Makeup-Gain.
- **LIMIT** liegt jeweils hinter dem Fader und verwendet ab dem ersten aktiven Sample ein Ceiling von −1 dBFS. Der Amount erhöht den geglätteten Input-Drive um bis zu 12 dB. Die beiden Seiten teilen eine sofortige Pegelreduktion mit einer Release-Zeit von 80 ms. Das Verfahren arbeitet ohne Lookahead und ist ein Sample-Peak-Limiter.
- **STEREO und BALANCE** wirken unabhängig. STEREO skaliert das Seitensignal in Mid/Side von 0 bis 200 %. BALANCE dämpft linear die jeweils gegenüberliegende Seite. In der Mitte arbeiten beide Seiten mit Unity-Gain.

Der Audiothread glättet Regleränderungen. Der Original/Mix-Schalter blendet auf derselben Transportposition über etwa 8 ms um. MONO mittelt erst im Abhörzweig nach dem Vergleich und betrifft ausschließlich die Wiedergabe. Beim Springen oder am Loop-Anfang werden die Filter- und Dynamics-Historien neu begonnen. Echtzeit und Export verwenden dieselben Definitionen und gemeinsame numerische Referenzsignale. Gibt das Ausgabegerät eine andere Samplerate vor, liest der Player den gemeinsamen Projektzeitindex interpoliert.

Regler lassen sich vertikal ziehen, mit Shift feinfühliger bedienen und doppelklicken, um sie auf ihren Neutralwert zu setzen. Pfeiltasten ändern den fokussierten Regler. Das Zahlenfeld unter dem Regler nimmt direkte Eingaben an. Eine Faderstellung von −∞ ergibt Gain null. Rückgängig und Wiederholen gruppieren einen Reglerzug als eine Änderung. Eine Mischfassung der Version 2 enthält kompatible neutrale Defaults für ältere Fassungen und behält bestehende Gain-, Balance-, Mute- und Solo-Einstellungen. Frühere Gain-Werte oberhalb von +6 dB bleiben erhalten, bis der Fader geändert wird. Abhörmodus und Pegelanzeigen bleiben flüchtig.

- **Einzelne Spuren exportieren** verwendet markierte Kanalzüge unabhängig von Mute und Solo. Rohspuren und bearbeitete Spuren übernehmen standardmäßig denselben Mixerbereich. Eine vollständige Stereo-Float-WAV kann bei übereinstimmendem Format kopiert werden. Bearbeitete Exporte verwenden die Kanalverarbeitung einschließlich Ersatzspuren.
- **Mix exportieren** rendert die anhand von Mute und Solo hörbaren Kanäle über die Mastersumme. Export-Häkchen und die aktuelle Abhöre ändern den Mixexport nicht.
- **Spurpaket exportieren** erzeugt ein ZIP mit synchronen Roh-WAVs der ausgewählten Spuren, eindeutigen Spurzuordnungen und der versionierten Mischfassung im Manifest. Das Original und ein Mix sind optional. Im Bereichsexport kann die Auswahl am Projektanfang beginnen oder mit Stille bis zur ursprünglichen Position ausgegeben werden.

Jeder Export verwendet einen unveränderlichen Snapshot. Fehlende oder unlesbare Dateien erscheinen am betroffenen Kanal, und Exporte, die diese Dateien benötigen, melden einen Fehler. Die Mischfassung bleibt bearbeitbar.

WAV ist als 16 oder 24 Bit PCM sowie als 32 Bit Float möglich. Ausgaben unterstützen 44,1 oder 48 kHz und Stereo oder Mono. MP3, AAC und Opus werden bei vorhandenen Encodern über die bestehende Exportpipeline angeboten. Der Exportverlauf zeigt den Spitzenpegel und Übersteuerung vor der Quantisierung. Fertige Exporte sind über **Im Ordner speichern** als Gruppe in einem frei gewählten Zielordner ablegbar.

## Daten und Schnittstellen

SQLite speichert Quell-Hash, Quellbereich, Engineversion, Modellrevision, Parameter, Ergebnisstatus, Spuren, Mischfassungen und Exportverlauf. Die zugehörigen Dateien liegen unter `stems/` im Anwendungsdatenverzeichnis. Projektordner in der Bibliothek dienen zur Ablage der Metadaten. Die Modelle liegen im konfigurierten Modellordner unter `stem-separation/`. Die gemeinsame Warteschlange verarbeitet Generierung, Trennung und Export nacheinander. Beim Neustart bleiben wartende Aufträge erhalten. Unterbrochene, fehlgeschlagene und abgebrochene Trennungen lassen sich in der Projektliste wiederholen oder entfernen. Beim nächsten App-Start werden nicht mehr referenzierte Importkopien freigegeben.

Die gekoppelte Smartphone-Oberfläche startet Trennung für Bibliothekstitel, zeigt Aufträge, spielt Stems ab und lädt Exporte. Die authentifizierte API verwendet `/api/stems/` mit verwalteten Song-, Projekt- und Export-IDs. MCP stellt `list_stem_models`, `separate_song`, `list_stem_jobs`, `get_stem_job`, `cancel_stem_job`, Mischfassungen sowie die Exportoperationen bereit.

## Prüfen

Reguläre Tests verwenden synthetische Signale. Die explizit aktivierte Rust-Prüfung führt echte Trennungen durch und benötigt die vier Modelldateien der oben angegebenen Revisionen sowie eine vorbereitete Laufzeit. Für die separate Python-Umgebung wird das Verzeichnis `runtime` neben den Modelldateien erwartet. Für das Apple-Silicon-Paket verweist `MUSIC_STEM_QA_RESOURCES` auf das Verzeichnis oberhalb von `engine/pytorch`. `MUSIC_STEM_QA_SUPERVISOR` enthält den absoluten Pfad zur gebauten Supervisor-Binärdatei.

```sh
MUSIC_STEM_QA=/path/to/stem-fixtures \
  cargo test --manifest-path src-tauri/Cargo.toml --lib \
  stems::tests::offline_separation -- --ignored --nocapture
```

Mit `MUSIC_STEM_QA_DOWNLOAD=1` setzt der Test einen echten Hub-Download ab einer lokalen Teildatei fort. Mit `MUSIC_STEM_QA_MODEL=htdemucs-6s` prüft derselbe Test die Sechsspurvariante. Der Test lädt die Gewichte aus dem lokalen Modellordner, startet die gemeinsame Warteschlange, prüft die Zeitbasis und exportiert nach einem Neustart und Entfernen der Modelle. Die allgemeinen Testläufe benötigen keine Modellgewichte.


### Geprüfte Ergebnisse

Auf macOS 26.6.2 auf Apple Silicon wurden das PyTorch-Enginepaket und der Demucs-Plug-in-Build geprüft. HTDemucs lief mit dem Schnellprofil, HTDemucs 6s mit dem Standardprofil. Die reale Quelle war ein synthetisches Monosignal bei 48 kHz. Beide Läufe prüften Stereo bei 44,1 kHz sowie die originale Quellposition, Framegleichheit, die unveränderten Rohspuren und den Export nach Neustart und Modell-Deinstallation. Die Läufe prüften außerdem Abbruch während der Inferenz, ein unveränderliches Export-Snapshot, Hinzufügen einer ausgerichteten Spur, Hash-basierte Neuzuordnung, Revisionswechsel bei einem aktiven Auftrag, 24-Bit-PCM in Mono bei 48 kHz, MP3 und das ZIP-Manifest. Der Downloadtest mit Hugging Face setzte bei einem 2-MiB-Teilstück an und prüfte Konfiguration und Gewichte.

Die Rust-Tests decken unter anderem beschädigte Teil-Downloads, fehlende oder nicht ausgerichtete Ausgaben, gemeinsame Modellartefakte, die Wiederherstellung nach Unterbrechungen sowie die Authentifizierung für Smartphone und MCP ab. Die Frontend-Tests prüfen den Batch-Assistenten sowie den gemeinsamen Takt für Start, Pause, Seek, Loop und A/B. Sie prüfen auch Mehrfach-Solo und Vorrang von Stumm.

Die Laufzeitprüfung auf Windows und Linux, manuelle Hör- und Dauertests mit musikalischen Referenzaufnahmen und die Prüfung eines vollständigen notarisierten macOS-Pakets stehen aus. Die zwölf Oberflächensprachen enthalten die zentralen Bedienelemente und Spurrollen. Technische Detailtexte stehen vollständig auf Deutsch und Englisch zur Verfügung.
