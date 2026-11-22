import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    const msg = error?.message || String(error || '');
    // If it's the cross-origin iframe security error or React 19 scheduling collision,
    // we do not want to crash the whole application
    if (
      msg.includes('cross-origin frame') ||
      msg.includes('Blocked a frame with origin') ||
      msg.includes('Should not already be working')
    ) {
      return { hasError: false, errorMessage: '' };
    }
    return { hasError: true, errorMessage: msg };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const msg = error?.message || String(error || '');
    if (
      msg.includes('cross-origin frame') ||
      msg.includes('Blocked a frame with origin') ||
      msg.includes('Should not already be working')
    ) {
      // Benign iframe / profiler artifact - ignore
      return;
    }
    console.error('[DeltaAI] UI Error caught by boundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#070b12] text-slate-200 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0d131f] border border-red-500/30 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Terminal Rendering Alert</h3>
                <p className="text-xs text-slate-400">Application encountered a recoverable view exception</p>
              </div>
            </div>

            <div className="p-3 bg-[#080d16] border border-slate-800 rounded text-xs font-mono text-red-400 break-words">
              {this.state.errorMessage || 'Unknown rendering anomaly'}
            </div>

            <button
              onClick={this.handleReset}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Restore Live Terminal
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
