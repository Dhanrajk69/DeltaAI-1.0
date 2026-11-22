/**
 * Telegram Notification Service
 *
 * Strictly routes Telegram alerts and connectivity verification through the secure
 * server-side relay (/api/notifications/telegram/test & /api/notifications/dispatch)
 * so Bot Tokens never leave the server boundary in direct browser requests.
 */

import type { TelegramNotificationPriority } from './notificationService';

export interface TelegramTestVerificationResult {
  success: boolean;
  status?: number;
  botUsername?: string | null;
  botFirstName?: string | null;
  chatId?: string;
  messageId?: number | null;
  latencyMs?: number;
  verifiedAt?: string;
  description: string;
}

export interface TelegramAlertOptions {
  title?: string;
  priority?: TelegramNotificationPriority | 'urgent' | 'normal' | 'silent' | 'min';
  impactLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  mode?: 'LIVE' | 'PAPER' | string;
  isPaper?: boolean;
  category?: 'TRADE' | 'POSITION' | 'SIGNAL' | 'SENTIMENT' | 'HEADLINE' | 'SYSTEM' | 'RISK' | 'MARKET_INTELLIGENCE';
  eventKey?: 'fills' | 'tpSl' | 'autoPilot' | 'killSwitch' | 'staleSignals';
  fingerprint?: string;
  milestoneKey?: string;
  contractSymbol?: string;
  stageOrEventType?: string;
}

export const sendTelegramAlert = async (
  message: string,
  botToken: string,
  chatId: string,
  sessionToken?: string | null,
  options?: TelegramAlertOptions
) => {
  // Strict LIVE-only policy: drop any PAPER mode notification immediately
  if (options?.isPaper === true || String(options?.mode || '').toUpperCase() === 'PAPER') {
    return {
      success: true,
      skipped: true,
      description: 'Skipped: PAPER mode notifications are blocked (LIVE-only policy)',
    };
  }

  const cleanToken = (botToken || '').trim();
  const cleanChat = (chatId || '').trim();
  if (!cleanToken || !cleanChat) {
    return { success: false, description: 'Missing Bot Token or Chat ID' };
  }

  try {
    const res = await fetch('/api/notifications/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-email': 'dhanrajk69@gmail.com',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({
        title: options?.title || 'DeltaAI Trade Alert',
        message,
        type: 'TRADE',
        priority: options?.priority,
        impactLevel: options?.impactLevel,
        mode: options?.mode || 'LIVE',
        isPaper: false,
        category: options?.category,
        eventKey: options?.eventKey,
        fingerprint: options?.fingerprint,
        milestoneKey: options?.milestoneKey,
        contractSymbol: options?.contractSymbol,
        stageOrEventType: options?.stageOrEventType,
        overrideConfig: {
          telegramBotToken: cleanToken,
          telegramChatId: cleanChat,
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      if (data.skipped) {
        return {
          success: true,
          skipped: true,
          description: data.reason || 'Skipped by server change-detection gate',
        };
      }
      return {
        success: Boolean(data.channels?.telegram?.ok),
        description: data.channels?.telegram?.message || 'Dispatched via server relay',
      };
    }
    return {
      success: false,
      description: data?.channels?.telegram?.message || data?.error || `Server HTTP ${res.status}`,
    };
  } catch (err: any) {
    console.error('[TelegramRelay] Server dispatch failed:', err);
    return { success: false, description: err?.message || 'Server relay network error' };
  }
};

export const testTelegramConnection = async (
  botToken: string,
  chatId: string,
  enabledEvents?: Record<string, boolean>,
  sessionToken?: string | null,
  lowImpactNewsPriority?: TelegramNotificationPriority
): Promise<TelegramTestVerificationResult> => {
  const cleanToken = (botToken || '').trim();
  const cleanChat = (chatId || '').trim();
  if (!cleanToken || !cleanChat) {
    return {
      success: false,
      description: 'Please enter both Telegram Bot Token and Telegram Chat ID',
    };
  }

  try {
    const res = await fetch('/api/notifications/telegram/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-email': 'dhanrajk69@gmail.com',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({
        telegramBotToken: cleanToken,
        telegramChatId: cleanChat,
        ...(enabledEvents ? { enabledEvents } : {}),
        ...(lowImpactNewsPriority ? { lowImpactNewsPriority } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (data) {
      return {
        success: Boolean(res.ok && data.success),
        status: data.status || res.status,
        botUsername: data.botUsername ?? null,
        botFirstName: data.botFirstName ?? null,
        chatId: data.chatId || cleanChat,
        messageId: data.messageId ?? null,
        latencyMs: data.latencyMs,
        verifiedAt: data.verifiedAt,
        description:
          data.message ||
          data.channels?.telegram?.message ||
          (res.ok ? 'Telegram connectivity verified' : `HTTP ${res.status}`),
      };
    }
    return {
      success: false,
      status: res.status,
      description: `Server returned HTTP ${res.status}`,
    };
  } catch (err: any) {
    console.error('[TelegramRelay] Server connectivity verification failed:', err);
    return {
      success: false,
      description: err?.message || 'Network error while verifying Telegram connectivity',
    };
  }
};
