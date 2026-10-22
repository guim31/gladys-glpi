// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// errors, and the GLPI vocabulary of the scene variables. Four languages, the
// four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './glpi/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your GLPI in the configuration.',
    fr: "Saisissez l'adresse de votre GLPI dans la configuration.",
    de: 'Gib die Adresse deines GLPI in der Konfiguration ein.',
    es: 'Introduzca la dirección de su GLPI en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. https://helpdesk.example.org/glpi',
    fr: 'Adresse incomprise, ex. https://helpdesk.example.org/glpi',
    de: 'Adresse nicht verstanden, z. B. https://helpdesk.example.org/glpi',
    es: 'Dirección no válida, p. ej. https://helpdesk.example.org/glpi',
  },
  noToken: {
    en: 'Enter the API token of a GLPI user in the configuration (its preferences, API token).',
    fr: "Saisissez le jeton d'API d'un utilisateur GLPI dans la configuration (ses préférences, Jeton d'API).",
    de: 'Gib in der Konfiguration das API-Token eines GLPI-Benutzers ein (seine Einstellungen, API-Token).',
    es: 'Introduzca el token de API de un usuario de GLPI en la configuración (sus preferencias, API token).',
  },
};

// One short explanation per error kind (src/glpi/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'GLPI does not answer',
    fr: 'GLPI ne répond pas',
    de: 'GLPI antwortet nicht',
    es: 'GLPI no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user token refused: check it in the preferences of the user',
    fr: "jeton utilisateur refusé : vérifiez-le dans les préférences de l'utilisateur",
    de: 'Benutzer-Token abgelehnt: Prüfe es in den Einstellungen des Benutzers',
    es: 'token de usuario rechazado: compruébelo en las preferencias del usuario',
  },
  [ERROR_KINDS.APP_TOKEN]: {
    en: 'application token missing or wrong: see Setup, General, API',
    fr: "jeton d'application manquant ou erroné : voir Configuration, Générale, API",
    de: 'Anwendungs-Token fehlt oder ist falsch: Siehe Konfiguration, Allgemein, API',
    es: 'token de aplicación ausente o incorrecto: vea Configuración, General, API',
  },
  [ERROR_KINDS.IP]: {
    en: 'no API client accepts the address of Gladys: see Setup, General, API',
    fr: "aucun client d'API n'accepte l'adresse de Gladys : voir Configuration, Générale, API",
    de: 'kein API-Client akzeptiert die Adresse von Gladys: Siehe Konfiguration, Allgemein, API',
    es: 'ningún cliente de API acepta la dirección de Gladys: vea Configuración, General, API',
  },
  [ERROR_KINDS.API_DISABLED]: {
    en: 'the REST API is off: turn it on in Setup, General, API',
    fr: "l'API REST est désactivée : activez-la dans Configuration, Générale, API",
    de: 'die REST-API ist aus: Schalte sie in Konfiguration, Allgemein, API ein',
    es: 'la API REST está desactivada: actívela en Configuración, General, API',
  },
  [ERROR_KINDS.RIGHTS]: {
    en: 'the profile of the GLPI user lacks a right: see the documentation',
    fr: "le profil de l'utilisateur GLPI n'a pas un droit nécessaire : voir la documentation",
    de: 'dem Profil des GLPI-Benutzers fehlt ein Recht: Sieh in der Dokumentation nach',
    es: 'al perfil del usuario de GLPI le falta un derecho: consulte la documentación',
  },
  [ERROR_KINDS.NOT_GLPI]: {
    en: 'no GLPI API at this address',
    fr: 'aucune API GLPI à cette adresse',
    de: 'keine GLPI-API unter dieser Adresse',
    es: 'no hay ninguna API de GLPI en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (version, user, open, late) =>
      `GLPI ${version} OK, user ${user}: ${open} open ticket(s), ${late} late.`,
    failed: (reason) => `GLPI: ${reason}.`,
  },
  fr: {
    ok: (version, user, open, late) =>
      `GLPI ${version} OK, utilisateur ${user} : ${open} ticket(s) ouvert(s), ${late} en retard.`,
    failed: (reason) => `GLPI : ${reason}.`,
  },
  de: {
    ok: (version, user, open, late) =>
      `GLPI ${version} OK, Benutzer ${user}: ${open} offene(s) Ticket(s), ${late} überfällig.`,
    failed: (reason) => `GLPI: ${reason}.`,
  },
  es: {
    ok: (version, user, open, late) =>
      `GLPI ${version} OK, usuario ${user}: ${open} ticket(s) abierto(s), ${late} atrasado(s).`,
    failed: (reason) => `GLPI: ${reason}.`,
  },
};

