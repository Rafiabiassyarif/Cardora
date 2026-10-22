import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger';

export interface StoredUser {
  id: number;
  username: string;
  passwordHash: string;
  /** ID akun Google (klaim `sub`) bila akun dibuat/ditautkan lewat Google. */
  googleSub?: string;
  email?: string;
  displayName: string;
  avatar: string;
  createdAt: number;
  stats: Record<string, { played: number; wins: number }>;
  history: Array<{ game_id: string; finished_at: string; players: number; rank: number; score: number }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// CARDORA_DATA_DIR (atau KUYPOKER_DATA_DIR) memungkinkan test memakai folder sementara (tidak menyentuh data dev).
const dataDir = () => (process.env.CARDORA_DATA_DIR || process.env.KUYPOKER_DATA_DIR ? path.resolve(process.env.CARDORA_DATA_DIR || process.env.KUYPOKER_DATA_DIR!) : path.resolve(__dirname, '../.data'));
const dataFile = () => path.join(dataDir(), 'users.json');

let usersMap = new Map<number, StoredUser>();
let usernameIndex = new Map<string, number>();
let googleIndex = new Map<string, number>();
let nextId = 1;
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(dataDir())) {
      fs.mkdirSync(dataDir(), { recursive: true });
    }
    if (fs.existsSync(dataFile())) {
      const raw = fs.readFileSync(dataFile(), 'utf-8');
      const data: StoredUser[] = JSON.parse(raw);
      for (const u of data) {
        usersMap.set(u.id, u);
        usernameIndex.set(u.username.toLowerCase(), u.id);
        if (u.googleSub) googleIndex.set(u.googleSub, u.id);
        if (u.id >= nextId) nextId = u.id + 1;
      }
    }
  } catch (e) {
    log.error('failed to load local users.json, starting with empty store', { err: String(e) });
  }
}

function saveToFile() {
  try {
    if (!fs.existsSync(dataDir())) {
      fs.mkdirSync(dataDir(), { recursive: true });
    }
    const data = Array.from(usersMap.values());
    fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    log.error('failed to save local users.json', { err: String(e) });
  }
}

export const localUserStore = {
  async findByUsername(username: string): Promise<StoredUser | null> {
    ensureLoaded();
    const id = usernameIndex.get(username.toLowerCase());
    if (id === undefined) return null;
    return usersMap.get(id) ?? null;
  },

  async findById(id: number): Promise<StoredUser | null> {
    ensureLoaded();
    return usersMap.get(id) ?? null;
  },

  async findByGoogleSub(sub: string): Promise<StoredUser | null> {
    ensureLoaded();
    const id = googleIndex.get(sub);
    return id === undefined ? null : usersMap.get(id) ?? null;
  },

  async usernameTaken(username: string): Promise<boolean> {
    ensureLoaded();
    return usernameIndex.has(username.toLowerCase());
  },

  async createUser(username: string, passwordHash: string, displayName: string, avatar: string, extra: { googleSub?: string; email?: string } = {}): Promise<StoredUser> {
    ensureLoaded();
    if (usernameIndex.has(username.toLowerCase())) {
      const err: any = new Error('Username sudah dipakai');
      err.code = '23505';
      throw err;
    }
    const id = nextId++;
    const user: StoredUser = {
      id,
      username,
      passwordHash,
      displayName,
      avatar,
      createdAt: Date.now(),
      stats: {},
      history: [],
      ...(extra.googleSub ? { googleSub: extra.googleSub } : {}),
      ...(extra.email ? { email: extra.email } : {}),
    };
    usersMap.set(id, user);
    usernameIndex.set(username.toLowerCase(), id);
    if (extra.googleSub) googleIndex.set(extra.googleSub, id);
    saveToFile();
    return user;
  },

  async updateUser(id: number, patch: { displayName?: string | null; avatar?: string | null }): Promise<void> {
    ensureLoaded();
    const user = usersMap.get(id);
    if (!user) return;
    if (patch.displayName) user.displayName = patch.displayName;
    if (patch.avatar) user.avatar = patch.avatar;
    saveToFile();
  },

  async recordMatch(userId: number, gameId: string, rank: number, score: number, players: number): Promise<void> {
    ensureLoaded();
    const user = usersMap.get(userId);
    if (!user) return;
    if (!user.stats[gameId]) {
      user.stats[gameId] = { played: 0, wins: 0 };
    }
    user.stats[gameId].played += 1;
    if (rank === 1) user.stats[gameId].wins += 1;

    user.history.unshift({
      game_id: gameId,
      finished_at: new Date().toISOString(),
      players,
      rank,
      score,
    });
    if (user.history.length > 30) user.history.pop();
    saveToFile();
  },
};
