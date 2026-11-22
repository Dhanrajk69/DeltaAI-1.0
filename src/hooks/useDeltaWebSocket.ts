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
  const [gatewayUrl, setGatewayUrl] = useState<string>('Local Relay (/ws/delta)');
  const [priceFlashing, setPriceFlashing] = useState<Record<string, 'UP' | 'DOWN'>>({});
  const [lastTickTimestamp, setLastTickTimestamp] = useState<number>(Date.now());
  const [lastCandleTimestamp, setLastCandleTimestamp] = useState<number>(Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const pingStartRef = useRef<number>(0);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const prevPricesRef = useRef<Record<string, number>>({});
  const lastPacketTimestampRef = useRef<number>(0);
  const lastPacketArrivalRef = useRef<number>(0);
  const latestGapRef = useRef<number>(350);
  const lastSymTimestampRef = useRef<Record<string, number>>({});

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

  // Connect function
  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;

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

    setStatus('CONNECTING');

    // Build WebSocket URL: prefer local relay /ws/delta which bridges upstream Delta India
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/delta`;
    setGatewayUrl(wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('CONNECTED');

        // Subscribe to live tickers
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
                name: 'l2_orderbook',
                symbols: ['BTCUSD', 'BTCUSDT'],
              },
            ],
          },
        };
        ws.send(JSON.stringify(subscribePayload));

        // Start periodic ping/pong for RTT latency measurement
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

          // Handle pong latency immediately (12s interval)
          if (data.type === 'pong' && pingStartRef.current > 0) {
            const rtt = Date.now() - pingStartRef.current;
            setLatency(Math.max(8, rtt));
          }

          // Handle handshake
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

          // Handle ticker & markPrice updates (force priority on incoming WebSocket packets)
          const isTickerPacket = (
            data.type === 'v2/ticker' ||
            data.channel === 'v2/ticker' ||
            data.type === 'ticker' ||
            data.mark_price !== undefined ||
            data.markPrice !== undefined
          ) && data.symbol;

          if (isTickerPacket) {
            const sym = data.symbol;
            const rawMark = data.mark_price ?? data.markPrice ?? data.close ?? data.price ?? data.last_price;
            const newPrice = Number(rawMark || 0);
            const rawIndex = data.index_price ?? data.indexPrice ?? data.spot_price;
            const newIndex = rawIndex !== undefined ? Number(rawIndex) : undefined;

            // Compute timestamp gap between incoming WebSocket price packets in milliseconds
            const nowTime = Date.now();
            if (lastPacketArrivalRef.current > 0) {
              const delta = nowTime - lastPacketArrivalRef.current;
              latestGapRef.current = Math.min(2500, Math.max(12, delta));
            } else {
              latestGapRef.current = 85;
            }
            lastPacketArrivalRef.current = nowTime;
            pendingLastTickRef.current = nowTime;
            pendingLastCandleRef.current = Math.floor(nowTime / (5 * 60 * 1000)) * (5 * 60 * 1000);

            // Track per-symbol gap
            if (sym) {
              const prevSymArrival = lastSymTimestampRef.current[sym] || nowTime;
              const symDelta = nowTime - prevSymArrival;
              if (symDelta > 0 && symDelta < 60000) {
                pendingSymGapsRef.current[sym] = Math.min(2500, Math.max(12, symDelta));
              }
              lastSymTimestampRef.current[sym] = nowTime;
            }

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
                change24h: data.change24h !== undefined ? Number(data.change24h) : data.mark_change_24h !== undefined ? Number(data.mark_change_24h) : undefined,
                timestamp: typeof data.timestamp === 'number' && data.timestamp > 0 ? data.timestamp : nowTime,
              });
            }
          }

          // Buffer sliding message log (last 20 messages) for batched flush
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
          // ignore parse error
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
        // Automatic reconnection after 3.5s
        reconnectTimeoutRef.current = setTimeout(() => {
          setStatus('RECONNECTING');
          connect();
        }, 3500);
      };
    } catch {
      setStatus('DISCONNECTED');
      setPacketGap(9999);
      reconnectTimeoutRef.current = setTimeout(connect, 4000);
    }
  }, [onTickerUpdate]);

  const disconnect = useCallback(() => {
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
