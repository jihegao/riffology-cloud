import type { Grant, Scope } from './policy.ts';

export const ACCESS_SECONDS = 20;
export const TICKET_SECONDS = 30;
export const SESSION_SECONDS = 600;
export const SESSION_COOKIE = '__Host-m0_principal';
export const ACCESS_COOKIE = '__Host-m0_preview';
export const CHALLENGE_COOKIE = '__Host-m0_challenge';
type Session = { id: string; tenant: Scope['tenant']; principal: string; expires_at: number; active: boolean };
type Ticket = { sid: string; grant: Grant; expires_at: number; used: boolean };
type Challenge = { ticket: string; nonce: string; state: 'pending' | 'authorized' | 'consumed'; expires_at: number };
type Access = { sid: string; grant: Grant; expires_at: number };
export type BrowserState = {
  enrollments: Record<string, { tenant: Scope['tenant']; run_id: string; expires_at: number; used: boolean }>;
  sessions: Record<string, Session>;
  tickets: Record<string, Ticket>;
  challenges: Record<string, Challenge>;
  codes: Record<string, { challenge: string; used: boolean }>;
  accesses: Record<string, Access>;
};
export function emptyBrowserState(): BrowserState { return { enrollments: {}, sessions: {}, tickets: {}, challenges: {}, codes: {}, accesses: {} }; }
export interface BrowserStorage {
  read(): BrowserState;
  write(state: BrowserState): void;
  transaction<T>(callback: () => T): T;
}
export type BrowserAction =
  | { kind: 'enroll'; tenant: Scope['tenant']; run_id: string }
  | { kind: 'login'; enrollment: string }
  | { kind: 'session'; sid: string }
  | { kind: 'ticket'; sid: string; grant: Grant }
  | { kind: 'begin'; ticket: string; generation: string }
  | { kind: 'authorize'; sid: string; challenge: string }
  | { kind: 'redeem'; code: string; nonce: string; generation: string }
  | { kind: 'access'; access: string; scope: Scope }
  | { kind: 'logout'; sid: string };
export type BrowserResult = {
  ok: boolean; error?: string; enrollment?: string; sid?: string; principal?: string; tenant?: Scope['tenant'];
  ticket?: string; challenge?: string; nonce?: string; code?: string; access?: string; grant?: Grant;
  expires_at?: number; scopes?: Scope[];
};
function same(a: Scope, b: Scope): boolean { return a.run_id === b.run_id && a.tenant === b.tenant && a.preview_id === b.preview_id && a.generation === b.generation; }
const opaque = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const deny = (error: string): BrowserResult => ({ ok: false, error });
const isOpaque = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function own<T>(records: Record<string, T>, id: string): T | undefined {
  return isOpaque(id) && Object.hasOwn(records, id) ? records[id] : undefined;
}
function validOpaqueInputs(input: BrowserAction): boolean {
  switch (input.kind) {
    case 'enroll': return true;
    case 'login': return isOpaque(input.enrollment);
    case 'session': case 'ticket': case 'logout': return isOpaque(input.sid);
    case 'begin': return isOpaque(input.ticket);
    case 'authorize': return isOpaque(input.sid) && isOpaque(input.challenge);
    case 'redeem': return isOpaque(input.code) && isOpaque(input.nonce);
    case 'access': return isOpaque(input.access);
    default: return false;
  }
}
/** Only trusted Worker RPC calls enter here. Project output and request-declared
 * principals are never inputs. All checks + one-use mutations share one DO
 * transactionSync; there are no awaits between checking and consuming. */
