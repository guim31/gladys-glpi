// -----------------------------------------------------------------------------
// The hub against the in-memory GLPI (real answers of GLPI 12.0.0): counters,
// scene events and their persistence, the scene actions, the connection
// status and the transport.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalHost } from '../src/hub.js';
import {
  BASE_CONFIG,
  FakeGlpi,
  URL_1,
  URL_CLOUD,
  USER_TOKEN,
  createAll,
  createWorld,
  deviceId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const counters = (w) => {
  const ids = deviceId(w.gladys);
  return Object.fromEntries(
    ['open', 'new', 'processing', 'pending', 'late', 'solved_today'].map((key) => [
      key,
      w.fake.lastState(ids.feature(key)),
    ]),
  );
};

const keys = (w) => w.fake.sceneEvents.map((event) => `${event.key}:${event.data.ticket_id}`);

test('the counters of the device, published once added', async (t) => {
  const w = await world(t);
  await createAll(w);
  assert.deepEqual(counters(w), {
    open: 6,
    new: 5,
    processing: 0,
    pending: 1,
    late: 1,
    solved_today: 2,
  });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['GLPI'],
  );
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: deviceId(w.gladys).device,
    transport: 'local',
  });
});

test('nothing fires at the first reading; then new, late and solved tickets, once', async (t) => {
  const w = await world(t);
  assert.deepEqual(w.fake.sceneEvents, [], 'what was already there is not news');

  w.server.addTicket({
    name: 'Imprimante du 1er en panne',
    urgency: 5,
    type: 1,
    category: 'Imprimantes',
    requesters: '7',
    entity: 'Root entity > Site Nord',
  });
  w.server.ticket(3).late = 1;
  w.server.ticket(2).status = 5;
  w.server.ticket(2).solvedate = '2026-10-22 09:00:00';
  await w.hub.poll();
  await w.hub.poll();
  assert.deepEqual(keys(w), ['ticket_created:9', 'ticket_late:3', 'ticket_solved:2']);
  assert.deepEqual(w.fake.sceneEvents[0].data, {
    ticket_id: 9,
    title: 'Imprimante du 1er en panne',
    urgency: 5,
    urgency_label: 'Very high',
    type: 1,
    type_label: 'Incident',
    status_label: 'New',
    category: 'Imprimantes',
    entity: 'Root entity > Site Nord',
    requester: 'Marie Durand',
    due_date: '',
    url: `${URL_1}/front/ticket.form.php?id=9`,
  });
  // The filters see the urgency and the type, as strings.
  assert.equal(w.fake.sceneEvents[0].filters?.urgency ?? '5', '5');
  assert.equal(w.fake.sceneEvents[2].data.solved_date, '2026-10-22 09:00:00');
});

test('the events survive a restart: neither repeated nor lost', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-glpi-'));
  const server = new FakeGlpi();
  const first = await world(t, { server, dataDir });
  await first.app.stop();
  // Opened while the integration was stopped.
  server.addTicket({ name: 'Wi-Fi coupé' });
  const second = await world(t, { server, dataDir });
  assert.deepEqual(keys(second), ['ticket_created:9']);
  await second.app.stop();
  const third = await world(t, { server, dataDir });
  assert.deepEqual(keys(third), [], 'not again after another restart');
});

test('another GLPI user starts from scratch: no flood of events', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-glpi-'));
  const server = new FakeGlpi();
  const first = await world(t, { server, dataDir });
  await first.app.stop();
  server.userId = 5;
  server.ticket(3).late = 1;
  const second = await world(t, { server, dataDir });
  assert.deepEqual(keys(second), []);
});

test('an event Gladys refuses is sent again at the next reading', async (t) => {
  const w = await world(t);
  w.server.addTicket({ name: 'A' });
  w.server.addTicket({ name: 'B' });
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  w.gladys.publishSceneEvent = async (key, data) => {
    if (refuse && data.ticket_id === 10) {
      throw new Error('Gladys restarting');
    }
    return publish(key, data);
  };
  await w.hub.poll();
  assert.deepEqual(keys(w), ['ticket_created:9']);
  refuse = false;
  await w.hub.poll();
  assert.deepEqual(keys(w), ['ticket_created:9', 'ticket_created:10']);
});

test('a mass import fires 30 events at most', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 45; i += 1) {
    w.server.addTicket({ name: `Import ${i}` });
  }
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 30);
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 30, 'the rest is not sent later either');
});

