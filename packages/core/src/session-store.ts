/**
 * Encrypted session store — persists wallet sessions (NOT private keys) to disk.
 * Uses AES-256-GCM with a machine-derived key scoped to the current user.
 *
 * Security note: the encryption key is derived from the OS user identity + a
 * fixed application salt. It is NOT a substitute for a proper secrets manager;
 * it prevents casual filesystem snooping of session tokens.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WalletSession } from "./types.js";

const APP_SALT = "open-agents-toolkit-v1";
const STORE_DIR = join(homedir(), ".open-agents-toolkit");
const STORE_FILE = join(STORE_DIR, "sessions.enc");

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12; // GCM standard
const AUTH_TAG_LEN = 16;

function deriveKey(): Buffer {
  // Derive a per-user key from a combination of the home directory path (user-scoped)
  // and a fixed application salt. Not HSM-grade but prevents casual leakage.
  const userSeed = createHash("sha256").update(homedir()).digest();
  return scryptSync(userSeed, APP_SALT, KEY_LEN) as Buffer;
}

function encrypt(plaintext: string): Buffer {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LEN });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Layout: [iv (12)] [authTag (16)] [ciphertext]
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decrypt(data: Buffer): string {
  const key = deriveKey();
  const iv = data.subarray(0, IV_LEN);
  const authTag = data.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = data.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LEN });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
}

function readSessions(): Record<string, WalletSession> {
  try {
    if (!existsSync(STORE_FILE)) return {};
    const raw = readFileSync(STORE_FILE);
    const json = decrypt(raw);
    return JSON.parse(json) as Record<string, WalletSession>;
  } catch {
    // Corrupt / stale file — start fresh
    return {};
  }
}

function writeSessions(sessions: Record<string, WalletSession>): void {
  ensureStoreDir();
  const json = JSON.stringify(sessions);
  const encrypted = encrypt(json);
  writeFileSync(STORE_FILE, encrypted, { mode: 0o600 });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function saveSession(key: string, session: WalletSession): void {
  const sessions = readSessions();
  sessions[key] = session;
  writeSessions(sessions);
}

export function loadSession(key: string): WalletSession | null {
  const sessions = readSessions();
  return sessions[key] ?? null;
}

export function deleteSession(key: string): void {
  const sessions = readSessions();
  delete sessions[key];
  writeSessions(sessions);
}

export function clearAllSessions(): void {
  writeSessions({});
}
