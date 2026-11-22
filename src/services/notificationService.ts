/**
 * Telegram Bot Notification Routing Service
 *
 * Dispatches trade execution, Auto-Pilot signals, TP1-4/SL hits, and kill-switch alerts
 * directly through the backend server-side Telegram relay (POST /api/notifications/dispatch)
 * to the configured Telegram Bot and Chat ID.
 */

export type TelegramNotificationPriority = 'high' | 'default' | 'low';

export interface MobileNotificationConfig {
  ntfyTopic?: string;
  telegramBotToken: string;
  telegramChatId: string;
  priority?: TelegramNotificationPriority;
  lowImpactNewsPriority: TelegramNotificationPriority;
  webhookUrl?: string;
  whatsappNumber?: string;
  enabledEvents: {
    fills: boolean;
    tpSl: boolean;
    autoPilot: boolean;
    killSwitch: boolean;
    staleSignals: boolean;
  };
}

export interface MobileDispatchChannelResult {
  configured: boolean;
  ok: boolean;
  status: number;
  message: string;
  priority?: TelegramNotificationPriority;
  disable_notification?: boolean;
  silent?: boolean;
  topic?: string;
}

export interface MobileDispatchResponse {
  success: boolean;
  priority?: TelegramNotificationPriority;
  disable_notification?: boolean;
  silent?: boolean;
  dispatchedAt: number;
  channels: {
    ntfy?: MobileDispatchChannelResult;
    telegram: MobileDispatchChannelResult;
    webhook?: MobileDispatchChannelResult;
  };
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export interface MobileAlertPayload {
  title: string;
  message: string;
  htmlMessage?: string;
  type?: 'INFO' | 'TRADE' | 'RISK' | 'AI';
  priority?: TelegramNotificationPriority | 'urgent' | 'normal' | 'silent' | 'min';
  impactLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  tags?: string;
  eventKey?: 'fills' | 'tpSl' | 'autoPilot' | 'killSwitch' | 'staleSignals';
  mode?: 'LIVE' | 'PAPER' | string;
  isPaper?: boolean;
  category?: 'TRADE' | 'POSITION' | 'SIGNAL' | 'SENTIMENT' | 'HEADLINE' | 'SYSTEM' | 'RISK' | 'MARKET_INTELLIGENCE';
  fingerprint?: string;
  milestoneKey?: string;
  contractSymbol?: string;
  stageOrEventType?: string;
  test?: boolean;
  overrideConfig?: Partial<MobileNotificationConfig>;
}

export const DEFAULT_NOTIFICATION_CONFIG: MobileNotificationConfig = {
  ntfyTopic: '',
  telegramBotToken: '',
  telegramChatId: '',
  priority: 'default',
  lowImpactNewsPriority: 'low',
  webhookUrl: '',
  whatsappNumber: '',
  enabledEvents: {
    fills: true,
    tpSl: true,
    autoPilot: true,
    killSwitch: true,
    staleSignals: true,
  },
};

/**
 * Generate a randomized topic identifier for ntfy.sh
 */
export function generateNtfyTopic(): string {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `deltaai-dhanraj-${rand}`;
}

/**
 * Retrieve current server-side notification configuration
 */
export async function fetchMobileNotificationConfig(sessionToken?: string | null): Promise<MobileNotificationConfig> {
  try {
    const res = await fetch('/api/notifications/config', {
      headers: {
        'x-admin-email': 'dhanrajk69@gmail.com',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.config) {
        return {
          ...DEFAULT_NOTIFICATION_CONFIG,
          ...data.config,
          enabledEvents: {
            ...DEFAULT_NOTIFICATION_CONFIG.enabledEvents,
            ...(data.config.enabledEvents || {}),
          },
        };
      }
    }
  } catch (err) {
    console.warn('[NotificationService] Failed to fetch server notification config:', err);
  }
  return DEFAULT_NOTIFICATION_CONFIG;
}

/**
 * Persist notification configuration to VM backend storage
 */
export async function saveMobileNotificationConfig(
  config: Partial<MobileNotificationConfig>,
  sessionToken?: string | null
): Promise<{ success: boolean; config: MobileNotificationConfig }> {
  try {
    const res = await fetch('/api/notifications/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-email': 'dhanrajk69@gmail.com',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    return {
      success: res.ok && data.success,
      config: data.config || { ...DEFAULT_NOTIFICATION_CONFIG, ...config },
    };
  } catch (err: any) {
    console.error('[NotificationService] Failed to save notification config:', err);
    return {
      success: false,
      config: { ...DEFAULT_NOTIFICATION_CONFIG, ...config },
    };
  }
}

/**
 * Dispatch mobile alert via Server-Side Push Relay
 */
export async function dispatchMobileAlert(
  payload: MobileAlertPayload,
  sessionToken?: string | null
): Promise<MobileDispatchResponse> {
  try {
    const res = await fetch('/api/notifications/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-email': 'dhanrajk69@gmail.com',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const data: MobileDispatchResponse = await res.json().catch(() => ({
      success: false,
      dispatchedAt: Date.now(),
      channels: {
        ntfy: { configured: false, ok: false, status: res.status, message: `HTTP ${res.status}` },
        telegram: { configured: false, ok: false, status: 0, message: 'Parse error' },
        webhook: { configured: false, ok: false, status: 0, message: 'Parse error' },
      },
    }));

    return data;
  } catch (err: any) {
    console.warn('[NotificationService] Mobile push dispatch request failed:', err?.message);
    return {
      success: false,
      dispatchedAt: Date.now(),
      channels: {
        ntfy: { configured: false, ok: false, status: 0, message: err?.message || 'Network error' },
        telegram: { configured: false, ok: false, status: 0, message: err?.message || 'Network error' },
        webhook: { configured: false, ok: false, status: 0, message: err?.message || 'Network error' },
      },
      error: err?.message || 'Network request failed',
    };
  }
}
