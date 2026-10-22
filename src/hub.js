// -----------------------------------------------------------------------------
// The GLPI hub: reads the open tickets (and those solved today) on a timer of
// the container, publishes the counters of the device when they change, fires
// the scene events (a new ticket, a ticket late, a ticket solved), and creates
// tickets or adds follow-ups for the scene actions.
//
// Gladys never polls the device (should_poll: false): the interval goes up to
// 10 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire even when the device was not added.
//
// The events come from the difference between two readings, persisted under
// /data (src/store.js): a ticket number above the highest one seen is new, a
// ticket open at the previous reading and solved now is solved, an open
// ticket that GLPI now says late is late. The first reading of a GLPI (or of
// another user) only takes note: what was already there is not news.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';
import { buildDevice, deviceIds, featureStates } from './devices.js';
import { ERROR_KINDS, GlpiClient, GlpiError, MAX_PAGES, PAGE_SIZE } from './glpi/client.js';
import {
  findByIdOrName,
  isOpen,
  parseTicketNumber,
  parseTickets,
  summarize,
  text,
  ticketUrl,
  toHtml,
  userName,
} from './glpi/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  STATUS_TEXT,
  TYPE_TEXT,
  URGENCY_TEXT,
  allLanguages,
  labelOf,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'glpi-hub' });

export const WIDGET_KEY = 'latest_tickets';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  CREATED: 'ticket_created',
  LATE: 'ticket_late',
  SOLVED: 'ticket_solved',
});

export const HUB_TIMINGS = {
  // A failed read is tried again this soon, whatever the interval.
  retryMs: 30_000,
  // Re-send unchanged values this often: Gladys shows "no recent value" after 48 h.
  heartbeatMs: 12 * 60 * 60_000,
};

// Scene events fired by one reading at most (a mass import, a migration):
// the core admits 300 per minute, and nobody wants 300 notifications.
export const MAX_EVENTS_PER_READING = 30;
// The reading after a command is awaited at most this long: the scene action
// answers within its timeout.
const REFRESH_WAIT_MS = 3_000;
// Tickets created by the scene action that the next readings must not
// announce as new (no loop between a trigger and the action).
const OWN_TICKETS_KEPT = 100;
// GLPI caps a title at 255 characters.
const TITLE_MAX = 250;
const CONTENT_MAX = 20_000;

/** An address of the home network (local transport), else the Internet (cloud). */
export function isLocalHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes('.') || /\.(local|lan|home|internal|localdomain|home\.arpa)$/.test(host)) {
    return true;
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80:');
}

