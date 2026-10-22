// components/MobileCompileModal.tsx — Desain Ultra-Premium Download APK Android & Pasang iPhone
import { useState, useEffect } from 'react';
import { Modal } from './ui';
import { play } from '../lib/sound';
import { IconCheck, IconCopy, IconSparkles } from './icons';

interface MobileCompileModalProps {
  onClose: () => void;
}

type TabKey = 'android' | 'ios' | 'pwa' | 'dev';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function MobileCompileModal({ onClose }: MobileCompileModalProps) {
  const [tab, setTab] = useState<TabKey>('android');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsInstalled(true);
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    play('click');
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      play('click');
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        play('win');
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      alert('Untuk memasang di perangkat ini:\n• Di Chrome/Edge: Klik ikon Pasang (⊕) di bilah alamat browser.\n• Di HP: Ketuk menu (⋮) lalu pilih "Tambahkan ke Layar Utama".');
    }
  };

  const currentHost = typeof window !== 'undefined' ? window.location.origin : '';
  const downloadUrl = `${currentHost}/downloads/Cardora.apk`;

  return (
    <Modal title="📱 Pasang Cardora di HP" onClose={onClose}>
      <div className="mobile-download-modal" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Segmented iOS/Modern Tab Switcher */}
        <div style={{
          background: 'var(--paper-2, #EDE4D8)',
          borderRadius: 14,
          padding: 4,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4,
          border: '1px solid rgba(70, 50, 30, 0.1)',
        }}>
          <button
            type="button"
            onClick={() => { setTab('android'); play('click'); }}
            style={{
              padding: '9px 12px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
              background: tab === 'android' ? '#FFFFFF' : 'transparent',
              color: tab === 'android' ? 'var(--ink, #2C241B)' : 'var(--muted, #7E7265)',
              boxShadow: tab === 'android' ? '0 2px 8px rgba(70,50,30,0.12)' : 'none',
            }}
          >
            <span>🤖</span>
            <span>Android (APK)</span>
          </button>

          <button
            type="button"
            onClick={() => { setTab('ios'); play('click'); }}
            style={{
              padding: '9px 12px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
              background: tab === 'ios' ? '#FFFFFF' : 'transparent',
              color: tab === 'ios' ? 'var(--ink, #2C241B)' : 'var(--muted, #7E7265)',
              boxShadow: tab === 'ios' ? '0 2px 8px rgba(70,50,30,0.12)' : 'none',
            }}
          >
            <span>🍏</span>
            <span>iPhone (iOS)</span>
          </button>

          <button
            type="button"
            onClick={() => { setTab('pwa'); play('click'); }}
            style={{
              padding: '9px 12px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
              background: tab === 'pwa' ? '#FFFFFF' : 'transparent',
              color: tab === 'pwa' ? 'var(--ink, #2C241B)' : 'var(--muted, #7E7265)',
              boxShadow: tab === 'pwa' ? '0 2px 8px rgba(70,50,30,0.12)' : 'none',
            }}
          >
            <span>⚡</span>
            <span>Pasang Cepat</span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: ANDROID (.APK SIAP DOWNLOAD) */}
        {/* ========================================================================= */}
        {tab === 'android' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Store App Showcase Header */}
            <div style={{
              background: 'linear-gradient(145deg, #FFFFFF 0%, #FAF5EE 100%)',
              border: '1.5px solid rgba(212, 114, 52, 0.25)',
              borderRadius: 18,
              padding: '18px 20px',
              boxShadow: '0 8px 26px rgba(70, 50, 30, 0.08)',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Corner Watermark */}
              <div style={{
                position: 'absolute',
                right: -15,
                top: -15,
                width: 90,
                height: 90,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(234, 179, 8, 0.15) 0%, transparent 70%)',
                pointerEvents: 'none',
              }} />

              {/* App Identity Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <img
                  src="/favicon.svg"
                  alt="Cardora Logo"
                  width={62}
                  height={62}
                  style={{
                    borderRadius: 16,
                    boxShadow: '0 8px 18px rgba(70, 50, 30, 0.18)',
                    flexShrink: 0,
                    border: '2px solid #FFFFFF',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: 'var(--ink, #2C241B)', letterSpacing: '-0.02em' }}>
                      Cardora Mobile
                    </h3>
                    <span style={{
                      background: 'rgba(34, 197, 94, 0.12)',
                      color: '#15803D',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: 20,
                    }}>
                      ✓ Terverifikasi
                    </span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--muted, #7E7265)', marginBottom: 4 }}>
                    Platform Game Kartu &amp; Kasino Multiplayer
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#B45309', fontWeight: 700 }}>
                    <span>⭐ 4.9</span>
                    <span>·</span>
                    <span>100% Gratis</span>
                    <span>·</span>
                    <span>Tanpa Uang Asli</span>
                  </div>
                </div>
              </div>

              {/* 3-Column Micro Stats (Crisp High-Contrast) */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
                background: 'rgba(245, 237, 227, 0.7)',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(70, 50, 30, 0.08)',
                marginBottom: 16,
                textAlign: 'center',
              }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted, #7E7265)', fontWeight: 600 }}>UKURAN</div>
                  <div style={{ fontSize: '0.92rem', color: 'var(--ink, #2C241B)', fontWeight: 800, marginTop: 1 }}>390 KB</div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(70, 50, 30, 0.1)', borderRight: '1px solid rgba(70, 50, 30, 0.1)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted, #7E7265)', fontWeight: 600 }}>ANDROID</div>
                  <div style={{ fontSize: '0.92rem', color: 'var(--ink, #2C241B)', fontWeight: 800, marginTop: 1 }}>8.0+</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted, #7E7265)', fontWeight: 600 }}>VERSI</div>
                  <div style={{ fontSize: '0.92rem', color: '#D97706', fontWeight: 800, marginTop: 1 }}>v1.0.0</div>
                </div>
              </div>

              {/* Big Golden Download CTA Button */}
              <a
                href="/downloads/Cardora.apk"
                download="Cardora.apk"
                onClick={() => play('win')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'linear-gradient(135deg, #059669 0%, #10B981 50%, #047857 100%)',
                  color: '#FFFFFF',
                  textDecoration: 'none',
                  padding: '14px 20px',
                  borderRadius: 14,
                  fontWeight: 900,
                  fontSize: '1rem',
                  letterSpacing: '0.01em',
                  boxShadow: '0 8px 24px rgba(16, 185, 129, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.4)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                }}
              >
                <span style={{
                  fontSize: '1.3rem',
                  background: 'rgba(255, 255, 255, 0.25)',
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  📥
                </span>
                <div style={{ textAlign: 'left', lineHeight: 1.25 }}>
                  <div style={{ fontSize: '0.96rem', fontWeight: 900 }}>DOWNLOAD APK SEKARANG</div>
                  <div style={{ fontSize: '0.72rem', opacity: 0.88, fontWeight: 600 }}>Klik untuk langsung mengunduh ke memori HP</div>
                </div>
              </a>

              {/* Copy URL Row */}
              <div style={{
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                background: '#FFFFFF',
                padding: '6px 10px 6px 12px',
                borderRadius: 10,
                border: '1px solid rgba(70, 50, 30, 0.12)',
              }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted, #7E7265)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Kirim link ke HP: <b>{downloadUrl}</b>
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(downloadUrl, 'dl_url')}
                  style={{
                    background: 'var(--paper-2, #EDE4D8)',
                    border: '1px solid rgba(70, 50, 30, 0.15)',
                    borderRadius: 8,
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'var(--ink, #2C241B)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  {copiedKey === 'dl_url' ? <><IconCheck size={13} /> Tersalin</> : <><IconCopy size={13} /> Salin Link</>}
                </button>
              </div>
            </div>

            {/* 3 Step Installation Visual Guide */}
            <div style={{
              background: '#FFFFFF',
              borderRadius: 16,
              padding: '16px 18px',
              border: '1px solid rgba(70, 50, 30, 0.1)',
              boxShadow: '0 4px 12px rgba(70, 50, 30, 0.04)',
            }}>
              <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--ink, #2C241B)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <span style={{ color: '#D97706' }}>⚡</span> Cara Pasang APK di HP Android:
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                <div style={{ background: 'var(--paper-1, #FAF5EE)', padding: '12px 10px', borderRadius: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>1️⃣</div>
                  <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--ink, #2C241B)' }}>Unduh APK</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted, #7E7265)', marginTop: 2, lineHeight: 1.3 }}>
                    Ketuk tombol download hijau di atas
                  </div>
                </div>

                <div style={{ background: 'var(--paper-1, #FAF5EE)', padding: '12px 10px', borderRadius: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>2️⃣</div>
                  <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--ink, #2C241B)' }}>Buka File</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted, #7E7265)', marginTop: 2, lineHeight: 1.3 }}>
                    Buka notifikasi atau folder Download
                  </div>
                </div>

                <div style={{ background: 'var(--paper-1, #FAF5EE)', padding: '12px 10px', borderRadius: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>3️⃣</div>
                  <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--ink, #2C241B)' }}>Tekan Instal</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted, #7E7265)', marginTop: 2, lineHeight: 1.3 }}>
                    Izinkan instalasi sumber &amp; langsung main!
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: IPHONE & IPAD (IOS) */}
        {/* ========================================================================= */}
        {tab === 'ios' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'linear-gradient(145deg, #FFFFFF 0%, #F0F6FF 100%)',
              border: '1.5px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 18,
              padding: '18px 20px',
              boxShadow: '0 8px 26px rgba(59, 130, 246, 0.08)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.6rem',
                  boxShadow: '0 6px 16px rgba(37, 99, 235, 0.3)',
                }}>
                  🍏
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: '#1E3A8A' }}>
                    Pasang di iPhone &amp; iPad
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: '#3B82F6', fontWeight: 700 }}>
                    Aplikasi Web Layar Penuh (PWA Native Apple)
                  </div>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--muted, #7E7265)', lineHeight: 1.55 }}>
                Apple iOS membatasi pengunduhan file mentah non-App Store. Namun, Cardora mendukung <b>instalasi resmi Safari PWA</b>: aplikasi akan berjalan <b>layar penuh 100% tanpa address bar</b>, mendukung suara, getaran haptic, dan hemat baterai!
              </p>
            </div>

            {/* Apple 4-Step Visual Timeline */}
            <div style={{
              background: '#FFFFFF',
              borderRadius: 16,
              padding: '16px 18px',
              border: '1px solid rgba(70, 50, 30, 0.1)',
            }}>
              <b style={{ fontSize: '0.9rem', color: 'var(--ink, #2C241B)', display: 'block', marginBottom: 12 }}>
                📲 Panduan Pasang Safari (Hanya 15 Detik):
              </b>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--paper-1, #FAF5EE)', padding: '10px 14px', borderRadius: 12 }}>
                  <span style={{ fontSize: '1.3rem' }}>🧭</span>
                  <div style={{ fontSize: '0.82rem', color: 'var(--ink, #2C241B)' }}>
                    <b>1. Buka di Safari</b>: Buka link game Cardora menggunakan browser resmi <b>Safari</b> di iPhone.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--paper-1, #FAF5EE)', padding: '10px 14px', borderRadius: 12 }}>
                  <span style={{ fontSize: '1.3rem' }}>⎘</span>
                  <div style={{ fontSize: '0.82rem', color: 'var(--ink, #2C241B)' }}>
                    <b>2. Ketuk Tombol Share</b>: Di bagian bawah layar Safari, ketuk tombol <b>Bagikan (Share icon ⎘)</b>.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--paper-1, #FAF5EE)', padding: '10px 14px', borderRadius: 12 }}>
                  <span style={{ fontSize: '1.3rem' }}>➕</span>
                  <div style={{ fontSize: '0.82rem', color: 'var(--ink, #2C241B)' }}>
                    <b>3. Tambah ke Layar Utama</b>: Gulir ke bawah, lalu pilih menu <b>"Tambah ke Layar Utama" (Add to Home Screen)</b>.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--paper-1, #FAF5EE)', padding: '10px 14px', borderRadius: 12 }}>
                  <span style={{ fontSize: '1.3rem' }}>🎉</span>
                  <div style={{ fontSize: '0.82rem', color: 'var(--ink, #2C241B)' }}>
                    <b>4. Selesai!</b>: Ketuk <b>"Tambah"</b> di pojok kanan atas. Ikon Cardora langsung muncul di menu iPhone Anda!
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: PASANG CEPAT (1-KLIK NATIVE PWA) */}
        {/* ========================================================================= */}
        {tab === 'pwa' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'linear-gradient(145deg, #FFFFFF 0%, #FEFCE8 100%)',
              border: '1.5px solid rgba(234, 179, 8, 0.4)',
              borderRadius: 18,
              padding: '18px 20px',
              boxShadow: '0 8px 26px rgba(234, 179, 8, 0.1)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: '1.8rem' }}>⚡</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: '#854D0E' }}>
                    Instal Langsung ke Perangkat
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: '#CA8A04', fontWeight: 700 }}>
                    Mendukung Chrome, Edge, Android &amp; Laptop/Desktop
                  </div>
                </div>
              </div>

              <p style={{ margin: '0 0 16px', fontSize: '0.84rem', color: 'var(--muted, #7E7265)', lineHeight: 1.55 }}>
                Pasang Cardora langsung ke layar utama ponsel atau desktop tanpa perlu mengunduh file installer. Hemat memori dan selalu terupdate otomatis.
              </p>

              {isInstalled ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'rgba(34, 197, 94, 0.12)',
                  border: '1.5px solid rgba(34, 197, 94, 0.3)',
                  padding: '12px 16px',
                  borderRadius: 12,
                }}>
                  <span style={{ color: '#16A34A', fontSize: '1.3rem', fontWeight: 900 }}>✓</span>
                  <div style={{ fontSize: '0.85rem', color: '#15803D', fontWeight: 800 }}>
                    Aplikasi Cardora sudah terpasang di perangkat ini!
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleInstallPWA}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    width: '100%',
                    background: 'linear-gradient(135deg, #EAB308 0%, #D97706 100%)',
                    color: '#000000',
                    border: 'none',
                    padding: '14px 20px',
                    borderRadius: 14,
                    fontWeight: 900,
                    fontSize: '0.98rem',
                    letterSpacing: '0.01em',
                    boxShadow: '0 8px 24px rgba(234, 179, 8, 0.35)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <IconSparkles size={18} />
                  <span>PASANG KE LAYAR UTAMA SEKARANG</span>
                </button>
              )}
            </div>

            <div style={{
              background: '#FFFFFF',
              borderRadius: 16,
              padding: '14px 18px',
              border: '1px solid rgba(70, 50, 30, 0.1)',
            }}>
              <b style={{ fontSize: '0.88rem', color: 'var(--ink, #2C241B)', display: 'block', marginBottom: 8 }}>
                Keunggulan Versi Aplikasi:
              </b>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', color: 'var(--muted, #7E7265)', lineHeight: 1.7 }}>
                <li>Tampilan layar penuh elegan tanpa tab atau bilah URL browser.</li>
                <li>Dukungan audio instan dan getaran kartu responsif.</li>
                <li>Tetap bisa dibuka dan dimainkan secara offline saat kuota habis.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* DEVELOPER DRAWER / FOOTER LINK */}
        {/* ========================================================================= */}
        <div style={{
          marginTop: 4,
          paddingTop: 10,
          borderTop: '1px solid var(--hair, rgba(70,50,30,0.1))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <button
            type="button"
            onClick={() => setTab(tab === 'dev' ? 'android' : 'dev')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted, #7E7265)',
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 0,
            }}
          >
            <span>⚙️</span>
            <span>{tab === 'dev' ? 'Tutup Opsi Developer' : 'Opsi Developer / Source Code'}</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            style={{ minWidth: 80, fontSize: '0.84rem' }}
          >
            Tutup
          </button>
        </div>

        {tab === 'dev' && (
          <div style={{
            background: '#111827',
            color: '#F3F4F6',
            padding: '14px 16px',
            borderRadius: 12,
            fontFamily: 'monospace',
            fontSize: '0.78rem',
            lineHeight: 1.7,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            <div style={{ color: '#9CA3AF' }}># Lokasi file APK siap pakai:</div>
            <div style={{ color: '#34D399' }}>packages/web/public/downloads/Cardora.apk</div>
            <div style={{ color: '#9CA3AF', marginTop: 4 }}># Perintah Kompilasi Capacitor Android &amp; iOS:</div>
            <div style={{ color: '#FBBF24' }}>npm run cap:sync</div>
            <div style={{ color: '#FBBF24' }}>npm run cap:android</div>
            <div style={{ color: '#FBBF24' }}>npm run cap:ios</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
