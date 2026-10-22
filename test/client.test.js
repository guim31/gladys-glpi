// -----------------------------------------------------------------------------
// The GLPI client and model against real answers (GLPI 10.0.28, 11.0.11 and
// 12.0.0 in Docker): the ticket search of the three versions, the error
// kinds, a session that expires, the pagination, and the parsing helpers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeConfig, parseServerUrl } from '../src/config.js';
import { ERROR_KINDS, GlpiClient, PAGE_SIZE, ticketSearchQuery } from '../src/glpi/client.js';
import {
  decodeHtml,
  findByIdOrName,
  parseTicketNumber,
  parseTickets,
  summarize,
  toHtml,
  userName,
} from '../src/glpi/model.js';
import { APP_TOKEN, FakeGlpi, USER_TOKEN, createNetwork } from './helpers/fakeGlpi.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/glpi/${name}.json`, import.meta.url), 'utf8'));

const URL_1 = 'http://192.0.2.30';

function client(server = new FakeGlpi(), options = {}) {
  const network = createNetwork({ [URL_1]: server });
  return new GlpiClient({
    url: URL_1,
    userToken: USER_TOKEN,
    request: network.request,
    ...options,
  });
}

const counters = ({ latest, ...rest }) => ({ ...rest, latest: latest.map((ticket) => ticket.id) });

test('the ticket search of GLPI 10, 11 and 12 gives the same counters', async () => {
  const expected = {
    10: {
      open: 5,
      new: 4,
      processing: 0,
      pending: 1,
      late: 1,
      solvedToday: 1,
      latest: [5, 4, 3, 2, 1],
    },
    11: {
      open: 6,
      new: 5,
      processing: 0,
      pending: 1,
      late: 1,
      solvedToday: 1,
      latest: [7, 5, 4, 3, 2, 1],
    },
    12: {
      open: 6,
      new: 5,
      processing: 0,
      pending: 1,
      late: 1,
      solvedToday: 2,
      latest: [8, 7, 4, 3, 2, 1],
    },
  };
  for (const version of [10, 11, 12]) {
    const { data } = await fixture(`real-search-${version}`);
    assert.deepEqual(counters(summarize(parseTickets(data))), expected[version], `GLPI ${version}`);
  }
});

test('a ticket row: dropdowns, several requesters, an empty title, the late flag', async () => {
  const tickets = parseTickets((await fixture('real-search-12')).data);
  const byId = Object.fromEntries(tickets.map((ticket) => [ticket.id, ticket]));
  assert.deepEqual(byId[1], {
    id: 1,
    title: 'Panne de la box internet',
    status: 1,
    urgency: 4,
    type: 1,
    category: 'Réseau',
    entity: 'Root entity',
    requesterIds: [2, 7],
    opened: byId[1].opened,
    solved: '',
    dueDate: '2026-10-23 18:00:00',
    late: false,
  });
  assert.equal(byId[4].late, true);
  assert.equal(byId[4].entity, 'Root entity > Site Nord');
  assert.equal(byId[7].title, '#7', 'a ticket without title shows its number');
  assert.deepEqual(byId[3].requesterIds, [7]);
});

test('the search asks for open tickets and those solved since midnight, newest first', () => {
  const query = new URLSearchParams(ticketSearchQuery(0, 499));
  assert.equal(query.get('criteria[0][field]'), '12');
  assert.equal(query.get('criteria[0][value]'), 'notold');
  assert.equal(query.get('criteria[1][link]'), 'OR');
  assert.equal(query.get('criteria[1][field]'), '17');
  assert.equal(query.get('criteria[1][value]'), 'TODAY');
  assert.equal(query.get('range'), '0-499');
  assert.equal(query.get('order'), 'DESC');
  assert.ok([...query.keys()].filter((key) => key.startsWith('forcedisplay')).length >= 12);
});

