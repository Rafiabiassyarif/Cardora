// screens/LocalPlay.tsx — single-player vs bot (berjalan sepenuhnya di perangkat).
import { AVATARS } from '@kuypoker/engine';
import { useLocalGame } from '../lib/localGame';
import { useData } from '../lib/store';
import { TableScreen } from '../tables/TableScreen';

export default function LocalPlay({ gameId, players, options, onExit }: { gameId: string; players: number; options: Record<string, unknown>; onExit: () => void }) {
  const difficulty = useData(d => d.settings.botDifficulty);
  const me = useData(d => d.profile.avatar);
  const g = useLocalGame(gameId, players, difficulty, options);
  const avatars = Array.from({ length: players }, (_, i) => (i === 0 ? me : AVATARS[(i * 3 + 1) % AVATARS.length]));
  const isPassAndPlay = Boolean(options.passAndPlay);
  const diffLabel = isPassAndPlay 
    ? '📱 Operan HP (4 Pemain)' 
    : difficulty === 'easy' ? 'Bot mudah' : difficulty === 'hard' ? 'Bot sulit' : 'Bot normal';
  return (
    <TableScreen 
      gameId={gameId} 
      view={g.view} 
      error={g.error} 
      act={g.act} 
      onExit={onExit} 
      onRematch={g.restart} 
      onNextRound={g.nextRound}
      series={g.series}
      avatars={avatars} 
      subtitle={diffLabel} 
      turnDeadline={g.turnDeadline}
    />
  );
}
