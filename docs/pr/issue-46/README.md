# UI-Nachweise zu Issue #46

Aufgenommen am 27. Oktober 2026 mit den tatsächlichen Setup- und i18n-Modulen des Implementierungsstands `4481a87`. Die isolierte Browser-Vorschau ersetzt ausschließlich native Backend-Antworten; Hardware, Speichergrößen und Pfade sind simulierte Beispieldaten. Es wurden keine Modelle geladen und keine Benutzerdaten geändert. Dies ist keine native Windows-/GTX-1060-Abnahme.

- `windows-de.png`: Allgemeiner Ordnerhinweis ohne macOS-Freigabetext unter Windows auf Deutsch.
- `macos-de.png`: Derselbe Assistent unter macOS mit dem dort weiterhin erforderlichen Freigabehinweis.
- `windows-en.png`: Allgemeiner Hinweis unter Windows auf Englisch.

Die automatisierten Tests decken zusätzlich Linux, alle zwölf Übersetzungen, den Sprachwechsel im offenen Assistenten und das erneute Öffnen mit geänderter Plattform ab. Titelbereinigung, dauerhafter Zufallstitel-Fallback und die Iterationspersistenz sind im [Prüfprotokoll](../../verification.md) dokumentiert.
