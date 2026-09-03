// AI key vault — passphrase-based encryption for provider API keys.
//
// Keys are stored in Directus as `enc:v1:<ivB64>:<ctB64>` ciphertext. The
// AES-GCM key is derived (PBKDF2) from a passphrase you set; only the salt
// and a verifier ciphertext live in Directus (`ai_vault`). The passphrase
// itself is never persisted server-side — optionally cached per-device in
// localStorage so you don't re-enter it every session.
//
// This means a leaked Directus token / DB dump exposes only ciphertext.
import { browser } from '$app/environment';
import { getAiVaultMeta, saveAiVaultMeta } from '$lib/directus';

const PASS_KEY = 'twin.ai.vaultPass'; // per-device passphrase cache (opt-in)
const VERIFIER_PLAINTEXT = 'twin-ai-vault-v1';
const PBKDF2_ITERS = 200_000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Reactive vault state for the UI. */
export const vault = $state<{ configured: boolean; unlocked: boolean; loaded: boolean }>({
  configured: false,
  unlocked: false,
  loaded: false
});

let cryptoKey: CryptoKey | null = null; // in-memory derived key for the session
let saltB64: string | null = null;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptWith(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return `enc:v1:${b64(iv)}:${b64(ct)}`;
}
async function decryptWith(key: CryptoKey, payload: string): Promise<string> {
  const [, v, ivB64, ctB64] = payload.split(':');
  if (v !== 'v1') throw new Error('Unknown ciphertext version');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) as unknown as BufferSource },
    key,
    fromB64(ctB64) as unknown as BufferSource
  );
  return dec.decode(pt);
}

/** True if a string looks like a vault ciphertext (vs a legacy plaintext key). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

/** Load vault meta + try a cached passphrase. Call once on the AI settings page. */
export async function initVault(): Promise<void> {
  if (!browser) return;
  const meta = await getAiVaultMeta().catch(() => null);
  vault.configured = !!meta;
  saltB64 = meta?.salt ?? null;
  if (meta) {
    const cached = localStorage.getItem(PASS_KEY);
    if (cached) {
      try { await unlock(cached, true); } catch { localStorage.removeItem(PASS_KEY); }
    }
  }
  vault.loaded = true;
}

/** First-time setup: pick a passphrase, generate salt + verifier, store meta. */
export async function setupVault(passphrase: string, remember = true): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const verifier = await encryptWith(key, VERIFIER_PLAINTEXT);
  await saveAiVaultMeta(b64(salt), verifier);
  cryptoKey = key; saltB64 = b64(salt);
  vault.configured = true; vault.unlocked = true;
  if (remember) localStorage.setItem(PASS_KEY, passphrase);
}

/** Unlock with the passphrase; throws if wrong. */
export async function unlock(passphrase: string, remember = true): Promise<void> {
  const full = await getAiVaultMeta();
  if (!full) throw new Error('Vault not set up');
  const key = await deriveKey(passphrase, fromB64(full.salt));
  let ok = false;
  try { ok = (await decryptWith(key, full.verifier)) === VERIFIER_PLAINTEXT; } catch { ok = false; }
  if (!ok) throw new Error('Wrong passphrase');
  cryptoKey = key; saltB64 = full.salt;
  vault.unlocked = true;
  if (remember) localStorage.setItem(PASS_KEY, passphrase);
  else localStorage.removeItem(PASS_KEY);
}

/** Forget the passphrase on this device + drop the in-memory key. */
export function lock(): void {
  cryptoKey = null;
  vault.unlocked = false;
  if (browser) localStorage.removeItem(PASS_KEY);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  if (!cryptoKey) throw new Error('Vault locked');
  return encryptWith(cryptoKey, plaintext);
}
export async function decryptSecret(payload: string): Promise<string> {
  if (!cryptoKey) throw new Error('Vault locked');
  return decryptWith(cryptoKey, payload);
}
