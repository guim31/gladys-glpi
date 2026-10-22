// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `latest_tickets`.
//
// The use case: the screen of the IT room (or of the small office) shows how
// many tickets wait, how many are late, and the latest ones, without opening
// GLPI. Budget (8 components): three tiles (open, late, new) and one list of
// the eight newest open tickets, late ones flagged; each one links to its page
// in GLPI when GLPI is served in HTTPS (the widget links https only). The
// figures are values, not bound to device features, so the widget works
// before the device is added.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { ticketUrl } from './glpi/model.js';
import { STATUS_TEXT, URGENCY_TEXT, labelOf, pick } from './texts.js';

const MAX_ITEMS = 8;
// GLPI urgencies: 4 high, 5 very high.
const HIGH_URGENCY = 4;

export const TEXT = {
  configure: {
    en: 'Enter the address of your GLPI and a user token in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre GLPI et un jeton utilisateur dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines GLPI und ein Benutzer-Token in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su GLPI y un token de usuario en la configuración de la integración.',
  },
  noAnswer: {
    en: 'GLPI does not answer: see the Configuration screen of the integration.',
    fr: "GLPI ne répond pas : voir l'écran Configuration de l'intégration.",
    de: 'GLPI antwortet nicht: Sieh dir die Konfiguration der Integration an.',
    es: 'GLPI no responde: consulte la pantalla de configuración de la integración.',
  },
  stale: {
    en: 'GLPI does not answer: last known tickets.',
    fr: 'GLPI ne répond pas : derniers tickets connus.',
    de: 'GLPI antwortet nicht: zuletzt bekannte Tickets.',
    es: 'GLPI no responde: últimos tickets conocidos.',
  },
  nothing: {
    en: 'No open ticket.',
    fr: 'Aucun ticket ouvert.',
    de: 'Kein offenes Ticket.',
    es: 'Ningún ticket abierto.',
  },
  open: { en: 'Open', fr: 'Ouverts', de: 'Offen', es: 'Abiertos' },
  late: { en: 'Late', fr: 'En retard', de: 'Überfällig', es: 'Atrasados' },
  new: { en: 'New', fr: 'Nouveaux', de: 'Neu', es: 'Nuevos' },
  lateBadge: { en: 'Late', fr: 'En retard', de: 'Überfällig', es: 'Atrasado' },
  open_link: {
    en: 'Open in GLPI',
    fr: 'Ouvrir dans GLPI',
    de: 'In GLPI öffnen',
    es: 'Abrir en GLPI',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** One open ticket of the list: number and title, status and urgency, a late badge. */
function ticketItem(hub, ticket, language) {
  const subtitle = [
    labelOf(STATUS_TEXT, ticket.status, language),
    labelOf(URGENCY_TEXT, ticket.urgency, language),
    ticket.entity,
  ]
    .filter(Boolean)
    .join(' · ');
  const item = { title: fit(`#${ticket.id} ${ticket.title}`, 60), subtitle: fit(subtitle, 80) };
  if (ticket.late) {
    item.badge = { text: t(TEXT.lateBadge, language), color: WIDGET_COLORS.DANGER };
  } else if (ticket.urgency >= HIGH_URGENCY) {
    item.badge = {
      text: fit(labelOf(URGENCY_TEXT, ticket.urgency, language), 16),
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (hub.config.url.startsWith('https://')) {
    item.links = [
      { url: ticketUrl(hub.config.url, ticket.id), label: t(TEXT.open_link, language) },
    ];
  }
  return item;
}

async function get(hub, { language = 'en' } = {}) {
  if (!hub.client) {
    return message(TEXT.configure, language);
  }
  if (hub.readAt === 0) {
    return message(TEXT.noAnswer, language);
  }
  const summary = hub.summary();
  const components = [];
  if (hub.error) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.stale, language) });
  }
  components.push(
    { type: 'value', value: summary.open, label: t(TEXT.open, language), icon: 'inbox' },
    {
      type: 'value',
      value: summary.late,
      label: t(TEXT.late, language),
      icon: 'alert-circle',
      color: summary.late > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    { type: 'value', value: summary.new, label: t(TEXT.new, language), icon: 'plus-circle' },
  );
  if (summary.latest.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.nothing, language) });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: summary.latest.slice(0, MAX_ITEMS).map((ticket) => ticketItem(hub, ticket, language)),
    });
  }
  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