export class GlpiHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/glpi/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   */
  constructor({ gladys, store, request, timers = true, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.config = null;
    this.client = null;
    this.reset();
    this.saved = null;
    this.connection = null;
    this.deviceSignature = null;
    this.widgetSignature = null;
    this.transport = null;
    this.timer = null;
    this.polling = null;
    this.stopped = false;
    /** Ticket numbers created by the scene action, never announced as new. */
    this.ownTickets = [];
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  reset() {
    /** Open tickets and tickets solved today, newest first. */
    this.tickets = [];
    this.total = 0;
    /** `{ userId, user, profile, interface, entity }` of the session. */
    this.account = null;
    this.version = null;
    this.error = null;
    this.downSince = null;
    this.readAt = 0;
    this.connectedLogged = false;
    /** Requester names by user id. */
    this.users = new Map();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, lost, back, user commands). A
  // problem that repeats is logged once, then at debug until it clears.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved =
      typeof saved.scope === 'string'
        ? {
            scope: saved.scope,
            maxId: Number.isInteger(saved.maxId) ? saved.maxId : 0,
            open: Array.isArray(saved.open) ? saved.open.filter(Number.isInteger) : [],
            late: Array.isArray(saved.late) ? saved.late.filter(Number.isInteger) : [],
          }
        : null;
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.connection = null;
    this.deviceSignature = null;
    this.transport = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const same =
      previous &&
      previous.url === config.url &&
      previous.userToken === config.userToken &&
      previous.appToken === config.appToken &&
      previous.allowSelfSigned === config.allowSelfSigned;
    if (!same) {
      const old = this.client;
      this.reset();
      this.transport = null;
      this.client =
        config.url && config.userToken
          ? new GlpiClient({
              url: config.url,
              userToken: config.userToken,
              appToken: config.appToken,
              insecure: config.allowSelfSigned,
              request: this.request,
            })
          : null;
      old?.close().catch(() => {});
    }
    // A new language: the device is published again.
    this.deviceSignature = null;
    this.gladys.forgetPublishedStates?.();
    await this.poll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.polling?.catch(() => {});
    await this.client?.close();
    await this.store.flush();
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const delay = this.error
      ? Math.min(this.config.pollIntervalMs, this.timings.retryMs)
      : this.config.pollIntervalMs;
    this.timer = setTimeout(() => {
      this.poll().catch((err) => this.problem('poll', 'Reading failed', err, 'error'));
    }, delay);
  }

  // --- Reading ---------------------------------------------------------------

  /** One reading at a time: a call during a reading waits for it, then reads. */
  poll() {
    const run = async () => {
      try {
        await this.read();
      } finally {
        this.schedule();
      }
    };
    this.polling = (this.polling ?? Promise.resolve()).catch(() => {}).then(run);
    return this.polling;
  }

  async read() {
    if (!this.client) {
      await this.publishConnectionStatus();
      return;
    }
    const { client } = this;
    let fresh = false;
    try {
      const account = this.account ?? (await client.session());
      const version = this.version ?? (await client.version()) ?? '?';
      const { rows, total } = await client.tickets();
      if (client !== this.client) {
        // The configuration changed during the reading: these are the old
        // GLPI's tickets; the new one is being read.
        return;
      }
      this.account = account;
      this.version = version;
      this.tickets = parseTickets(rows);
      this.total = total;
      this.readAt = Date.now();
      this.recovered();
      fresh = true;
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.failed(err);
    }
    if (this.readAt !== 0) {
      await this.publishDevice();
      if (fresh) {
        await this.publishStates();
        await this.fireEvents();
      }
    }
    await this.publishTransport();
    await this.publishConnectionStatus();
    this.refreshWidget();
  }

  recovered() {
    const host = hostOf(this.config.url);
    if (this.downSince !== null) {
      const minutes = Math.round((Date.now() - this.downSince) / 60_000);
      this.resolved('read', `GLPI at ${host} answers again after ${minutes} min`);
    }
    if (!this.connectedLogged) {
      this.connectedLogged = true;
      const { user, profile } = this.account;
      logger.info(
        `Connected to GLPI ${this.version} at ${host} as ${user} (${profile}): ${summarize(this.tickets).open} open ticket(s)`,
      );
    }
    const limit = PAGE_SIZE * MAX_PAGES;
    if (this.total > limit) {
      this.problem('limit', `${this.total} tickets: only the ${limit} newest are counted`);
    } else {
      this.resolved('limit');
    }
    this.error = null;
    this.downSince = null;
  }

  failed(err) {
    const kind = err instanceof GlpiError ? err.kind : ERROR_KINDS.HTTP;
    this.error = { kind, message: err.message };
    this.downSince ??= Date.now();
    // The user and the version are read again with the next session.
    this.account = null;
    this.version = null;
    this.problem('read', `GLPI at ${hostOf(this.config.url)}: ${err.message}`, undefined, 'error');
  }

  summary() {
    return summarize(this.tickets);
  }

  // --- Publishing to Gladys --------------------------------------------------

  async publishDevice() {
    const device = buildDevice(this.gladys, this.language);
    const signature = JSON.stringify(device);
    if (signature === this.deviceSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices([device]);
      this.deviceSignature = signature;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Discovered device refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab. */
  async rediscover() {
    this.deviceSignature = null;
    await this.poll();
  }

  /** The user added the device: the states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device?.external_id);
    if (!this.error && this.readAt !== 0) {
      await this.publishStates();
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async publishStates() {
    try {
      // Only the changes, and every value again after `heartbeatMs`.
      await this.gladys.publishChangedStates(featureStates(this.gladys, this.summary()), {
        heartbeat: this.timings.heartbeatMs,
      });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async publishTransport() {
    if (this.readAt === 0) {
      return;
    }
    const transport = this.error
      ? DEVICE_TRANSPORTS.UNREACHABLE
      : isLocalHost(new URL(this.config.url).hostname)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.CLOUD;
    if (transport === this.transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([
        { external_id: deviceIds(this.gladys).device, transport },
      ]);
      this.transport = transport;
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transport refused: ${err.message}`);
    }
  }

  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (!this.config.userToken) {
      return { connected: false, message: CONNECTION_TEXT.noToken };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidget() {
    const signature = JSON.stringify([this.error?.kind ?? null, this.tickets]);
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Scene events ----------------------------------------------------------

  /** What the next reading compares with: the highest number, the open and late tickets. */
  snapshot(scope) {
    const open = this.tickets.filter(isOpen);
    return {
      scope,
      maxId: Math.max(
        this.saved?.scope === scope ? this.saved.maxId : 0,
        ...this.tickets.map((t) => t.id),
      ),
      open: open.map((ticket) => ticket.id),
      late: open.filter((ticket) => ticket.late).map((ticket) => ticket.id),
    };
  }

  async fireEvents() {
    // Per GLPI and per user: another user sees other tickets.
    const scope = `${this.config.url}#${this.account.userId}`;
    if (this.saved?.scope !== scope) {
      this.saved = this.snapshot(scope);
      this.store.save(this.saved);
      return;
    }
    const before = this.saved;
    const wasOpen = new Set(before.open);
    const wasLate = new Set(before.late);
    const events = [
      ...this.tickets
        .filter((ticket) => ticket.id > before.maxId)
        .sort((a, b) => a.id - b.id)
        .map((ticket) => ({ key: TRIGGERS.CREATED, ticket })),
      ...this.tickets
        .filter((ticket) => isOpen(ticket) && ticket.late && !wasLate.has(ticket.id))
        .map((ticket) => ({ key: TRIGGERS.LATE, ticket })),
      ...this.tickets
        .filter((ticket) => !isOpen(ticket) && wasOpen.has(ticket.id))
        .map((ticket) => ({ key: TRIGGERS.SOLVED, ticket })),
    ].filter(
      ({ key, ticket }) => !(key === TRIGGERS.CREATED && this.ownTickets.includes(ticket.id)),
    );

    if (events.length > MAX_EVENTS_PER_READING) {
      this.problem(
        'burst',
        `${events.length} scene events at once: only the first ${MAX_EVENTS_PER_READING} are sent`,
      );
    }
    // What fired is applied to the saved state one by one: when Gladys
    // refuses one (restarting?), it and the next ones are tried again at the
    // next reading.
    const applied = { ...before, open: [...before.open], late: [...before.late] };
    let complete = true;
    for (const { key, ticket } of events.slice(0, MAX_EVENTS_PER_READING)) {
      if (!(await this.fire(key, await this.eventData(key, ticket)))) {
        complete = false;
        break;
      }
      if (key === TRIGGERS.CREATED) {
        applied.maxId = Math.max(applied.maxId, ticket.id);
      } else if (key === TRIGGERS.LATE) {
        applied.late.push(ticket.id);
      } else {
        applied.open = applied.open.filter((id) => id !== ticket.id);
      }
    }
    this.saved = complete ? this.snapshot(scope) : applied;
    if (JSON.stringify(this.saved) !== JSON.stringify(before)) {
      this.store.save(this.saved);
    }
  }

  /** Requester names, read once per user (a self-service profile may not: then empty). */
  async requesters(ids) {
    const names = [];
    for (const id of ids.slice(0, 3)) {
      if (!this.users.has(id)) {
        try {
          this.users.set(id, userName(await this.client.user(id)));
        } catch (err) {
          logger.debug(`User #${id} not readable: ${err.message}`);
          this.users.set(id, '');
        }
      }
      if (this.users.get(id)) {
        names.push(this.users.get(id));
      }
    }
    return names.join(', ');
  }

  async eventData(key, ticket) {
    const language = this.language;
    return {
      ticket_id: ticket.id,
      title: ticket.title,
      urgency: ticket.urgency,
      urgency_label: labelOf(URGENCY_TEXT, ticket.urgency, language),
      type: ticket.type,
      type_label: labelOf(TYPE_TEXT, ticket.type, language),
      status_label: labelOf(STATUS_TEXT, ticket.status, language),
      category: ticket.category,
      entity: ticket.entity,
      requester: await this.requesters(ticket.requesterIds),
      due_date: ticket.dueDate,
      url: ticketUrl(this.config.url, ticket.id),
      ...(key === TRIGGERS.SOLVED ? { solved_date: ticket.solved } : {}),
    };
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
      return true;
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Commands --------------------------------------------------------------

  /** A GLPI error, in words for the user (the server's text stays in the logs). */
  explain(err) {
    if (!(err instanceof GlpiError)) {
      return err;
    }
    const language = this.language;
    const colon = language === 'fr' ? ' : ' : ': ';
    const status = err.status ? ` (HTTP ${err.status})` : '';
    return new Error(`GLPI${colon}${pick(ERROR_TEXT[err.kind], language)}${status}`, {
      cause: err,
    });
  }

  requireClient() {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.language));
    }
    return this.client;
  }

  fail(key) {
    return new Error(pick(ACTION_TEXT[key], this.language));
  }

  /** Read again now, and wait for it a little (the scene should not lag). */
  async refreshSoon() {
    const refresh = this.poll().catch(() => {});
    let timer;
    await Promise.race([
      refresh,
      new Promise((resolve) => {
        timer = setTimeout(resolve, REFRESH_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  async findCategory(query) {
    const categories = (await this.requireClient().categories())
      .filter((category) => Number.isInteger(category?.id) && category.id > 0)
      .map((category) => ({
        id: category.id,
        name: text(category.completename) || text(category.name),
      }));
    const { item, reason } = findByIdOrName(categories, query);
    if (!item) {
      throw this.fail(reason === 'ambiguous' ? 'categoryAmbiguous' : 'categoryNotFound');
    }
    return item;
  }

  async findEntity(query) {
    const entities = (await this.requireClient().entities())
      .filter((entity) => Number.isInteger(entity?.id) && entity.id >= 0)
      .map((entity) => ({ id: entity.id, name: text(entity.name) }));
    const { item, reason } = findByIdOrName(entities, query);
    if (!item) {
      throw this.fail(reason === 'ambiguous' ? 'entityAmbiguous' : 'entityNotFound');
    }
    return item;
  }

  /**
   * Create a ticket, requested by the user of the token.
   * @param {object} fields title, description, urgency, type, category, entity (strings)
   * @returns {Promise<{ id: number, title: string, url: string }>}
   */
  async createTicket(fields = {}) {
    const client = this.requireClient();
    const title = String(fields.title ?? '').trim();
    if (!title) {
      throw this.fail('emptyTitle');
    }
    const description = String(fields.description ?? '').trim() || title;
    const urgency = Number(fields.urgency);
    const type = Number(fields.type);
    let id;
    try {
      const account = this.account ?? (await client.session());
      const input = {
        name: title.slice(0, TITLE_MAX),
        content: toHtml(description.slice(0, CONTENT_MAX)),
        urgency: Number.isInteger(urgency) && urgency >= 1 && urgency <= 5 ? urgency : 3,
        type: type === 2 ? 2 : 1,
        // Through the API, a ticket gets no requester unless one is given.
        ...(account.userId ? { _users_id_requester: account.userId } : {}),
      };
      if (String(fields.category ?? '').trim()) {
        input.itilcategories_id = (await this.findCategory(fields.category)).id;
      }
      if (String(fields.entity ?? '').trim()) {
        input.entities_id = (await this.findEntity(fields.entity)).id;
      }
      id = await client.createTicket(input);
    } catch (err) {
      throw this.explain(err);
    }
    // Never announced as new by the next reading: a scene "new ticket →
    // create a ticket" would loop.
    this.ownTickets = [...this.ownTickets, id].slice(-OWN_TICKETS_KEPT);
    logger.info(`Ticket #${id} created from Gladys`);
    await this.refreshSoon();
    return { id, title, url: ticketUrl(this.config.url, id) };
  }

  /** Add a follow-up to a ticket, written by the user of the token. */
  async addFollowup(fields = {}) {
    const client = this.requireClient();
    const id = parseTicketNumber(fields.ticket);
    if (id === null) {
      throw this.fail('badTicket');
    }
    const content = String(fields.text ?? '').trim();
    if (!content) {
      throw this.fail('emptyText');
    }
    let ticket;
    try {
      // A follow-up on a ticket that does not exist is a 400 "no permission":
      // the ticket is read first, for a clear message.
      ticket = await client.ticket(id);
      await client.addFollowup(id, toHtml(content.slice(0, CONTENT_MAX)));
    } catch (err) {
      if (err instanceof GlpiError && err.code === 'ERROR_ITEM_NOT_FOUND') {
        throw this.fail('ticketNotFound');
      }
      throw this.explain(err);
    }
    logger.info(`Follow-up added to ticket #${id} from Gladys`);
    return {
      id,
      title: text(ticket?.name) || `#${id}`,
      url: ticketUrl(this.config.url, id),
    };
  }

  /** The "Test the connection" action: read now, report. */
  async testConnection() {
    this.account = null;
    this.version = null;
    await this.poll();
    const status = this.connectionStatus();
    if (!status.connected) {
      const message = allLanguages((language) =>
        REPORT_TEXT[language].failed(pick(status.message, language)),
      );
      throw new Error(message[this.language]);
    }
    const summary = this.summary();
    const user = this.account.profile
      ? `${this.account.user} (${this.account.profile})`
      : this.account.user;
    return allLanguages((language) =>
      REPORT_TEXT[language].ok(this.version, user, summary.open, summary.late),
    );
  }
}
