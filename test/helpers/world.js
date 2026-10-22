// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake GLPI on a fake network
// and a temporary /data, with the integration wired on top through
// registerHandlers. No timer runs unless `timers: true`: the tests read GLPI
// with `world.hub.poll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { APP_TOKEN, FakeGlpi, USER_TOKEN, createNetwork } from './fakeGlpi.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// A GLPI of the home or office network (local), and one on the Internet (cloud).
export const URL_1 = 'http://glpi.lan';
export const URL_CLOUD = 'https://helpdesk.example.org/glpi';

export const BASE_CONFIG = { url: URL_1, user_token: USER_TOKEN, language: 'en' };

/**
 * @param {object} [options]
 * @param {FakeGlpi} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  server,
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-glpi-')),
  timings = {},
  timers = false,
} = {}) {
  const glpi = server ?? new FakeGlpi();
  const network = createNetwork({ [URL_1]: glpi, [URL_CLOUD]: glpi });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, server: glpi, app, hub: app.hub, dataDir, network };
}

export const deviceId = (gladys) => gladys.externalIds('helpdesk', 'main');

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { APP_TOKEN, FakeGlpi, USER_TOKEN };
