import { useState, useEffect, useRef, useCallback } from 'react';
import { MarketTicker } from '../types';

export type WsConnectionStatus = 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED';

export interface WsMessageLog {
  id: string;
  time: string;
  type: string;
  symbol?: string;
  payload: any;
}

interface UseDeltaWebSocketOptions {
  onTickerUpdate?: (ticker: Partial<MarketTicker> & { symbol: string; timestamp?: number }) => void;
  autoConnect?: boolean;
}

export function useDeltaWebSocket(options: UseDeltaWebSocketOptions = {}) {
  const { onTickerUpdate, autoConnect = true } = options;

  const [status, setStatus] = useState<WsConnectionStatus>('CONNECTING');
  const [latency, setLatency] = useState<number>(18);
  const [packetGap, setPacketGap] = useState<number>(350);
  const [symbolPacketGaps, setSymbolPacketGaps] = useState<Record<string, number>>({});
  const [messageCount, setMessageCount] = useState<number>(0);
  const lastMessageRef = useRef<any>(null);
  const [messageLogs, setMessageLogs] = useState<WsMessageLog[]>([]);
  const [gatewayUrl, setGatewayUrl] = useState<string>('wss://socket.india.delta.exchange (via /ws/delta)');
  const [priceFlashing, setPriceFlashing] = useState<Record<string, 'UP' | 'DOWN'>>({});
  const [lastTickTimestamp, setLastTickTimestamp] = useState<number>(Date.now());
  const [lastCandleTimestamp, setLastCandleTimestamp] = useState<number>(Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const pingStartRef = useRef<number>(0);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const manualDisconnectRef = useRef<boolean>(false);
  const flashTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const prevPricesRef = useRef<Record<string, number>>({});
  const lastPacketArrivalRef = useRef<number>(0);
  const latestGapRef = useRef<number>(350);
  const lastSymTimestampRef = useRef<Record<string, number>>({});
  const lastResyncBroadcastAtRef = useRef<number>(0);

  // Telemetry accumulators flushed to React state on a 250ms cadence to avoid per-packet re-render storms
  const pendingMsgCountRef = useRef<number>(0);
  const pendingSymGapsRef = useRef<Record<string, number>>({});
  const pendingLogsRef = useRef<WsMessageLog[]>([]);
  const pendingLastTickRef = useRef<number>(Date.now());
  const pendingLastCandleRef = useRef<number>(Date.now());
  const pendingDirtyRef = useRef<boolean>(false);

  const clearAllFlashTimeouts = useCallback(() => {
    for (const key of Object.keys(flashTimeoutsRef.current)) {
      clearTimeout(flashTimeoutsRef.current[key]);
      delete flashTimeoutsRef.current[key];
    }
  }, []);

  const dispatchAuthoritativeResync = useCallback((detail?: any) => {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    // Coalesce burst reconnect/auth frames within 400ms
    if (now - lastResyncBroadcastAtRef.current < 400 && !detail?.authenticated) {
      return;
    }
    lastResyncBroadcastAtRef.current = now;
    window.dispatchEvent(
      new CustomEvent('delta:ws-reconnected-resync', {
        detail: detail || { timestamp: now },
      })
    );
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    manualDisconnectRef.current = false;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    setStatus(reconnectAttemptRef.current > 0 ? 'RECONNECTING' : 'CONNECTING');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/delta`;
    setGatewayUrl(wsUrl);

    const scheduleExponentialReconnect = () => {
      if (manualDisconnectRef.current) return;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      const baseDelayMs = Math.min(30_000, 1000 * Math.pow(2, reconnectAttemptRef.current));
      const jitterMs = Math.floor(Math.random() * 350);
      reconnectAttemptRef.current = Math.min(reconnectAttemptRef.current + 1, 6);
      reconnectTimeoutRef.current = setTimeout(() => {
        setStatus('RECONNECTING');
        connect();
      }, baseDelayMs + jitterMs);
    };

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setStatus('CONNECTED');

        // Subscribe to public market channels (v2/ticker + candlesticks)
        const subscribePayload = {
          type: 'subscribe',
          payload: {
            channels: [
              {
                name: 'v2/ticker',
                symbols: [
                  'BTCUSD', 'BTCUSDT',
                  'ETHUSD', 'ETHUSDT',
                  'SOLUSD', 'SOLUSDT',
                  'XRPUSD', 'XRPUSDT',
                  'DOGEUSD', 'DOGEUSDT',
                  'AVAXUSD', 'AVAXUSDT',
                ],
              },
              {
                name: 'candlestick_1m',
                symbols: ['BTCUSD', 'ETHUSD', 'SOLUSD'],
              },
              {
                name: 'candlestick_5m',
                symbols: ['BTCUSD', 'ETHUSD', 'SOLUSD'],
              },
              {
                name: 'candlestick_15m',
                symbols: ['BTCUSD', 'ETHUSD', 'SOLUSD'],
              },
              {
                name: 'l2_orderbook',
                symbols: ['BTCUSD'],
              },
            ],
          },
        };
        ws.send(JSON.stringify(subscribePayload));

        // Immediately trigger full authoritative REST resync on every WebSocket open/reconnect
        dispatchAuthoritativeResync({ reason: 'ws_open', timestamp: Date.now() });

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            pingStartRef.current = Date.now();
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 12000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          pendingMsgCountRef.current += 1;
          lastMessageRef.current = data;

          if (data.type === 'pong' && pingStartRef.current > 0) {
            const rtt = Date.now() - pingStartRef.current;
            setLatency(Math.max(8, rtt));
          }

          if (data.type === 'ws_reconnected_resync') {
            dispatchAuthoritativeResync(data);
            return;
          }

          if (data.type === 'handshake') {
            if (data.upstreamUrl) {
              setGatewayUrl(`${data.upstreamUrl} (via /ws/delta)`);
            }
            if (Array.isArray(data.markets) && onTickerUpdate) {
              for (const m of data.markets) {
                if (m && m.symbol && m.markPrice) {
                  prevPricesRef.current[m.symbol] = Number(m.markPrice);
                  onTickerUpdate({
                    symbol: m.symbol,
                    markPrice: Number(m.markPrice),
                    indexPrice: m.indexPrice ? Number(m.indexPrice) : undefined,
                    high24h: m.high24h ? Number(m.high24h) : undefined,
                    low24h: m.low24h ? Number(m.low24h) : undefined,
                    volume24hUsd: m.volume24hUsd ? Number(m.volume24hUsd) : undefined,
                    fundingRate: m.fundingRate ? Number(m.fundingRate) : undefined,
                    nextFundingCountdown: m.nextFundingCountdown || undefined,
                    change24h: m.change24h !== undefined ? Number(m.change24h) : undefined,
                  });
                }
              }
            }
          }

          const msgType = String(data.type || data.channel || '').toLowerCase();

          // Live candlestick streams (candlestick_1m, candlestick_5m, candlestick_15m)
          if (msgType.startsWith('candlestick_')) {
            const nowTime = Date.now();
            pendingLastCandleRef.current = nowTime;
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('delta:ws-candle', { detail: data }));
            }
          }

          // Private authenticated channels: positions, orders, user_trades, margins
          if (msgType === 'positions' && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('delta:ws-positions', { detail: data }));
            window.dispatchEvent(new CustomEvent('delta:ws-trade-event', { detail: data }));
          } else if ((msgType === 'orders' || msgType === 'v2/orders') && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('delta:ws-orders', { detail: data }));
            window.dispatchEvent(new CustomEvent('delta:ws-trade-event', { detail: data }));
          } else if (
            (msgType === 'user_trades' || msgType === 'v2/user_trades' || msgType === 'fills' || msgType === 'v2/fills') &&
            typeof window !== 'undefined'
          ) {
            window.dispatchEvent(new CustomEvent('delta:ws-user-trades', { detail: data }));
            window.dispatchEvent(new CustomEvent('delta:ws-trade-event', { detail: data }));
          } else if (msgType === 'margins' && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('delta:ws-margins', { detail: data }));
          }

          // Public v2/ticker updates (Futures markPrice + Option Chain Greeks/IV)
          const isTickerPacket =
            (msgType === 'v2/ticker' ||
              msgType === 'ticker' ||
              data.mark_price !== undefined ||
              data.markPrice !== undefined) &&
            Boolean(data.symbol) &&
            msgType !== 'positions' &&
            msgType !== 'orders';

          if (isTickerPacket) {
            const sym = String(data.symbol);
            const upperSym = sym.toUpperCase();
            const isOptionContract = upperSym.startsWith('C-') || upperSym.startsWith('P-');
            const rawMark =
              data.mark_price ?? data.markPrice ?? data.close ?? data.quotes?.mark_price ?? data.price ?? data.last_price;
            const newPrice = Number(rawMark || 0);
            const rawIndex = data.index_price ?? data.indexPrice ?? data.spot_price;
            const newIndex = rawIndex !== undefined ? Number(rawIndex) : undefined;
            const nowTime = Date.now();

            if (lastPacketArrivalRef.current > 0) {
              const delta = nowTime - lastPacketArrivalRef.current;
              latestGapRef.current = Math.min(2500, Math.max(12, delta));
            } else {
              latestGapRef.current = 85;
            }
            lastPacketArrivalRef.current = nowTime;
            pendingLastTickRef.current = nowTime;

            if (sym) {
              const prevSymArrival = lastSymTimestampRef.current[sym] || nowTime;
              const symDelta = nowTime - prevSymArrival;
              if (symDelta > 0 && symDelta < 60000) {
                pendingSymGapsRef.current[sym] = Math.min(2500, Math.max(12, symDelta));
              }
              lastSymTimestampRef.current[sym] = nowTime;
            }

            if (isOptionContract || data.greeks) {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('delta:ws-option-ticker', {
                    detail: {
                      symbol: upperSym,
                      markPrice: newPrice,
                      spotPrice: newIndex,
                      greeks: data.greeks || null,
                      markVol: data.mark_vol !== undefined ? Number(data.mark_vol) : undefined,
                      quotes: data.quotes || null,
                      timestamp: typeof data.timestamp === 'number' && data.timestamp > 0 ? data.timestamp : nowTime,
                    },
                  })
                );
              }
            } else {
              if (newPrice > 0) {
                const oldPrice = prevPricesRef.current[sym] || newPrice;
                if (newPrice !== oldPrice) {
                  const dir = newPrice > oldPrice ? 'UP' : 'DOWN';
                  setPriceFlashing((prev) => (prev[sym] === dir ? prev : { ...prev, [sym]: dir }));
                  if (flashTimeoutsRef.current[sym]) {
                    clearTimeout(flashTimeoutsRef.current[sym]);
                  }
                  flashTimeoutsRef.current[sym] = setTimeout(() => {
                    delete flashTimeoutsRef.current[sym];
                    setPriceFlashing((prev) => {
                      if (!prev[sym]) return prev;
                      const copy = { ...prev };
                      delete copy[sym];
                      return copy;
                    });
                  }, 800);
                }
                prevPricesRef.current[sym] = newPrice;
              }

              if (onTickerUpdate) {
                onTickerUpdate({
                  symbol: sym,
                  markPrice: newPrice > 0 ? newPrice : undefined,
                  indexPrice: newIndex !== undefined && newIndex > 0 ? newIndex : undefined,
                  high24h: data.high24h ?? data.high ? Number(data.high24h || data.high) : undefined,
                  low24h: data.low24h ?? data.low ? Number(data.low24h || data.low) : undefined,
                  volume24hUsd: data.volume24hUsd ?? data.turnover_usd ? Number(data.volume24hUsd || data.turnover_usd) : undefined,
                  fundingRate: data.fundingRate ?? data.funding_rate ? Number(data.fundingRate || data.funding_rate) : undefined,
                  nextFundingCountdown: data.nextFundingCountdown || data.next_funding_countdown || undefined,
                  change24h:
                    data.change24h !== undefined
                      ? Number(data.change24h)
                      : data.mark_change_24h !== undefined
                      ? Number(data.mark_change_24h)
                      : undefined,
                  timestamp: typeof data.timestamp === 'number' && data.timestamp > 0 ? data.timestamp : nowTime,
                });
              }

              if (typeof window !== 'undefined' && newPrice > 0) {
                window.dispatchEvent(
                  new CustomEvent('delta:ws-ticker', {
                    detail: {
                      symbol: sym,
                      markPrice: newPrice,
                      indexPrice: newIndex,
                      timestamp: nowTime,
                    },
                  })
                );
              }
            }
          }

          pendingLogsRef.current.unshift({
            id: `ws-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            time: new Date().toLocaleTimeString(),
            type: data.type || data.channel || 'data',
            symbol: data.symbol,
            payload: data,
          });
          if (pendingLogsRef.current.length > 20) {
            pendingLogsRef.current.length = 20;
          }
          pendingDirtyRef.current = true;
        } catch {
          // ignore malformed frame
        }
      };

      ws.onerror = () => {
        setStatus('RECONNECTING');
        setPacketGap(9999);
      };

      ws.onclose = () => {
        setStatus('DISCONNECTED');
        setPacketGap(9999);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        scheduleExponentialReconnect();
      };
    } catch {
      setStatus('DISCONNECTED');
      setPacketGap(9999);
      scheduleExponentialReconnect();
    }
  }, [onTickerUpdate, dispatchAuthoritativeResync]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    clearAllFlashTimeouts();
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    setStatus('DISCONNECTED');
    setPacketGap(9999);
  }, [clearAllFlashTimeouts]);

  const sendManualPing = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      pingStartRef.current = Date.now();
      wsRef.current.send(JSON.stringify({ type: 'ping' }));
    }
  }, []);

  // Allow Options Lab & dynamic modules to subscribe option contract symbols on wss://socket.india.delta.exchange
  useEffect(() => {
    const handleOptionSub = (e: any) => {
      const symbols: string[] = Array.isArray(e?.detail?.symbols) ? e.detail.symbols : [];
      if (symbols.length > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'subscribe',
            payload: {
              channels: [{ name: 'v2/ticker', symbols }],
            },
          })
        );
      }
    };
    window.addEventListener('delta:ws-subscribe-options', handleOptionSub);
    return () => window.removeEventListener('delta:ws-subscribe-options', handleOptionSub);
  }, []);

  // Batched telemetry flush & real-time packet gap monitor (~250ms cadence)
  useEffect(() => {
    const gapTimer = setInterval(() => {
      if (status !== 'CONNECTED') {
        setPacketGap((prev) => (prev === 9999 ? prev : 9999));
      } else {
        if (lastPacketArrivalRef.current > 0) {
          const elapsed = Date.now() - lastPacketArrivalRef.current;
          const nextGap = elapsed > latestGapRef.current ? elapsed : latestGapRef.current;
          setPacketGap(nextGap);
        } else {
          setPacketGap(latestGapRef.current);
        }
      }

      if (pendingDirtyRef.current) {
        pendingDirtyRef.current = false;
        if (pendingMsgCountRef.current > 0) {
          const delta = pendingMsgCountRef.current;
          pendingMsgCountRef.current = 0;
          setMessageCount((prev) => prev + delta);
        }
        setLastTickTimestamp(pendingLastTickRef.current);
        setLastCandleTimestamp(pendingLastCandleRef.current);
        const gapUpdates = pendingSymGapsRef.current;
        if (Object.keys(gapUpdates).length > 0) {
          pendingSymGapsRef.current = {};
          setSymbolPacketGaps((prev) => ({ ...prev, ...gapUpdates }));
        }
        if (pendingLogsRef.current.length > 0) {
          const logBatch = pendingLogsRef.current;
          pendingLogsRef.current = [];
          setMessageLogs((prev) => [...logBatch, ...prev].slice(0, 20));
        }
      }
    }, 250);
    return () => clearInterval(gapTimer);
  }, [status]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [connect, disconnect, autoConnect]);

  return {
    status,
    latency,
    packetGap,
    lastTickTimestamp,
    lastCandleTimestamp,
    symbolPacketGaps,
    messageCount,
    lastMessage: lastMessageRef.current,
    messageLogs,
    gatewayUrl,
    priceFlashing,
    reconnect: connect,
    disconnect,
    sendManualPing,
  };
}
