import { useEffect, useState, useRef, type ReactNode, type CSSProperties } from 'react';
import { type Card as CardT, cardLabel, catalogById, type OptionSpec, type CatalogEntry, CATEGORY_LABEL } from '@kuypoker/engine';
import { useNet } from '../lib/net';
import { useAppNotices } from '../lib/store';
import {
  IconArrowLeft,
  IconAward,
  IconCheck,
  IconChevronDown,
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

export function CustomSelect<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Pilih opsi',
  style,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode; hint?: string }[];
  onChange: (val: T) => void;
  disabled?: boolean;
  placeholder?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = options.find(o => o.value === value);

  return (
    <div ref={ref} className={`soft-select-wrap ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`} style={style}>
      <button
        type="button"
        className="soft-select-btn"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="soft-select-content">
          {active?.icon && <span className="soft-select-icon">{active.icon}</span>}
          <span className="soft-select-label">{active ? active.label : placeholder}</span>
        </span>
        <span className={`soft-select-chev ${open ? 'rot' : ''}`}>
          <IconChevronDown size={14} />
        </span>
      </button>

      {open && !disabled && (
        <div className="soft-select-menu" role="listbox">
          {options.map(opt => {
            const isSel = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={isSel}
                className={`soft-select-opt ${isSel ? 'selected' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="soft-select-opt-body">
                  {opt.icon && <span className="soft-select-opt-icon">{opt.icon}</span>}
                  <span className="soft-select-opt-text">
                    <b>{opt.label}</b>
                    {opt.hint && <small>{opt.hint}</small>}
                  </span>
                </span>
                {isSel && (
                  <span className="soft-select-check">
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

/** Form opsi generik dari OptionSpec modul game. */
export function OptionsForm({ specs, values, onChange, disabled }: {
  specs: OptionSpec[]; values: Record<string, unknown>; onChange: (key: string, v: unknown) => void; disabled?: boolean;
}) {
  return (
    <div className="stack">
      {specs.map(s => (
        <label key={s.key} className="row" style={{ justifyContent: 'space-between' }}>
          <span className="grow">{s.label}{s.help && <span className="muted small"><br />{s.help}</span>}</span>
          {s.type === 'number' && (
            <NumberField min={s.min} max={s.max} step={s.step} disabled={disabled} label={s.label}
              value={Number(values[s.key] ?? s.min)} onCommit={v => onChange(s.key, v)} />
          )}
          {s.type === 'select' && (
            <CustomSelect
              style={{ minWidth: 150 }}
              disabled={disabled}
              value={isNaN(Number(values[s.key])) ? String(values[s.key]) : Number(values[s.key])}
              options={s.choices.map(c => ({
                value: isNaN(Number(c.value)) ? String(c.value) : Number(c.value),
                label: c.label,
              }))}
              onChange={v => onChange(s.key, v)}
              ariaLabel={s.label}
            />
          )}
          {s.type === 'boolean' && (disabled
            ? <span className="badge">{values[s.key] ? 'Ya' : 'Tidak'}</span>
            : <Switch on={!!values[s.key]} label={s.label} onChange={v => onChange(s.key, v)} />)}
        </label>
      ))}
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
