// App.tsx — routing sederhana berbasis state (hash) + lazy loading halaman.
import { Suspense, useEffect, useState } from 'react';
import { lazyRetry } from './lib/lazyRetry';
import { useData, effectiveMotion, emitNotice, getData } from './lib/store';
import { Toasts } from './components/ui';
import { MusicPlayerModal, GlobalYouTubeHost, FloatingMusicWidget } from './components/MusicPlayerModal';
import { isSignedIn, validateSession, logout } from './lib/auth';

export type Route =
  | { name: 'landing'; next?: Route }
  | { name: 'auth'; mode: 'login' | 'register'; next?: Route }
  | { name: 'home' }
  | { name: 'catalog' }
  | { name: 'setup'; gameId: string }
  | { name: 'local'; gameId: string; players: number; options: Record<string, unknown> }
  | { name: 'online'; join?: string; create?: string }
  | { name: 'profile' }
  | { name: 'settings' }
  | { name: 'guide' };

const Landing = lazyRetry(() => import('./screens/Landing'));
const Auth = lazyRetry(() => import('./screens/Auth'));
const Home = lazyRetry(() => import('./screens/Home'));
const Catalog = lazyRetry(() => import('./screens/Catalog'));
const Setup = lazyRetry(() => import('./screens/Setup'));
const LocalPlay = lazyRetry(() => import('./screens/LocalPlay'));
const Online = lazyRetry(() => import('./screens/Online'));
const Profile = lazyRetry(() => import('./screens/Profile'));
const Settings = lazyRetry(() => import('./screens/Settings'));
const Guide = lazyRetry(() => import('./screens/Guide'));

export type Nav = (r: Route) => void;

/** Halaman yang hanya boleh dibuka setelah masuk (akun atau tamu). */
const PUBLIC: Route['name'][] = ['landing', 'auth'];

// Dibaca SEKALI per halaman: initializer useState bisa dipanggil dua kali (StrictMode),
// dan panggilan pertama menghapus hash undangan.
let inviteCode: string | null | undefined;
function readInvite(): string | null {
  if (inviteCode === undefined) {
    const m = location.hash.match(/join=([A-Za-z0-9]{6})/);
    inviteCode = m ? m[1].toUpperCase() : null;
    if (m) history.replaceState(null, '', location.pathname);
  }
  return inviteCode;
}

function initialRoute(): Route {
  // Tautan undangan: https://host/#join=ABC123
  const code = readInvite();
  let target: Route = { name: 'home' };
  if (code) target = { name: 'online', join: code };
  // Masih ada kursi online yang ditahan server (mis. halaman di-reload) → kembali ke meja itu.
  else if (getData().session.lastRoom) target = { name: 'online' };
  // Belum memilih masuk/tamu → landing page dulu; tujuan (mis. undangan room) dilanjutkan setelahnya.
  return isSignedIn() ? target : { name: 'landing', next: target.name === 'home' ? undefined : target };
}

export default function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const settings = useData(d => d.settings);
  useEffect(() => { document.documentElement.dataset.motion = effectiveMotion(settings); }, [settings]);
  const session = useData(d => d.session);
  const nav: Nav = (r) => {
    // Gerbang: halaman privat tanpa sesi → landing (tujuan disimpan untuk setelah masuk).
    if (!PUBLIC.includes(r.name) && !isSignedIn()) { setRoute({ name: 'landing', next: r.name === 'home' ? undefined : r }); scrollTo(0, 0); return; }
    setRoute(r); scrollTo(0, 0);
  };
  const home = () => nav({ name: 'home' });
  const doLogout = () => { logout(); setRoute({ name: 'landing' }); scrollTo(0, 0); };

  // Validasi token tersimpan sekali saat aplikasi dibuka.
  useEffect(() => {
    validateSession().then(r => {
      if (r === 'ok') void import('./lib/economy').then(m => m.refreshEconomy());
      if (r === 'expired') {
        emitNotice('warn', 'Sesi akunmu berakhir, silakan masuk lagi.');
        if (!isSignedIn()) setRoute({ name: 'landing' });
      } else if (r === 'offline') {
        emitNotice('info', 'Server tidak terjangkau — kamu tetap bisa main offline melawan bot.');
      }
    });
  }, []);

  // Jika sesi hilang (mis. keluar dari tab lain), kembali ke landing.
  useEffect(() => {
    if (!session.authToken && !session.guest && !PUBLIC.includes(route.name)) setRoute({ name: 'landing' });
  }, [session.authToken, session.guest, route.name]);

  return (
    <div className="app">
      <Toasts />
      <GlobalYouTubeHost />
      <MusicPlayerModal />
      <FloatingMusicWidget />
      <Suspense fallback={<div className="page center muted">Memuat…</div>}>
        {route.name === 'landing' && <Landing nav={nav} next={route.next} />}
        {route.name === 'auth' && <Auth nav={nav} mode={route.mode} next={route.next} />}
        {route.name === 'home' && <Home nav={nav} />}
        {route.name === 'catalog' && <Catalog nav={nav} />}
        {route.name === 'setup' && <Setup nav={nav} gameId={route.gameId} />}
        {route.name === 'local' && <LocalPlay {...route} onExit={() => nav({ name: 'setup', gameId: route.gameId })} />}
        {route.name === 'online' && <Online nav={nav} join={route.join} create={route.create} />}
        {route.name === 'profile' && <Profile onBack={home} onLogout={doLogout} onLinkAccount={() => nav({ name: 'auth', mode: 'register', next: { name: 'profile' } })} />}
        {route.name === 'settings' && <Settings onBack={home} />}
        {route.name === 'guide' && <Guide onBack={home} />}
      </Suspense>
    </div>
  );
}
