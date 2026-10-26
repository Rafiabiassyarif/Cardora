import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { type Card as CardT, cardLabel, isColorCard, colorCardInfo, colorCardLabel, isDomino, dominoPips, dominoLabel, catalogById, type OptionSpec, type CatalogEntry, CATEGORY_LABEL } from '@kuypoker/engine';
import { useNet } from '../lib/net';
import { useAppNotices } from '../lib/store';
import {
  IconArrowLeft,
  IconAward,
  IconCheck,
  IconClock,
  IconMinus,
  IconPlus,
  IconUsers,
  IconX,
} from './icons';

export function PlayingCard({ card, small, playable, disabled, win, combo, onClick, delay = 0 }: {
  card: CardT | null; small?: boolean; playable?: boolean; disabled?: boolean; win?: boolean; combo?: boolean; onClick?: () => void; delay?: number;
}) {
  const style = delay ? { animationDelay: `${delay}ms` } : undefined;
  if (!card) {
    return (
      <div className={`pcard back${small ? ' small' : ''}`} style={style} aria-label="Kartu tertutup" role="img">
        <div className="card-back-pattern" aria-hidden="true" />
        <div className="card-back-emblem" aria-hidden="true">♠</div>
      </div>
    );
  }
  if (isColorCard(card) || isDomino(card)) {
    return <TokenCard card={card} small={small} playable={playable} disabled={disabled} win={win} combo={combo} onClick={onClick} style={style} />;
  }
  const label = cardLabel(card);
  const red = card[1] === 'H' || card[1] === 'D';
  const rank = label.slice(0, -1);
  const suit = label.slice(-1);
  const isFace = card[0] === 'J' || card[0] === 'Q' || card[0] === 'K';
  const cls = `pcard${red ? ' red' : ''}${isFace ? ' face' : ''}${card[0] === 'A' ? ' ace' : ''}${small ? ' small' : ''}${playable ? ' playable' : ''}${disabled ? ' disabled' : ''}${win ? ' win' : ''}${combo ? ' combo' : ''}`;
  const inner = (
    <>
      <div className="card-corner tl">
        <span className="r">{rank}</span>
        <span className="s">{suit}</span>
      </div>
      {isFace ? (
        <div className="card-center card-face" aria-hidden="true">
          <div className="face-emblem">
            <span className="face-rank">{rank}</span>
            <span className="face-suit">{suit}</span>
          </div>
        </div>
      ) : (
        <div className="card-center" aria-hidden="true">{suit}</div>
      )}
      <div className="card-corner br" aria-hidden="true">
        <span className="r">{rank}</span>
        <span className="s">{suit}</span>
      </div>
    </>
  );
  // Kartu interaktif (onClick ATAU prop playable diberikan, mis. kartu tangan) selalu <button>, supaya
  // elemen tidak berganti div↔button saat giliran berubah (itu memicu remount & animasi bagi ulang).
  return onClick || playable !== undefined
    ? <button type="button" className={cls} style={style} onClick={onClick} disabled={disabled} aria-disabled={!onClick || undefined} aria-label={label}>{inner}</button>
    : <div className={cls} style={style} role="img" aria-label={label}>{inner}</div>;
}

