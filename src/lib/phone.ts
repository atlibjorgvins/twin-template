// Lightweight phone-number helpers. We store numbers as E.164 strings
// (e.g. "+3548235300") so dialing, searching, and de-duplication are trivial.
// No external lib — Atli's contacts are mostly Icelandic, and the UI's
// country picker covers the long tail.

export type CountryCode = {
  code: string;       // dial prefix incl. leading + e.g. "+354"
  digits: string;     // bare digits e.g. "354"
  iso2: string;       // 2-letter country code e.g. "IS"
  flag: string;       // emoji
  name: string;
};

// Curated list — Atli's network. Iceland first as default; then the
// countries he actually corresponds with. Easy to extend later.
export const COUNTRIES: CountryCode[] = [
  { code: '+354', digits: '354', iso2: 'IS', flag: '🇮🇸', name: 'Iceland' },
  { code: '+1',   digits: '1',   iso2: 'US', flag: '🇺🇸', name: 'United States / Canada' },
  { code: '+44',  digits: '44',  iso2: 'GB', flag: '🇬🇧', name: 'United Kingdom' },
  { code: '+45',  digits: '45',  iso2: 'DK', flag: '🇩🇰', name: 'Denmark' },
  { code: '+46',  digits: '46',  iso2: 'SE', flag: '🇸🇪', name: 'Sweden' },
  { code: '+47',  digits: '47',  iso2: 'NO', flag: '🇳🇴', name: 'Norway' },
  { code: '+358', digits: '358', iso2: 'FI', flag: '🇫🇮', name: 'Finland' },
  { code: '+49',  digits: '49',  iso2: 'DE', flag: '🇩🇪', name: 'Germany' },
  { code: '+33',  digits: '33',  iso2: 'FR', flag: '🇫🇷', name: 'France' },
  { code: '+34',  digits: '34',  iso2: 'ES', flag: '🇪🇸', name: 'Spain' },
  { code: '+39',  digits: '39',  iso2: 'IT', flag: '🇮🇹', name: 'Italy' },
  { code: '+31',  digits: '31',  iso2: 'NL', flag: '🇳🇱', name: 'Netherlands' },
  { code: '+32',  digits: '32',  iso2: 'BE', flag: '🇧🇪', name: 'Belgium' },
  { code: '+41',  digits: '41',  iso2: 'CH', flag: '🇨🇭', name: 'Switzerland' },
  { code: '+43',  digits: '43',  iso2: 'AT', flag: '🇦🇹', name: 'Austria' },
  { code: '+351', digits: '351', iso2: 'PT', flag: '🇵🇹', name: 'Portugal' },
  { code: '+353', digits: '353', iso2: 'IE', flag: '🇮🇪', name: 'Ireland' },
  { code: '+48',  digits: '48',  iso2: 'PL', flag: '🇵🇱', name: 'Poland' },
  { code: '+91',  digits: '91',  iso2: 'IN', flag: '🇮🇳', name: 'India' },
  { code: '+86',  digits: '86',  iso2: 'CN', flag: '🇨🇳', name: 'China' },
  { code: '+81',  digits: '81',  iso2: 'JP', flag: '🇯🇵', name: 'Japan' },
  { code: '+61',  digits: '61',  iso2: 'AU', flag: '🇦🇺', name: 'Australia' },
  { code: '+972', digits: '972', iso2: 'IL', flag: '🇮🇱', name: 'Israel' },
  { code: '+55',  digits: '55',  iso2: 'BR', flag: '🇧🇷', name: 'Brazil' },
  { code: '+52',  digits: '52',  iso2: 'MX', flag: '🇲🇽', name: 'Mexico' }
];

export const DEFAULT_COUNTRY = COUNTRIES[0]; // +354

const CC_BY_DIGITS = new Map(COUNTRIES.map((c) => [c.digits, c]));

/** Strip everything that isn't a digit or leading +. */
function bareDigits(s: string): string {
  return s.replace(/[^\d+]/g, '');
}

