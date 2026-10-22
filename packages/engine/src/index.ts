// index.ts — API publik mesin aturan.
import type { GameModule } from './types';
import { holdem } from './poker/holdem';
import { cangkulan } from './cangkulan';
import { blackjack } from './blackjack';
import { tongkrongan } from './tongkrongan';
import {
  omahaGame,
  shortDeckGame,
  fiveCardDrawGame,
  sevenCardStudGame,
  baccaratGame,
  warGame,
  game41,
  tepokNyamukGame,
  samhongGame,
  remiGame,
  capsaSusunGame,
  capsaBantingGame,
  goFishGame,
  oldMaidGame,
  crazyEightsGame,
  mauMauGame,
  ginRummyGame,
  rummyGame,
  heartsGame,
  spadesGame,
  euchreGame,
  durakGame,
  presidentGame,
} from './allGames';

export * from './types';
export * from './cards';
export * from './rng';
export * from './catalog';
export * from './poker/evaluator';
export * from './poker/pots';
export * from './poker/equity';
export * from './poker/holdem';
export * from './cangkulan';
export * from './blackjack';
export * from './tongkrongan';
export * from './allGames';
export * from './protocol';

/** Registry seluruh game yang dapat dimainkan di Cardora. */
export const GAMES: Record<string, GameModule<any, any, any, any>> = {
  holdem,
  cangkulan,
  blackjack,
  tongkrongan,
  'capsa-banting': capsaBantingGame,
  omaha: omahaGame,
  'short-deck': shortDeckGame,
  'five-card-draw': fiveCardDrawGame,
  'seven-card-stud': sevenCardStudGame,
  baccarat: baccaratGame,
  war: warGame,
  '41': game41,
  samhong: samhongGame,
  remi: remiGame,
  'capsa-susun': capsaSusunGame,
  'tepok-nyamuk': tepokNyamukGame,
  'go-fish': goFishGame,
  'old-maid': oldMaidGame,
  'crazy-eights': crazyEightsGame,
  'mau-mau': mauMauGame,
  'gin-rummy': ginRummyGame,
  rummy: rummyGame,
  hearts: heartsGame,
  spades: spadesGame,
  euchre: euchreGame,
  durak: durakGame,
  president: presidentGame,
};

export function getGame(id: string): GameModule<any, any, any, any> | undefined {
  return Object.prototype.hasOwnProperty.call(GAMES, id) ? GAMES[id] : undefined;
}
