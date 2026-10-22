// net.ts — klien Socket.IO (satu koneksi untuk seluruh app) + state room/game online.
import { io, type Socket } from 'socket.io-client';
import { useSyncExternalStore } from 'react';
import type { BaseView, ClientToServer, RoomView, ServerToClient, ChatMessage } from '@kuypoker/engine';
import { getData, update, recordResult, setLastRoom } from './store';
import { play } from './sound';

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'offline';

interface NetState {
  status: ConnStatus;
  room: RoomView | null;
  view: BaseView | null;
  notices: { id: number; kind: 'info' | 'warn'; text: string }[];
  closedReason: string | null;
  lastError: string | null;
  chats: ChatMessage[];
}

let state: NetState = { status: 'idle', room: null, view: null, notices: [], closedReason: null, lastError: null, chats: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<NetState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
export const useNet = <T,>(sel: (s: NetState) => T) =>
  useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => sel(state));

let socket: Socket<ServerToClient, ClientToServer> | null = null;
let noticeId = 0;
let recordedFor: string | null = null;

/** URL server: pengaturan pengguna → VITE_SERVER_URL → origin web saat ini. */
export function serverUrl(): string {
  const custom = getData().settings.serverUrl.trim();
  if (custom) return custom.replace(/\/$/, '');
  const env = (import.meta.env.VITE_SERVER_URL as string | undefined) || '';
  if (env) return env.replace(/\/$/, '');
  return location.origin;
}

function notice(kind: 'info' | 'warn', text: string) {
  const n = { id: ++noticeId, kind, text };
  set({ notices: [...state.notices, n].slice(-4) });
  setTimeout(() => set({ notices: state.notices.filter(x => x.id !== n.id) }), 4500);
}

async function hello(): Promise<void> {
  const d = getData();
  const res = await emit('session:hello', { sessionToken: d.session.token ?? undefined, name: d.profile.name, avatar: d.profile.avatar, authToken: d.session.authToken ?? undefined });
  update(x => { x.session.token = res.sessionToken; });
  set({ room: res.room, view: res.room?.status === 'lobby' ? null : state.view });
  // Server menahan kursi pemain yang terputus: catat kodenya agar reload bisa kembali ke meja.
  setLastRoom(res.room?.code ?? null);
}

export function connect(): Promise<void> {
  if (socket?.connected) return Promise.resolve();
  if (socket) { socket.connect(); return waitOnline(); }
  set({ status: 'connecting', lastError: null });
  socket = io(serverUrl(), { transports: ['websocket', 'polling'], reconnectionDelayMax: 4000, timeout: 8000 });
  socket.on('connect', () => { hello().then(() => set({ status: 'online' })).catch(e => set({ status: 'offline', lastError: String(e.message ?? e) })); });
  socket.on('disconnect', () => set({ status: 'offline' }));
  socket.on('connect_error', () => set({ status: 'offline', lastError: `Tidak bisa terhubung ke server (${serverUrl()})` }));
  socket.on('room:state', room => {
    const prev = state.room;
    if (prev && room.members.length > prev.members.length) play('room');
    if (room.status === 'lobby') recordedFor = null;
    set({ room, view: room.status === 'lobby' ? null : state.view, closedReason: null });
    setLastRoom(room.code);
  });
  socket.on('game:view', view => {
    const before = state.view;
    if (view.turn !== null && view.turn === view.you && before?.turn !== view.turn) play('turn');
    set({ view });
    const r = state.room;
    if (view.over && view.results && r && recordedFor !== r.code + view.log.length) {
      recordedFor = r.code + view.log.length;
      const mine = view.results.find(x => x.seat === view.you);
      if (mine) { recordResult({ gameId: r.gameId, at: Date.now(), mode: 'online', rank: mine.rank, players: view.results.length }); if (mine.rank === 1) play('win'); }
    }
  });
  socket.on('room:notice', n => notice(n.kind, n.text));
  socket.on('room:closed', ({ reason }) => { set({ room: null, view: null, closedReason: reason, chats: [] }); setLastRoom(null); });
  socket.on('room:chat', chat => {
    set({ chats: [...state.chats, chat].slice(-50) });
    play('emote');
  });
  return waitOnline();
}

function waitOnline(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (state.status === 'online') return resolve();
    const t = setTimeout(() => { unsub(); reject(new Error(state.lastError || 'Server tidak merespons')); }, 9000);
    const check = () => {
      if (state.status === 'online') { clearTimeout(t); unsub(); resolve(); }
    };
    listeners.add(check);
    const unsub = () => listeners.delete(check);
  });
}

/** Kirim event dengan ack; melempar Error berisi pesan ramah dari server. */
export function emit<T = any>(event: keyof ClientToServer, payload: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Belum terhubung ke server'));
    const t = setTimeout(() => reject(new Error('Server tidak merespons')), 8000);
    (socket.emit as any)(event, payload, (res: { ok: boolean; data?: T; error?: string }) => {
      clearTimeout(t);
      if (res?.ok) resolve(res.data as T);
      else reject(new Error(res?.error || 'Gagal'));
    });
  });
}

/** Setelah ganti nama/avatar/server — kirim ulang hello atau sambung ulang. */
export function refreshIdentity() {
  if (socket?.connected) void hello();
}
export function resetConnection() {
  socket?.disconnect();
  socket = null;
  set({ status: 'idle' });
}

export function clearClosed() { set({ closedReason: null }); }

export function sendRoomChat(text: string): Promise<void> {
  return emit('room:chat', { text });
}
