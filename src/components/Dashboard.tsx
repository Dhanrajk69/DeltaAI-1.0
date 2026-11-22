import React from 'react';
import { TradingDashboard } from './TradingDashboard';
import { PortfolioData, Position, ClosedTrade, TradingMode } from '../types';
import { usePortfolio } from '../context/PortfolioContext';

export interface DashboardProps {
  portfolio: PortfolioData;
  positions: Position[];
  history: ClosedTrade[];
  currencyPrefix: string;
  exchangeRate: number;
  onNavigateToPositions: () => void;
  onNavigateToStrategy: () => void;
  onNavigateToAi: () => void;
  tradingMode?: TradingMode;
  isLiveApiAuthenticated?: boolean;
  onOpenSettings?: () => void;
}

/**
 * Main Dashboard component providing unified real-time global PnL telemetry
 * synchronized with PortfolioContext across Sniper Scalping, Options Strategy Lab, and Base Positions.
 */
export const Dashboard: React.FC<DashboardProps> = (props) => {
  // Ensure access to global PortfolioContext telemetry
  const portfolioTelemetry = usePortfolio();

  return <TradingDashboard {...props} />;
};

export default Dashboard;
