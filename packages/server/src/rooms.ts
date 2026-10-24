// rooms.ts — manajemen room & sesi permainan authoritative.
//
// Terpisah dari Socket.IO (memakai interface Emitter) agar bisa diuji langsung.
// Server adalah sumber kebenaran: deck, kartu tersembunyi, giliran, chip.
// Setiap pemain hanya menerima `view` untuk seat-nya sendiri.

import { randomBytes, randomInt } from 'node:crypto';
import {
  type BaseView, type GameModule, type RoomView, type SeatResult, type ChatMessage, getGame, catalogById,
  cryptoRng, RuleError, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode, AVATARS,
} from '@kuypoker/engine';
import { config } from './config';
import { log } from './logger';

export class UserError extends Error {}

export interface Emitter {
  room(playerId: string, room: RoomView): void;
  view(playerId: string, view: BaseView): void;
  notice(playerId: string, kind: 'info' | 'warn', text: string): void;
  closed(playerId: string, reason: string): void;
  chat(playerId: string, msg: ChatMessage): void;
}

export interface Session {
  token: string;
  playerId: string;
  name: string;
  avatar: string;
  userId: number | null;
  roomCode: string | null;
  connected: boolean;
  lastSeen: number;
}

interface Member {
  playerId: string | null; // null = bot
  name: string;
  avatar: string;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
  disconnectedAt: number | null;
}

interface ActiveGame {
  module: GameModule;
  state: any;
  /** seat index → slot index */
  seatSlots: number[];
}

export interface Room {
  code: string;
  hostId: string;
  gameId: string;
  maxPlayers: number;
  options: Record<string, unknown>;
  slots: (Member | null)[];
  status: 'lobby' | 'playing' | 'finished';
  game: ActiveGame | null;
  turnDeadline: number | null;
  timers: { turn?: NodeJS.Timeout; auto?: NodeJS.Timeout; bot?: NodeJS.Timeout };
  lastActivity: number;
  createdAt: number;
}

export interface ResultSink {
  (r: { gameId: string; code: string; results: SeatResult[]; players: { seat: number; userId: number | null; name: string; isBot: boolean }[] }): void;
}

const BOT_NAMES = ['Bot Budi', 'Bot Sari', 'Bot Joko', 'Bot Rina', 'Bot Dewi', 'Bot Agus', 'Bot Tono', 'Bot Lina'];

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) : '';
  return s || `Pemain${randomInt(100, 999)}`;
}
export function cleanAvatar(raw: unknown): string {
  return typeof raw === 'string' && AVATARS.includes(raw) ? raw : AVATARS[0];
}

export class RoomManager {
  readonly sessions = new Map<string, Session>();   // token → session
  private byPlayer = new Map<string, Session>();     // playerId → session
  readonly rooms = new Map<string, Room>();
  private rng = cryptoRng();
  private sweeper: NodeJS.Timeout;

  constructor(private emit: Emitter, private onResults: ResultSink = () => {}, private cfg = config) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  dispose() {
    clearInterval(this.sweeper);
    for (const r of this.rooms.values()) this.clearTimers(r);
  }

  /* ----------------------------- sessions ------------------------------ */

  /** Membuat atau melanjutkan sesi. Token = rahasia acak 256-bit milik klien. */
  hello(token: string | undefined, name: unknown, avatar: unknown, userId: number | null = null): Session {
    let s = token ? this.sessions.get(token) : undefined;
    if (!s) {
      const t = randomBytes(32).toString('hex');
      s = { token: t, playerId: randomBytes(8).toString('hex'), name: cleanName(name), avatar: cleanAvatar(avatar), userId, roomCode: null, connected: true, lastSeen: Date.now() };
      this.sessions.set(t, s);
      this.byPlayer.set(s.playerId, s);
    } else {
      s.name = cleanName(name ?? s.name);
      s.avatar = cleanAvatar(avatar ?? s.avatar);
      if (userId) s.userId = userId;
    }
    s.connected = true;
    s.lastSeen = Date.now();
    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    if (s.roomCode && !room) s.roomCode = null;
    if (room) this.onReconnect(room, s);
    return s;
  }