/** Try to identify which country code is at the start of a digit string (no +). */
function matchPrefix(digits: string): CountryCode | null {
  // Try longest first (3-digit then 2-digit then 1-digit prefixes).
  for (const len of [3, 2, 1]) {
    const head = digits.slice(0, len);
    const cc = CC_BY_DIGITS.get(head);
    if (cc) return cc;
  }
  return null;
}

export type ParsedPhone = {
  country: CountryCode;
  national: string;       // bare national digits, no formatting
  e164: string;           // canonical "+CCNNNNNNN"
  recognized: boolean;    // true if a known country prefix matched
};

/**
 * Parse a free-form phone string into a canonical form.
 * - Strips spaces, dashes, parens, dots.
 * - "00xxx" → "+xxx"
 * - If a known country prefix is present, splits into country + national.
 * - Otherwise prepends the default country (Iceland by default).
 */
export function parsePhone(input: string, defaultCountry: CountryCode = DEFAULT_COUNTRY): ParsedPhone {
  const raw = bareDigits(input ?? '').replace(/^00/, '+');
  if (!raw) {
    return { country: defaultCountry, national: '', e164: '', recognized: false };
  }
  // With +
  if (raw.startsWith('+')) {
    const digits = raw.slice(1);
    const cc = matchPrefix(digits);
    if (cc) {
      const national = digits.slice(cc.digits.length);
      return { country: cc, national, e164: `+${cc.digits}${national}`, recognized: true };
    }
    // Unknown country code — keep as-is so we don't destroy data.
    return { country: defaultCountry, national: digits, e164: `+${digits}`, recognized: false };
  }
  // No leading +. Two cases:
  //  (a) Short input — looks like a default-country local number ("823 5300"
  //      → 7 Iceland digits). Don't try to read a country prefix into it,
  //      because e.g. "863 6760" would otherwise be mis-parsed as +86 China.
  //  (b) Longer input — may be a country code without "+" ("3548235300",
  //      "13105550000"). Allow prefix detection only if the *rest* is also a
  //      plausible national number (≥7 digits — Iceland's minimum).
  if (raw.length <= 8) {
    return {
      country: defaultCountry,
      national: raw,
      e164: `+${defaultCountry.digits}${raw}`,
      recognized: false
    };
  }
  const cc = matchPrefix(raw);
  if (cc) {
    const rest = raw.slice(cc.digits.length);
    if (rest.length >= 7 && rest.length <= 13) {
      return { country: cc, national: rest, e164: `+${cc.digits}${rest}`, recognized: true };
    }
  }
  return {
    country: defaultCountry,
    national: raw,
    e164: `+${defaultCountry.digits}${raw}`,
    recognized: false
  };
}

/** Build E.164 from explicit parts. Returns "" if national is empty. */
export function toE164(country: CountryCode, national: string): string {
  const n = bareDigits(national).replace(/^\+/, '');
  if (!n) return '';
  return `+${country.digits}${n}`;
}

/**
 * Pretty-print an E.164 string for display.
 * - Iceland: +354 NNN NNNN
 * - US/CA:   +1 NNN NNN NNNN
 * - other:   +CC <grouped>
 * Falls back to the original input if it can't parse.
 */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored) return '';
  const p = parsePhone(stored);
  if (!p.e164) return stored;
  const n = p.national;
  if (p.country.iso2 === 'IS' && n.length === 7) return `+354 ${n.slice(0, 3)} ${n.slice(3)}`;
  if (p.country.iso2 === 'US' && n.length === 10) return `+1 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (p.country.iso2 === 'GB' && n.length >= 10) return `${p.country.code} ${n.slice(0, 4)} ${n.slice(4)}`;
  // Generic: group in 3s
  const groups = n.match(/.{1,3}/g) ?? [n];
  return `${p.country.code} ${groups.join(' ')}`;
}

/** Re-export for UI dropdowns. */
export function findCountry(codeOrIso: string): CountryCode | null {
  const t = codeOrIso.trim().toUpperCase();
  return (
    COUNTRIES.find((c) => c.code === t || c.digits === t.replace(/^\+/, '') || c.iso2 === t) ?? null
  );
}
