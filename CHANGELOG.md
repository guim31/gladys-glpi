# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-22

### Added

- GLPI 10, 11 and 12 in Gladys, through the legacy REST API with a user token
  (and an application token when the API client has one).
- A "GLPI" device with six counters: open, new, in progress, pending, late
  (time to resolve exceeded) and solved today tickets.
- The "Latest GLPI tickets" dashboard widget: open, late and new counts, and the
  eight newest open tickets, late and urgent ones flagged.
- Scene triggers "New GLPI ticket", "GLPI ticket late" and "GLPI ticket solved",
  filtered by urgency and type, with the ticket's title, urgency, type,
  category, entity, requester and link as variables.
- Scene actions "Create a GLPI ticket" (description with scene variables,
  urgency, type, category, entity) and "Add a follow-up to a GLPI ticket".
- A "Test the connection" action, and the documentation in English, French,
  German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-glpi/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-glpi/releases/tag/v1.0.0