test('create a ticket: requester, urgency, type, category and entity by name', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('create_ticket', {
    title: 'Fuite d’eau détectée',
    description: 'Capteur <cuisine> : 1\nÀ 3 h 12',
    urgency: '5',
    type: '2',
    category: 'réseau',
    entity: 'Site Nord',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { ticket_id: 9, url: `${URL_1}/front/ticket.form.php?id=9` });
  assert.deepEqual(w.server.created, [
    {
      name: 'Fuite d’eau détectée',
      content: '<p>Capteur &lt;cuisine&gt; : 1<br>À 3 h 12</p>',
      urgency: 5,
      type: 2,
      _users_id_requester: 2,
      itilcategories_id: 1,
      entities_id: 1,
    },
  ]);
  await w.hub.poll();
  assert.deepEqual(keys(w), [], 'a ticket created by Gladys is never announced as new');
  assert.equal(counters(w).open, 7, 'counted at once');
});

test('create a ticket: defaults, and the errors in the language of the configuration', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  let ack = await w.fake.sceneAction('create_ticket', { title: 'Congélateur trop chaud' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.server.created[0], {
    name: 'Congélateur trop chaud',
    content: '<p>Congélateur trop chaud</p>',
    urgency: 3,
    type: 1,
    _users_id_requester: 2,
  });
  ack = await w.fake.sceneAction('create_ticket', { title: '  ' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Indiquez le titre du ticket/);
  ack = await w.fake.sceneAction('create_ticket', { title: 'x', category: 'Plomberie' });
  assert.match(ack.error, /Aucune catégorie de ticket/);
  ack = await w.fake.sceneAction('create_ticket', { title: 'x', entity: 'Site Sud' });
  assert.match(ack.error, /aucune entité/);
  w.server.canCreate = false;
  ack = await w.fake.sceneAction('create_ticket', { title: 'x' });
  assert.match(ack.error, /^GLPI : le profil de l'utilisateur GLPI n'a pas un droit/);
});

test('add a follow-up: by number, the ticket must exist', async (t) => {
  const w = await world(t);
  let ack = await w.fake.sceneAction('add_followup', { ticket: '#1', text: 'Box redémarrée' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { ticket_id: 1, title: 'Panne de la box internet' });
  assert.deepEqual(w.server.followups, [
    { ticket: 1, itemtype: 'Ticket', items_id: 1, content: '<p>Box redémarrée</p>' },
  ]);
  ack = await w.fake.sceneAction('add_followup', { ticket: '999', text: 'x' });
  assert.match(ack.error, /GLPI has no ticket with this number/);
  ack = await w.fake.sceneAction('add_followup', { ticket: 'box', text: 'x' });
  assert.match(ack.error, /Give the number of the ticket/);
  ack = await w.fake.sceneAction('add_followup', { ticket: '1', text: '' });
  assert.match(ack.error, /Give the text of the follow-up/);
});

test('the requester stays empty when the profile may not read users', async (t) => {
  const w = await world(t);
  w.server.canReadUsers = false;
  w.server.addTicket({ requesters: '7' });
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents[0].data.requester, '');
});

test('test the connection: version, user, counts; or the reason', async (t) => {
  const w = await world(t);
  let ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.fr,
    'GLPI 12.0.0 OK, utilisateur glpi (Super-Admin) : 6 ticket(s) ouvert(s), 1 en retard.',
  );
  w.server.apiEnabled = false;
  ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /the REST API is off/);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  w.server.apiEnabled = true;
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('the connection status explains a missing address, token or a bad token', async (t) => {
  let w = await world(t, { config: { language: 'en' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(JSON.stringify(w.fake.connectionStatus), /Enter the address of your GLPI/);
  w = await world(t, { config: { url: URL_1 } });
  assert.match(JSON.stringify(w.fake.connectionStatus), /API token of a GLPI user/);
  w = await world(t, { config: { url: URL_1, user_token: 'wrong' } });
  assert.match(JSON.stringify(w.fake.connectionStatus), /user token refused/);
  w = await world(t, { config: { url: 'ftp://x', user_token: USER_TOKEN } });
  assert.match(JSON.stringify(w.fake.connectionStatus), /Address not understood/);
});

test('a GLPI on the Internet is a cloud device', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, url: URL_CLOUD } });
  assert.equal(w.fake.transports.at(-1).transport, 'cloud');
  assert.equal(isLocalHost('192.168.1.20'), true);
  assert.equal(isLocalHost('glpi'), true);
  assert.equal(isLocalHost('glpi.lan'), true);
  assert.equal(isLocalHost('172.20.0.4'), true);
  assert.equal(isLocalHost('helpdesk.example.org'), false);
  assert.equal(isLocalHost('8.8.8.8'), false);
});

test('a new configuration reads the new GLPI and closes the old session', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...BASE_CONFIG, language: 'de' });
  assert.equal(w.fake.discoveredDevices[0].features[0].name, 'Offene Tickets');
  await w.fake.configUpdated({ ...BASE_CONFIG, url: URL_CLOUD });
  assert.ok(w.server.requests.some((request) => request.path.endsWith('/killSession')));
});
