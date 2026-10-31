# Rechen-Backend und CUDA-Kompatibilität

Die Hardwareanzeige beschreibt den Rechner. Im Studio steht das **Rechenbackend** kompakt neben Sprache und Einstellungen. Bereits vor der ersten Generierung zeigt die modellfreie Erkennung ein verfügbares Backend wie Metal; dies ist noch kein Beleg für eine ausgeführte Synthese. Tooltip und zugängliche Beschreibung unterscheiden erkannte Verfügbarkeit, bestätigte Klangerzeugung und die getrennte Sprachmodellwahl. Möglich sind CUDA, Vulkan, Metal, CPU oder ein noch unbekanntes Backend.

## Was die Anzeige belegt

Für die Bestätigung einer tatsächlichen Ausführung wertet die App ausschließlich Meldungen der aktuell von ihr gestarteten Engine-Prozesse aus: `[Load] LM backend: …` für das Sprachmodell und `[Load] DiT backend: …` für die Klangerzeugung. Eine geladene CUDA-DLL, eine erkannte NVIDIA-Karte oder ein erreichbarer Modellserver beweisen noch keine CUDA-Nutzung. Die Anzeige beschreibt das primäre Backend dieser Modellkomponenten; sie behauptet nicht, dass jede einzelne Rechenoperation auf der GPU stattfindet.

Jeder Startversuch erhält eine neue Loggrenze. Alte Meldungen aus `logs/ace-server.log` und `logs/ace-lm.log` werden nicht als aktuelle Nutzung übernommen. Ein separater CPU-Sprachmodellprozess bleibt von der Klangerzeugung getrennt. Die ausführlichen Diagnosen unterscheiden vor dem Start **Noch nicht gestartet**, nach dem Start ohne Ausführungsbeleg **Noch nicht bestätigt** und nach dem Beenden **Engine beendet**. Der kompakte Studioindikator zeigt bei verfügbarer Erkennung stattdessen das erkannte Backend und kennzeichnet dessen Herkunft in der Beschreibung. Nach einem App-Neustart wird kein früheres Backend als aktiv wiederhergestellt. Health-Abfragen starten keine Engine.

Der Assistent testet das Sprachmodell, nicht die komplette Klangerzeugung. Sein Ergebnis kann daher beispielsweise **Sprachmodell: Vulkan** und **Klangerzeugung: Noch nicht bestätigt** zeigen. Erst die erste tatsächliche Synthese bestätigt deren Backend. Das Ergebnis bleibt bis zum Klick auf **Zum Studio** stehen; ein erneuter Aufruf des Assistenten beginnt wieder beim Formular.

Eine ausdrückliche CPU-Auswahl und ein CPU-Bundle sind keine fehlgeschlagene CUDA-Nutzung. Der bestehende Testfallback betrifft ausschließlich das Sprachmodell. Bekannte Gründe werden erläutert; andernfalls steht ausdrücklich, dass kein Grund für die Backend-Auswahl belegt ist. Die App ergänzt keine automatische CUDA→Vulkan-Neustartstrategie und verändert die Auswahl der Engine nicht.

## Überarbeitete 0.1.2-Engine mit 200 Schritten

Die Composite-Revision `6013134-steps200` baut den Windows-ACE-Kern und seine CLI-Werkzeuge aus der passenden Quellrevision `6013134c136d9fb4e970cf690e76925be9553da0` mit der erweiterten Grenze neu. GGML-Header sind auf `2eddaf94a8cdbbf1c30017d28313cd661a9da543` gepinnt; die vollständigen GPU-/CPU-GGML-DLLs bleiben aus dem unten untersuchten, SHA-geprüften Archiv erhalten. Die bisherige CUDA-Binäranalyse beschreibt diese unveränderten DLLs und ersetzt weiterhin keinen realen NVIDIA-Inferenztest. Der ACE-Core selbst ist neu gebaut.

Die produktive Normalisierung unterstützt 1–200 und wird vor Runtime-Caching sowie im verlagerten Bundle modellfrei geprüft. Der Synthesepfad meldet tatsächlich ausgeführte Schritte separat vom ursprünglichen Request. [Abnahme der 200er-Korrektur](qa/iterations-200-0.1.2/README.md).

## Untersuchter Windows-Build

