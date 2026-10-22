// -----------------------------------------------------------------------------
// The "latest tickets" widget: content within the core budget (validated by
// the SDK's validateWidgetContent), late and urgent tickets flagged, links in
// HTTPS only, and the degraded states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { BASE_CONFIG, URL_CLOUD, createWorld } from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, language = 'en') {
  const ack = await w.fake.widgetGet('latest_tickets', { settings: {}, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (data, type) => data.components.filter((component) => component.type === type);

test('three tiles and the newest open tickets, late and urgent ones flagged', async (t) => {
  const w = await world(t);
  const data = await content(w);
  assert.deepEqual(
    ofType(data, 'value').map((tile) => [tile.label, tile.value]),
    [
      ['Open', 6],
      ['Late', 1],
      ['New', 5],
    ],
  );
  const items = ofType(data, 'card-list')[0].items;
  assert.deepEqual(
    items.map((item) => [item.title, item.subtitle, item.badge?.text ?? null]),
    [
      ['#8 Fuite d eau détectée', 'New · Very high · Root entity', 'Very high'],
      ['#7 #7', 'New · Medium · Root entity', null],
      ['#4 Imprimante bloquée', 'New · Low · Root entity > Site Nord', 'Late'],
      ['#3 Mot de passe oublié', 'New · Very high · Root entity', 'Very high'],
      ['#2 Wi-Fi lent en salle de réunion', 'Pending · Medium · Root entity', null],
      ['#1 Panne de la box internet', 'New · High · Root entity', 'High'],
    ],
  );
  assert.ok(
    items.every((item) => item.links === undefined),
    'no link to an http:// GLPI',
  );
});

test('in French, with links to an https:// GLPI', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, url: URL_CLOUD } });
  const data = await content(w, 'fr');
  assert.equal(ofType(data, 'value')[1].label, 'En retard');
  const [first] = ofType(data, 'card-list')[0].items;
  assert.deepEqual(first.links, [
    { url: `${URL_CLOUD}/front/ticket.form.php?id=8`, label: 'Ouvrir dans GLPI' },
  ]);
});

test('no open ticket, GLPI down, not configured', async (t) => {
  const w = await world(t);
  w.server.tickets = w.server.tickets.filter((ticket) => ticket.status >= 5);
  await w.hub.poll();
  let data = await content(w);
  assert.equal(ofType(data, 'text')[0].text, 'No open ticket.');
  w.server.online = false;
  await w.hub.poll();
  data = await content(w);
  assert.equal(ofType(data, 'text')[0].text, 'GLPI does not answer: last known tickets.');
  const down = await world(t, { config: { ...BASE_CONFIG, url: 'http://198.51.100.9' } });
  assert.match(ofType(await content(down), 'text')[0].text, /GLPI does not answer/);
  const empty = await world(t, { config: {} });
  assert.match(ofType(await content(empty), 'text')[0].text, /Enter the address/);
});