/** Posisi titik domino pada grid 3×3 (indeks 0–8) untuk angka 0–6. */
const PIP_CELLS: Record<number, number[]> = {
  0: [], 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function DominoHalf({ n }: { n: number }) {
  return (
    <div className="dom-half">
      {Array.from({ length: 9 }, (_, i) => <span key={i} className={PIP_CELLS[n].includes(i) ? 'pip on' : 'pip'} />)}
    </div>
  );
}

const U_SYMBOL: Record<string, string> = { S: '⊘', R: '⇄', D: '+2', W: '★', '4': '+4' };

/** Kartu non-remi: Kartu Warna ("u:…") dan domino ("d:…"). */
function TokenCard({ card, small, playable, disabled, win, combo, onClick, style }: {
  card: CardT; small?: boolean; playable?: boolean; disabled?: boolean; win?: boolean; combo?: boolean; onClick?: () => void; style?: CSSProperties;
}) {
  let cls: string, label: string, inner: ReactNode;
  if (isDomino(card)) {
    const [a, b] = dominoPips(card);
    label = dominoLabel(card);
    cls = 'pcard tok-dom';
    inner = <><DominoHalf n={a} /><span className="dom-line" aria-hidden="true" /><DominoHalf n={b} /></>;
  } else {
    const { color, value } = colorCardInfo(card);
    label = colorCardLabel(card);
    const sym = U_SYMBOL[value] ?? value;
    cls = `pcard tok-u u-${color}`;
    inner = (
      <>
        <span className="u-corner tl" aria-hidden="true">{sym}</span>
        <span className="u-oval" aria-hidden="true"><span className="u-sym">{sym}</span></span>
        <span className="u-corner br" aria-hidden="true">{sym}</span>
      </>
    );
  }
  cls += `${small ? ' small' : ''}${playable ? ' playable' : ''}${disabled ? ' disabled' : ''}${win ? ' win' : ''}${combo ? ' combo' : ''}`;
  return onClick || playable !== undefined
    ? <button type="button" className={cls} style={style} onClick={onClick} disabled={disabled} aria-disabled={!onClick || undefined} aria-label={label}>{inner}</button>
    : <div className={cls} style={style} role="img" aria-label={label}>{inner}</div>;
}

export function EmptySlot({ small }: { small?: boolean }) {
  return (
    <div className={`pcard slot${small ? ' small' : ''}`} aria-hidden="true">
      <div className="slot-inner" />
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <div className="modal-head">
          <h2 className="grow">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Tutup">
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function RulesModal({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const g = catalogById(gameId) as CatalogEntry;
  if (!g) return null;

  return (
    <Modal title="Aturan & Cara Main" onClose={onClose}>
      <div className="rules-modal-container">
        {/* Game Header Card */}
        <div className="rules-game-card">
          <div className="rules-game-icon" aria-hidden="true">{g.icon}</div>
          <div className="rules-game-details">
            <h3 className="rules-game-title">{g.name}</h3>
            <div className="rules-game-badges">
              <span className="rules-badge category">{CATEGORY_LABEL[g.category] ?? 'Game Kartu'}</span>
              <span className="rules-badge"><IconUsers size={12} /> {g.minPlayers}–{g.maxPlayers} Pemain</span>
              <span className="rules-badge"><IconClock size={12} /> {g.duration}</span>
              <span className="rules-badge"><IconAward size={12} /> {g.difficulty}</span>
            </div>
          </div>
        </div>

        {/* Variant / Special Note */}
        {g.variantNote && (
          <div className="rules-callout">
            <span className="rules-callout-icon" aria-hidden="true">💡</span>
            <div className="rules-callout-text">
              <b>Catatan Variasi:</b> {g.variantNote}
            </div>
          </div>
        )}

        {/* Step-by-Step Rules List */}
        {g.rules && g.rules.length > 0 ? (
          <div className="rules-list">
            <div className="rules-section-kicker">
              <span>LANGKAH & TATA CARA PERMAINAN</span>
            </div>
            {g.rules.map((rule, idx) => {
              const isGoal = idx === g.rules!.length - 1 && (
                rule.toLowerCase().includes('menang') || 
                rule.toLowerCase().includes('kalah') || 
                rule.toLowerCase().includes('juara')
              );
              return (
                <div key={idx} className={`rules-step-card ${isGoal ? 'is-goal' : ''}`}>
                  <div className="rules-step-num-wrap">
                    {isGoal ? (
                      <span className="rules-step-goal-icon" aria-hidden="true">🏆</span>
                    ) : (
                      <span className="rules-step-num">{String(idx + 1).padStart(2, '0')}</span>
                    )}
                  </div>
                  <div className="rules-step-content">
                    {isGoal && <span className="rules-step-goal-title">Tujuan & Syarat Kemenangan</span>}
                    <p className="rules-step-text">{rule}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card-box stack center" style={{ padding: '24px 16px', borderRadius: 16 }}>
            <p className="muted small center">Aturan untuk <b>{g.name}</b> sedang disempurnakan dan diverifikasi sistem.</p>
          </div>
        )}

        {/* Action Button */}
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-gold btn-block" onClick={onClose}>
            <IconCheck size={16} /> Saya Mengerti, Siap Main!
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack && (
        <button 
          className="topbar-back-btn" 
          onClick={onBack} 
          aria-label="Kembali ke halaman sebelumnya"
          title="Kembali"
        >
          <IconArrowLeft size={18} />
          <span className="topbar-back-label">Kembali</span>
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Toasts() {
  const netNotices = useNet(s => s.notices);
  const appNotices = useAppNotices();
  const all = [...netNotices, ...appNotices];
  return (
    <div className="toasts" aria-live="polite">
      {all.map(n => <div key={n.id} className={`toast ${n.kind}`}>{n.text}</div>)}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

/** Pilihan sebagai tombol (tanpa dropdown): semua opsi langsung terlihat, satu ketuk untuk memilih. */
export function ChoiceGroup<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode; hint?: string }[];
  onChange: (val: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="choice-group" role="radiogroup" aria-label={ariaLabel}>
      {options.map(opt => {
        const on = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled && !on}
            className={`choice${on ? ' on' : ''}`}
            title={opt.hint}
            onClick={() => !disabled && !on && onChange(opt.value)}
          >
            {opt.icon && <span className="choice-icon">{opt.icon}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function getOptionIcon(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('pass') || k.includes('device') || k.includes('operan') || k.includes('play')) return '📱';
  if (k.includes('second') || k.includes('time') || k.includes('timer') || k.includes('turn')) return '⏱️';
  if (k.includes('opening') || k.includes('round') || k.includes('start')) return '🃏';
  if (k.includes('bomb') || k.includes('quad')) return '💣';
  if (k.includes('forbid') || k.includes('penalty') || k.includes('foul') || k.includes('ban') || k.includes('larangan')) return '🚫';
  if (k.includes('chip') || k.includes('stack') || k.includes('blind') || k.includes('bet')) return '🪙';
  if (k.includes('hint') || k.includes('assist') || k.includes('guide')) return '💡';
  if (k.includes('sort') || k.includes('hand') || k.includes('card') || k.includes('deck')) return '🗂️';
  if (k.includes('odds') || k.includes('rate') || k.includes('payout')) return '📊';
  return '⚙️';
}

function renderChoiceContent(label: string) {
  const m = label.match(/^(.*?)\s*\((.*?)\)$/);
  if (m) {
    return (
      <span className="opt-choice-text-wrap">
        <span className="opt-choice-main">{m[1]}</span>
        <span className="opt-choice-sub">{m[2]}</span>
      </span>
    );
  }
  return (
    <span className="opt-choice-text-wrap">
      <span className="opt-choice-main">{label}</span>
    </span>
  );
}

/** Form opsi generik dari OptionSpec modul game dengan desain kartu terstruktur, konsisten & rapi. */
export function OptionsForm({ specs, values, onChange, disabled }: {
  specs: OptionSpec[]; values: Record<string, unknown>; onChange: (key: string, v: unknown) => void; disabled?: boolean;
}) {
  return (
    <div className="options-form-grid">
      {specs.map(s => {
        const icon = getOptionIcon(s.key);

        if (s.type === 'boolean') {
          const isOn = !!values[s.key];
          return (
            <div
              key={s.key}
              className={`opt-card opt-card-boolean${isOn ? ' is-checked' : ''}`}
              role="button"
              tabIndex={disabled ? -1 : 0}
              onClick={() => !disabled && onChange(s.key, !isOn)}
              onKeyDown={e => {
                if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onChange(s.key, !isOn);
                }
              }}
            >
              <div className="opt-header-row">
                <span className="opt-icon-badge" aria-hidden="true">{icon}</span>
                <div className="opt-info">
                  <span className="opt-title">{s.label}</span>
                  {s.help && <p className="opt-help">{s.help}</p>}
                </div>
                <div className="opt-action" onClick={e => e.stopPropagation()}>
                  {disabled ? (
                    <span className="badge">{isOn ? 'Aktif' : 'Nonaktif'}</span>
                  ) : (
                    <div className="opt-switch-wrap">
                      <span className={`opt-switch-status ${isOn ? 'is-on' : ''}`}>
                        {isOn ? 'Aktif' : 'Mati'}
                      </span>
                      <Switch on={isOn} label={s.label} onChange={v => onChange(s.key, v)} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        if (s.type === 'select') {
          const activeVal = isNaN(Number(values[s.key])) ? String(values[s.key]) : Number(values[s.key]);
          const currentChoice = s.choices.find(c => {
            const optVal = isNaN(Number(c.value)) ? String(c.value) : Number(c.value);
            return optVal === activeVal;
          });

          return (
            <div key={s.key} className="opt-card opt-card-select">
              <div className="opt-header-row">
                <span className="opt-icon-badge" aria-hidden="true">{icon}</span>
                <div className="opt-info">
                  <div className="opt-title-line">
                    <span className="opt-title">{s.label}</span>
                    {currentChoice && (
                      <span className="opt-current-badge">
                        {currentChoice.label.split('(')[0].trim()}
                      </span>
                    )}
                  </div>
                  {s.help && <p className="opt-help">{s.help}</p>}
                </div>
              </div>

              <div className="opt-choices-wrap">
                <div
                  className={`opt-choices-grid ${
                    s.choices.length === 2 ? 'is-pair' : s.choices.length <= 4 ? 'is-quartet' : 'is-multi'
                  }`}
                  role="radiogroup"
                  aria-label={s.label}
                >
                  {s.choices.map(c => {
                    const optVal = isNaN(Number(c.value)) ? String(c.value) : Number(c.value);
                    const on = activeVal === optVal;
                    return (
                      <button
                        key={String(c.value)}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={disabled && !on}
                        className={`opt-choice-btn${on ? ' is-active' : ''}`}
                        onClick={() => !disabled && !on && onChange(s.key, optVal)}
                      >
                        <span className={`opt-choice-indicator${on ? ' is-active' : ''}`} aria-hidden="true">
                          {on ? '✓' : ''}
                        </span>
                        {renderChoiceContent(c.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

        if (s.type === 'number') {
          return (
            <div key={s.key} className="opt-card opt-card-number">
              <div className="opt-header-row">
                <span className="opt-icon-badge" aria-hidden="true">{icon}</span>
                <div className="opt-info">
                  <span className="opt-title">{s.label}</span>
                  {s.help && <p className="opt-help">{s.help}</p>}
                </div>
                <div className="opt-action">
                  <NumberField
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    disabled={disabled}
                    label={s.label}
                    value={Number(values[s.key] ?? s.min)}
                    onCommit={v => onChange(s.key, v)}
                  />
                </div>
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

/** Input angka dengan tombol stepper tactile (- dan +) untuk kenyamanan sentuhan & presisi. */
function NumberField({ value, min, max, step, disabled, label, onCommit }: {
  value: number; min: number; max: number; step: number; disabled?: boolean; label: string; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (targetVal?: number) => {
    const raw = targetVal !== undefined ? targetVal : Number(draft);
    const n = Math.min(max, Math.max(min, Math.round(raw)));
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <div className="stepper-wrap">
      <button
        type="button"
        className="stepper-btn"
        disabled={disabled || value <= min}
        onClick={() => commit(value - step)}
        aria-label={`Kurangi ${label}`}
      >
        <IconMinus size={14} />
      </button>
      <input
        className="input stepper-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
      <button
        type="button"
        className="stepper-btn"
        disabled={disabled || value >= max}
        onClick={() => commit(value + step)}
        aria-label={`Tambah ${label}`}
      >
        <IconPlus size={14} />
      </button>
    </div>
  );
}

export function Countdown({ deadline, total }: { deadline: number | null; total: number }) {
  const now = useNow(deadline !== null);
  if (deadline === null) return null;
  const left = Math.max(0, deadline - now);
  const pct = Math.min(100, (left / (total * 1000)) * 100);
  const urgent = left <= 5000;
  return (
    <div className={`timer-container${urgent ? ' urgent' : ''}`}>
      <div className="timer-bar" role="timer" aria-label={`Sisa ${Math.ceil(left / 1000)} detik`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="timer-badge">{Math.ceil(left / 1000)}s</span>
    </div>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
