# CUDA-Speicherplatz: Nachprüfung von Issue #69

Prüfstand: 7. November 2026, `main` bei
`aa151677f7d36b43d7c0a8203b12e313bd479e16`, einschließlich PR #72
(`57c339e`, Merge `29beab3`). [Issue #69](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/69)
hat keine Kommentare. Der ursprüngliche Melder nennt in
[#58](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/58#issuecomment-6655394748)
ungefähr 3 GB freien Platz und ein möglicherweise laufendes Update. Daraus lässt
sich die ursprüngliche Erstversuch-/Zweitversuch-Ursache nicht bestimmen. Die
Anzeige von rund 0,4 GiB im Assistenten bezeichnet den Downloadumfang.

Ein verbleibender Fehler wurde in den geprüften Szenarien nicht reproduziert.
Die Änderungen dieser Nachprüfung ergänzen ausschließlich Tests und diese
Dokumentation; Speicherprüfungen, Übersetzungen und Installationsverhalten bleiben
unverändert.

## Praktischer Test mit begrenztem Speicher

`cuda_runtime::space_tests::pinned_installation_and_retries_on_a_small_real_volume`
verwendet die produktiven Funktionen `required_space`, `download_model`,
`installation_space`, `publish` und `installed`. Der Test lädt beide originalen,
gepinnten NVIDIA-ZIPs und prüft ihre SHA-256-Werte. Eine eigene HFS+-Testpartition
auf macOS bot anfangs **1.111.404.544 Bytes** freien Platz. Alle Dateien liegen in
einem temporären Unterordner mit Leerzeichen und Umlaut; der Ordner wird am Ende
entfernt. Platzknappheit entsteht durch tatsächlich geschriebene Blöcke auf dieser
Partition, nicht durch eine simulierte Freiplatzabfrage oder Füllen des Systemlaufwerks.

Bestätigte Fälle:

- Der frische Download und die anschließende vollständige Veröffentlichung
  gelingen im ersten Durchlauf mit genügend Platz. Die Vorprüfung verlangt
  **998.583.053 Bytes**, weniger als die alte Grenze von 1,5 GiB.
- Bei **997.531.648 Bytes** frei scheitern zwei Vorprüfungen nachvollziehbar und
  ohne Cache-Änderung. Nach Entfernen der Fülldatei besteht die Prüfung.
- Die tatsächlichen ausgewählten DLLs und Lizenzen umfassen **528.791.446 Bytes**;
  die Pins stimmen mit den ZIP-Einträgen und den extrahierten Dateien überein.
- Vollständige ZIPs und vollständige `.part`-Dateien reduzieren den berechneten
  Restbedarf auf **595.900.310 Bytes** einschließlich Reserve. Verifizierte ZIPs
  werden auch mit unerreichbarer Download-URL wiederverwendet.
- Ein beschädigtes Cache-ZIP wird bei beiden Versuchen als Prüfsummenfehler
  abgewiesen; ein zweiter Versuch macht es nicht gültig.
- Sinkt der freie Platz nach dem Download auf **594.849.792 Bytes**, verweigert
  `publish` zweimal das Entpacken. Aktivierungszeiger und Archive bleiben erhalten,
  es entsteht kein Staging-Verzeichnis. Nach Freigabe des Platzes gelingt die
  Veröffentlichung aus dem Cache.

Der Test ist absichtlich `ignored`: Er benötigt Netzwerk, etwa 403 MB Download
und ein ausdrücklich bereitgestelltes Wegwerf-Laufwerk mit maximal 2 GiB Kapazität.
So lässt er sich auf macOS aus dem Repository-Stamm wiederholen:

```sh
npm ci
npm run build
test_dir=$(mktemp -d /private/tmp/cuda-space-test.XXXXXX)
hdiutil create -size 1200m -fs HFS+ -volname CUDA-Space-Test -type SPARSE -o "$test_dir/cuda.sparseimage"
hdiutil attach -nobrowse -mountpoint "$test_dir/volume" "$test_dir/cuda.sparseimage"
MUSIC_GENERATOR_CUDA_SPACE_TEST_ROOT="$test_dir/volume" cargo test --manifest-path src-tauri/Cargo.toml --locked --lib cuda_runtime::space_tests -- --ignored --nocapture
hdiutil detach "$test_dir/volume"
rm "$test_dir/cuda.sparseimage"
rmdir "$test_dir"
```

Auch bei einem Testfehler das Image anschließend aushängen und entfernen.

## Weitere Regressionen und Grenzen

Die normalen Downloadtests prüfen HTTP 206/200 (Fortsetzen bzw. Neustart), falsche
Ranges, falsche Prüfsummen, Abbruch und die Wiederherstellung einer vollständigen
`.part` nach HTTP 416. Neu hinzu kommen die wiederholte Ablehnung eines beschädigten
Cache-Files sowie die Freiplatzprüfung vor dem Ändern einer `.part`, wenn die
Serverantwort einen unerfüllbaren Restbedarf meldet. Letztere verwendet einen
lokalen HTTP-Testserver mit künstlich großem `Content-Range`, keinen großen Download.
Die CUDA-Unit-Tests prüfen außerdem ausgewählte ZIP-Einträge, fremde/überlange
Teil-Downloads, Abbruch, fehlerhafte Archive und die atomare Aktivierung.

Ausgeführte Prüfungen (Rust jeweils mit `--locked --offline`):

- `cargo test --manifest-path src-tauri/Cargo.toml --lib cuda_runtime`: 7 bestanden,
  der oben beschriebene manuelle Test regulär ignoriert.
- `cargo test --manifest-path src-tauri/Cargo.toml --test download`: 11 bestanden.
- Expliziter Lauf des ignorierten Tests auf dem Test-Image: 1 bestanden.
- `npm test -- frontend/react/setup/CudaSetup.test.tsx`: 16 bestanden.
- `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`,
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  und `git diff --check`: bestanden.
- Zusätzlicher Library-Gesamtlauf: 171 bestanden, 2 ignoriert, 1 fehlgeschlagen.
  `mcp::settings::tests::network_scope_rebinds_fixed_port_and_authenticates_real_lan_requests`
  scheitert auch isoliert beim Zugriff auf `10.90.0.0` mit `AddrNotAvailable`
  (`Can't assign requested address`). Dieser Test betrifft den MCP-LAN-Zugriff;
  dessen Code wurde für Issue #69 nicht geändert.

Die praktische Prüfung umgeht bewusst den Windows-Plattform-/Hardware-Einstieg
von `install` und ruft dessen Datei- und Downloadfunktionen auf. Sie prüft weder
den echten Windows-Assistenten noch NTFS, Windows-Freiplatz-APIs, Treiber, das Laden
der DLLs oder CUDA-Inferenz. Der Erstklick-/Zweitklick-Bericht ist deshalb nicht als
auf Windows abschließend behoben nachgewiesen. Eine erneute Meldung mit aktuellem
Build sollte die inzwischen ausgegebenen Zielpfade sowie erforderlichen und freien
Bytes beider Versuche enthalten.
