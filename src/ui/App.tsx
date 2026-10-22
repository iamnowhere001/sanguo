import type { ReactNode } from 'react';
import { useGameStore } from '../store/gameStore';
import type { GameState } from '../core/state';
import { MainMenu } from './MainMenu';
import { ScenarioSelect } from './ScenarioSelect';
import { MapScreen } from './MapScreen';
import { BattleScreen } from './BattleScreen';
import { ReportModal } from './ReportModal';
import { GameOver } from './GameOver';
import { Toast } from './Toast';

function GameScreen({ state }: { state: GameState }) {
  return (
    <div className="app-shell">
      {state.phase === 'battle' && state.battle ? <BattleScreen /> : <MapScreen />}
      {state.report && !state.gameOver ? <ReportModal report={state.report} /> : null}
      {state.phase === 'gameover' && state.gameOver ? <GameOver state={state} /> : null}
    </div>
  );
}

export default function App() {
  const store = useGameStore();

  let body: ReactNode;
  if (store.screen === 'select') body = <ScenarioSelect />;
  else if (store.screen === 'game' && store.state) body = <GameScreen state={store.state} />;
  else body = <MainMenu />;

  return (
    <>
      {body}
      <Toast />
    </>
  );
}
