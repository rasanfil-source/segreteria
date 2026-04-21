# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- Added the new system label `SISTEMA/Ignora_IT` to mark Italian messages intentionally skipped while language mode is set to `foreign_only`.

### Changed

- In `foreign_only` mode, Italian emails skipped in the high-confidence language branches are now tagged with the skip label instead of re-entering discovery forever.
- Gmail discovery now excludes the skip label dynamically in both `query` and `metadata` modes, keeping behavior consistent across both discovery paths.
- When a message becomes processable again and receives the `IA` label, the `SISTEMA/Ignora_IT` label is automatically removed to avoid stale UI residue in Gmail.

### Fixed

- Resolved the operational ambiguity between application logs and Gmail conversation view: a thread may still display a historical label, but Italian messages skipped in `foreign_only` now have a dedicated and auditable marker.
- Reduced the risk of thread-level loops with multiple unread messages by applying the skip label to all unread, still-unlabeled messages in the thread within the safe language branches.

## [1.0.0] - Initial Release

- Initial release of the system.
