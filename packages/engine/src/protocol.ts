// protocol.ts — kontrak pesan Socket.IO antara klien dan server (dipakai kedua sisi).

import type { BaseView } from './types';

export interface RoomMemberView {
  /** Index slot (0..maxPlayers-1). */
  slot: number;
  name: string;
  avatar: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
  isYou: boolean;
}

export interface RoomView {
  code: string;
  gameId: string;
  maxPlayers: number;
  options: Record<string, unknown>;
  members: RoomMemberView[];
  status: 'lobby' | 'playing' | 'finished';
  /** Detik tersisa untuk giliran sekarang (null = tidak ada timer). */
  turnDeadline: number | null;
  turnSeconds: number;
  /** seat index permainan berjalan → slot anggota (kosong saat lobby). */
  seatSlots: number[];
  /** Seri ronde di room: rounds 0 = tanpa batas, intermission = jeda sebelum ronde berikutnya. */
  series: { round: number; rounds: number; intermission: boolean };
}

export interface ChatMessage {
  id: string;
  sender: string;
  avatar: string;
  seat: number | null;
  text: string;
  time: number;
}

export interface ServerToClient {
  'room:state': (room: RoomView) => void;
  'game:view': (view: BaseView) => void;
  'room:notice': (msg: { kind: 'info' | 'warn'; text: string }) => void;
  'room:closed': (msg: { reason: string }) => void;
  'room:chat': (msg: ChatMessage) => void;
}

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;

export interface ClientToServer {
  'session:hello': (p: { sessionToken?: string; name: string; avatar: string; authToken?: string }, ack: Ack<{ sessionToken: string; playerId: string; room: RoomView | null }>) => void;
  'room:create': (p: { gameId: string; maxPlayers: number }, ack: Ack<{ room: RoomView }>) => void;
  'room:join': (p: { code: string }, ack: Ack<{ room: RoomView }>) => void;
  'room:leave': (p: Record<string, never>, ack: Ack) => void;
  'room:ready': (p: { ready: boolean }, ack: Ack) => void;
  'room:configure': (p: { gameId?: string; maxPlayers?: number; options?: Record<string, unknown>; seriesRounds?: number }, ack: Ack) => void;
  'room:addBot': (p: Record<string, never>, ack: Ack) => void;
  'room:removeBot': (p: { slot: number }, ack: Ack) => void;
  'room:start': (p: Record<string, never>, ack: Ack) => void;
  'room:rematch': (p: Record<string, never>, ack: Ack) => void;
  'room:endSeries': (p: Record<string, never>, ack: Ack) => void;
  'game:action': (p: { action: unknown }, ack: Ack) => void;
  'room:chat': (p: { text: string }, ack: Ack) => void;
}

/** Alfabet kode room: tanpa karakter ambigu (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦁', '🐵', '🐙', '🦉', '🐨', '🐶', '🐱', '🐻'];
