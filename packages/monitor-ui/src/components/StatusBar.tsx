import { useEffect, useState } from 'react';
import type { UIState } from '../lib/types';

const STATUS_COLORS: Record<UIState['status'], string> = {
  idle: 'bg-gray-600',
  running: 'bg-blue-500 animate-pulse-fast',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-amber-500',
};

const STATUS_LABELS: Record<UIState['status'], string> = {
  idle: 'Idle',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

interface Props {
  dagId: string;
  status: UIState['status'];
  progress: UIState['progress'];
  startTime: number;
  connected: boolean;
}

export function StatusBar({ dagId, status, progress, startTime, connected }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'running' || startTime === 0) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, startTime]);

  const progressPct = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-gray-900 border-b border-gray-800 rounded-t-lg">
      {/* Connection indicator */}
      <div
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          connected ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'
        }`}
        title={connected ? 'Connected' : 'Disconnected'}
      />

      {/* DAG ID */}
      <div className="text-sm font-mono text-gray-400 truncate max-w-40">
        {dagId || 'No DAG'}
      </div>

      {/* Status badge */}
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold text-white ${STATUS_COLORS[status]}`}>
        {STATUS_LABELS[status]}
      </span>

      {/* Progress bar */}
      {progress.total > 0 && (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 font-mono whitespace-nowrap">
            {progress.completed}/{progress.total}
          </span>
        </div>
      )}

      {/* Elapsed time */}
      {status === 'running' && (
        <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
          {elapsed}s
        </span>
      )}
    </div>
  );
}
