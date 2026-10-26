// index.ts — API publik mesin aturan.
import type { GameModule } from './types';
import { holdem, omaha, shortDeck } from './poker/holdem';
import { cangkulan } from './cangkulan';
import { blackjack } from './blackjack';
import { tongkrongan } from './tongkrongan';
import { bohong } from './games/bohong';
import { kartuWarna } from './games/kartuWarna';
import { gaple } from './games/gaple';
import { fiveCardDraw } from './games/fiveCardDraw';
import { sevenCardStud } from './games/sevenCardStud';
import { baccarat } from './games/baccarat';
import { casinoWar } from './games/casinoWar';
import { kartu41 } from './games/kartu41';
import { samhong } from './games/samhong';
import { remi } from './games/remi';
import { capsaSusun } from './games/capsaSusun';
import { tepokNyamuk } from './games/tepokNyamuk';
import { goFish } from './games/goFish';
import { oldMaid } from './games/oldMaid';
import { crazyEights } from './games/crazyEights';
import { mauMau } from './games/mauMau';
import { ginRummy } from './games/ginRummy';
import { rummy } from './games/rummy';
import { hearts } from './games/hearts';
import { spades } from './games/spades';
import { euchre } from './games/euchre';
import { durak } from './games/durak';
import { president } from './games/president';

export * from './types';
export * from './cards';
export * from './rng';
export * from './catalog';
export * from './poker/evaluator';
export * from './poker/pots';
export * from './poker/equity';
export * from './poker/variant';
export * from './poker/holdem';
export * from './cangkulan';
export * from './blackjack';
export * from './tongkrongan';
export * from './protocol';
export * from './generic';
export * from './tokens';
export * from './economy';
export { bohong, type BohongState } from './games/bohong';
export { kartuWarna, type KartuWarnaState } from './games/kartuWarna';
export { gaple, type GapleState } from './games/gaple';
export { fiveCardDraw, type FiveCardDrawState } from './games/fiveCardDraw';
export { sevenCardStud, type SevenCardStudState } from './games/sevenCardStud';
export { baccarat, type BaccaratState } from './games/baccarat';
export { casinoWar, type CasinoWarState } from './games/casinoWar';
export { kartu41, type Kartu41State } from './games/kartu41';
export { samhong, type SamhongState } from './games/samhong';
export { remi, type RemiState } from './games/remi';
export { capsaSusun, type CapsaSusunState } from './games/capsaSusun';
export { tepokNyamuk, type TepokNyamukState } from './games/tepokNyamuk';
export { goFish, type GoFishState } from './games/goFish';
export { oldMaid, type OldMaidState } from './games/oldMaid';
export { crazyEights, type CrazyEightsState } from './games/crazyEights';
export { mauMau, type MauMauState } from './games/mauMau';
export { ginRummy, type GinRummyState } from './games/ginRummy';
export { rummy, type RummyState } from './games/rummy';
export { hearts, type HeartsState } from './games/hearts';
export { spades, type SpadesState } from './games/spades';
export { euchre, type EuchreState } from './games/euchre';
export { durak, type DurakState } from './games/durak';
export { president, type PresidentState } from './games/president';

/** Registry seluruh game yang dapat dimainkan di Cardora. */
export const GAMES: Record<string, GameModule<any, any, any, any>> = {
  holdem,
  cangkulan,
  blackjack,
  tongkrongan,
  omaha,
  'short-deck': shortDeck,
  'five-card-draw': fiveCardDraw,
  'seven-card-stud': sevenCardStud,
  baccarat: baccarat,
  war: casinoWar,
  '41': kartu41,
  samhong: samhong,
  remi: remi,
  'capsa-susun': capsaSusun,
  'tepok-nyamuk': tepokNyamuk,
  'go-fish': goFish,
  'old-maid': oldMaid,
  'crazy-eights': crazyEights,
  'mau-mau': mauMau,
  'gin-rummy': ginRummy,
  rummy: rummy,
  hearts: hearts,
  spades: spades,
  euchre: euchre,
  durak: durak,
  president: president,
  'domino-gaple': gaple,
  'kartu-warna': kartuWarna,
  'bohong': bohong,
};

export function getGame(id: string): GameModule<any, any, any, any> | undefined {
  return Object.prototype.hasOwnProperty.call(GAMES, id) ? GAMES[id] : undefined;
}