export function browserAction(storage: BrowserStorage, input: BrowserAction, nowMs = Date.now()): BrowserResult {
  if (!validOpaqueInputs(input)) return deny('invalid-opaque-credential');
  return storage.transaction(() => {
    const state = storage.read();
    const now = Math.floor(nowMs / 1000);
    const session = (sid: string) => {
      const record = own(state.sessions, sid);
      return record?.active && record.expires_at > now ? record : undefined;
    };
    const done = (result: BrowserResult) => { storage.write(state); return result; };
    switch (input.kind) {
      case 'enroll': {
        const enrollment = opaque();
        state.enrollments[enrollment] = { tenant: input.tenant, run_id: input.run_id, expires_at: now + TICKET_SECONDS, used: false };
        return done({ ok: true, enrollment });
      }
      case 'login': {
        const enrollment = own(state.enrollments, input.enrollment);
        if (!enrollment || enrollment.used || enrollment.expires_at <= now) return deny('enrollment-denied');
        const sid = opaque();
        // Fixed, server-owned synthetic identity. This is not a product login.
        const record: Session = { id: sid, tenant: enrollment.tenant, principal: `fixture-${enrollment.tenant}`, expires_at: now + SESSION_SECONDS, active: true };
        enrollment.used = true;
        state.sessions[sid] = record;
        return done({ ok: true, sid, principal: record.principal, tenant: record.tenant, expires_at: record.expires_at });
      }
      case 'session': {
        const record = session(input.sid);
        return record ? { ok: true, sid: record.id, principal: record.principal, tenant: record.tenant, expires_at: record.expires_at } : deny('browser-session-denied');
      }
      case 'ticket': {
        const record = session(input.sid);
        if (!record || record.tenant !== input.grant.tenant || input.grant.expires_at <= now) return deny('ticket-owner-denied');
        const ticket = opaque();
        state.tickets[ticket] = { sid: record.id, grant: input.grant, expires_at: Math.min(now + TICKET_SECONDS, input.grant.expires_at, record.expires_at), used: false };
        return done({ ok: true, ticket, grant: input.grant });
      }
      case 'begin': {
        const ticket = own(state.tickets, input.ticket);
        if (!ticket || ticket.used || ticket.expires_at <= now || ticket.grant.generation !== input.generation || !session(ticket.sid)) return deny('ticket-denied');
        const challenge = opaque(), nonce = opaque();
        state.challenges[challenge] = { ticket: input.ticket, nonce, state: 'pending', expires_at: ticket.expires_at };
        return done({ ok: true, challenge, nonce, grant: ticket.grant, expires_at: ticket.expires_at });
      }
      case 'authorize': {
        const challenge = own(state.challenges, input.challenge);
        const ticket = challenge && own(state.tickets, challenge.ticket);
        const record = session(input.sid);
        // Wrong subjects cannot burn another session's legitimate ticket.
        if (!record || !challenge || !ticket || ticket.sid !== record.id || ticket.grant.tenant !== record.tenant) return deny('ticket-owner-denied');
        if (challenge.state !== 'pending' || challenge.expires_at <= now || ticket.used || ticket.expires_at <= now) return deny('ticket-consumed-or-expired');
        const code = opaque();
        challenge.state = 'authorized';
        state.codes[code] = { challenge: input.challenge, used: false };
        return done({ ok: true, code, grant: ticket.grant });
      }
      case 'redeem': {
        const code = own(state.codes, input.code);
        const challenge = code && own(state.challenges, code.challenge);
        const ticket = challenge && own(state.tickets, challenge.ticket);
        const record = ticket && session(ticket.sid);
        if (!code || code.used || !challenge || challenge.state !== 'authorized' || challenge.nonce !== input.nonce || challenge.expires_at <= now || !ticket || ticket.used || ticket.expires_at <= now || !record || ticket.grant.generation !== input.generation || ticket.grant.expires_at <= now) return deny('code-denied');
        const access = opaque();
        const expires_at = Math.min(now + ACCESS_SECONDS, ticket.grant.expires_at, record.expires_at);
        // Consume the ticket only when this browser proves its nonce. Merely
        // navigating an owner's browser through authorize cannot burn it.
        ticket.used = true;
        code.used = true;
        challenge.state = 'consumed';
        state.accesses[access] = { sid: record.id, grant: ticket.grant, expires_at };
        return done({ ok: true, access, sid: record.id, grant: ticket.grant, expires_at });
      }
      case 'access': {
        const access = own(state.accesses, input.access);
        if (!access || access.expires_at <= now || access.grant.expires_at <= now || !same(access.grant, input.scope) || !session(access.sid)) return deny('preview-session-denied');
        return { ok: true, sid: access.sid, grant: access.grant, expires_at: access.expires_at };
      }
      case 'logout': {
        const record = session(input.sid);
        if (!record) return deny('browser-session-denied');
        record.active = false;
        const scopes = Object.values(state.accesses).filter(access => access.sid === record.id).map(access => access.grant);
        return done({ ok: true, sid: record.id, scopes });
      }
    }
  });
}
