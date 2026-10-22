// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URL_1, USER_TOKEN, createWorld } from './helpers/world.js';

function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to GLPI 12.0.0')),
    'the start is logged',
  );
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.server.ticket(1).name = `Panne de la box internet ${i}`;
    w.server.addTicket({ name: `Ticket ${i}` });
    if (i === 2) {
      w.server.expireSessions();
    }
    await w.hub.poll();
  }
  assert.deepEqual(logs.texts(), []);
});

test('an outage is logged once, and once when GLPI is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.server.online = false;
  for (let i = 0; i < 6; i += 1) {
    await w.hub.poll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  logs.clear();
  w.server.online = true;
  await w.hub.poll();
  await w.hub.poll();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again after \d+ min/);
});

test('a ticket created from Gladys writes one line; never a token, even at debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  const ack = await w.fake.sceneAction('create_ticket', { title: 'Fuite d’eau détectée' });
  assert.equal(ack.success, true, ack.error);
  w.server.online = false;
  await w.hub.poll();
  const text = logs.texts().join('\n');
  assert.match(text, /Ticket #9 created from Gladys/);
  assert.ok(!text.includes(USER_TOKEN), 'never the user token');
  assert.ok(!text.includes('session-'), 'never a session token');

  const refused = await world(t, {
    config: { url: URL_1, user_token: 'secret_wrong_token', app_token: 'secret_app' },
  });
  await refused.hub.poll();
  const all = logs.texts().join('\n');
  assert.ok(
    !all.includes('secret_wrong_token') && !all.includes('secret_app'),
    'never a refused token',
  );
});