  sessionByPlayer(playerId: string) { return this.byPlayer.get(playerId); }

  /** Status nyata akun: tersambung ke server & sedang di meja yang bermain. */
  presence(userId: number): 'online' | 'playing' | 'offline' {
    let st: 'online' | 'playing' | 'offline' = 'offline';
    for (const s of this.byPlayer.values()) {
      if (s.userId !== userId || !s.connected) continue;
      if (s.roomCode && this.rooms.get(s.roomCode)?.status === 'playing') return 'playing';
      st = 'online';
    }
    return st;
  }

  disconnect(playerId: string) {
    const s = this.byPlayer.get(playerId);
    if (!s) return;
    s.connected = false;
    s.lastSeen = Date.now();
    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    if (!room) return;
    const m = this.memberOf(room, playerId);
    if (!m) return;
    m.connected = false;
    m.disconnectedAt = Date.now();
    this.notifyAll(room, 'warn', `${m.name} terputus — kursi ditahan ${this.cfg.reconnectGraceSeconds} detik`);
    this.touch(room);
    this.broadcast(room);
    // Jika sedang gilirannya, percepat timeout agar meja tidak macet.
    this.scheduleTurn(room);
  }

  private onReconnect(room: Room, s: Session) {
    const m = this.memberOf(room, s.playerId);
    if (!m) { s.roomCode = null; return; }
    const wasAway = !m.connected;
    m.connected = true;
    m.disconnectedAt = null;
    m.name = s.name; m.avatar = s.avatar;
    if (wasAway) this.notifyAll(room, 'info', `${m.name} tersambung kembali`);
    this.touch(room);
    this.broadcast(room);
    this.scheduleTurn(room);
  }