test('every page within the total, never past it (a 400 on GLPI)', async () => {
  const server = new FakeGlpi();
  for (let i = 0; i < PAGE_SIZE * 2 + 10; i += 1) {
    server.addTicket({ name: `Ticket ${i}` });
  }
  const glpi = client(server);
  const { rows, total } = await glpi.tickets();
  assert.equal(total, PAGE_SIZE * 2 + 10 + 8);
  assert.equal(rows.length, total);
  const ranges = server.requests
    .filter((request) => request.path.endsWith('/search/Ticket'))
    .map((request) => new URLSearchParams(request.search).get('range'));
  assert.deepEqual(ranges, ['0-499', '500-999', '1000-1499']);
  assert.equal(new Set(rows.map((row) => row['2'])).size, total);
});

test('no ticket at all: an empty search, not an error', async () => {
  const server = new FakeGlpi();
  server.tickets = [];
  assert.deepEqual(await client(server).tickets(), { rows: [], total: 0 });
});

test('an expired session is opened again, once', async () => {
  const server = new FakeGlpi();
  const glpi = client(server);
  await glpi.tickets();
  server.expireSessions();
  await glpi.tickets();
  const inits = server.requests.filter((request) => request.path.endsWith('/initSession'));
  assert.equal(inits.length, 2);
  // A token that GLPI refuses at once is not retried in a loop.
  server.userToken = 'another';
  server.expireSessions();
  await assert.rejects(glpi.tickets(), { kind: ERROR_KINDS.AUTH, status: 401 });
});

test('the application token travels in App-Token when set', async () => {
  const server = new FakeGlpi({ appToken: APP_TOKEN });
  await assert.rejects(client(server).session(), {
    kind: ERROR_KINDS.APP_TOKEN,
    code: 'ERROR_APP_TOKEN_PARAMETERS_MISSING',
  });
  await assert.rejects(client(server, { appToken: 'wrong' }).session(), {
    kind: ERROR_KINDS.APP_TOKEN,
    code: 'ERROR_WRONG_APP_TOKEN_PARAMETER',
  });
  const session = await client(server, { appToken: APP_TOKEN }).session();
  assert.deepEqual(session, {
    userId: 2,
    user: 'glpi',
    profile: 'Super-Admin',
    interface: 'central',
    entity: 'Root entity (tree structure)',
  });
});

test('every refusal of the real server has its kind, without the documentation address', async () => {
  const cases = [
    [(server) => (server.apiEnabled = false), ERROR_KINDS.API_DISABLED],
    [(server) => (server.ipAllowed = false), ERROR_KINDS.IP],
    [(server) => (server.userToken = 'other'), ERROR_KINDS.AUTH],
    [(server) => (server.online = false), ERROR_KINDS.UNREACHABLE],
  ];
  for (const [breakIt, kind] of cases) {
    const server = new FakeGlpi();
    breakIt(server);
    await assert.rejects(client(server).tickets(), (err) => {
      assert.equal(err.kind, kind);
      assert.doesNotMatch(err.message, /documentation/);
      return true;
    });
  }
  const notGlpi = {
    async request() {
      return { status: 200, headers: {}, body: '<!DOCTYPE html><html></html>' };
    },
  };
  await assert.rejects(
    new GlpiClient({ url: URL_1, userToken: 'x', request: notGlpi.request }).session(),
    { kind: ERROR_KINDS.NOT_GLPI },
  );
  const redirect = async () => ({ status: 302, headers: { location: 'https://x' }, body: '' });
  await assert.rejects(
    new GlpiClient({ url: URL_1, userToken: 'x', request: redirect }).session(),
    {
      kind: ERROR_KINDS.REDIRECT,
    },
  );
  const tls = async () => {
    const err = new Error('self signed');
    err.code = 'DEPTH_ZERO_SELF_SIGNED_CERT';
    throw err;
  };
  await assert.rejects(new GlpiClient({ url: URL_1, userToken: 'x', request: tls }).session(), {
    kind: ERROR_KINDS.TLS,
  });
});

test('a creation refused by the profile is a rights error', async () => {
  const server = new FakeGlpi();
  server.canCreate = false;
  await assert.rejects(client(server).createTicket({ name: 'x', content: 'x' }), {
    kind: ERROR_KINDS.RIGHTS,
    code: 'ERROR_GLPI_ADD',
  });
});

