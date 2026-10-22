// screens/Auth.tsx — Masuk / Daftar akun (username + password), Google, atau lanjut sebagai tamu.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Nav, Route } from '../App';
import { GoogleButton } from '../components/GoogleButton';
import { ApiError, continueAsGuest, loginWithPassword, registerAccount } from '../lib/auth';
import { useData } from '../lib/store';
import { play } from '../lib/sound';

// Aturan sama persis dengan server (packages/server/src/api.ts).
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Username atau password salah.';
    if (e.status === 409) return 'Username sudah dipakai, coba yang lain.';
    if (e.status === 429) return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
    return e.message;
  }
  return (e as Error)?.message || 'Terjadi kesalahan.';
}

export default function Auth({ nav, mode: initialMode, next }: { nav: Nav; mode: 'login' | 'register'; next?: Route }) {
  const session = useData(d => d.session);
  const profile = useData(d => d.profile);
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState(profile.name);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { setMode(initialMode); }, [initialMode]);
  useEffect(() => { first.current?.focus(); setError(null); setTouched(false); }, [mode]);

  const isRegister = mode === 'register';
  const userErr = !username ? 'Username wajib diisi' : isRegister && !USERNAME_RE.test(username) ? 'Username 3–20 karakter: huruf, angka, atau _' : null;
  const passErr = !password ? 'Password wajib diisi' : isRegister && (password.length < 8 || password.length > 72) ? 'Password 8–72 karakter' : null;
  const confirmErr = isRegister && confirm !== password ? 'Konfirmasi password tidak sama' : null;
  const invalid = !!(userErr || passErr || confirmErr);

  const goNext = () => nav(next ?? { name: 'home' });
  const back = () => nav(session.guest || session.authToken ? (next ?? { name: 'home' }) : { name: 'landing', next });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true); setError(null);
    try {
      if (isRegister) await registerAccount(username, password, displayName);
      else await loginWithPassword(username, password);
      play('achievement');
      goNext();
    } catch (err) {
      setError(friendly(err));
      play('click');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <div className="landing-glow" aria-hidden="true" />
      <button className="lbtn lbtn-round auth-back" onClick={back} aria-label="Kembali">←</button>

      <div className="auth-card">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width={56} height={56} />
          <h1>KUY<b>POKER</b></h1>
          <p>{isRegister ? 'Buat akun gratis & amankan progresmu' : 'Selamat datang kembali!'}</p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Mode akun">
          <button role="tab" aria-selected={!isRegister} className={!isRegister ? 'on' : ''} onClick={() => setMode('login')}>Masuk</button>
          <button role="tab" aria-selected={isRegister} className={isRegister ? 'on' : ''} onClick={() => setMode('register')}>Daftar</button>
        </div>

        {session.guest && isRegister && (
          <div className="auth-bonus">🎁 Progres tamu (chip, level, statistik) ikut tersimpan + bonus <b>25.000 chip</b>!</div>
        )}

        <GoogleButton onSuccess={goNext} label={isRegister ? 'Daftar dengan Google' : 'Masuk dengan Google'} />
        <div className="or-sep"><span>atau dengan username</span></div>

        <form className="auth-form" onSubmit={submit} noValidate>
          <label className="field">
            <span>Username</span>
            <input ref={first} className="linput" autoComplete="username" inputMode="text" maxLength={20}
              placeholder="mis. raja_kartu" value={username} onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
              aria-invalid={touched && !!userErr} />
            {touched && userErr && <em className="field-err">{userErr}</em>}
          </label>

          {isRegister && (
            <label className="field">
              <span>Nama tampilan</span>
              <input className="linput" maxLength={20} placeholder="Nama di meja" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </label>
          )}

          <label className="field">
            <span>Password</span>
            <div className="pass-wrap">
              <input className="linput" type={show ? 'text' : 'password'} maxLength={72}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                placeholder={isRegister ? 'Minimal 8 karakter' : 'Password'} value={password} onChange={e => setPassword(e.target.value)}
                aria-invalid={touched && !!passErr} />
              <button type="button" className="pass-toggle" onClick={() => setShow(s => !s)} aria-label={show ? 'Sembunyikan password' : 'Lihat password'}>{show ? '🙈' : '👁️'}</button>
            </div>
            {touched && passErr && <em className="field-err">{passErr}</em>}
          </label>

          {isRegister && (
            <label className="field">
              <span>Ulangi password</span>
              <input className="linput" type={show ? 'text' : 'password'} maxLength={72} autoComplete="new-password"
                placeholder="Ketik ulang password" value={confirm} onChange={e => setConfirm(e.target.value)}
                aria-invalid={touched && !!confirmErr} />
              {touched && confirmErr && <em className="field-err">{confirmErr}</em>}
            </label>
          )}

          {error && <div className="auth-error" role="alert">⚠️ {error}</div>}

          <button type="submit" className={`lbtn lbtn-lg lbtn-block ${isRegister ? 'lbtn-green' : 'lbtn-blue'}`} disabled={busy}>
            {busy ? 'Memproses…' : isRegister ? '✨ Daftar & Mulai Main' : '🔑 Masuk'}
          </button>
        </form>

        {!session.authToken && !session.guest && (
          <button className="lbtn lbtn-ghost lbtn-block" onClick={() => { continueAsGuest(); goNext(); }}>🎮 Main sebagai Tamu saja</button>
        )}
      </div>
    </div>
  );
}
