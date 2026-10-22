// -----------------------------------------------------------------------------
// GLPI API client: the legacy REST API (`/apirest.php`), the one GLPI 9.1 to
// 12 all serve. A session is opened with the user token of a GLPI user
// (`Authorization: user_token …`) and, when the API client asks for one, an
// application token (`App-Token`); every other call carries the
// `Session-Token` it returns. Checked against the official glpi/glpi images
// 10.0.28, 11.0.11 and 12.0.0 in Docker, October 2026.
//
//   GET  /initSession                  { session_token }
//   GET  /getFullSession               { session: { glpiID, glpiactiveprofile… } }
//   GET  /getGlpiConfig                { cfg_glpi: { version… } }
//   GET  /search/Ticket?criteria…      { totalcount, data: [{ "<field id>": value }] }
//   GET  /Ticket/:id                   Ticket
//   POST /Ticket                       { id, message } (201)
//   POST /Ticket/:id/ITILFollowup      { id, message } (201)
//   GET  /User/:id                     User
//   GET  /ITILCategory?range=0-999     ITILCategory[]
//   GET  /getMyEntities?is_recursive=1 { myentities: [{ id, name }] }
//   GET  /killSession
//
// Pitfalls found on the real servers:
//   - An error is a JSON array `["ERROR_CODE", "message"]`, mostly with a 400:
//     a wrong application token, an address refused by the API client and the
//     API turned off are all 400s, only a wrong user token is a 401.
//   - A session that expired (or a server restarted) answers
//     ERROR_SESSION_TOKEN_MISSING: the client opens a new one and tries again.
//   - A range past the last item is a 400 (ERROR_RANGE_EXCEED_TOTAL): pages
//     are asked for within `totalcount` only.
//   - A follow-up on a ticket that does not exist is a 400 "You don't have
//     permission", not a 404: the ticket is read first.
//   - A ticket created through the API has no requester unless one is given
//     (`_users_id_requester`), and an unknown category id is accepted
//     silently: both are filled in and checked by the caller.
//   - The dates are naive strings in the time zone of the GLPI server; the
//     integration compares none of them itself (GLPI's search engine computes
//     "late" and "today").
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // the user token is wrong, or its user cannot log in
  APP_TOKEN: 'app_token', // the API client wants an application token, or another one
  IP: 'ip', // no active API client accepts the address of Gladys
  API_DISABLED: 'api_disabled', // Setup > General > API: the REST API is off
  RIGHTS: 'rights', // the profile of the user lacks a right
  NOT_GLPI: 'not_glpi', // something answers, but not the GLPI API
  REDIRECT: 'redirect', // HTTP redirected to HTTPS, or a login portal
  HTTP: 'http', // any other unexpected answer
});

export class GlpiError extends Error {
  constructor(kind, message, status, code) {
    super(message);
    this.name = 'GlpiError';
    this.kind = kind;
    this.status = status;
    /** GLPI's own error code (first item of the error array), e.g. ERROR_ITEM_NOT_FOUND. */
    this.code = code;
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const KIND_OF_CODE = {
  ERROR_GLPI_LOGIN_USER_TOKEN: ERROR_KINDS.AUTH,
  ERROR_LOGIN_PARAMETERS_MISSING: ERROR_KINDS.AUTH,
  ERROR_GLPI_LOGIN: ERROR_KINDS.AUTH,
  ERROR_APP_TOKEN_PARAMETERS_MISSING: ERROR_KINDS.APP_TOKEN,
  ERROR_WRONG_APP_TOKEN_PARAMETER: ERROR_KINDS.APP_TOKEN,
  ERROR_NOT_ALLOWED_IP: ERROR_KINDS.IP,
  ERROR_RIGHT_MISSING: ERROR_KINDS.RIGHTS,
};

const SESSION_CODES = new Set(['ERROR_SESSION_TOKEN_MISSING', 'ERROR_SESSION_TOKEN_INVALID']);

// Search option ids of a Ticket (GET /listSearchOptions/Ticket), the same in
// GLPI 10, 11 and 12.
export const FIELDS = Object.freeze({
  TITLE: 1,
  ID: 2,
  REQUESTER: 4,
  CATEGORY: 7,
  URGENCY: 10,
  STATUS: 12,
  TYPE: 14,
  OPENED: 15,
  SOLVED: 17,
  TIME_TO_RESOLVE: 18,
  ENTITY: 80,
  LATE: 82, // "Time to resolve exceeded", computed by GLPI
});

export const PAGE_SIZE = 500;
export const MAX_PAGES = 10;

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new GlpiError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  if (String(err.code ?? '').startsWith('HPE_')) {
    // Something answers on that port, but not in HTTP (a database, SSH…).
    return new GlpiError(ERROR_KINDS.NOT_GLPI, `${err.code}`);
  }
  return new GlpiError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

/** The query string of the ticket search: open tickets, and those solved today. */
export function ticketSearchQuery(start, end) {
  const params = new URLSearchParams();
  const criterion = (index, values) => {
    for (const [key, value] of Object.entries(values)) {
      params.append(`criteria[${index}][${key}]`, String(value));
    }
  };
  criterion(0, { field: FIELDS.STATUS, searchtype: 'equals', value: 'notold' });
  // TODAY: midnight in the time zone of the GLPI server, computed by GLPI.
  criterion(1, { link: 'OR', field: FIELDS.SOLVED, searchtype: 'morethan', value: 'TODAY' });
  Object.values(FIELDS).forEach((field, index) => {
    params.append(`forcedisplay[${index}]`, String(field));
  });
  params.append('sort', String(FIELDS.ID));
  params.append('order', 'DESC');
  params.append('range', `${start}-${end}`);
  return params.toString();
}

export class GlpiClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL of GLPI, without trailing slash
   * @param {string} options.userToken API token of a GLPI user (its preferences)
   * @param {string} [options.appToken] application token of the API client, if it has one
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/glpi/http.js)
   */
  constructor({ url, userToken, appToken = '', insecure = false, request = httpRequest }) {
    this.url = url;
    this.userToken = userToken;
    this.appToken = appToken;
    this.insecure = insecure;
    this.request = request;
    this.sessionToken = null;
    this.opening = null;
  }

