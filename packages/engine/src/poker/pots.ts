// poker/pots.ts — main pot & side pot dari total kontribusi tiap seat dalam satu tangan.
//
// Algoritma lapisan: urutkan level kontribusi yang berbeda; setiap lapisan
// berisi (level - levelSebelumnya) × jumlah seat yang menyumbang ≥ level.
// Yang berhak atas lapisan = seat yang TIDAK fold dan menyumbang ≥ level.
//  - Lapisan yang hanya disumbang satu seat (taruhan yang tidak di-call)
//    dikembalikan ke seat itu (unmatched bet refund).
//  - Lapisan tanpa seat berhak (semua penyumbang fold) digabung ke pot sebelumnya.

export interface Pot {
  amount: number;
  eligible: number[];
}

export interface PotResult {
  pots: Pot[];
  refunds: { seat: number; amount: number }[];
}

export function buildPots(contributed: number[], folded: boolean[]): PotResult {
  const levels = [...new Set(contributed.filter(c => c > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  const refunds: { seat: number; amount: number }[] = [];
  let prev = 0;
  for (const level of levels) {
    const contributors = contributed.map((c, s) => (c >= level ? s : -1)).filter(s => s >= 0);
    const amount = (level - prev) * contributors.length;
    const eligible = contributors.filter(s => !folded[s]);
    prev = level;
    if (contributors.length === 1 && eligible.length === 1) {
      const r = refunds.find(x => x.seat === contributors[0]);
      if (r) r.amount += amount; else refunds.push({ seat: contributors[0], amount });
      continue;
    }
    const last = pots[pots.length - 1];
    if (eligible.length === 0) {
      if (last) last.amount += amount;
      else pots.push({ amount, eligible: [] });
      continue;
    }
    // Gabungkan lapisan dengan himpunan berhak yang sama (hasilnya identik).
    if (last && last.eligible.length === eligible.length && last.eligible.every((s, i) => s === eligible[i])) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }
  return { pots, refunds };
}

/**
 * Bagi pot ke pemenang. Sisa chip ganjil (odd chip) diberikan ke pemenang
 * pertama searah jarum jam dari kiri dealer button (aturan kasino umum).
 */
export function splitPot(amount: number, winners: number[], button: number, seatCount: number): Map<number, number> {
  const order = winners.slice().sort((a, b) =>
    ((a - button - 1 + seatCount) % seatCount) - ((b - button - 1 + seatCount) % seatCount));
  const share = Math.floor(amount / order.length);
  let odd = amount - share * order.length;
  const out = new Map<number, number>();
  for (const s of order) {
    out.set(s, share + (odd > 0 ? 1 : 0));
    if (odd > 0) odd--;
  }
  return out;
}
