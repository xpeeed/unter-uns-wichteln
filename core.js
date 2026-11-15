export const LIMITS = Object.freeze({
  minNames: 2,
  maxNames: 100,
  maxNameLength: 80,
  maxEventLength: 100,
  maxBudgetLength: 60,
  maxInputLength: 50000,
  maxFragmentLength: 4096,
  maxBaseUrlLength: 2048,
  maxDerangementAttempts: 10000,
});

const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const VERSION = 'v1';
const PAYLOAD_KEYS = ['v', 'giver', 'recipient', 'event', 'budget', 'date'];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const CONTROL_CHARS = /\p{Cc}/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const GENERIC_LINK_ERROR = 'Dieser Link ist ungültig, unvollständig oder wurde verändert.';

export class WichtelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WichtelError';
  }
}

const fail = (message) => {
  throw new WichtelError(message);
};

const charLength = (s) => [...s].length;

const normalizeText = (s) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();

// toUpperCase().toLowerCase() folds e.g. "ß" and "SS" to the same key.
const nameKey = (s) => s.normalize('NFC').toUpperCase().toLowerCase();

function getCrypto() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    fail('Dieser Browser bietet keinen sicheren Zufallsgenerator. Bitte einen aktuellen Browser verwenden.');
  }
  return c;
}

function getSubtle() {
  const subtle = getCrypto().subtle;
  if (!subtle) {
    fail('Sichere Verschlüsselung ist hier nicht verfügbar. Bitte die Seite über HTTPS oder localhost öffnen.');
  }
  return subtle;
}

function checkNameText(name, label) {
  if (name.length === 0) fail(`${label} darf nicht leer sein.`);
  if (CONTROL_CHARS.test(name)) fail(`${label} enthält unzulässige Steuerzeichen.`);
  if (charLength(name) > LIMITS.maxNameLength) {
    fail(`${label} ist zu lang (höchstens ${LIMITS.maxNameLength} Zeichen).`);
  }
}

export function normalizeNames(text) {
  if (typeof text !== 'string') fail('Bitte die Namen als Text eingeben, einen Namen pro Zeile.');
  if (text.length > LIMITS.maxInputLength) fail('Die Eingabe ist zu lang.');

  const names = [];
  const seen = new Map();
  text.split(/\r\n|[\n\r\u2028\u2029]/).forEach((line, index) => {
    const name = normalizeText(line);
    if (name === '') return;
    const lineNo = index + 1;
    checkNameText(name, `Der Name in Zeile ${lineNo}`);
    const key = nameKey(name);
    if (seen.has(key)) {
      const first = seen.get(key);
      fail(
        `Der Name „${name}“ kommt mehrfach vor (Zeile ${first.lineNo} und ${lineNo}). ` +
          'Groß- und Kleinschreibung zählt nicht als Unterschied. Bitte die Namen eindeutig machen, z. B. mit Nachnamen-Initial.',
      );
    }
    seen.set(key, { lineNo });
    names.push(name);
  });

  if (names.length < LIMITS.minNames) {
    fail(`Bitte mindestens ${LIMITS.minNames} Namen eingeben, einen pro Zeile.`);
  }
  if (names.length > LIMITS.maxNames) {
    fail(`Es sind höchstens ${LIMITS.maxNames} Namen möglich (eingegeben: ${names.length}).`);
  }
  return names;
}

export function secureRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32) {
    throw new RangeError('maxExclusive must be an integer in [1, 2^32]');
  }
  const c = getCrypto();
  const buf = new Uint32Array(1);
  // Values >= limit are rejected so every residue class has exactly the same size.
  const limit = 2 ** 32 - (2 ** 32 % maxExclusive);
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}

function validateNameList(names) {
  if (!Array.isArray(names)) fail('Die Namensliste ist ungültig.');
  if (names.length < LIMITS.minNames) fail(`Für die Auslosung werden mindestens ${LIMITS.minNames} Namen benötigt.`);
  if (names.length > LIMITS.maxNames) fail(`Es sind höchstens ${LIMITS.maxNames} Namen möglich.`);
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== 'string') fail('Die Namensliste enthält ungültige Einträge.');
    checkNameText(name, 'Ein Name');
    const key = nameKey(name);
    if (seen.has(key)) fail(`Der Name „${name}“ kommt mehrfach vor.`);
    seen.add(key);
  }
}

export function derangeWith(names, randomInt) {
  validateNameList(names);
  const n = names.length;
  const perm = new Array(n);
  for (let attempt = 0; attempt < LIMITS.maxDerangementAttempts; attempt++) {
    for (let i = 0; i < n; i++) perm[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }
    if (perm.every((target, i) => target !== i)) return perm.map((target) => names[target]);
  }
  return fail('Die Auslosung ist fehlgeschlagen. Bitte erneut versuchen.');
}

export function secureDerangement(names) {
  return derangeWith(names, secureRandomInt);
}

function isValidIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

