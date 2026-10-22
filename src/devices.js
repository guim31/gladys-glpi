// -----------------------------------------------------------------------------
// The Gladys device: one "GLPI" device for every ticket the user of the token
// sees (its profile and entities decide, as in GLPI).
//
// Identity: `helpdesk` / `main`: one GLPI per integration, so the device keeps
// its history when the address or the token changes.
//
// Features (category/type couples of the core table, test/gladys-rules.test.js):
// six counter-sensor/integer counters, definitions in src/glpi/model.js.
//
// The device is published with should_poll: false: the integration reads GLPI
// on its own timer (src/hub.js), every 1 to 10 minutes.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'helpdesk';
export const DEVICE_ID = 'main';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  OPEN: 'open',
  NEW: 'new',
  PROCESSING: 'processing',
  PENDING: 'pending',
  LATE: 'late',
  SOLVED_TODAY: 'solved_today',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.OPEN]: 'Open tickets',
    [FEATURE_KEYS.NEW]: 'New tickets',
    [FEATURE_KEYS.PROCESSING]: 'Tickets in progress',
    [FEATURE_KEYS.PENDING]: 'Pending tickets',
    [FEATURE_KEYS.LATE]: 'Late tickets',
    [FEATURE_KEYS.SOLVED_TODAY]: 'Tickets solved today',
  },
  fr: {
    [FEATURE_KEYS.OPEN]: 'Tickets ouverts',
    [FEATURE_KEYS.NEW]: 'Nouveaux tickets',
    [FEATURE_KEYS.PROCESSING]: 'Tickets en cours',
    [FEATURE_KEYS.PENDING]: 'Tickets en attente',
    [FEATURE_KEYS.LATE]: 'Tickets en retard',
    [FEATURE_KEYS.SOLVED_TODAY]: "Tickets résolus aujourd'hui",
  },
  de: {
    [FEATURE_KEYS.OPEN]: 'Offene Tickets',
    [FEATURE_KEYS.NEW]: 'Neue Tickets',
    [FEATURE_KEYS.PROCESSING]: 'Tickets in Bearbeitung',
    [FEATURE_KEYS.PENDING]: 'Wartende Tickets',
    [FEATURE_KEYS.LATE]: 'Überfällige Tickets',
    [FEATURE_KEYS.SOLVED_TODAY]: 'Heute gelöste Tickets',
  },
  es: {
    [FEATURE_KEYS.OPEN]: 'Tickets abiertos',
    [FEATURE_KEYS.NEW]: 'Tickets nuevos',
    [FEATURE_KEYS.PROCESSING]: 'Tickets en curso',
    [FEATURE_KEYS.PENDING]: 'Tickets en espera',
    [FEATURE_KEYS.LATE]: 'Tickets atrasados',
    [FEATURE_KEYS.SOLVED_TODAY]: 'Tickets resueltos hoy',
  },
};

// Display bound (the core never applies it on write).
const COUNTER_MAX = 100000;

// Order = display order in Gladys; `value` reads a summary of src/glpi/model.js.
const FEATURES = [
  [FEATURE_KEYS.OPEN, (summary) => summary.open],
  [FEATURE_KEYS.NEW, (summary) => summary.new],
  [FEATURE_KEYS.PROCESSING, (summary) => summary.processing],
  [FEATURE_KEYS.PENDING, (summary) => summary.pending],
  [FEATURE_KEYS.LATE, (summary) => summary.late],
  [FEATURE_KEYS.SOLVED_TODAY, (summary) => summary.solvedToday],
];

export const deviceIds = (gladys) => gladys.externalIds(DEVICE_TYPE, DEVICE_ID);

export function buildDevice(gladys, language = 'en') {
  const ids = deviceIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: 'GLPI',
    external_id: ids.device,
    should_poll: false,
    features: FEATURES.map(([key]) => ({
      name: names[key],
      external_id: ids.feature(key),
      category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: COUNTER_MAX,
    })),
  };
}

/** The states of the six counters, in the `publishStates` format. */
export function featureStates(gladys, summary) {
  const ids = deviceIds(gladys);
  return FEATURES.map(([key, value]) => ({
    device_feature_external_id: ids.feature(key),
    state: value(summary),
  }));
}