  async raw(path, { method = 'GET', json, headers = {} } = {}) {
    let response;
    try {
      response = await this.request(`${this.url}/apirest.php${path}`, {
        method,
        json,
        insecure: this.insecure,
        headers: {
          ...(this.appToken ? { 'app-token': this.appToken } : {}),
          ...headers,
        },
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body, headers: answer = {} } = response;
    let parsed;
    let parsedOk = true;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsedOk = false;
    }
    if (status >= 300 && status < 400) {
      throw new GlpiError(ERROR_KINDS.REDIRECT, `HTTP ${status}`, status);
    }
    if (!parsedOk) {
      // Another site, or GLPI's web pages: an HTML answer.
      throw new GlpiError(
        [200, 404].includes(status) ? ERROR_KINDS.NOT_GLPI : ERROR_KINDS.HTTP,
        `HTTP ${status}, not JSON`,
        status,
      );
    }
    if (status >= 200 && status < 300) {
      return { data: parsed, headers: answer };
    }
    const isGlpiError = Array.isArray(parsed) && typeof parsed[0] === 'string';
    const code = isGlpiError ? parsed[0] : undefined;
    // GLPI's own message, short; it never echoes the tokens. The address of
    // its documentation that follows is left out.
    const said = isGlpiError
      ? ` ${String(parsed[1] ?? '')
          .replace(/;\s*view documentation.*$/, '')
          .slice(0, 200)}`
      : '';
    let kind = KIND_OF_CODE[code];
    if (!kind && code === 'ERROR' && /API disabled/i.test(String(parsed[1]))) {
      kind = ERROR_KINDS.API_DISABLED;
    }
    if (!kind && /permission/i.test(said)) {
      kind = ERROR_KINDS.RIGHTS;
    }
    if (!kind && status === 401) {
      kind = ERROR_KINDS.AUTH;
    }
    if (!kind && !isGlpiError && status === 404) {
      kind = ERROR_KINDS.NOT_GLPI;
    }
    throw new GlpiError(kind ?? ERROR_KINDS.HTTP, `HTTP ${status}${said}`, status, code);
  }

  /** Open a session (one at a time, shared by the calls waiting for it). */
  openSession() {
    this.opening ??= (async () => {
      try {
        const { data } = await this.raw('/initSession', {
          headers: { authorization: `user_token ${this.userToken}` },
        });
        if (typeof data?.session_token !== 'string' || data.session_token === '') {
          throw new GlpiError(ERROR_KINDS.NOT_GLPI, 'no session_token in initSession', 200);
        }
        this.sessionToken = data.session_token;
        return this.sessionToken;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  /** A call within the session, opened (again) when needed. */
  async call(path, options = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const token = this.sessionToken ?? (await this.openSession());
      try {
        return await this.raw(path, {
          ...options,
          headers: { 'session-token': token },
        });
      } catch (err) {
        if (attempt === 0 && err instanceof GlpiError && SESSION_CODES.has(err.code)) {
          // Expired, or the server restarted: a new session, once.
          if (this.sessionToken === token) {
            this.sessionToken = null;
          }
          continue;
        }
        throw err;
      }
    }
  }

  /** Close the session, if any (best effort: it expires on its own anyway). */
  async close() {
    const token = this.sessionToken;
    this.sessionToken = null;
    if (!token) {
      return;
    }
    try {
      await this.raw('/killSession', { headers: { 'session-token': token } });
    } catch {
      // ignored
    }
  }

  /** `{ userId, user, profile, interface, entity }` of the session. */
  async session() {
    const { data } = await this.call('/getFullSession');
    const session = data?.session;
    if (!session || typeof session !== 'object') {
      throw new GlpiError(ERROR_KINDS.NOT_GLPI, 'no session in getFullSession', 200);
    }
    const profile = session.glpiactiveprofile ?? {};
    return {
      userId: Number(session.glpiID) || 0,
      user: String(session.glpifriendlyname || session.glpiname || ''),
      profile: String(profile.name ?? ''),
      interface: String(profile.interface ?? ''),
      entity: String(session.glpiactive_entity_name ?? ''),
    };
  }

  /** The version of GLPI, null when the profile may not read it. */
  async version() {
    try {
      const { data } = await this.call('/getGlpiConfig');
      const version = data?.cfg_glpi?.version;
      return typeof version === 'string' ? version : null;
    } catch (err) {
      if (err instanceof GlpiError && [ERROR_KINDS.RIGHTS, ERROR_KINDS.HTTP].includes(err.kind)) {
        return null;
      }
      throw err;
    }
  }

  /**
   * The open tickets and those solved today, newest first: the raw rows of
   * the search engine, keyed by field id, at most PAGE_SIZE × MAX_PAGES.
   * @returns {Promise<{ rows: object[], total: number }>}
   */
  async tickets() {
    const rows = [];
    let total = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const start = page * PAGE_SIZE;
      let data;
      try {
        ({ data } = await this.call(
          `/search/Ticket?${ticketSearchQuery(start, start + PAGE_SIZE - 1)}`,
        ));
      } catch (err) {
        // Tickets solved or deleted between two pages: what was read stands.
        if (page > 0 && err instanceof GlpiError && err.code === 'ERROR_RANGE_EXCEED_TOTAL') {
          break;
        }
        throw err;
      }
      if (!data || typeof data !== 'object' || !Number.isFinite(Number(data.totalcount))) {
        throw new GlpiError(ERROR_KINDS.NOT_GLPI, 'no totalcount in the ticket search', 200);
      }
      total = Number(data.totalcount);
      const items = Array.isArray(data.data) ? data.data : [];
      rows.push(...items);
      if (items.length === 0 || start + PAGE_SIZE >= total) {
        break;
      }
    }
    return { rows, total };
  }

  /** The highest ticket number the user sees, open or not (0 when none). */
  async lastTicketId() {
    const params = new URLSearchParams({
      'forcedisplay[0]': String(FIELDS.ID),
      sort: String(FIELDS.ID),
      order: 'DESC',
      range: '0-0',
    });
    const { data } = await this.call(`/search/Ticket?${params}`);
    const id = Number(Array.isArray(data?.data) ? data.data[0]?.[FIELDS.ID] : 0);
    return Number.isInteger(id) && id > 0 ? id : 0;
  }

  async ticket(id) {
    const { data } = await this.call(`/Ticket/${encodeURIComponent(id)}`);
    return data;
  }

  async user(id) {
    const { data } = await this.call(`/User/${encodeURIComponent(id)}`);
    return data;
  }

  async categories() {
    const { data } = await this.call('/ITILCategory?range=0-999');
    return Array.isArray(data) ? data : [];
  }

  async entities() {
    const { data } = await this.call('/getMyEntities?is_recursive=1');
    return Array.isArray(data?.myentities) ? data.myentities : [];
  }

  /** Create a ticket; resolves its id. */
  async createTicket(input) {
    const { data } = await this.call('/Ticket', { method: 'POST', json: { input } });
    const id = Number(data?.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new GlpiError(ERROR_KINDS.HTTP, 'no id in the answer', 201);
    }
    return id;
  }

  /** Add a follow-up to a ticket; resolves its id. */
  async addFollowup(ticketId, content) {
    const { data } = await this.call(`/Ticket/${encodeURIComponent(ticketId)}/ITILFollowup`, {
      method: 'POST',
      json: { input: { itemtype: 'Ticket', items_id: ticketId, content } },
    });
    return Number(data?.id) || 0;
  }
}
