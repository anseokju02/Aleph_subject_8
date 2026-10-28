import { env } from "cloudflare:workers";

export const SESSION_COOKIE = "p8_session";
export const CHALLENGE_COOKIE = "p8_challenge";
const PUBLIC_HOST = "persona.anseokju02.chatgpt.site";
const SESSION_LIFETIME = 12 * 60 * 60 * 1000;

type Runtime = { DB?: D1Database; OWNER_ACCOUNT_EMAIL?: string };

export function database(): D1Database {
  const db = (env as unknown as Runtime).DB;
  if (!db) throw new Error("D1 DB binding is missing");
  return db;
}

export function expectedSite(request: Request): { origin: string; rpID: string } {
  const url = new URL(request.url);
  if (url.protocol === "https:" && url.hostname === PUBLIC_HOST) {
    return { origin: `https://${PUBLIC_HOST}`, rpID: PUBLIC_HOST };
  }
  if (
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    ["http:", "https:"].includes(url.protocol)
  ) {
    return { origin: url.origin, rpID: url.hostname };
  }
  throw new Error("Unsupported Site origin");
}

export function sameOrigin(request: Request): boolean {
  try {
    return request.headers.get("origin") === expectedSite(request).origin;
  } catch {
    return false;
  }
}

export function isOwnerPlatformUser(request: Request): boolean {
  const configured = (env as unknown as Runtime).OWNER_ACCOUNT_EMAIL;
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  return Boolean(
    configured &&
      userId &&
      email &&
      email.toLowerCase() === configured.toLowerCase(),
  );
}

export function cookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  const item = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item?.slice(name.length + 1) ?? null;
}

export function cookieHeader(
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAgeSeconds}`;
}

export function json(data: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(JSON.stringify(data), { status, headers });
}

export function reject(message: string, status: number): Response {
  return json({ error: message }, status);
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export type Session = { token_hash: string; credential_id: string };

export async function currentSession(request: Request): Promise<Session | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  return database().prepare(
    `SELECT s.token_hash, s.credential_id FROM sessions s
      INNER JOIN passkeys p ON p.id = s.credential_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(tokenHash, Date.now()).first<Session>();
}

export async function createSession(credentialId: string, request: Request): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await database().prepare(
    "INSERT INTO sessions (token_hash, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(await hashToken(token), credentialId, now, now + SESSION_LIFETIME).run();
  return cookieHeader(request, SESSION_COOKIE, token, Math.floor(SESSION_LIFETIME / 1000));
}

export async function writeAudit(kind: string, outcome: string, detail: string): Promise<void> {
  await database().prepare(
    "INSERT INTO audit_events (kind, outcome, detail, created_at) VALUES (?, ?, ?, ?)",
  ).bind(kind, outcome, detail, Date.now()).run();
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 160_000) return null;
  const raw = await request.text();
  if (raw.length > 160_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
