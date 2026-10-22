// screens/Guide.tsx — panduan bermain & tutorial ringkas.
import { useState } from 'react';
import { CATALOG } from '@kuypoker/engine';
import { RulesModal, TopBar, PlayingCard } from '../components/ui';

export default function Guide({ onBack }: { onBack: () => void }) {
  const [rules, setRules] = useState<string | null>(null);
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <TopBar title="Panduan Bermain" onBack={onBack} />
      <div className="card-box stack">
        <b>Mulai dalam 3 langkah</b>
        <ol style={{ margin: 0, lineHeight: 1.6 }}>
          <li><b>Main sendiri:</b> Pilih Game → pilih jumlah pemain & kesulitan bot → <i>Main vs Bot</i>. Bisa offline.</li>
          <li><b>Ajak teman:</b> Buat Room → bagikan <b>kode 6 karakter</b> atau tautan undangan. Teman memilih <i>Gabung Room</i> dan memasukkan kode.</li>
          <li>Teman menekan <b>Siap</b>, host menekan <b>Mulai</b>. Kursi kosong bisa diisi bot.</li>
        </ol>
      </div>

      <h2 className="section-title">Membaca kartu</h2>
      <div className="card-box row">
        <PlayingCard card="AS" /><PlayingCard card="KH" /><PlayingCard card="TD" /><PlayingCard card="2C" /><PlayingCard card={null} />
        <span className="muted small grow">As Sekop, King Hati, 10 Wajik, 2 Keriting, dan kartu tertutup. Kartu yang bisa dimainkan akan terangkat saat disentuh; kartu yang tidak boleh dimainkan tampak redup.</span>
      </div>

      <h2 className="section-title">Tips online</h2>
      <div className="card-box">
        <ul style={{ margin: 0, lineHeight: 1.6 }}>
          <li>Setiap giliran punya batas waktu. Jika habis, sistem menjalankan aksi aman (check/fold, stand, atau kartu terendah).</li>
          <li>Koneksi putus? Buka lagi aplikasinya — kursimu ditahan sementara dan kartumu kembali.</li>
          <li>Kode room hanya untuk bergabung ke meja, bukan kata sandi akun.</li>
          <li>Semua chip adalah chip virtual tanpa nilai uang.</li>
        </ul>
      </div>

      <h2 className="section-title">Aturan tiap game</h2>
      <div className="grid">
        {CATALOG.map(g => (
          <button key={g.id} className="member" style={{ border: 0, textAlign: 'left' }} onClick={() => setRules(g.id)}>
            <span className="game-icon" style={{ width: 40, height: 40, fontSize: '1.2rem' }}>{g.icon}</span>
            <span className="grow">{g.name}</span>
            <span className={`badge${g.status === 'available' ? ' ok' : ' soon'}`}>{g.status === 'available' ? 'Tersedia' : 'Segera'}</span>
          </button>
        ))}
      </div>
      {rules && <RulesModal gameId={rules} onClose={() => setRules(null)} />}
    </div>
  );
}
