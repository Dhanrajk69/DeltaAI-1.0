import { useState, useEffect, useCallback, useRef } from 'react';
import { NewsSentimentRadarData } from '../types';

export function useNewsSentimentRadar() {
  const [radarData, setRadarData] = useState<NewsSentimentRadarData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const fetchSentiment = useCallback(async (force = false) => {
    if (force) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const url = `/api/ai/news-sentiment${force ? '?refresh=true' : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch sentiment radar`);
      }
      const json = await res.json();
      if (isMountedRef.current && json.data) {
        setRadarData(json.data);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to load news sentiment');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    isMountedRef.current = true;
    fetchSentiment(false);

    // Periodic background refresh every 3 minutes to respect API rate limits
    const interval = setInterval(() => {
      fetchSentiment(false);
    }, 180000);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchSentiment]);

  return {
    radarData,
    isLoading,
    isRefreshing,
    error,
    refreshRadar: () => fetchSentiment(true),
  };
}
