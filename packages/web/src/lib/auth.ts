// auth.ts — alur masuk: akun (username/password), Google, atau tamu. Semua lewat API server yang sudah ada.
import { getData, update, claimRegisterBonus } from './store';
import { serverUrl, refreshIdentity } from './net';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
}

/** Panggil REST API server. status 0 = server tidak bisa dihubungi. */
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getData().session.authToken;
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Server tidak bisa dihubungi. Periksa koneksi atau coba lagi nanti.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Gagal (${res.status})`, res.status);
  return body as T;
}

interface AuthResponse { token: string; user: { id: number; username: string; displayName: string; avatar: string }; created?: boolean }

function applyAuth(body: AuthResponse, provider: 'password' | 'google') {
  update(d => {
    d.session.authToken = body.token;
    d.session.username = body.user.username;
    d.session.provider = provider;
    d.session.guest = false;
    d.profile.name = body.user.displayName;
    d.profile.avatar = body.user.avatar;
    d.onboarded = true;
  });
  refreshIdentity();
  void import('./economy').then(async m => { await m.migrateGuestProgress(); await m.refreshEconomy(); });
}

export async function loginWithPassword(username: string, password: string) {
  const body = await api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ username: username.trim(), password }) });
  applyAuth(body, 'password');
  return body;
}

/** Daftar akun baru. Progres lokal (chip, XP, statistik) tetap dipertahankan + bonus daftar. */
export async function registerAccount(username: string, password: string, displayName?: string) {
  const profile = getData().profile;
  const body = await api<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: username.trim(), password, displayName: displayName?.trim() || profile.name, avatar: profile.avatar }),
  });
  applyAuth(body, 'password');
  claimRegisterBonus();
  return body;
}

export async function loginWithGoogle(credential: string) {
  const profile = getData().profile;
  const body = await api<AuthResponse>('/auth/google', { method: 'POST', body: JSON.stringify({ credential, avatar: profile.avatar }) });
  applyAuth(body, 'google');
  if (body.created) claimRegisterBonus();
  return body;
}

export function continueAsGuest() {
  update(d => { d.session.guest = true; d.session.authToken = null; d.session.username = null; d.session.provider = null; d.onboarded = true; });
  refreshIdentity();
}

/** Keluar sepenuhnya → kembali ke landing page. Data lokal (chip/XP) tetap di perangkat. */
export function logout() {
  update(d => { d.session.authToken = null; d.session.username = null; d.session.provider = null; d.session.guest = false; });
  try { (window as any).google?.accounts?.id?.disableAutoSelect?.(); } catch { /* abaikan */ }
  refreshIdentity();
}

export const isSignedIn = () => { const s = getData().session; return !!s.authToken || s.guest; };

/**
 * Validasi token tersimpan. 'ok' | 'expired' (token ditolak → sudah dihapus) | 'offline' (server tak terjangkau,
 * tetap izinkan main offline).
 */
export async function validateSession(): Promise<'ok' | 'expired' | 'offline' | 'none'> {
  if (!getData().session.authToken) return 'none';
  try {
    await api('/me');
    return 'ok';
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      update(d => { d.session.authToken = null; d.session.username = null; d.session.provider = null; });
      return 'expired';
    }
    return 'offline';
  }
}

// ---------------- Google Identity Services ----------------
let configPromise: Promise<string | null> | null = null;

/** Client ID Google dari server (null = belum dikonfigurasi / server offline). */
export function googleClientId(): Promise<string | null> {
  configPromise ??= api<{ google: string | null }>('/auth/config').then(r => r.google).catch(() => { configPromise = null; return null; });
  return configPromise;
}

let gsiPromise: Promise<any> | null = null;
export function loadGoogleScript(): Promise<any> {
  gsiPromise ??= new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.id) return resolve((window as any).google);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve((window as any).google);
    s.onerror = () => { gsiPromise = null; reject(new Error('Gagal memuat layanan Google')); };
    document.head.appendChild(s);
  });
  return gsiPromise;
}
