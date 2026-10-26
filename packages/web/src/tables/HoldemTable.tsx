// tables/HoldemTable.tsx — meja Texas Hold'em (juga Omaha & Short Deck) dengan Live Hand Strength Analyzer, Win Equity HUD, dan Pot Odds Helper.
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { 
  type HoldemView, 
  type HoldemAction, 
  type Card,
  evaluateVariant,
  variantSpec,
  estimateEquity, 
  cryptoRng, 
  rankOf, 
  suitOf 
} from '@kuypoker/engine';
import { createPortal } from 'react-dom';
import { PlayingCard, EmptySlot } from '../components/ui';
import { AnimatedNumber, ChipBurst } from '../components/effects';
import { SeatBadge, rotateSeats, Opponents } from './common';
import { play } from '../lib/sound';
import { flyChips, flyIn } from '../lib/flights';
import { trackAchievement } from '../lib/store';
import { HandRankingsModal, RebuyModal, LastHandModal } from '../components/gameModals';

const STREET: Record<string, string> = { 
  preflop: 'Pre-flop', 
  flop: 'Flop', 
  turn: 'Turn', 
  river: 'River', 
  handOver: 'Tangan selesai', 
  gameOver: 'Selesai' 
};

/** Analisis pre-flop Omaha (4 kartu): pair, suited/double-suited, rundown. */
function analyzeOmahaPreflop(hole: Card[]) {
  const ranks = hole.map(rankOf);
  const label = (r: number) => hole[ranks.indexOf(r)].slice(0, -1);
  const rc = new Map<number, number>();
  for (const r of ranks) rc.set(r, (rc.get(r) ?? 0) + 1);
  const pairs = [...rc].filter(([, c]) => c >= 2).map(([r]) => r).sort((a, b) => b - a);
  const sc = new Map<string, number>();
  for (const c of hole) sc.set(suitOf(c), (sc.get(suitOf(c)) ?? 0) + 1);
  const suitedSuits = [...sc.values()].filter(c => c >= 2).length;
  const uniq = [...rc.keys()].sort((a, b) => b - a);
  const rundown = uniq.length === 4 && uniq[0] - uniq[3] <= 4;
  const parts: string[] = [];
  if (pairs.length) parts.push(pairs[0] === 14 ? 'Pocket Aces' : `Pair ${label(pairs[0])}`);
  if (suitedSuits >= 2) parts.push('Double-Suited');
  else if (suitedSuits === 1) parts.push('Suited');
  if (rundown) parts.push('Rundown');
  const high = (pairs[0] === 14) || (pairs.length > 0 && pairs[0] >= 10 && suitedSuits > 0) || (rundown && suitedSuits >= 2);
  const tier = high ? 'high' : parts.length ? 'mid' : 'low';
  return { name: parts.length ? parts.join(' · ') : `High Card ${label(Math.max(...ranks))}`, tier };
}

function analyzePlayerHand(hole: Card[], board: Card[], gameId: string) {
  const spec = variantSpec(gameId);
  if (hole.length !== spec.holeCards) return null;
  if (board.length === 0 && spec.id === 'omaha') return analyzeOmahaPreflop(hole);
  if (board.length === 0) {
    const r1 = rankOf(hole[0]);
    const r2 = rankOf(hole[1]);
    const suited = suitOf(hole[0]) === suitOf(hole[1]);
    const label0 = hole[0].slice(0, -1);
    const label1 = hole[1].slice(0, -1);
    if (r1 === r2) {
      const pairName = r1 === 14 ? 'Pocket Aces (Monster Pair! 🚀)' : r1 >= 10 ? `Pocket ${label0}s (Premium Pair)` : `Pocket ${label0}s (Pair)`;
      return { name: pairName, tier: 'high' };
    }
    const high = Math.max(r1, r2);
    const low = Math.min(r1, r2);
    if (high === 14 && low >= 10) return { name: `Big Ace (${label0}-${label1} ${suited ? 'Suited' : ''})`, tier: 'high' };
    if (high - low === 1 && suited) return { name: `${label0}-${label1} Suited Connector`, tier: 'mid' };
    if (suited) return { name: `${label0}-${label1} Suited`, tier: 'mid' };
    return { name: `High Card ${label0}`, tier: 'low' };
  }
  if (board.length >= 3) {
    // Omaha: wajib 2 kartu tangan + 3 kartu meja; Short Deck: urutan Triton.
    const hand = evaluateVariant(spec.id, hole, board);
    return { 
      name: hand.name, 
      tier: hand.category >= 3 ? 'high' : hand.category >= 1 ? 'mid' : 'low' 
    };
  }
  return null;
}

