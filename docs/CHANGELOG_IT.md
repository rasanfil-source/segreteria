# Changelog

Modifiche significative a questo progetto saranno documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
e questo progetto aderisce a [Semantic Versioning](https://semver.org/lang/it/).

---

## [Unreleased]

### Added

- Aggiunta la nuova label di sistema `·` per marcare i messaggi italiani saltati intenzionalmente quando la modalità lingua è `foreign_only`.

### Changed

- In modalità `foreign_only`, le email italiane saltate nei rami a confidenza alta vengono ora marcate con la label di skip invece di rientrare all'infinito nella discovery.
- La discovery Gmail esclude dinamicamente la label di skip sia in modalità `query` sia in modalità `metadata`, mantenendo coerente il comportamento tra i due percorsi.
- Quando un messaggio torna processabile e viene marcato con `IA`, la label `·` viene rimossa automaticamente per evitare residui visivi in Gmail.

### Fixed

- Risolta l'ambiguità operativa tra log applicativi e vista conversazione di Gmail: un thread può mostrare una label storica, ma i messaggi italiani saltati in `foreign_only` hanno ora una marcatura dedicata e verificabile.
- Ridotto il rischio di loop sui thread con più messaggi non letti, applicando la label di skip a tutti i messaggi non letti non ancora etichettati del thread nei rami lingua sicuri.

## [1.0.0] - Rilascio Iniziale

- Rilascio iniziale del sistema.
