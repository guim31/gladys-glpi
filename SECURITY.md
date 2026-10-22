# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps and sends:

- the GLPI address, the user token and the optional application token live in
  the configuration of the integration, stored by Gladys; they are never
  written to the logs;
- `/data/glpi-state.json` holds the address of GLPI, the id of the GLPI user,
  the highest ticket number seen and the numbers of the open and late tickets
  (to fire each scene event once): no title, no content, no token;
- the integration only talks to the GLPI address of the configuration (HTTP or
  HTTPS), with the session token GLPI gives it; it acts with the rights of that
  GLPI user, so give it a dedicated user with the smallest profile that fits.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
GLPI, and the other third-party services and devices.