function checkOptionalText(value, label, max) {
  if (typeof value !== 'string') fail(`${label} muss ein Text sein.`);
  const text = normalizeText(value);
  if (CONTROL_CHARS.test(text)) fail(`${label} enthält unzulässige Steuerzeichen.`);
  if (charLength(text) > max) fail(`${label} ist zu lang (höchstens ${max} Zeichen).`);
  return text;
}

export function validatePayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Die Wichtel-Daten sind ungültig.');
  }
  for (const key of Object.keys(payload)) {
    if (!PAYLOAD_KEYS.includes(key)) fail('Die Wichtel-Daten enthalten unbekannte Felder.');
  }
  if (payload.v !== 1) fail('Diese Version des Wichtel-Links wird nicht unterstützt.');

  if (typeof payload.giver !== 'string') fail('Der Name der schenkenden Person fehlt.');
  if (typeof payload.recipient !== 'string') fail('Der Name der beschenkten Person fehlt.');
  const giver = normalizeText(payload.giver);
  const recipient = normalizeText(payload.recipient);
  checkNameText(giver, 'Der Name der schenkenden Person');
  checkNameText(recipient, 'Der Name der beschenkten Person');
  if (nameKey(giver) === nameKey(recipient)) fail('Niemand darf sich selbst beschenken.');

  const event = checkOptionalText(payload.event, 'Der Anlass', LIMITS.maxEventLength);
  const budget = checkOptionalText(payload.budget, 'Das Budget', LIMITS.maxBudgetLength);

  const { date } = payload;
  if (typeof date !== 'string' || (date !== '' && !isValidIsoDate(date))) {
    fail('Das Datum ist ungültig. Bitte leer lassen oder im Format JJJJ-MM-TT angeben.');
  }

  return { v: 1, giver, recipient, event, budget, date };
}

export function validateBaseUrl(baseUrl) {
  const invalid = 'Die Basis-Adresse ist ungültig. Erlaubt ist eine HTTPS-Adresse (HTTP nur für localhost) ohne Zugangsdaten, „?“ oder „#“.';
  if (typeof baseUrl !== 'string' || baseUrl.length === 0 || baseUrl.length > LIMITS.maxBaseUrlLength) fail(invalid);
  if (/[\s\p{Cc}]/u.test(baseUrl) || baseUrl.includes('?') || baseUrl.includes('#')) fail(invalid);
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return fail(invalid);
  }
  if (url.username !== '' || url.password !== '' || baseUrl.includes('@')) fail(invalid);
  if (url.search !== '' || url.hash !== '') fail(invalid);
  if (url.protocol === 'https:') {
    if (url.hostname === '') fail(invalid);
  } else if (url.protocol === 'http:') {
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      fail('Unverschlüsselte HTTP-Adressen sind nur für localhost, 127.0.0.1 oder [::1] erlaubt. Bitte HTTPS verwenden.');
    }
  } else {
    fail(invalid);
  }
  return url;
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (!BASE64URL.test(text) || text.length % 4 === 1) fail(GENERIC_LINK_ERROR);
  let bin;
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return fail(GENERIC_LINK_ERROR);
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Reject non-canonical encodings (unused trailing bits set) so each link has one spelling.
  if (toBase64Url(bytes) !== text) fail(GENERIC_LINK_ERROR);
  return bytes;
}

export async function createSecretLink(baseUrl, payload) {
  const url = validateBaseUrl(baseUrl);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Die Wichtel-Daten sind ungültig.');
  }
  const clean = validatePayload({ v: 1, event: '', budget: '', date: '', ...payload });
  const subtle = getSubtle();

  let fragment;
  try {
    const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES));
    const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const rawKey = new Uint8Array(await subtle.exportKey('raw', key));
    const plaintext = new TextEncoder().encode(JSON.stringify(clean));
    const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
    fragment = `${VERSION}.${toBase64Url(iv)}.${toBase64Url(cipher)}.${toBase64Url(rawKey)}`;
  } catch {
    return fail('Der Link konnte nicht verschlüsselt werden. Bitte erneut versuchen.');
  }
  if (fragment.length + 1 > LIMITS.maxFragmentLength) fail('Die Angaben sind zu lang für einen Link.');
  return `${url.href}#${fragment}`;
}

export async function revealSecret(fragment) {
  if (typeof fragment !== 'string' || fragment.length === 0 || fragment.length > LIMITS.maxFragmentLength) {
    fail(GENERIC_LINK_ERROR);
  }
  const body = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const parts = body.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) fail(GENERIC_LINK_ERROR);

  const iv = fromBase64Url(parts[1]);
  const cipher = fromBase64Url(parts[2]);
  const rawKey = fromBase64Url(parts[3]);
  if (iv.length !== IV_BYTES || rawKey.length !== KEY_BYTES || cipher.length <= TAG_BYTES) {
    fail(GENERIC_LINK_ERROR);
  }

  const subtle = getSubtle();
  let decoded;
  try {
    const key = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    return fail(GENERIC_LINK_ERROR);
  }
  return validatePayload(decoded);
}