// Errors of the scene actions (shown in the scene logs of Gladys).
export const ACTION_TEXT = {
  notConfigured: {
    en: 'GLPI is not configured.',
    fr: "GLPI n'est pas configuré.",
    de: 'GLPI ist nicht konfiguriert.',
    es: 'GLPI no está configurado.',
  },
  emptyTitle: {
    en: 'Give the title of the ticket.',
    fr: 'Indiquez le titre du ticket.',
    de: 'Gib den Titel des Tickets an.',
    es: 'Indique el título del ticket.',
  },
  emptyText: {
    en: 'Give the text of the follow-up.',
    fr: 'Indiquez le texte du suivi.',
    de: 'Gib den Text der Antwort an.',
    es: 'Indique el texto del seguimiento.',
  },
  badTicket: {
    en: 'Give the number of the ticket, e.g. 125 or #125.',
    fr: 'Indiquez le numéro du ticket, ex. 125 ou #125.',
    de: 'Gib die Nummer des Tickets an, z. B. 125 oder #125.',
    es: 'Indique el número del ticket, p. ej. 125 o #125.',
  },
  ticketNotFound: {
    en: 'GLPI has no ticket with this number, or the user of the token cannot see it.',
    fr: "GLPI n'a aucun ticket avec ce numéro, ou l'utilisateur du jeton ne le voit pas.",
    de: 'GLPI hat kein Ticket mit dieser Nummer, oder der Benutzer des Tokens sieht es nicht.',
    es: 'GLPI no tiene ningún ticket con este número, o el usuario del token no puede verlo.',
  },
  categoryNotFound: {
    en: 'No ticket category has this name or number in GLPI.',
    fr: 'Aucune catégorie de ticket ne porte ce nom ou ce numéro dans GLPI.',
    de: 'Keine Ticket-Kategorie in GLPI hat diesen Namen oder diese Nummer.',
    es: 'Ninguna categoría de ticket tiene este nombre o número en GLPI.',
  },
  categoryAmbiguous: {
    en: 'Several categories have this name: give the full name (Parent > Child) or the number.',
    fr: 'Plusieurs catégories portent ce nom : indiquez le nom complet (Parent > Enfant) ou le numéro.',
    de: 'Mehrere Kategorien haben diesen Namen: Gib den vollen Namen (Eltern > Kind) oder die Nummer an.',
    es: 'Varias categorías tienen este nombre: indique el nombre completo (Padre > Hijo) o el número.',
  },
  entityNotFound: {
    en: 'The user of the token has no entity with this name or number.',
    fr: "L'utilisateur du jeton n'a aucune entité avec ce nom ou ce numéro.",
    de: 'Der Benutzer des Tokens hat keine Einheit mit diesem Namen oder dieser Nummer.',
    es: 'El usuario del token no tiene ninguna entidad con este nombre o número.',
  },
  entityAmbiguous: {
    en: 'Several entities have this name: give the full name (Root > Site) or the number.',
    fr: 'Plusieurs entités portent ce nom : indiquez le nom complet (Racine > Site) ou le numéro.',
    de: 'Mehrere Einheiten haben diesen Namen: Gib den vollen Namen (Wurzel > Standort) oder die Nummer an.',
    es: 'Varias entidades tienen este nombre: indique el nombre completo (Raíz > Sede) o el número.',
  },
};

// GLPI's vocabulary, for the scene variables and the widget.
export const STATUS_TEXT = {
  1: { en: 'New', fr: 'Nouveau', de: 'Neu', es: 'Nuevo' },
  2: { en: 'In progress', fr: 'En cours', de: 'In Bearbeitung', es: 'En curso' },
  3: { en: 'Planned', fr: 'Planifié', de: 'Geplant', es: 'Planificado' },
  4: { en: 'Pending', fr: 'En attente', de: 'Wartend', es: 'En espera' },
  5: { en: 'Solved', fr: 'Résolu', de: 'Gelöst', es: 'Resuelto' },
  6: { en: 'Closed', fr: 'Clos', de: 'Geschlossen', es: 'Cerrado' },
};

export const URGENCY_TEXT = {
  1: { en: 'Very low', fr: 'Très basse', de: 'Sehr niedrig', es: 'Muy baja' },
  2: { en: 'Low', fr: 'Basse', de: 'Niedrig', es: 'Baja' },
  3: { en: 'Medium', fr: 'Moyenne', de: 'Mittel', es: 'Media' },
  4: { en: 'High', fr: 'Haute', de: 'Hoch', es: 'Alta' },
  5: { en: 'Very high', fr: 'Très haute', de: 'Sehr hoch', es: 'Muy alta' },
};

export const TYPE_TEXT = {
  1: { en: 'Incident', fr: 'Incident', de: 'Störung', es: 'Incidencia' },
  2: { en: 'Request', fr: 'Demande', de: 'Anfrage', es: 'Solicitud' },
};

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A label of a GLPI table (status, urgency, type), '' when unknown. */
export const labelOf = (table, value, language) =>
  table[value] ? pick(table[value], language) : '';

/** A multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(Object.keys(INIT_FAILED).map((language) => [language, render(language)]));
