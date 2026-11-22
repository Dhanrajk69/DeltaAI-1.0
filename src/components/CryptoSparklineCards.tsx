import React from 'react';
import { MarketTicker } from '../types';

interface CryptoSparklineCardsProps {
  markets: Record<string, MarketTicker>;
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  currencyPrefix: string;
  exchangeRate: number;
}

interface AssetConfig {
  symbol: string;
  name: string;
  strokeColor: string;
  gradientId: string;
  gradientFrom: string;
  gradientTo: string;
  dotColor: string;
  basePriceUsd: number;
  points: number[];
}

export const CryptoSparklineCards: React.FC<CryptoSparklineCardsProps> = ({
  markets,
  selectedSymbol,
  onSelectSymbol,
  currencyPrefix,
  exchangeRate,
}) => {
  const assets: AssetConfig[] = [
    {
      symbol: 'BTCUSDT',
      name: 'Bitcoin',
      strokeColor: '#38bdf8', // Neon Sky/Cyan
      gradientId: 'sparkline-btc',
      gradientFrom: 'rgba(56, 189, 248, 0.45)',
      gradientTo: 'rgba(56, 189, 248, 0.0)',
      dotColor: '#e0f2fe',
      basePriceUsd: 81702.50,
      points: [35, 38, 25, 45, 20, 28, 50, 48, 30, 22, 18, 32, 28, 15],
    },
    {
      symbol: 'ETHUSDT',
      name: 'Ethereum',
      strokeColor: '#c084fc', // Neon Purple/Violet
      gradientId: 'sparkline-eth',
      gradientFrom: 'rgba(192, 132, 252, 0.45)',
      gradientTo: 'rgba(192, 132, 252, 0.0)',
      dotColor: '#f3e8ff',
      basePriceUsd: 2184.20,
      points: [40, 32, 38, 22, 30, 15, 25, 35, 48, 42, 28, 20, 18, 12],
    },
    {
      symbol: 'SOLUSDT',
      name: 'Solana',
      strokeColor: '#f43f5e', // Vibrant Coral/Rose
      gradientId: 'sparkline-sol',
      gradientFrom: 'rgba(244, 63, 94, 0.45)',
      gradientTo: 'rgba(244, 63, 94, 0.0)',
      dotColor: '#ffe4e6',
      basePriceUsd: 142.80,
      points: [20, 25, 35, 48, 52, 40, 32, 28, 45, 50, 38, 26, 19, 14],
    },
    {
      symbol: 'XRPUSDT',
      name: 'XRP',
      strokeColor: '#a855f7', // Radiant Indigo/Purple
      gradientId: 'sparkline-xrp',
      gradientFrom: 'rgba(168, 85, 247, 0.45)',
      gradientTo: 'rgba(168, 85, 247, 0.0)',
      dotColor: '#faf5ff',
      basePriceUsd: 2.15,
      points: [45, 40, 32, 28, 38, 20, 10, 22, 30, 35, 42, 30, 20, 16],
    },
  ];

  // Helper to render smooth SVG wave with glow dot
  const renderSparkline = (points: number[], stroke: string, gradId: string, gradFrom: string, gradTo: string, dotColor: string) => {
    const width = 140;
    const height = 55;
    const maxVal = Math.max(...points);
    const minVal = Math.min(...points);
    const range = Math.max(1, maxVal - minVal);

    const coords = points.map((val, idx) => {
      const x = (idx / (points.length - 1)) * (width - 12) + 6;
      const y = height - 10 - ((val - minVal) / range) * (height - 20);
      return { x, y };
    });

    // Create cubic bezier curve command
    let pathD = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i === 0 ? 0 : i - 1];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    const areaD = `${pathD} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`;

    // Apex highlight dot (index with highest peak, i.e., lowest y)
    let minIdx = 0;
    for (let i = 1; i < coords.length; i++) {
      if (coords[i].y < coords[minIdx].y) {
        minIdx = i;
      }
    }
    const apex = coords[minIdx];

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-14 overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradFrom} />
            <stop offset="100%" stopColor={gradTo} />
          </linearGradient>
          <filter id={`glow-${gradId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Gradient Fill under the wave */}
        <path d={areaD} fill={`url(#${gradId})`} />

        {/* Glowing Spline Line */}
        <path
          d={pathD}
          fill="none"
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#glow-${gradId})`}
        />

        {/* Apex Luminous Marker Dot */}
        <circle cx={apex.x} cy={apex.y} r="4" fill={dotColor} stroke={stroke} strokeWidth="1.5" />
        <circle cx={apex.x} cy={apex.y} r="7" fill={stroke} fillOpacity="0.3" className="animate-pulse" />
      </svg>
    );
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 w-full">
      {assets.map((asset) => {
        const isSelected = selectedSymbol === asset.symbol || selectedSymbol.replace(/USDT$/, 'USD') === asset.symbol.replace(/USDT$/, 'USD');
        const ticker =
          markets[asset.symbol] ||
          markets[asset.symbol.replace(/USDT$/, 'USD')] ||
          markets[`${asset.symbol.replace(/USDT$/, '')}INR`];

        const markPriceUsd = ticker?.markPrice || asset.basePriceUsd;
        const change24h = ticker?.change24h !== undefined ? ticker.change24h : 1.25;
        const isPositive = change24h >= 0;

        // INR & USD calculation (standardized ₹85.00/USD)
        const displayPriceInr = (markPriceUsd * 85.0).toLocaleString(undefined, {
          maximumFractionDigits: markPriceUsd < 10 ? 2 : 0,
        });
        const displayPriceUsd = markPriceUsd.toLocaleString(undefined, {
          maximumFractionDigits: markPriceUsd < 10 ? 3 : 2,
        });

        return (
          <button
            key={asset.symbol}
            onClick={() => onSelectSymbol(asset.symbol)}
            type="button"
            className={`text-left rounded-2xl p-3.5 transition-all duration-200 cursor-pointer relative overflow-hidden group ${
              isSelected
                ? 'bg-[#101736]/90 border border-cyan-400/50 shadow-[0_0_24px_rgba(6,182,212,0.22)]'
                : 'bg-[#0d1226]/80 hover:bg-[#111732]/90 border border-slate-800/80 hover:border-slate-700/80 shadow-lg'
            }`}
          >
            {/* Ambient Background Gradient Glow on Hover/Active */}
            <div
              className={`absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl pointer-events-none transition-opacity duration-300 ${
                isSelected ? 'opacity-30' : 'opacity-0 group-hover:opacity-15'
              }`}
              style={{ background: asset.strokeColor }}
            />

            {/* Asset Header */}
            <div className="flex items-center justify-between mb-1 relative z-10">
              <span className="text-xs font-semibold text-slate-300 group-hover:text-white transition-colors">
                {asset.name}
              </span>
              <span className="text-[10px] font-mono text-slate-500 font-medium">
                {asset.symbol.replace('USDT', '')}
              </span>
            </div>

            {/* Wave Sparkline Chart */}
            <div className="my-1.5 relative z-10">
              {renderSparkline(
                asset.points,
                asset.strokeColor,
                asset.gradientId,
                asset.gradientFrom,
                asset.gradientTo,
                asset.dotColor
              )}
            </div>

            {/* Price & Change Pill */}
            <div className="mt-1 relative z-10 flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-sm lg:text-base font-bold font-mono-numbers text-white tracking-tight">
                  {currencyPrefix === '₹' ? `₹${displayPriceInr}` : `$${displayPriceUsd}`}
                </span>
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full font-mono-numbers border ${
                    isPositive
                      ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                      : 'bg-rose-950/80 border-rose-500/40 text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.2)]'
                  }`}
                >
                  <span>{isPositive ? '▲ +' : '▼ '}</span>
                  <span>{Math.abs(change24h).toFixed(2)}%</span>
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {currencyPrefix === '₹' ? `≈ $${displayPriceUsd}` : `≈ ₹${displayPriceInr}`}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
};
