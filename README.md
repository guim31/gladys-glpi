# GLPI for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[GLPI](https://glpi-project.org), the open-source IT asset management and
service desk software: ticket counters on a device, a dashboard widget, scene
triggers on new, late and solved tickets, and scene actions that open a ticket
or add a follow-up, so a failure Gladys detects becomes a ticket by itself.

It runs as an external integration: a small Node.js service in its own
sandboxed container, talking to Gladys through the
[integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and to
GLPI through its legacy REST API (`apirest.php`).

## Features

- **Device "GLPI"**: open, new, in progress, pending, late (time to resolve
  exceeded) and solved today tickets, as counters with history.
- **Widget "Latest GLPI tickets"**: open, late and new counts, and the eight
  newest open tickets with their status, urgency and entity, late ones flagged.
- **Scene triggers**: new ticket, ticket late, ticket solved, filtered by urgency
  and type; title, urgency, type, category, entity, requester and link as
  variables.
- **Scene actions**: create a ticket (title, description with scene variables,
  urgency, type, category, entity), add a follow-up to a ticket.
- Four languages (English, French, German, Spanish).

## Requirements

- Gladys Assistant 5.1.0 or later.
- GLPI 10, 11 or 12 (self-hosted, or hosted such as GLPI Network Cloud), with
  the legacy REST API and login with an external token turned on, an API client
  that accepts the address of Gladys, and the API token of a GLPI user.

## Installation

In Gladys: **Integrations** → **Install from GitHub**, with the address of this
repository: `https://github.com/guim31/gladys-glpi`. Once it is in the store,
install **GLPI** from the integration list instead.

Then fill in the address of GLPI and the user token on the **Configuration**
screen, and add the **GLPI** device from the **Discovery** tab. The setup on the
GLPI side is in the [documentation](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

- A session is opened with the user token (and the application token, when the
  API client has one); it is opened again when it expires.
- Every 1 to 10 minutes (configurable), one search asks GLPI for the open
  tickets and those solved since midnight. GLPI itself computes "late" (its
  "Time to resolve exceeded") and "today", so no time zone is guessed.
- The scene events come from the difference with the previous reading, saved in
  `/data`: a ticket number above the highest one seen is new, an open ticket now
  flagged late is late, a ticket open before and solved now is solved. The first
  reading only takes note. Tickets created by the scene action never fire "new
  ticket", so a scene cannot loop.
- The device is published with `should_poll: false`: the container reads on its
  own timer, and only the changed counters are sent to Gladys.

## Checked on a real GLPI, and what was not

Checked in Docker against the official `glpi/glpi` images **10.0.28, 11.0.11
and 12.0.0** (with MariaDB 11), installed from the command line, API turned on
and tokens set: the session, the ticket search of the three versions (real
answers kept in `test/fixtures/glpi/`), the error of every refusal (wrong user
or application token, address refused, API off, expired session, range past the
total, missing ticket), ticket creation and follow-ups, and the integration in
its locked-down container against GLPI 11.

Not checked: GLPI 9.5 and older, GLPI Network Cloud, an LDAP or SSO user, a GLPI
behind a reverse proxy, and a real Gladys instance (the tests use the SDK's fake
Gladys).

## Limitations

- One GLPI per installation, one device for every ticket the user sees (no
  device per entity).
- The 5,000 newest open or solved-today tickets are counted.
- The new GLPI 11 API (OAuth2) is not used: the legacy REST API exists in GLPI
  10, 11 and 12.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against an in-memory GLPI (`test/helpers/fakeGlpi.js`) that
answers like the real one, and against the SDK's fake Gladys. They never touch
the network.

## Credits

- [GLPI](https://glpi-project.org) by Teclib' and the GLPI contributors
  (GPL-3.0): the integration only talks to its REST API; no code was copied. The
  cover uses the GLPI logo from the official
  [glpi-project/glpi](https://github.com/glpi-project/glpi) repository
  (`public/pics/logos/sources/GLPI_Logo-white.svg`), to name
  the service.
- The architecture and the conformity tests follow
  [gladys-vikunja](https://github.com/guim31/gladys-vikunja) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Teclib' or the
GLPI project. The GLPI name and logo belong to their owners.

## License

Apache-2.0
