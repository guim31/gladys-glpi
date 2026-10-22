// -----------------------------------------------------------------------------
// From the raw rows of GLPI's search engine to what Gladys shows: tickets and
// the counters of the device, the widget and the documentation.
//
// Definitions (GLPI statuses: 1 new, 2 processing (assigned), 3 processing
// (planned), 4 pending, 5 solved, 6 closed):
//   - open: new, processing or pending (GLPI's "not solved");
//   - late: open, and its time to resolve has passed (GLPI's own
//     "Time to resolve exceeded", so the time zone of the server applies);
//   - solved today: solved (or solved then closed) since midnight, server time.
// -----------------------------------------------------------------------------

import { FIELDS } from './client.js';

export const STATUS = Object.freeze({
  NEW: 1,
  ASSIGNED: 2,
  PLANNED: 3,
  PENDING: 4,
  SOLVED: 5,
  CLOSED: 6,
});

const OPEN_STATUSES = new Set([STATUS.NEW, STATUS.ASSIGNED, STATUS.PLANNED, STATUS.PENDING]);
export const isOpen = (ticket) => OPEN_STATUSES.has(ticket.status);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * GLPI 10 stores and returns names HTML-encoded (`Root entity &#62; Site
 * Nord`, `Imprimante &#60;RDC&#62; &#38; café`); 11 and 12 do not. Decoded
 * once, here, for every text read from GLPI.
 */
export const decodeHtml = (value) =>
  value.replace(/&(#\d{1,7}|#x[\da-f]{1,6}|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const point =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return NAMED[code.toLowerCase()] ?? entity;
  });

export const text = (value) => (typeof value === 'string' ? decodeHtml(value).trim() : '');
const int = (value) => {
  const number = Number(value);
  return Number.isInteger(number) ? number : 0;
};
/** A dropdown cell holds one value, or an array when several (two requesters). */
const list = (value) =>
  (Array.isArray(value) ? value : [value])
    .map((item) => (item === null || item === undefined ? '' : text(String(item))))
    .filter(Boolean);

/**
 * @param {unknown[]} rows `data` of GET /search/Ticket
 * @returns {Array<{ id: number, title: string, status: number, urgency: number,
 *   type: number, category: string, entity: string, requesterIds: number[],
 *   opened: string, solved: string, dueDate: string, late: boolean }>} newest first
 */
export function parseTickets(rows) {
  return (
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row && typeof row === 'object' && int(row[FIELDS.ID]) > 0)
      .map((row) => {
        const id = int(row[FIELDS.ID]);
        return {
          id,
          title: text(row[FIELDS.TITLE]) || `#${id}`,
          status: int(row[FIELDS.STATUS]),
          urgency: int(row[FIELDS.URGENCY]) || 3,
          type: int(row[FIELDS.TYPE]) || 1,
          category: list(row[FIELDS.CATEGORY]).join(', '),
          entity: list(row[FIELDS.ENTITY]).join(', '),
          requesterIds: list(row[FIELDS.REQUESTER])
            .map(Number)
            .filter((value) => Number.isInteger(value) && value > 0),
          opened: text(row[FIELDS.OPENED]),
          solved: text(row[FIELDS.SOLVED]),
          dueDate: text(row[FIELDS.TIME_TO_RESOLVE]),
          late: int(row[FIELDS.LATE]) === 1,
        };
      })
      // Offset pages are not stable: a ticket that moved meanwhile may come twice.
      .filter((ticket, index, all) => all.findIndex((other) => other.id === ticket.id) === index)
      .sort((a, b) => b.id - a.id)
  );
}

/** A ticket read by GET /Ticket/:id, in the shape of parseTickets (ids only for the dropdowns). */
export function ticketFromItem(item) {
  const id = int(item?.id);
  if (id <= 0) {
    return null;
  }
  return {
    id,
    title: text(item.name) || `#${id}`,
    status: int(item.status),
    urgency: int(item.urgency) || 3,
    type: int(item.type) || 1,
    category: '',
    entity: '',
    requesterIds: [],
    opened: text(item.date),
    solved: text(item.solvedate),
    dueDate: text(item.time_to_resolve),
    late: false,
  };
}

/** The counters of the device and the widget. */
export function summarize(tickets) {
  const open = tickets.filter(isOpen);
  const count = (statuses) => open.filter((ticket) => statuses.includes(ticket.status)).length;
  return {
    open: open.length,
    new: count([STATUS.NEW]),
    processing: count([STATUS.ASSIGNED, STATUS.PLANNED]),
    pending: count([STATUS.PENDING]),
    late: open.filter((ticket) => ticket.late).length,
    solvedToday: tickets.filter((ticket) => !isOpen(ticket)).length,
    latest: open,
  };
}

const fold = (value) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Find an item by its number (`12`, `#12`), its complete name
 * (`Root entity > Site Nord`) or its last part (`Site Nord`); case, accents
 * and repeated blanks ignored.
 * @template {{ id: number, name: string }} T
 * @param {T[]} items
 * @param {unknown} query
 * @returns {{ item: T|null, reason?: 'empty'|'not_found'|'ambiguous' }}
 */
export function findByIdOrName(items, query) {
  const wanted = typeof query === 'number' ? String(query) : String(query ?? '').trim();
  if (!wanted) {
    return { item: null, reason: 'empty' };
  }
  const number = wanted.match(/^#?(\d+)$/);
  if (number) {
    const byId = items.find((item) => item.id === Number(number[1]));
    if (byId) {
      return { item: byId };
    }
  }
  const target = fold(wanted);
  for (const nameOf of [
    (item) => item.name,
    (item) =>
      item.name
        .split(/\s*>\s*/)
        .at(-1)
        .trim(),
  ]) {
    const matches = items.filter((item) => fold(nameOf(item)) === target);
    if (matches.length === 1) {
      return { item: matches[0] };
    }
    if (matches.length > 1) {
      return { item: null, reason: 'ambiguous' };
    }
  }
  return { item: null, reason: 'not_found' };
}

/** `12`, `#12` or a number: the ticket number, null otherwise. */
export function parseTicketNumber(query) {
  const match = String(query ?? '')
    .trim()
    .match(/^#?(\d{1,10})$/);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Plain text from a scene into the HTML of a GLPI ticket or follow-up:
 * escaped, line breaks kept.
 */
export function toHtml(value) {
  const escaped = String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => `<p>${paragraph.replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

/** A user as GLPI shows it: first name and last name, else the login. */
export function userName(user) {
  const full = [text(user?.firstname), text(user?.realname)].filter(Boolean).join(' ');
  return full || text(user?.name);
}

/** The page of a ticket in GLPI. */
export const ticketUrl = (base, id) => `${base}/front/ticket.form.php?id=${id}`;