test('the address: bare host, browser URL, API URL, folder kept', () => {
  assert.equal(parseServerUrl('192.0.2.30'), 'http://192.0.2.30');
  assert.equal(
    parseServerUrl('https://helpdesk.example.org/glpi/front/central.php'),
    'https://helpdesk.example.org/glpi',
  );
  assert.equal(
    parseServerUrl('https://helpdesk.example.org/glpi/apirest.php/'),
    'https://helpdesk.example.org/glpi',
  );
  assert.equal(
    parseServerUrl('https://helpdesk.example.org/api.php/v1'),
    'https://helpdesk.example.org',
  );
  assert.equal(parseServerUrl('http://192.0.2.30:8080/'), 'http://192.0.2.30:8080');
  assert.equal(parseServerUrl('https://user:pass@helpdesk.example.org'), null);
  assert.equal(parseServerUrl('ftp://helpdesk.example.org'), null);
  assert.equal(parseServerUrl(''), null);
  const config = normalizeConfig({ url: ' x ', user_token: ' abc ', poll_interval: '7' });
  assert.equal(config.userToken, 'abc');
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.language, 'fr');
});

test('categories and entities: by number, full name or last part', async () => {
  const entities = (await fixture('real-entities')).myentities;
  assert.equal(findByIdOrName(entities, 'site nord').item.id, 1);
  assert.equal(findByIdOrName(entities, 'Root entity > Site Nord').item.id, 1);
  assert.equal(findByIdOrName(entities, '#0').item.id, 0);
  assert.equal(findByIdOrName(entities, 'Sud').reason, 'not_found');
  const twins = [
    { id: 3, name: 'Root > A > Imprimantes' },
    { id: 4, name: 'Root > B > Imprimantes' },
  ];
  assert.equal(findByIdOrName(twins, 'imprimantes').reason, 'ambiguous');
  assert.equal(findByIdOrName(twins, 'Root > B > Imprimantes').item.id, 4);
});

test('helpers: ticket numbers, text to HTML, user names', async () => {
  assert.equal(parseTicketNumber('#125'), 125);
  assert.equal(parseTicketNumber(' 7 '), 7);
  assert.equal(parseTicketNumber(12), 12);
  assert.equal(parseTicketNumber('12a'), null);
  assert.equal(parseTicketNumber('0'), null);
  assert.equal(
    toHtml('Fuite <cuisine> & cave\nà 3 h\n\nCapteur 2'),
    '<p>Fuite &lt;cuisine&gt; &amp; cave<br>à 3 h</p><p>Capteur 2</p>',
  );
  assert.equal(userName(await fixture('real-user')), 'Marie Durand');
  assert.equal(userName({ name: 'm.durand' }), 'm.durand');
});

test('GLPI 10 encodes names in HTML: decoded for the lookups and the texts', async () => {
  // Real answers of GLPI 10.0.28: getMyEntities, and a search row of a ticket
  // titled `Imprimante <RDC> & café "test" l’été`.
  const entities = (await fixture('real-entities-10')).myentities;
  assert.equal(entities[0].name, 'Root entity &#62; Site Nord');
  const decoded = entities.map((entity) => ({ id: entity.id, name: decodeHtml(entity.name) }));
  assert.equal(findByIdOrName(decoded, 'Site Nord').item.id, 1);
  const [ticket] = parseTickets([
    { 2: 7, 1: 'Imprimante &#60;RDC&#62; &#38; café "test" l’été', 80: 'Root entity', 7: null },
  ]);
  assert.equal(ticket.title, 'Imprimante <RDC> & café "test" l’été');
  assert.equal(decodeHtml('a &amp;lt; b &#x3E; c &unknown; &#0;'), 'a &lt; b > c &unknown; &#0;');
});

test('something that is not HTTP on that port is not GLPI', async () => {
  const garbage = async () => {
    const err = new Error('Parse Error');
    err.code = 'HPE_INVALID_CONSTANT';
    throw err;
  };
  await assert.rejects(new GlpiClient({ url: URL_1, userToken: 'x', request: garbage }).session(), {
    kind: ERROR_KINDS.NOT_GLPI,
  });
});
