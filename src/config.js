// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One GLPI (its address, the user token of one of its users and, when the
// API client asks for one, an application token), read on a timer of the
// container.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['60', '120', '300', '600'];

export const DEFAULT_CONFIG = {
  url: '',
  user_token: '',
  app_token: '',
  allow_self_signed: false,
  poll_interval: '300',
  language: 'fr',
};

/**
 * Parse the address typed by the user into the base URL of GLPI: a bare host
 * (`192.0.2.30`), the URL copied from the browser
 * (`https://helpdesk.example.org/glpi/front/central.php`) or the API URL shown
 * in GLPI (`…/apirest.php`). HTTP by default. A path prefix is kept (GLPI
 * under `/glpi`), the API path and the screens of the web app are dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/prefix]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname
    .replace(/\/(apirest\.php|api\.php|api)(\/.*)?$/, '')
    .replace(/\/(front|index\.php|public|Helpdesk)(\/.*)?$/, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

const bool = (value) => value === true || value === 'true';
// Tokens are kept as typed, minus the blanks a copy and paste adds around them.
const token = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = typeof source.url === 'string' ? source.url.trim() : '';
  const poll = String(source.poll_interval ?? '');
  return {
    url: parseServerUrl(typed),
    urlTyped: typed !== '',
    userToken: token(source.user_token),
    appToken: token(source.app_token),
    allowSelfSigned: bool(source.allow_self_signed),
    pollIntervalMs:
      Number(POLL_INTERVALS.includes(poll) ? poll : DEFAULT_CONFIG.poll_interval) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
