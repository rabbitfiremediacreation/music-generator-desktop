# Audio-Metadaten prüfen

Geprüft auf macOS arm64 mit `ffprobe 9.0.2`. Die Audiodaten stammen aus einem kurzen Testsignal. Die App-Speicherroutine erhielt das echte MuLaCover-Katalogprofil und die gespeicherten Angaben zu einer Referenzaufnahme. Der Audio- und ZIP-Export lief über das reguläre Exportmodul. MP3 wurde mit dem mitgelieferten `mp3-codec` erzeugt, Ogg und AAC mit FFmpeg.

| Datei | Ergebnis mit `ffprobe` |
| --- | --- |
| Aus dem Songordner kopierte WAV- und MP3-Dateien | Modell, Variante, Revision, Ausgabebedingungen, Quelle und Hinweis zur Aufnahme lesbar |
| Original-WAV, einzeln und aus ZIP entpackt | Dateibytes identisch mit der gespeicherten WAV |
| MP3 mit 128, 192 und 320 kbit/s, einzeln und aus ZIP entpackt | Je Preset identische Dateibytes und vollständige Angaben |
| Ogg/Opus, einzeln und aus ZIP entpackt | Identische Dateibytes und vollständige Angaben |
| AAC/ADTS, einzeln und aus ZIP entpackt | Identische Dateibytes ohne App-Metadaten. Menü nennt die Einschränkung. |

Der aus der WAV dekodierte PCM-Stream hatte vor und nach dem Schreiben der Tags denselben MD5-Wert. Die MP3-Speicherroutine behielt alle ursprünglichen MPEG-Frames bei. Die gespeicherten Ausgabebedingungen nennen die nichtkommerzielle Nutzung und schriftliche Genehmigung durch MuLa Labs für kommerzielle Nutzung. [Quelle im Dateitag](https://huggingface.co/HeartMuLa/MuLaCover/blob/0f5ca612a41134738a14a28f95ed80bfa9b52adc/MODEL_LICENSE)

Im Desktop-Formatmenü wurden die Hinweise und der Tastaturfokus in WebKit und Chromium mit Testdaten geprüft. Für einen eigenen Export liest der folgende Befehl den Kommentar aus der kopierten oder entpackten Datei.

```sh
ffprobe -v error -show_entries format_tags=comment:stream_tags=comment -of json datei.wav
```
