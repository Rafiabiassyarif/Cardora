import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Nav, Route } from '../App';
import { GoogleButton } from '../components/GoogleButton';
import { ApiError, continueAsGuest, loginWithPassword, registerAccount } from '../lib/auth';
import { useData } from '../lib/store';
import { play } from '../lib/sound';
import { IconLogIn, IconSparkles, IconUser, IconLock, IconEye, IconEyeOff, IconArrowLeft } from '../components/icons';

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
      <button className="lbtn lbtn-round auth-back" onClick={back} aria-label="Kembali">
        <IconArrowLeft size={20} />
      </button>

      <div className="auth-card">
        {/* Brand Header */}
        <div className="auth-brand">
          <div className="auth-brand-logo-wrap">
            <img src="/favicon.svg" alt="Cardora Logo" width={64} height={64} className="auth-brand-logo" />
            <div className="auth-brand-glow" aria-hidden="true" />
          </div>
          <h1 className="auth-brand-title">CAR<b>DORA</b></h1>
          <span className="auth-brand-badge">PLATFORM GAME KARTU MULTIPLAYER</span>
          <p className="auth-brand-sub">
            {isRegister ? 'Buat akun & amankan chip serta progresmu!' : 'Selamat datang kembali, Master Kartu!'}
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="auth-tabs" role="tablist" aria-label="Mode akun">
          <button role="tab" aria-selected={!isRegister} className={!isRegister ? 'on' : ''} onClick={() => setMode('login')}>
            <IconLogIn size={16} /> Masuk
          </button>
          <button role="tab" aria-selected={isRegister} className={isRegister ? 'on' : ''} onClick={() => setMode('register')}>
            <IconSparkles size={16} /> Daftar Akun
          </button>
        </div>

        {session.guest && isRegister && (
          <div className="auth-bonus">🎁 Progres tamu (chip, level, statistik) ikut tersimpan + bonus <b>25.000 chip</b>!</div>
        )}

        <GoogleButton
          onSuccess={goNext}
          label={isRegister ? 'Daftar dengan Google' : 'Masuk dengan Google'}
          mode={isRegister ? 'signup' : 'signin'}
        />
        <div className="or-sep"><span>atau dengan username</span></div>

        <form className="auth-form" onSubmit={submit} noValidate>
          <label className="field">
            <span className="field-label"><IconUser size={15} /> Username</span>
            <div className="input-wrap">
              <input ref={first} className="linput" autoComplete="username" inputMode="text" maxLength={20}
                placeholder="mis. raja_kartu" value={username} onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
                aria-invalid={touched && !!userErr} />
            </div>
            {touched && userErr && <em className="field-err">{userErr}</em>}
          </label>

          {isRegister && (
            <label className="field">
              <span className="field-label"><IconSparkles size={15} /> Nama tampilan di meja</span>
              <div className="input-wrap">
                <input className="linput" maxLength={20} placeholder="Nama di meja" value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </div>
            </label>
          )}

          <label className="field">
            <span className="field-label"><IconLock size={15} /> Password</span>
            <div className="pass-wrap">
              <input className="linput" type={show ? 'text' : 'password'} maxLength={72}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                placeholder={isRegister ? 'Minimal 8 karakter' : 'Password akunmu'} value={password} onChange={e => setPassword(e.target.value)}
                aria-invalid={touched && !!passErr} />
              <button type="button" className="pass-toggle" onClick={() => setShow(s => !s)} aria-label={show ? 'Sembunyikan password' : 'Lihat password'}>
                {show ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </div>
            {touched && passErr && <em className="field-err">{passErr}</em>}
          </label>

          {isRegister && (
            <label className="field">
              <span className="field-label"><IconLock size={15} /> Ulangi password</span>
              <div className="pass-wrap">
                <input className="linput" type={show ? 'text' : 'password'} maxLength={72} autoComplete="new-password"
                  placeholder="Ketik ulang password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  aria-invalid={touched && !!confirmErr} />
              </div>
              {touched && confirmErr && <em className="field-err">{confirmErr}</em>}
            </label>
          )}

          {error && <div className="auth-error" role="alert">⚠️ {error}</div>}

          <button type="submit" className="lbtn lbtn-lg lbtn-block lbtn-gold auth-submit-btn" disabled={busy}>
            {busy ? 'Memproses…' : isRegister ? '✨ Daftar & Mulai Main' : '🔑 Masuk ke Meja'}
          </button>
        </form>

        {!session.authToken && !session.guest && (
          <button className="lbtn lbtn-guest lbtn-block" onClick={() => { continueAsGuest(); goNext(); }}>
            🎮 Main Cepat sebagai Tamu
          </button>
        )}
      </div>
    </div>
  );
}
