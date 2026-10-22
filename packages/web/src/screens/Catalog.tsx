// screens/Catalog.tsx — katalog game: toolbar (cari, kategori, jumlah pemain), bagian "Bisa dimainkan"
// berupa kartu besar, dan bagian "Segera hadir" berupa daftar ringkas.
import { useMemo, useState, useRef, useEffect, type CSSProperties } from 'react';
import { CATALOG, CATEGORY_LABEL, type Category, type CatalogEntry } from '@kuypoker/engine';
import type { Nav } from '../App';
import { useData, toggleFavorite } from '../lib/store';
import { RulesModal } from '../components/ui';
import {
  IconArrowLeft,
  IconBook,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconGauge,
  IconPlay,
  IconSearch,
  IconStar,
  IconUsers,
  IconX,
} from '../components/icons';

type CatKey = Category | 'all' | 'fav';
const TABS: CatKey[] = ['all', 'fav', 'poker', 'indonesia', 'international'];
const TONES = ['terra', 'sage', 'sky', 'butter'] as const;
const SUITS = ['♠', '♥', '♦', '♣'];

const playersText = (g: CatalogEntry) => (g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}–${g.maxPlayers}`);
const tabLabel = (c: CatKey) => (c === 'all' ? 'Semua' : c === 'fav' ? 'Favorit' : CATEGORY_LABEL[c]);

const PLAYER_OPTIONS: { value: number | null; label: string; hint?: string }[] = [
  { value: null, label: 'Semua pemain', hint: 'Tampilkan semua mode' },
  { value: 1, label: 'Solo (1 pemain)', hint: 'Latihan mandiri vs bot' },
  { value: 2, label: '2 pemain', hint: 'Duel head-to-head' },
  { value: 3, label: '3 pemain', hint: 'Trio seru' },
  { value: 4, label: '4 pemain', hint: 'Format klasik' },
  { value: 5, label: '5 pemain', hint: 'Meja ramai' },
  { value: 6, label: '6 pemain', hint: 'Kapasitas maksimal' },
];

function PlayerFilterDropdown({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isFiltered = value !== null;

  return (
    <div ref={ref} className={`cat-filter-dd ${open ? 'is-open' : ''} ${isFiltered ? 'is-active' : ''}`}>
      <button
        type="button"
        className="cat-filter-btn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter jumlah pemain"
      >
        <span className="cat-filter-icon"><IconUsers size={16} /></span>
        <span className="cat-filter-label">
          {value === null ? 'Jumlah pemain' : value === 1 ? 'Solo (1p)' : `${value} pemain`}
        </span>
        {isFiltered ? (
          <span
            className="cat-filter-clear"
            role="button"
            tabIndex={0}
            aria-label="Hapus filter pemain"
            onClick={e => {
              e.stopPropagation();
              onChange(null);
              setOpen(false);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onChange(null);
                setOpen(false);
              }
            }}
          >
            <IconX size={12} />
          </span>
        ) : (
          <span className={`cat-filter-chev ${open ? 'rot' : ''}`}>
            <IconChevronDown size={14} />
          </span>
        )}
      </button>

      {open && (
        <div className="cat-filter-menu" role="listbox" aria-label="Pilih jumlah pemain">
          <div className="cat-filter-menu-head">Jumlah Pemain</div>
          {PLAYER_OPTIONS.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value ?? 'all'}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`cat-filter-opt ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="cat-filter-opt-text">
                  <b>{opt.label}</b>
                  {opt.hint && <small>{opt.hint}</small>}
                </span>
                {isSelected && (
                  <span className="cat-filter-check">
                    <IconCheck size={16} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Catalog({ nav }: { nav: Nav }) {
  const favorites = useData(d => d.favorites);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CatKey>('all');
  const [players, setPlayers] = useState<number | null>(null);
  const [rules, setRules] = useState<string | null>(null);

  const match = (g: CatalogEntry, c: CatKey) =>
    (c === 'all' || (c === 'fav' ? favorites.includes(g.id) : g.category === c)) &&
    (!players || (g.minPlayers <= players && g.maxPlayers >= players)) &&
    (!q || `${g.name} ${g.description} ${CATEGORY_LABEL[g.category]}`.toLowerCase().includes(q.toLowerCase()));

  const list = useMemo(() => CATALOG.filter(g => match(g, cat)), [q, cat, players, favorites]);
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t, CATALOG.filter(g => match(g, t)).length])), [q, players, favorites]);
  const ready = list.filter(g => g.status === 'available');
  const soon = list.filter(g => g.status !== 'available');
  const filtered = !!q || players !== null || cat !== 'all';
  const reset = () => { setQ(''); setPlayers(null); setCat('all'); };

  return (
    <div className="cat">
      <header className="cat-head">
        <button className="cat-back" onClick={() => nav({ name: 'home' })} aria-label="Kembali ke beranda"><IconArrowLeft size={18} /></button>
        <div>
          <h1>Pilih Game</h1>
          <p>{CATALOG.filter(g => g.status === 'available').length} game siap dimainkan · {CATALOG.filter(g => g.status !== 'available').length} lainnya segera hadir</p>
        </div>
      </header>

      <div className="cat-toolbar">
        <label className="cat-search">
          <IconSearch size={18} />
          <input type="search" placeholder="Cari game, mis. poker, remi…" value={q} onChange={e => setQ(e.target.value)} aria-label="Cari game" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Hapus pencarian"><IconX size={16} /></button>}
        </label>
        <PlayerFilterDropdown value={players} onChange={setPlayers} />
      </div>

      <nav className="cat-tabs" aria-label="Kategori">
        {TABS.map(c => (
          <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)} aria-pressed={cat === c}>
            {c === 'fav' && <IconStar size={14} />}
            {tabLabel(c)}
            <span>{counts[c]}</span>
          </button>
        ))}
      </nav>

      {ready.length > 0 && (
        <section className="cat-section">
          <div className="cat-section-head">
            <h2>Bisa dimainkan</h2>
            <span>{ready.length} game</span>
          </div>
          <div className="cat-grid">
            {ready.map((g, i) => {
              const tone = TONES[CATALOG.indexOf(g) % TONES.length];
              const fav = favorites.includes(g.id);
              return (
                <article key={g.id} className={`cat-card tone-${tone}`} style={{ '--i': i } as CSSProperties}>
                  <div className="cat-cover" aria-hidden="true">
                    <span className="cat-cover-suits">{SUITS.map(s => <i key={s}>{s}</i>)}</span>
                    <span className="cat-cover-icon">{g.icon}</span>
                  </div>
                  <span className={`cat-level lv-${g.difficulty === 'Mudah' ? 1 : g.difficulty === 'Sedang' ? 2 : 3}`} title={`Tingkat kesulitan: ${g.difficulty}`}>
                    <IconGauge size={13} />{g.difficulty}
                  </span>
                  <button className={`cat-fav${fav ? ' on' : ''}`} onClick={() => toggleFavorite(g.id)}
                    aria-label={fav ? 'Hapus dari favorit' : 'Tambah ke favorit'} aria-pressed={fav} title={fav ? 'Favorit' : 'Jadikan favorit'}>
                    <IconStar size={16} />
                  </button>
                  <div className="cat-body">
                    <span className="cat-kicker">{CATEGORY_LABEL[g.category]}</span>
                    <h3>{g.name}</h3>
                    <p>{g.description}</p>
                    <ul className="cat-meta">
                      <li><IconUsers size={14} />{playersText(g)} pemain</li>
                      <li><IconClock size={14} />{g.duration}</li>
                    </ul>
                  </div>
                  <div className="cat-actions">
                    <button className="btn btn-gold" onClick={() => nav({ name: 'setup', gameId: g.id })}><IconPlay size={16} /> Mainkan</button>
                    <button className="btn btn-ghost cat-rules" onClick={() => setRules(g.id)}><IconBook size={16} /> Aturan</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {soon.length > 0 && (
        <section className="cat-section">
          <div className="cat-section-head">
            <h2>Segera hadir</h2>
            <span>Sedang kami siapkan · tandai favorit agar mudah ditemukan</span>
          </div>
          {(['poker', 'indonesia', 'international'] as const).map(c => {
            const group = soon.filter(g => g.category === c);
            if (!group.length) return null;
            return (
              <div key={c} className="cat-soon-group">
                <h3>{CATEGORY_LABEL[c]} <span>{group.length}</span></h3>
                <div className="cat-soon">
                  {group.map(g => {
                    const fav = favorites.includes(g.id);
                    return (
                      <div key={g.id} className="cat-soon-item">
                        <span className="cat-soon-icon" aria-hidden="true">{g.icon}</span>
                        <span className="cat-soon-text">
                          <b>{g.name}</b>
                          <small>{playersText(g)} pemain · {g.difficulty}</small>
                        </span>
                        <button className={`cat-soon-fav${fav ? ' on' : ''}`} onClick={() => toggleFavorite(g.id)}
                          aria-label={fav ? `Hapus ${g.name} dari favorit` : `Tandai ${g.name} sebagai favorit`} aria-pressed={fav}>
                          <IconStar size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {!list.length && (
        <div className="cat-empty">
          <IconSearch size={26} />
          <b>Tidak ada game yang cocok</b>
          <p>{cat === 'fav' && !q && players === null ? 'Belum ada favorit. Ketuk ikon bintang pada kartu game untuk menandainya.' : 'Coba kata kunci lain atau ubah filter.'}</p>
          {filtered && <button className="btn btn-sm" onClick={reset}>Hapus semua filter</button>}
        </div>
      )}

      {rules && <RulesModal gameId={rules} onClose={() => setRules(null)} />}
    </div>
  );
}
