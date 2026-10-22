// Klien "teman" untuk uji manual multiplayer: gabung room, tandai siap, mainkan aksi legal otomatis.
// Pemakaian: node scripts/friend-bot.mjs <KODE> [url]
import { io } from 'socket.io-client';

const [code, url = 'http://127.0.0.1:3000'] = process.argv.slice(2);
if (!code) { console.error('Pemakaian: node scripts/friend-bot.mjs <KODE> [url]'); process.exit(1); }
const s = io(url, { transports: ['websocket'] });
const call = (ev, p = {}) => new Promise((res, rej) => s.emit(ev, p, r => (r.ok ? res(r.data) : rej(new Error(r.error)))));
let lastAct = '';
// Node 22 me-resolve 'localhost' ke ::1 duluan; server mendengar di IPv4 → pakai 127.0.0.1.
s.on('connect_error', e => console.log('CONNECT_ERROR', e.message, '(coba http://127.0.0.1:3000)'));

s.on('connect', async () => {
  try {
    await call('session:hello', { name: 'Teman Rafi', avatar: '🐼' });
    const { room } = await call('room:join', { code });
    console.log('JOINED', room.code, 'members', room.members.map(m => m.name).join(','));
    await call('room:ready', { ready: true });
    console.log('READY');
  } catch (e) { console.log('ERROR', e.message); process.exit(1); }
});
s.on('room:state', r => console.log('ROOM', r.status, r.members.map(m => `${m.name}${m.ready ? '✓' : ''}${m.connected ? '' : '(off)'}`).join(' ')));
s.on('room:notice', n => console.log('NOTICE', n.text));
s.on('room:closed', n => { console.log('CLOSED', n.reason); process.exit(0); });
s.on('game:view', async v => {
  // Bukti: kartu yang diterima tamu — hanya miliknya.
  if (v.gameId === 'holdem') {
    const seen = v.seats.map((x, i) => `${i}:${x.hole.map(c => c ?? '??').join('')}`).join(' ');
    if (seen !== lastAct) { console.log('VIEW', v.street, 'you=' + v.you, seen); lastAct = seen; }
  }
  if (v.turn !== v.you || !v.legal) return;
  await new Promise(r => setTimeout(r, 600));
  const l = v.legal;
  const action = v.gameId === 'holdem' ? (l.canCheck ? { type: 'check' } : { type: 'call' })
    : v.gameId === 'blackjack' ? (l.canBet ? { type: 'bet', amount: l.minBet } : { type: 'stand' })
    : l.playable?.length ? { type: 'play', card: l.playable[0] } : l.canDraw ? { type: 'draw' } : { type: 'pass' };
  try { await call('game:action', { action }); console.log('ACT', JSON.stringify(action)); } catch (e) { console.log('REJECTED', e.message); }
});
