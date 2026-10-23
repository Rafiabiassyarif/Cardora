// GoogleButton.tsx — tombol Google (Google Identity Services, resmi).
// Menggunakan theme 'outline' (putih, logo Google berwarna) agar selaras dengan desain Cardora lokal dan hosting.
import { useEffect, useRef, useState } from 'react';
import { googleClientId, loadGoogleScript, loginWithGoogle } from '../lib/auth';
import { emitNotice } from '../lib/store';
import { play } from '../lib/sound';

const isNative = () => !!(window as any).Capacitor?.isNativePlatform?.();

export type GoogleButtonMode = 'signin' | 'signup' | 'continue';

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function GoogleButton({
  onSuccess,
  label = 'Masuk dengan Google',
  mode = 'continue',
}: {
  onSuccess: () => void;
  label?: string;
  mode?: GoogleButtonMode;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'disabled' | 'busy'>('loading');
  const [reason, setReason] = useState('');
  const cb = useRef(onSuccess);
  cb.current = onSuccess;

  const clientIdRef = useRef<string | null>(null);
  const googleRef = useRef<any>(null);

  // Fungsi untuk me-render tombol resmi Google sesuai mode & lebar wadah
  const renderGsi = () => {
    const google = googleRef.current;
    const el = slot.current;
    if (!google?.accounts?.id || !el) return;

    // Hitung lebar agar tombol pas dengan wadah kartu (rentang 220-400px yang didukung Google)
    const parentWidth = el.parentElement?.clientWidth || el.clientWidth;
    const targetWidth = Math.min(400, Math.max(240, parentWidth ? parentWidth - 4 : 360));

    const textOption: 'signin_with' | 'signup_with' | 'continue_with' =
      mode === 'signup' ? 'signup_with' : mode === 'signin' ? 'signin_with' : 'continue_with';

    el.innerHTML = '';
    google.accounts.id.renderButton(el, {
      theme: 'outline', // Latar putih bersih & border tipis, selaras dengan Cardora lokal & hosting
      size: 'large',
      shape: 'pill',
      text: textOption,
      locale: 'id',
      logo_alignment: 'left',
      width: targetWidth,
    });
  };

  useEffect(() => {
    let alive = true;
    if (isNative()) {
      setState('disabled');
      setReason('Login Google tersedia di versi web.');
      return;
    }

    googleClientId().then(async id => {
      if (!alive) return;
      if (!id) {
        setState('disabled');
        setReason('Login Google belum diaktifkan di server (GOOGLE_CLIENT_ID kosong).');
        return;
      }
      clientIdRef.current = id;
      try {
        const google = await loadGoogleScript();
        if (!alive) return;
        googleRef.current = google;

        google.accounts.id.initialize({
          client_id: id,
          ux_mode: 'popup',
          callback: async (resp: { credential?: string }) => {
            if (!resp.credential) return;
            setState('busy');
            try {
              await loginWithGoogle(resp.credential);
              play('achievement');
              cb.current();
            } catch (e) {
              emitNotice('warn', (e as Error).message);
              setState('ready');
            }
          },
        });

        renderGsi();
        setState('ready');
      } catch (e) {
        if (!alive) return;
        setState('disabled');
        setReason((e as Error).message);
      }
    });

    return () => { alive = false; };
  }, []);

  // Re-render saat mode (signin / signup / continue) berganti, misalnya toggle tab di Auth
  useEffect(() => {
    if (state === 'ready') {
      renderGsi();
    }
  }, [mode]);

  const fallback = state === 'disabled' || state === 'loading';

  const handleFallbackClick = () => {
    if (state === 'disabled') {
      emitNotice('info', reason);
      return;
    }
    // Jika Google script sudah ada, coba prompt jika diklik
    if (googleRef.current?.accounts?.id?.prompt) {
      googleRef.current.accounts.id.prompt();
    }
  };

  return (
    <div className={`google-wrap${state === 'busy' ? ' busy' : ''}`}>
      <div ref={slot} className="google-slot" hidden={fallback} />
      {fallback && (
        <button
          type="button"
          className="btn btn-google"
          aria-disabled={state === 'disabled'}
          data-state={state}
          onClick={handleFallbackClick}
          title={reason || 'Masuk dengan Google'}
        >
          <GoogleG /> {state === 'loading' ? 'Memuat Google…' : label}
          {state === 'disabled' && <span className="btn-google-note">segera</span>}
        </button>
      )}
      {state === 'busy' && <span className="small muted">Memverifikasi akun Google…</span>}
    </div>
  );
}
