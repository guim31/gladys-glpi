// -----------------------------------------------------------------------------
// An in-memory GLPI, answering the legacy REST API routes the integration
// calls the way the real server does (checked on glpi/glpi 10.0.28, 11.0.11
// and 12.0.0 in Docker): `["ERROR_CODE", "message"]` errors with their real
// statuses, sessions that expire, the search engine's rows keyed by field id,
// 206 for a partial page and 400 for a range past the total, a follow-up on a
// missing ticket refused as "no permission", the web pages outside the API.
// Its starting tickets are the real answer of GLPI 12.0.0
// (test/fixtures/glpi/real-search-12.json): eight tickets, six open (one
// late, one pending, one with two requesters, one without title), one
// solved and one closed today.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/glpi/${name}.json`, import.meta.url), 'utf8'));

export const USER_TOKEN = 'usertoken0123456789abcdef0123456789abcd';
export const APP_TOKEN = 'apptoken0123456789abcdef0123456789abcde';

const ERRORS = fixture('real-errors');
const json = (status, value) => ({
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8' },
  body: JSON.stringify(value),
});
const error = (name) => json(ERRORS[name].status, ERRORS[name].body);

const ENTITY_IDS = { 'Root entity': 0, 'Root entity > Site Nord': 1 };

/** A row of the search engine back into a ticket of the fake. */
function fromRow(row) {
  return {
    id: row['2'],
    name: row['1'],
    entity: row['80'],
    entities_id: ENTITY_IDS[row['80']] ?? 0,
    status: row['12'],
    date: row['15'],
    solvedate: row['17'],
    time_to_resolve: row['18'],
    urgency: row['10'],
    category: row['7'],
    requesters: row['4'],
    late: row['82'],
    type: row['14'],
    solvedToday: true,
  };
}

const FIELD_OF = {
  1: 'name',
  2: 'id',
  4: 'requesters',
  7: 'category',
  10: 'urgency',
  12: 'status',
  14: 'type',
  15: 'date',
  17: 'solvedate',
  18: 'time_to_resolve',
  80: 'entity',
  82: 'late',
};

export class FakeGlpi {
  constructor({ userToken = USER_TOKEN, appToken = '' } = {}) {
    this.userToken = userToken;
    this.appToken = appToken;
    this.version = '12.0.0';
    this.userId = 2;
    this.tickets = fixture('real-search-12').data.map(fromRow);
    this.categories = fixture('real-categories');
    this.entities = fixture('real-entities').myentities;
    this.online = true;
    this.apiEnabled = true;
    this.ipAllowed = true;
    this.canCreate = true;
    this.canReadUsers = true;
    this.sessions = new Set();
    this.nextSession = 1;
    this.nextId = 9;
    this.created = [];
    this.followups = [];
    this.requests = [];
  }

  ticket(id) {
    return this.tickets.find((ticket) => ticket.id === id);
  }

  /** A ticket opened by someone in GLPI. */
  addTicket(fields = {}) {
    const ticket = {
      id: this.nextId++,
      name: 'Nouveau ticket',
      entity: 'Root entity',
      entities_id: 0,
      status: 1,
      date: '2026-10-22 08:00:00',
      solvedate: null,
      time_to_resolve: null,
      urgency: 3,
      category: null,
      requesters: null,
      late: 0,
      type: 1,
      solvedToday: true,
      ...fields,
    };
    this.tickets.push(ticket);
    return ticket;
  }

  /** Every session ends (PHP garbage collection, a restart of GLPI). */
  expireSessions() {
    this.sessions.clear();
  }

  /** Open tickets and those solved today; every ticket when the search has no criteria. */
  visible(all = false) {
    return this.tickets
      .filter((ticket) => all || [1, 2, 3, 4].includes(ticket.status) || ticket.solvedToday)
      .sort((a, b) => b.id - a.id);
  }

  search(params) {
    const [start, end] = (params.get('range') ?? '0-49').split('-').map(Number);
    const all = this.visible(!params.has('criteria[0][field]'));
    if (all.length > 0 && start >= all.length) {
      return error('range_exceeded');
    }
    if (all.length === 0) {
      return error('empty_search');
    }
    const fields = [...params.entries()]
      .filter(([key]) => key.startsWith('forcedisplay'))
      .map(([, value]) => Number(value));
    const page = all
      .slice(start, end + 1)
      .map((ticket) =>
        Object.fromEntries(
          [...new Set([2, 1, 80, ...fields])].map((field) => [
            String(field),
            ticket[FIELD_OF[field]] ?? null,
          ]),
        ),
      );
    const last = start + page.length - 1;
    const body = {
      totalcount: all.length,
      count: page.length,
      sort: [2],
      order: ['DESC'],
      data: page,
      'content-range': `${start}-${last}/${all.length}`,
    };
    return json(page.length < all.length ? 206 : 200, body);
  }