  /* ------------------------------- rooms ------------------------------- */

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new UserError('Server sibuk, coba lagi');
  }

  private requireSession(playerId: string): Session {
    const s = this.byPlayer.get(playerId);
    if (!s) throw new UserError('Sesi tidak ditemukan, muat ulang aplikasi');
    return s;
  }

  private validGame(gameId: unknown): GameModule {
    const mod = typeof gameId === 'string' ? getGame(gameId) : undefined;
    if (!mod) {
      const entry = typeof gameId === 'string' ? catalogById(gameId) : undefined;
      throw new UserError(entry ? `${entry.name} masih segera hadir` : 'Game tidak dikenal');
    }
    return mod;
  }

  private clampPlayers(mod: GameModule, n: unknown) {
    const v = Math.round(Number(n));
    return Number.isFinite(v) ? Math.min(mod.maxPlayers, Math.max(Math.max(2, mod.minPlayers), v)) : Math.min(4, mod.maxPlayers);
  }

  create(playerId: string, gameId: unknown, maxPlayers: unknown): Room {
    const s = this.requireSession(playerId);
    if (this.rooms.size >= this.cfg.maxRooms) throw new UserError('Server penuh, coba beberapa saat lagi');
    if (s.roomCode) this.leave(playerId);
    const mod = this.validGame(gameId);
    const max = this.clampPlayers(mod, maxPlayers);
    const room: Room = {
      code: this.newCode(), hostId: playerId, gameId: mod.id, maxPlayers: max, options: { ...mod.defaultOptions },
      slots: Array(max).fill(null), status: 'lobby', game: null, turnDeadline: null, timers: {},
      lastActivity: Date.now(), createdAt: Date.now(),
    };
    room.slots[0] = { playerId, name: s.name, avatar: s.avatar, ready: false, connected: true, isBot: false, disconnectedAt: null };
    this.rooms.set(room.code, room);
    s.roomCode = room.code;
    log.info('room created', { code: room.code, game: room.gameId });
    this.broadcast(room);
    return room;
  }

  join(playerId: string, rawCode: unknown): Room {
    const s = this.requireSession(playerId);
    const code = normalizeRoomCode(rawCode);
    if (!code) throw new UserError('Kode room harus 6 karakter (huruf/angka)');
    const room = this.rooms.get(code);
    if (!room) throw new UserError('Room tidak ditemukan atau sudah kedaluwarsa');
    if (this.memberOf(room, playerId)) { s.roomCode = code; this.onReconnect(room, s); return room; }
    if (room.status === 'playing') throw new UserError('Permainan di room ini sedang berlangsung');
    const free = room.slots.findIndex(x => x === null);
    if (free < 0) throw new UserError('Room sudah penuh');
    if (s.roomCode && s.roomCode !== code) this.leave(playerId);
    room.slots[free] = { playerId, name: s.name, avatar: s.avatar, ready: false, connected: true, isBot: false, disconnectedAt: null };
    s.roomCode = code;
    this.notifyAll(room, 'info', `${s.name} bergabung`);
    this.touch(room);
    this.broadcast(room);
    return room;
  }

  leave(playerId: string) {
    const s = this.byPlayer.get(playerId);
    const room = s?.roomCode ? this.rooms.get(s.roomCode) : undefined;
    if (s) s.roomCode = null;
    if (!room) return;
    const slot = room.slots.findIndex(m => m?.playerId === playerId);
    if (slot < 0) return;
    const m = room.slots[slot]!;
    if (room.status === 'playing') {
      // Kursi tetap ada sampai permainan selesai; dikendalikan aksi timeout otomatis.
      m.connected = false;
      m.disconnectedAt = 0;
      m.playerId = `left:${playerId}`;
      this.notifyAll(room, 'warn', `${m.name} keluar dari permainan`);
      this.scheduleTurn(room);
    } else {
      room.slots[slot] = null;
      this.notifyAll(room, 'info', `${m.name} keluar`);
    }
    this.emit.closed(playerId, 'Kamu keluar dari room');
    this.afterMemberGone(room, playerId);
  }

  /** Pindahkan host atau tutup room jika tidak ada manusia tersisa. */
  private afterMemberGone(room: Room, goneId: string) {
    const humans = room.slots.filter((m): m is Member => !!m && !m.isBot && !!m.playerId && !m.playerId.startsWith('left:'));
    if (!humans.length) { this.close(room, 'Room ditutup karena tidak ada pemain'); return; }
    if (room.hostId === goneId || !humans.some(h => h.playerId === room.hostId)) {
      const next = humans.find(h => h.connected) ?? humans[0];
      room.hostId = next.playerId!;
      this.notifyAll(room, 'info', `${next.name} sekarang menjadi host`);
    }
    this.touch(room);
    this.broadcast(room);
  }

  close(room: Room, reason: string) {
    this.clearTimers(room);
    this.rooms.delete(room.code);
    for (const m of room.slots) {
      if (!m?.playerId || m.isBot) continue;
      const s = this.byPlayer.get(m.playerId);
      if (s?.roomCode === room.code) s.roomCode = null;
      this.emit.closed(m.playerId, reason);
    }
    log.info('room closed', { code: room.code, reason });
  }

  private hostRoom(playerId: string): Room {
    const room = this.roomOf(playerId);
    if (room.hostId !== playerId) throw new UserError('Hanya host yang bisa melakukan ini');
    return room;
  }

  roomOf(playerId: string): Room {
    const s = this.requireSession(playerId);
    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    if (!room) throw new UserError('Kamu tidak berada di room');
    return room;
  }

  setReady(playerId: string, ready: boolean) {
    const room = this.roomOf(playerId);
    if (room.status === 'playing') throw new UserError('Permainan sedang berlangsung');
    const m = this.memberOf(room, playerId)!;
    m.ready = !!ready;
    this.touch(room);
    this.broadcast(room);
  }

  configure(playerId: string, p: { gameId?: unknown; maxPlayers?: unknown; options?: unknown }) {
    const room = this.hostRoom(playerId);
    if (room.status === 'playing') throw new UserError('Tidak bisa mengubah pengaturan saat bermain');
    let mod = this.validGame(room.gameId);
    if (p.gameId !== undefined && p.gameId !== room.gameId) {
      mod = this.validGame(p.gameId);
      room.gameId = mod.id;
      room.options = { ...mod.defaultOptions };
    }
    if (p.maxPlayers !== undefined || room.maxPlayers > mod.maxPlayers) {
      const max = this.clampPlayers(mod, p.maxPlayers ?? room.maxPlayers);
      const occupied = room.slots.filter(Boolean).length;
      if (max < occupied) throw new UserError(`Masih ada ${occupied} pemain di room`);
      const members = room.slots.filter(Boolean) as Member[];
      room.slots = [...members, ...Array(max - members.length).fill(null)];
      room.maxPlayers = max;
    }
    if (p.options !== undefined) room.options = { ...mod.sanitizeOptions({ ...room.options, ...(p.options as object) }) };
    for (const m of room.slots) if (m && !m.isBot) m.ready = false; // pengaturan berubah → siap ulang
    room.status = 'lobby';
    this.touch(room);
    this.broadcast(room);
  }

  addBot(playerId: string) {
    const room = this.hostRoom(playerId);
    if (room.status === 'playing') throw new UserError('Permainan sedang berlangsung');
    const free = room.slots.findIndex(x => x === null);
    if (free < 0) throw new UserError('Room sudah penuh');
    const used = new Set(room.slots.map(m => m?.name));
    const name = BOT_NAMES.find(n => !used.has(n)) ?? `Bot ${free + 1}`;
    room.slots[free] = { playerId: null, name, avatar: AVATARS[(free + 3) % AVATARS.length], ready: true, connected: true, isBot: true, disconnectedAt: null };
    this.touch(room);
    this.broadcast(room);
  }

  removeBot(playerId: string, slot: unknown) {
    const room = this.hostRoom(playerId);
    if (room.status === 'playing') throw new UserError('Permainan sedang berlangsung');
    const i = Number(slot);
    if (!Number.isInteger(i) || !room.slots[i]?.isBot) throw new UserError('Bot tidak ditemukan');
    room.slots[i] = null;
    this.broadcast(room);
  }

  start(playerId: string) {
    const room = this.hostRoom(playerId);
    if (room.status === 'playing') throw new UserError('Permainan sudah berjalan');
    const mod = this.validGame(room.gameId);
    const members = room.slots.map((m, i) => ({ m, i })).filter((x): x is { m: Member; i: number } => !!x.m);
    // Pemain yang sudah keluar saat permainan sebelumnya dibersihkan.
    const present = members.filter(x => !x.m.playerId?.startsWith('left:'));
    if (present.length < mod.minPlayers || present.length < 2) throw new UserError(`Butuh minimal ${Math.max(2, mod.minPlayers)} pemain`);
    if (present.length > mod.maxPlayers) throw new UserError(`Maksimal ${mod.maxPlayers} pemain`);
    const notReady = present.filter(x => !x.m.isBot && x.m.playerId !== room.hostId && (!x.m.ready || !x.m.connected));
    if (notReady.length) throw new UserError(`Menunggu siap: ${notReady.map(x => x.m.name).join(', ')}`);
    for (const x of members) if (x.m.playerId?.startsWith('left:')) room.slots[x.i] = null;
    const seated = present;
    const options = mod.sanitizeOptions(room.options);
    const state = mod.setup(seated.map(x => ({ id: x.m.playerId ?? `bot${x.i}`, name: x.m.name, isBot: x.m.isBot })), options, this.rng);
    room.game = { module: mod, state, seatSlots: seated.map(x => x.i) };
    room.status = 'playing';
    log.info('game started', { code: room.code, game: mod.id, players: seated.length });
    this.notifyAll(room, 'info', 'Permainan dimulai!');
    this.touch(room);
    this.afterChange(room);
  }

  rematch(playerId: string) {
    const room = this.hostRoom(playerId);
    if (room.status !== 'finished') throw new UserError('Permainan belum selesai');
    room.status = 'lobby';
    room.game = null;
    for (const m of room.slots) if (m && !m.isBot) m.ready = m.playerId === room.hostId;
    this.broadcast(room);
  }

  action(playerId: string, action: unknown) {
    const room = this.roomOf(playerId);
    const g = room.game;
    if (!g || room.status !== 'playing') throw new UserError('Tidak ada permainan berjalan');
    const seat = this.seatOf(room, playerId);
    if (seat < 0) throw new UserError('Kamu bukan pemain di meja ini');
    if (typeof action !== 'object' || action === null) throw new UserError('Aksi tidak valid');
    this.applyAction(room, seat, action);
    this.touch(room);
  }

  chat(playerId: string, rawText: unknown) {
    const room = this.roomOf(playerId);
    if (typeof rawText !== 'string') throw new UserError('Pesan tidak valid');
    const text = rawText.trim().slice(0, 100);
    if (!text) return;
    const member = room.slots.find(s => s?.playerId === playerId);
    if (!member) throw new UserError('Kamu bukan anggota room');
    const seat = this.seatOf(room, playerId);
    const chatMsg: ChatMessage = {
      id: `${Date.now()}-${randomInt(1000, 9999)}`,
      sender: member.name,
      avatar: member.avatar,
      seat: seat >= 0 ? seat : null,
      text,
      time: Date.now(),
    };
    for (const m of room.slots) {
      if (m?.playerId && !m.isBot && m.connected) {
        this.emit.chat(m.playerId, chatMsg);
      }
    }
    this.touch(room);
  }

  /* --------------------------- game driving ---------------------------- */

  private applyAction(room: Room, seat: number, action: unknown) {
    const g = room.game!;
    try {
      g.state = g.module.apply(g.state, seat, action, this.rng);
    } catch (e) {
      if (e instanceof RuleError) throw new UserError(e.message);
      throw e;
    }
    this.afterChange(room);
  }

  /** Setelah setiap perubahan: broadcast, cek selesai, jadwalkan langkah otomatis/bot/timer. */
  private afterChange(room: Room) {
    const g = room.game!;
    this.clearTimers(room);
    if (g.module.isOver(g.state)) {
      room.status = 'finished';
      room.turnDeadline = null;
      this.broadcast(room);
      this.reportResults(room);
      return;
    }
    const rawDelay = g.module.autoDelay(g.state);
    if (rawDelay !== null) {
      room.turnDeadline = null;
      const delay = this.cfg.botDelayMs !== null ? Math.min(this.cfg.botDelayMs, rawDelay) : rawDelay;
      room.timers.auto = setTimeout(() => {
        if (room.game !== g || !this.rooms.has(room.code)) return;
        g.state = g.module.advance(g.state, this.rng);
        this.afterChange(room);
      }, delay);
      this.broadcast(room);
      return;
    }
    this.scheduleTurn(room, false);
    this.broadcast(room);
  }

  private scheduleTurn(room: Room, rebroadcast = true) {
    const g = room.game;
    if (!g || room.status !== 'playing') return;
    clearTimeout(room.timers.turn); clearTimeout(room.timers.bot);
    const seat = g.module.currentSeat(g.state);
    if (seat === null) return;
    const m = room.slots[g.seatSlots[seat]]!;
    if (m.isBot) {
      room.turnDeadline = null;
      const botDelay = this.cfg.botDelayMs ?? (700 + randomInt(700));
      room.timers.bot = setTimeout(() => this.botMove(room, seat), botDelay);
      return;
    }
    // Pemain terputus/keluar: beri jeda singkat, lalu aksi aman otomatis.
    const seconds = m.connected ? this.cfg.turnSeconds : Math.min(5, this.cfg.turnSeconds);
    const expectedState = g.state;
    room.turnDeadline = Date.now() + seconds * 1000;
    room.timers.turn = setTimeout(() => {
      if (room.game !== g || g.state !== expectedState) return;
      try {
        this.applyAction(room, seat, g.module.timeoutAction(g.state, seat));
        this.notifyAll(room, 'warn', `${m.name} kehabisan waktu — aksi otomatis`);
      } catch (e) { log.error('timeout action failed', { code: room.code, err: String(e) }); }
    }, seconds * 1000);
    if (rebroadcast) this.broadcast(room);
  }

  private botMove(room: Room, seat: number) {
    const g = room.game;
    if (!g || !this.rooms.has(room.code) || g.module.currentSeat(g.state) !== seat) return;
    const view = g.module.view(g.state, seat); // bot HANYA melihat view-nya sendiri
    let action = g.module.bot(view, 'normal', this.rng);
    try {
      this.applyAction(room, seat, action);
    } catch {
      action = g.module.timeoutAction(g.state, seat);
      this.applyAction(room, seat, action);
    }
  }

  private reportResults(room: Room) {
    const g = room.game!;
    const results = g.module.results(g.state);
    if (!results) return;
    try {
      this.onResults({
        gameId: room.gameId, code: room.code, results,
        players: g.seatSlots.map((slot, seat) => {
          const m = room.slots[slot];
          const s = m?.playerId ? this.byPlayer.get(m.playerId.replace(/^left:/, '')) : undefined;
          return { seat, userId: s?.userId ?? null, name: m?.name ?? '?', isBot: !!m?.isBot };
        }),
      });
    } catch (e) { log.error('result sink failed', { err: String(e) }); }
  }

  /* ------------------------------ views -------------------------------- */

  private memberOf(room: Room, playerId: string) { return room.slots.find(m => m?.playerId === playerId) ?? null; }

  private seatOf(room: Room, playerId: string): number {
    const g = room.game;
    if (!g) return -1;
    return g.seatSlots.findIndex(slot => room.slots[slot]?.playerId === playerId);
  }

  roomView(room: Room, playerId: string): RoomView {
    return {
      code: room.code,
      gameId: room.gameId,
      maxPlayers: room.maxPlayers,
      options: room.options,
      status: room.status,
      turnDeadline: room.turnDeadline,
      turnSeconds: this.cfg.turnSeconds,
      seatSlots: room.game?.seatSlots.slice() ?? [],
      members: room.slots.flatMap((m, slot) => (m ? [{
        slot, name: m.name, avatar: m.avatar, ready: m.ready || m.isBot, connected: m.connected,
        isHost: m.playerId === room.hostId, isBot: m.isBot, isYou: m.playerId === playerId,
      }] : [])),
    };
  }

  /** View permainan untuk satu pemain (null jika tidak ada game). */
  gameViewFor(room: Room, playerId: string): BaseView | null {
    const g = room.game;
    if (!g) return null;
    const seat = this.seatOf(room, playerId);
    return g.module.view(g.state, seat < 0 ? null : seat);
  }

  broadcast(room: Room) {
    for (const m of room.slots) {
      if (!m?.playerId || m.isBot || !m.connected) continue;
      this.emit.room(m.playerId, this.roomView(room, m.playerId));
      const v = this.gameViewFor(room, m.playerId);
      if (v) this.emit.view(m.playerId, v);
    }
  }

  private notifyAll(room: Room, kind: 'info' | 'warn', text: string) {
    for (const m of room.slots) if (m?.playerId && !m.isBot && m.connected) this.emit.notice(m.playerId, kind, text);
  }

  /* ---------------------------- housekeeping --------------------------- */

  private touch(room: Room) { room.lastActivity = Date.now(); }

  private clearTimers(room: Room) {
    clearTimeout(room.timers.turn); clearTimeout(room.timers.auto); clearTimeout(room.timers.bot);
    room.timers = {};
  }

  /** Bersihkan pemain yang lewat masa tenggang & room kedaluwarsa. */
  sweep(now = Date.now()) {
    const grace = this.cfg.reconnectGraceSeconds * 1000;
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivity > this.cfg.roomIdleMinutes * 60_000) { this.close(room, 'Room kedaluwarsa karena tidak ada aktivitas'); continue; }
      for (const m of room.slots) {
        if (!m || m.isBot || m.connected || !m.playerId || m.playerId.startsWith('left:')) continue;
        if (m.disconnectedAt !== null && now - m.disconnectedAt > grace) {
          const id = m.playerId;
          const s = this.byPlayer.get(id);
          if (s) s.roomCode = null;
          if (room.status === 'playing') { m.playerId = `left:${id}`; this.scheduleTurn(room); }
          else room.slots[room.slots.indexOf(m)] = null;
          this.notifyAll(room, 'warn', `${m.name} tidak kembali — dikeluarkan dari room`);
          if (this.rooms.has(room.code)) this.afterMemberGone(room, id);
        }
      }
    }
    // Sesi tanpa room yang lama tidak aktif dibuang (hemat memori).
    for (const [t, s] of this.sessions) {
      if (!s.connected && !s.roomCode && now - s.lastSeen > 24 * 3600_000) { this.sessions.delete(t); this.byPlayer.delete(s.playerId); }
    }
  }
}