export function HoldemTable({ v, act, avatars, dock, bubble }: { 
  v: HoldemView; 
  act: (a: HoldemAction) => void; 
  avatars: string[]; 
  dock: HTMLElement | null;
  bubble?: { text: string; seat: number } | null;
}) {
  const me = v.you!;
  const l = v.legal;
  const myBet = v.seats[me].bet;
  const myHole = v.seats[me].hole.filter((c): c is Card => !!c);
  const spec = variantSpec(v.gameId);
  const holeN = spec.holeCards;
  // Omaha (4 kartu tangan): kartu dirapatkan agar muat di layar HP.
  const holeCls = holeN > 2 ? ' hole4' : '';
  const minTo = l?.minBet ?? l?.minRaiseTo ?? 0;
  const [amount, setAmount] = useState(minTo);
  const [showRankings, setShowRankings] = useState(false);
  const [showRebuy, setShowRebuy] = useState(false);
  const [showLastHand, setShowLastHand] = useState(false);

  useEffect(() => { setAmount(minTo); }, [minTo, v.handNo, v.street]);
  
  const canSize = !!l && (l.minBet !== null || l.minRaiseTo !== null);
  const isBet = l?.minBet !== null;
  const presets = canSize ? [
    { label: 'Min', to: minTo },
    { label: '½ Pot', to: Math.round(v.currentBet + Math.max(v.bigBlind, (v.pot + (l!.callAmount)) / 2)) },
    { label: spec.potLimit ? 'Pot (Maks)' : 'Pot', to: Math.round(v.currentBet + Math.max(v.bigBlind, v.pot + l!.callAmount)) },
  ].map(p => ({ ...p, to: Math.min(l!.maxTo, Math.max(minTo, p.to)) })) : [];
  
  const winners = new Set(v.lastHand?.winners.map(w => w.seat));
  const showdown = !!v.lastHand && (v.street === 'handOver' || v.street === 'gameOver');
  // Kartu yang membentuk kombinasi pemenang (board + kartu tangan yang terlihat).
  const comboCards = useMemo(() => {
    const set = new Set<Card>();
    if (!showdown || v.board.length < 5) return set;
    for (const w of v.lastHand!.winners) {
      const hole = v.seats[w.seat]?.hole.filter((c): c is Card => !!c) ?? [];
      if (hole.length !== holeN) continue;
      try { for (const c of evaluateVariant(v.gameId, hole, v.board).cards) set.add(c); } catch { /* abaikan */ }
    }
    return set;
  }, [showdown, v.board, v.lastHand, v.seats, v.gameId, holeN]);
  const myWin = showdown ? v.lastHand!.winners.find(w => w.seat === me) : undefined;
  const others = rotateSeats(v.seats.length, me).slice(1);

  // Live Hand Analysis
  const handAnalysis = useMemo(() => analyzePlayerHand(myHole, v.board, v.gameId), [myHole.join(), v.board, v.gameId]);

  // Live Win Equity Monte Carlo estimation
  const activeOpponents = v.seats.filter((s, idx) => idx !== me && !s.folded && !s.out).length;
  const equityPct = useMemo(() => {
    if (myHole.length !== holeN || activeOpponents <= 0 || v.seats[me].folded || v.seats[me].out) return null;
    try {
      const rng = cryptoRng();
      // Omaha: evaluasi per tangan jauh lebih mahal → iterasi lebih sedikit agar UI tetap ringan.
      const eq = estimateEquity(myHole, v.board, activeOpponents, spec.id === 'omaha' ? 40 : 100, rng, spec.id);
      return Math.max(1, Math.min(99, Math.round(eq * 100)));
    } catch {
      return null;
    }
  }, [v.board.length, v.handNo, activeOpponents, myHole.length, v.seats[me].folded, v.seats[me].out, spec.id, holeN]);

  // Pot odds calculation
  const potOdds = l && l.callAmount > 0 ? Math.round((l.callAmount / (v.pot + l.callAmount)) * 100) : null;
  const favorableCall = equityPct !== null && potOdds !== null && equityPct >= potOdds;

  const handleAllIn = () => {
    play('allin');
    trackAchievement('allin_hero', 1);
    act({ type: 'allin' });
  };

  const isBroke = v.seats[me].stack === 0 || v.seats[me].out;

  // ---- Animasi chip: taruhan terbang ke pot, pot terbang ke pemenang; kartu komunitas meluncur dari tengah ----
  const animRef = useRef<HTMLSpanElement>(null);
  const prevBets = useRef<number[] | null>(null);
  const prevHandNo = useRef<number | null>(null);
  const paidOut = useRef<string | null>(null);
  const prevBoard = useRef<number>(0);
  useLayoutEffect(() => {
    const root = animRef.current?.closest('.felt');
    if (!root) return;
    const pot = root.querySelector('.pot');
    const seatEl = (i: number) => root.querySelector(`[data-seat="${i}"]`);
    const bets = v.seats.map(s => s.bet);
    if (prevBets.current && prevHandNo.current === v.handNo) {
      bets.forEach((b, i) => { if (b > (prevBets.current![i] ?? 0)) flyChips(seatEl(i)?.querySelector('.avatar') ?? null, pot, b >= v.bigBlind * 4 ? 5 : 3); });
    }
    prevBets.current = bets;
    prevHandNo.current = v.handNo;

    const payKey = v.lastHand ? `${v.handNo}-${v.lastHand.winners.map(w => w.seat).join(',')}` : null;
    if (v.street === 'handOver' && payKey && paidOut.current !== payKey) {
      paidOut.current = payKey;
      v.lastHand!.winners.forEach((w, k) => flyChips(pot, seatEl(w.seat)?.querySelector('.avatar') ?? null, 6, { delay: 350 + k * 200 }));
    }

    if (v.board.length > prevBoard.current && prevBoard.current >= 0) {
      const slots = root.querySelectorAll('.board-cards .pcard');
      for (let i = prevBoard.current; i < v.board.length; i++) flyIn(slots[i] ?? null, pot, { delay: (i - prevBoard.current) * 110, rotate: 0, scale: 0.6, duration: 420 });
    }
    prevBoard.current = v.board.length;
  });

  return (
    <>
      <Opponents>
      <span ref={animRef} hidden />
        {others.map(i => {
          const s = v.seats[i];
          return (
            <SeatBadge 
              key={i} 
              seat={i}
              name={s.name} 
              avatar={avatars[i]} 
              turn={v.turn === i} 
              folded={s.folded || s.out}
              sub={s.out ? 'Habis' : <AnimatedNumber value={s.stack} />} 
              gain={s.stack}
              tag={tagOf(v, i)}
              bubble={bubble?.seat === i ? bubble.text : undefined}
              extra={<>
                {!s.out && (
                  <div className={`cards overlap${holeCls}`}>
                    {s.hole.map((c, k) => <PlayingCard key={`${v.handNo}-${k}-${c ?? 'x'}`} small card={c} win={winners.has(i) && !!c} combo={!!c && comboCards.has(c)} />)}
                  </div>
                )}
                {s.bet > 0 && <span className="seat-sub">Bet {s.bet}</span>}
                {s.allIn && <span className="badge warn">ALL-IN</span>}
              </>} 
            />
          );
        })}
      </Opponents>

      <div className="center-area">
        <div className="muted small row" style={{ justifyContent: 'center', gap: 8 }}>
          <span>{STREET[v.street]} · Tangan #{v.handNo}</span>
          <button 
            className="btn btn-ghost" 
            style={{ padding: '0 6px', height: 20, fontSize: '0.75rem', color: 'var(--gold)' }} 
            onClick={() => setShowRankings(true)}
            title="Lihat urutan kombinasi poker"
          >
            Urutan Kartu
          </button>
        </div>

        <div className="cards board-cards">
          {Array.from({ length: 5 }, (_, i) => v.board[i]
            ? <PlayingCard key={`${v.handNo}-${i}`} card={v.board[i]} combo={comboCards.has(v.board[i])} delay={i < 3 ? i * 110 : 0} />
            : <EmptySlot key={i} />)}
        </div>
        
        <div className="pot-wrap">
          <div className="pot" aria-label="Pot">Pot <AnimatedNumber value={v.pot} duration={420} /></div>
          <ChipBurst burstKey={myWin ? v.handNo : null} amount={myWin?.amount} />
        </div>

        {v.lastHand && (
          <button 
            className="winner-banner" 
            onClick={() => setShowLastHand(true)} 
            title="Klik untuk detail showdown"
            style={{ cursor: 'pointer', border: 0 }}
          >
            {v.lastHand.winners.map(w => `${v.seats[w.seat].name} +${w.amount}${w.hand ? ` (${w.hand})` : ''}`).join(' · ')}
          </button>
        )}
      </div>

      <div className="me-area">
        {/* Live Poker Assistant HUD: Hand Strength & Win Equity */}
        {!v.seats[me].folded && !v.seats[me].out && handAnalysis && (
          <div className="poker-hud-bar">
            <div className="hand-anal-badge">
              <span className="anal-icon">◆</span>
              <span className="anal-title">{handAnalysis.name}</span>
            </div>

            {equityPct !== null && (
              <div className="equity-meter" title={`Peluang menang estimasi Monte Carlo: ${equityPct}%`}>
                <span className="equity-label">Peluang: <b>{equityPct}%</b></span>
                <div className="equity-bar-bg">
                  <div 
                    className="equity-bar-fill" 
                    style={{ 
                      width: `${equityPct}%`,
                      background: equityPct > 55 ? '#349E77' : equityPct > 35 ? '#D1B17B' : '#D9534F' 
                    }} 
                  />
                </div>
              </div>
            )}

            {potOdds !== null && (
              <div className="pot-odds-badge" title="Pot Odds">
                <span>Pot Odds: <b>{potOdds}%</b></span>
                {favorableCall && <span className="call-advice" title="Peluang Anda lebih besar dari rasio pot odds">Call Bagus</span>}
              </div>
            )}
          </div>
        )}

        <SeatBadge 
          seat={me}
          name={`${v.seats[me].name} (kamu)`} 
          avatar={avatars[me]} 
          turn={v.turn === me} 
          folded={v.seats[me].folded}
          sub={<>Chip <AnimatedNumber value={v.seats[me].stack} />{myBet ? ` · Bet ${myBet}` : ''}</>} 
          gain={v.seats[me].stack}
          tag={tagOf(v, me)}
          bubble={bubble?.seat === me ? bubble.text : undefined}
          extra={
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <div className={`cards${holeCls}`}>
                {v.seats[me].hole.map((c, k) => (
                  <PlayingCard key={`${v.handNo}-${k}`} card={c} win={winners.has(me)} combo={!!c && comboCards.has(c)} delay={k * 140} />
                ))}
              </div>
              {isBroke && (
                <button 
                  className="btn btn-gold btn-sm" 
                  onClick={() => setShowRebuy(true)}
                  style={{ animation: 'pulse 1.5s infinite' }}
                >
                  Rebuy
                </button>
              )}
            </div>
          } 
        />

        {dock && createPortal(
          <>
            {l && (
              <>
                {canSize && (
                  <div className="raise-row">
                    <input 
                      type="range" 
                      min={minTo} 
                      max={l.maxTo} 
                      step={1} 
                      value={amount} 
                      aria-label="Jumlah taruhan"
                      onChange={e => setAmount(Number(e.target.value))} 
                    />
                    {presets.map(p => (
                      <button key={p.label} className="chip" onClick={() => setAmount(p.to)}>
                        {p.label}
                      </button>
                    ))}
                    <input 
                      className="input" 
                      style={{ width: 84 }} 
                      type="number" 
                      min={minTo} 
                      max={l.maxTo} 
                      value={amount}
                      aria-label="Jumlah taruhan (angka)" 
                      onChange={e => setAmount(Number(e.target.value))} 
                    />
                  </div>
                )}
                <div className="actions">
                  <button className="btn btn-danger" onClick={() => { play('click'); act({ type: 'fold' }); }}>
                    Fold
                  </button>
                  {l.canCheck && (
                    <button className="btn" onClick={() => { play('knock'); act({ type: 'check' }); }}>
                      Check
                    </button>
                  )}
                  {l.callAmount > 0 && (
                    <button className="btn" onClick={() => { play('chip'); act({ type: 'call' }); }}>
                      Call {l.callAmount.toLocaleString('id-ID')}
                    </button>
                  )}
                  {/* Pot-Limit: bila all-in melebihi batas pot, raise ke batas (maxTo) tetap lewat tombol ini. */}
                  {canSize && (amount < l.maxTo || !l.canAllIn) && (
                    <button 
                      className="btn btn-emerald" 
                      onClick={() => { play('chip'); act(isBet ? { type: 'bet', amount } : { type: 'raise', amount }); }}
                    >
                      {isBet ? 'Bet' : 'Raise ke'} {amount.toLocaleString('id-ID')}
                    </button>
                  )}
                  {l.canAllIn && (
                    <button className="btn btn-gold" onClick={handleAllIn}>
                      All-in {l.maxTo.toLocaleString('id-ID')}
                    </button>
                  )}
                </div>
              </>
            )}
          </>, 
          dock
        )}
      </div>

      {showRankings && <HandRankingsModal variant={v.gameId} onClose={() => setShowRankings(false)} />}
      {showRebuy && <RebuyModal onClose={() => setShowRebuy(false)} currentStack={v.seats[me].stack} />}
      {showLastHand && (
        <LastHandModal 
          lastHand={v.lastHand} 
          seats={v.seats} 
          avatars={avatars} 
          onClose={() => setShowLastHand(false)} 
        />
      )}
    </>
  );
}

function tagOf(v: HoldemView, i: number) {
  if (i === v.button) return 'D';
  if (i === v.sbSeat) return 'SB';
  if (i === v.bbSeat) return 'BB';
  return undefined;
}