  handle(url, { method = 'GET', headers = {}, json: body } = {}) {
    const { pathname, searchParams } = new URL(url);
    this.requests.push({ method, path: pathname, search: searchParams.toString() });
    // GLPI may live in a folder (`/glpi/apirest.php`).
    const at = pathname.indexOf('/apirest.php/');
    if (at === -1) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<!DOCTYPE html>' };
    }
    const route = pathname.slice(at + '/apirest.php'.length);
    if (!this.apiEnabled) {
      return error('api_disabled');
    }
    if (!this.ipAllowed) {
      return error('ip_refused');
    }
    if (this.appToken && !headers['app-token']) {
      return error('app_token_missing');
    }
    if (this.appToken && headers['app-token'] !== this.appToken) {
      return error('bad_app_token');
    }
    if (route === '/initSession') {
      if (headers.authorization !== `user_token ${this.userToken}`) {
        return error('bad_user_token');
      }
      const token = `session-${this.nextSession++}`;
      this.sessions.add(token);
      return json(200, { session_token: token });
    }
    if (!this.sessions.has(headers['session-token'])) {
      return error('session_expired');
    }
    if (route === '/killSession') {
      this.sessions.delete(headers['session-token']);
      return json(200, true);
    }
    if (method === 'GET' && route === '/getFullSession') {
      const session = fixture('real-session');
      session.session.glpiID = this.userId;
      return json(200, session);
    }
    if (method === 'GET' && route === '/getGlpiConfig') {
      return json(200, { cfg_glpi: { app_name: 'GLPI', version: this.version } });
    }
    if (method === 'GET' && route === '/search/Ticket') {
      return this.search(searchParams);
    }
    if (method === 'GET' && route === '/ITILCategory') {
      return json(200, this.categories);
    }
    if (method === 'GET' && route === '/getMyEntities') {
      return json(200, { myentities: this.entities });
    }
    const user = route.match(/^\/User\/(\d+)$/);
    if (method === 'GET' && user) {
      if (!this.canReadUsers) {
        return json(401, [
          'ERROR_RIGHT_MISSING',
          "You don't have permission to perform this action.",
        ]);
      }
      return json(200, { ...fixture('real-user'), id: Number(user[1]) });
    }
    const ticketRoute = route.match(/^\/Ticket\/(\d+)$/);
    if (method === 'GET' && ticketRoute) {
      const ticket = this.ticket(Number(ticketRoute[1]));
      if (!ticket) {
        return error('item_not_found');
      }
      return json(200, {
        ...fixture('real-ticket'),
        id: ticket.id,
        name: ticket.name,
        status: ticket.status,
        urgency: ticket.urgency,
        solvedate: ticket.solvedate,
      });
    }
    if (method === 'POST' && route === '/Ticket') {
      if (!this.canCreate) {
        return error('add_refused');
      }
      const input = body?.input ?? {};
      this.created.push(input);
      const ticket = this.addTicket({
        name: input.name ?? '',
        urgency: input.urgency ?? 3,
        type: input.type ?? 1,
        entities_id: input.entities_id ?? 0,
        requesters: input._users_id_requester ? String(input._users_id_requester) : null,
      });
      return json(201, { id: ticket.id, message: `Item successfully added: ${ticket.name}` });
    }
    const followup = route.match(/^\/Ticket\/(\d+)\/ITILFollowup$/);
    if (method === 'POST' && followup) {
      const target = this.ticket(Number(followup[1]));
      // The real server says "no permission" for a missing ticket, and GLPI 10
      // and 11 may for a closed one.
      if (!target || (target.status === 6 && this.refuseOnClosed)) {
        return error('add_refused');
      }
      this.followups.push({ ticket: Number(followup[1]), ...(body?.input ?? {}) });
      return json(201, { id: this.followups.length, message: '' });
    }
    return error('item_not_found');
  }
}

/** The network: one fake server per base URL; anything else does not answer. */
export function createNetwork(servers) {
  return {
    servers,
    async request(url, options = {}) {
      const base = Object.keys(servers).find((origin) => url.startsWith(`${origin}/`));
      const server = base ? servers[base] : null;
      if (!server || !server.online) {
        const err = new Error('connect ECONNREFUSED');
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return server.handle(url, options);
    },
  };
}
