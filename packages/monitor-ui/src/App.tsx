import { useSwarmEvents } from './hooks/useSwarmEvents';
import { StatusBar } from './components/StatusBar';
import { DAGView } from './components/DAGView';
import { CostBar } from './components/CostBar';
import { EventLog } from './components/EventLog';

export function App() {
  const state = useSwarmEvents();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-blue-400">Swarm</span>
          <span className="text-gray-300">Engine</span>
          <span className="text-gray-600 text-sm font-normal ml-2">Monitor</span>
        </h1>
      </header>

      {/* Main content — two panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: DAG view */}
        <div className="flex-1 flex flex-col p-4 min-w-0">
          <div className="flex flex-col flex-1 bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
            <StatusBar
              dagId={state.dagId}
              status={state.status}
              progress={state.progress}
              startTime={state.startTime}
              connected={state.connected}
            />
            <DAGView
              nodes={state.nodes}
              routeDecisions={state.routeDecisions}
            />
            <CostBar totalCost={state.totalCost} />
          </div>
        </div>

        {/* Right panel: Event log */}
        <div className="w-[420px] flex-shrink-0 border-l border-gray-800 bg-gray-900/30 flex flex-col">
          <EventLog events={state.events} />
        </div>
      </div>
    </div>
  );
}