Die folgenden Angaben gelten ausschließlich für das im Manifest festgelegte [Windows-Archiv `6013134`](https://github.com/rabbitfiremediacreation/music-generator/releases/tag/engine-win64-6013134):

| Merkmal | Nachweis |
| --- | --- |
| Engine-Quellrevision | `6013134c136d9fb4e970cf690e76925be9553da0` |
| Archiv | `acestep-cpp-win64-6013134.zip`, 132.567.042 Bytes |
| SHA-256 des Archivs | `647f4ffd1cb2f2e20ac3d54e92a45ed83d3cf9278e55e8b4da1c788fbfb74ac2` |
| SHA-256 von `ggml-cuda.dll` | `2eeffd1561695d01a924782d89df7054ff6892b61a682456ab7e5a0664f0482c` |
| Virtuelle PTX-Ziele | `sm_75`, `sm_80`, jeweils PTX ISA `9.4` |
| Native Ziele | `sm_86`, `sm_89`, `sm_120a`, `sm_121a` |

Am 25. Oktober 2026 wurde das veröffentlichte Archiv heruntergeladen und gegen die Manifestprüfsumme geprüft. In `ggml-cuda.dll` wurden 144 CUDA-Fatbinary-Container mit jeweils sechs Einträgen gefunden. Die Zstandard-komprimierten Nutzdaten wurden entpackt: jeweils 144 PTX-Einträge mit `.target sm_75` beziehungsweise `.target sm_80` und `.version 9.4`; außerdem jeweils 144 native ELF-Einträge für die vier genannten Ziele. ELF-Flags und enthaltene Architekturnamen wurden abgeglichen. Dies ist eine statische Binäranalyse auf macOS, kein CUDA-Inferenztest. NVIDIA `cuobjdump --dump-ptx ggml-cuda.dll` beziehungsweise `--list-elf` kann auf einem Rechner mit passenden NVIDIA-Entwicklungswerkzeugen zum unabhängigen Abgleich verwendet werden.

Die Architekturuntergrenze der enthaltenen GPU-Programme ist somit **Compute Capability 7.5**. Native Programme sind für die explizit genannten Ziele enthalten. Für die virtuellen Ziele muss der installierte Treiber den enthaltenen PTX-Code, insbesondere dessen ISA-Version 9.4, übersetzen können. Architekturabdeckung allein garantiert daher keine funktionierende CUDA-Generierung; Treiber und verfügbare CUDA-/cuBLAS-Laufzeitabhängigkeiten müssen ebenfalls passen. Eine konkrete minimale Treiberversion wurde mit diesem Archiv nicht praktisch verifiziert. Die pauschale Release-Beschreibung „RTX 30xx und neuer“ ersetzt diese Unterscheidung nicht.

Die App bindet diese Kompatibilitätsmetadaten an Engine-Revision **und** Archivprüfsumme. Ändert sich eine davon, gelten die alten Angaben nicht weiter. NVIDIA-Compute-Capability und Treiberversion werden optional abgefragt. Schlägt die erweiterte Abfrage fehl, bleibt die bestehende Erkennung von Name und VRAM erhalten. Bei mehreren NVIDIA-GPUs wird ohne eindeutige Zuordnung keine Architekturursache behauptet.

### GTX 1060 / Pascal

Die GTX 1060 besitzt laut [NVIDIA-GPU-Tabelle](https://developer.nvidia.com/cuda/gpus/legacy) **Compute Capability 6.1**. Für sie enthält das untersuchte Archiv weder native GPU-Programme noch ein passendes PTX-Ziel. NVIDIA hat die Offline-Kompilierungs- und Bibliotheksunterstützung für Pascal ab [CUDA Toolkit 13.0](https://docs.nvidia.com/cuda/archive/13.0.0/cuda-toolkit-release-notes/#deprecated-architectures) entfernt. Ein neuerer Treiber allein fügt diesem Archiv keine Pascal-Programme hinzu.

Wird auf einem eindeutig erkannten Pascal-Rechner tatsächlich Vulkan oder CPU beobachtet, erklärt die App die fehlende CUDA-Architekturunterstützung. Vor einer Ausführung ist dies lediglich die Build-Kompatibilitätsangabe; ein erfolgter Fallback wird daraus nicht abgeleitet.

### Linux und macOS

Die Windows-Untergrenze gilt nicht für die separate Linux-CUDA-AppImage. Deren CUDA-12.8.1-Rezept und SM-Ziele stehen in `models/cuda-linux.json`; die reguläre Linux-AppImage enthält Vulkan/CPU. Apple-Silicon-Bundles verwenden Metal/CPU, Intel-Mac-Bundles ausschließlich CPU. Die Nutzungsanzeige bleibt auch dort an aktuelle Ausführungsbelege gebunden.

## Optionaler CUDA-Download unter Windows (Issue #58)

Der Einrichtungsassistent prüft bei erkannter NVIDIA-GPU zuerst den Treiber (`nvcuda.dll`, `cuInit`), dann die CUDA-/cuBLAS-Laufzeit und schließlich die Initialisierung von `CUDA0` durch das enthaltene GGML-Backend. Die Prüfung läuft ohne Modelle in einem separaten Prozess mit zehn Sekunden Zeitlimit. Ein Ladefehler bedeutet nicht automatisch einen veralteten Treiber: Bibliotheken können fehlen oder andere Ladeprobleme haben. Technische Fehler stehen aufklappbar in der Diagnose. Treiberfehler erhalten einen Link zum offiziellen NVIDIA-Treiberdownload; unbekannte Fehler werden nicht als gesicherte Treiberursache dargestellt.

Sind Laufzeitbibliotheken nicht ladbar, bietet **CUDA-Unterstützung herunterladen** den optionalen Download an. `models/cuda-windows.json` bindet die NVIDIA-Archive und ihre SHA-256-Prüfsummen an die Windows-Engine-Revision und Archivprüfsumme. Für eine neue Engine müssen diese Angaben erneut geprüft werden. Die Downloadgröße beträgt 402.682.743 Bytes (rund 384 MiB), temporär werden 1,5 GiB freier Speicher verlangt. Quelle ist das [offizielle NVIDIA-Komponentenmanifest für CUDA 13.0.0](https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.0.0.json).

Der Download nutzt die vorhandene fortsetzbare Download- und Prüfsummenprüfung. Aus den verifizierten ZIPs werden ausschließlich `cudart64_13.dll`, `cublasLt64_13.dll`, `cublas64_13.dll` sowie die beiden `LICENSE`-Dateien übernommen. Compiler, Treiber und weitere DLLs werden nicht installiert. Fortschritt, Abbruch und Wiederholung stehen im Assistenten bereit. Fehlerhafte oder abgebrochene Entpackvorgänge aktivieren kein unvollständiges Verzeichnis.

Die Dateien liegen unter `<App-Datenverzeichnis>/cuda/13.0.0-<Installations-ID>/`. Erst nach vollständiger Extraktion wird `cuda/active.json` atomar auf das neue Verzeichnis umgestellt. Die gebündelte Engine und systemweite Einstellungen bleiben unverändert; Administratorrechte sind nicht erforderlich. Nur die gestarteten Engine- und Prüfprozesse erhalten den zusätzlichen `PATH`-Eintrag. Eine bereits funktionierende systemweite oder mitgelieferte Laufzeit benötigt keinen Download. Nach erfolgreicher Installation werden die komprimierten Archive entfernt, bei Abbruch bleiben sie für eine Fortsetzung erhalten.

Während der Installation wird die bestehende Engine angehalten; die normale Operationssperre verhindert Überschneidungen mit Generierungen oder Konfigurationsänderungen. Anschließend werden CUDA und die modellfreie Backend-Erkennung erneut geprüft. **CUDA verfügbar** bestätigt Geräteinitialisierung, weiterhin keine ausgeführte Synthese.

Automatisiert geprüft sind ZIP-Auswahl, Lizenzübernahme, unvollständige Archive, mehrdeutige Dateinamen, Pfadbegrenzung, Abbruch und atomare Aktivierung sowie der Assistent einschließlich Fehlern, Wiederholung und Sprachwechsel (Deutsch/Englisch; andere Sprachen verwenden den vorhandenen englischen Fallback). Die Dateinamen und Lizenzpfade wurden zusätzlich anhand der offiziellen ZIP-Verzeichnisse verifiziert. Eine vollständige Installation und anschließende Generierung auf Windows mit NVIDIA-Hardware ist hier noch nicht abgenommen. Dafür auf einem Windows-Rechner ohne CUDA Toolkit den Download ausführen, die erneute Prüfung abwarten und einen kurzen Song generieren; die Backend-Anzeige muss die tatsächliche CUDA-Synthese bestätigen. Auch eine Installation unter `Program Files`, ein Pfad mit Leerzeichen/Umlauten und ein App-Neustart sind dabei zu prüfen.

## Noch erforderliche Hardwareabnahme

Der [Testbericht aus Issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) beschreibt funktionierende Vulkan-Generierung mit v0.1.0 auf Windows 10 und GTX 1060 6 GB: Standardmodell/0.6B, 30 Sekunden, 80 Iterationen, Laufzeiten 1:30 und 1:40 Minuten. Treiberversion und vollständige Logs fehlen. Dieser historische Bericht ersetzt keine Abnahme der neuen Anzeige.

Für eine neue Abnahme auf GTX 1060 oder gleichwertiger Pascal-Hardware:

1. App-Version, Windows-Version, GPU, Compute Capability und Treiberversion festhalten.
2. Assistenten ausführen: Architekturhinweis prüfen; Ergebnis muss das beobachtete Sprachmodell-Backend und den passenden Grund zeigen. Ungetestete Synthese darf noch nicht bestätigt sein. Der Assistent bleibt beim Ergebnis stehen.
3. Mit **Zum Studio** wechseln und mit Standardmodell/0.6B einen Song mit 30 Sekunden und 80 Iterationen erzeugen.
4. Backend-Details mit den neuen `[Load] LM backend:`- und `[Load] DiT backend:`-Zeilen vergleichen; bei Vulkan den Architekturhinweis prüfen.
5. Sprachmodell ausdrücklich auf CPU stellen und erneut verwenden: CPU-Auswahl muss erkennbar sein, die Synthese darf weiterhin Vulkan verwenden. Sprachwechsel sowie App-Neustart ohne Übernahme alter aktiver Backend-Werte prüfen.

Diese neue Windows-/Pascal-Abnahme ist **offen**. Automatisierte Log-, Vertrags- und UI-Tests sowie die Vorschau mit Beispieldaten sind keine Messung auf Pascal-Hardware.
