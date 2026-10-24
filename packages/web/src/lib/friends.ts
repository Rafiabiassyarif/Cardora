// friends.ts — teman & peringkat dari server (akun terdaftar), tanpa data contoh.
import { useEffect, useState } from 'react';
import { api } from './auth';
import { useData, emitNotice, trackAchievement } from './store';

export interface PublicUser { id: number; username: string; displayName: string; avatar: string }
export interface FriendRow extends PublicUser { wins: number; played: number; status: 'online' | 'playing' | 'offline' }
export interface SearchRow extends PublicUser { isFriend: boolean }
export interface RankRow extends PublicUser { rank: number; wins: number; played: number }

const listeners = new Set<() => void>();
let cache: FriendRow[] = [];
let loadedFor: string | null = null;
const notify = () => listeners.forEach(l => l());

export async function refreshFriends(): Promise<FriendRow[]> {
  const r = await api<{ friends: FriendRow[] }>('/friends');
  cache = r.friends;
  notify();
  return cache;
}

/** Daftar teman akun yang sedang masuk. Tamu → kosong + `needsAccount`. */
export function useFriends() {
  const token = useData(d => d.session.authToken);
  const [, tick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const l = () => tick(x => x + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => {
    if (!token) { cache = []; loadedFor = null; notify(); return; }
    if (loadedFor === token) return;
    loadedFor = token;
    refreshFriends().then(() => setError(null)).catch(e => setError((e as Error).message));
  }, [token]);
  return { friends: token ? cache : [], needsAccount: !token, error };
}

export const searchUsers = (q: string) =>
  api<{ users: SearchRow[] }>(`/users/search?q=${encodeURIComponent(q.trim())}`).then(r => r.users);

export async function addFriendById(u: PublicUser) {
  await api('/friends', { method: 'POST', body: JSON.stringify({ userId: u.id }) });
  trackAchievement('social_chatter', 1);
  emitNotice('success', `👥 ${u.displayName} ditambahkan sebagai teman.`);
  await refreshFriends();
}

export async function removeFriendById(u: PublicUser) {
  await api(`/friends/${u.id}`, { method: 'DELETE' });
  await refreshFriends();
}

export const fetchLeaderboard = () => api<{ players: RankRow[] }>('/leaderboard').then(r => r.players);
