import type { CostSummary } from '../lib/types';

interface Props {
  totalCost: CostSummary;
}

export function CostBar({ totalCost }: Props) {
  if (totalCost.calls === 0) return null;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-gray-900 border-t border-gray-800 rounded-b-lg text-xs">
      {/* Total cost */}
      <div className="flex items-center gap-1.5">
        <span className="text-gray-500">Cost:</span>
        <span className="font-mono text-emerald-400 font-semibold">
          {totalCost.costCents.toFixed(2)}¢
        </span>
      </div>

      {/* Token counts */}
      <div className="flex items-center gap-1.5">
        <span className="text-gray-500">Tokens:</span>
        <span className="font-mono text-gray-300">
          {formatTokens(totalCost.inputTokens)}
          <span className="text-gray-600"> in</span>
          {' / '}
          {formatTokens(totalCost.outputTokens)}
          <span className="text-gray-600"> out</span>
        </span>
      </div>

      {/* API calls */}
      <div className="flex items-center gap-1.5">
        <span className="text-gray-500">Calls:</span>
        <span className="font-mono text-gray-300">{totalCost.calls}</span>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
