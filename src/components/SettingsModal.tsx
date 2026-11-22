import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TradingMode, DeltaApiCredentials } from '../types';
import { X, Key, ShieldCheck, Send, CheckCircle2, AlertCircle, Trash2, ShieldAlert, Volume2, VolumeX, Copy, Check, Lock, Unlock, Smartphone, Bell, RefreshCw } from 'lucide-react';
import { maskApiKey } from '../utils/securityClient';
import { useAuth, isValidGoogleClientId } from '../context/AuthContext';
import { testTelegramConnection, TelegramTestVerificationResult } from '../services/telegramNotificationService';
import { useVoiceAlerts, SOFT_FEMALE_VOICE_CADENCE } from '../hooks/useVoiceAlerts';
import { announceVoiceActivated } from '../utils/voiceAlert';
import { copyToClipboard } from '../utils/clipboardUtils';
import {
  fetchMobileNotificationConfig,
  saveMobileNotificationConfig,
  dispatchMobileAlert,
  generateNtfyTopic,
  MobileDispatchChannelResult,
  DEFAULT_NOTIFICATION_CONFIG,
} from '../services/notificationService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
  onSendTestNotification: (title: string, message: string) => void;
  apiCredentials?: DeltaApiCredentials;
  onSaveApiCredentials?: (creds: DeltaApiCredentials) => void;
  onClearApiCredentials?: () => void;
  sessionToken?: string;
  serverLiveGateEnabled?: boolean;
  onToggleServerLiveGate?: (unlocked: boolean, statusData?: any) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  tradingMode,
  setTradingMode,
  onSendTestNotification,
  apiCredentials,
  onSaveApiCredentials,
  onClearApiCredentials,
  sessionToken,
  serverLiveGateEnabled = false,
  onToggleServerLiveGate,
}) => {
  const {
    isAuthenticated,
    user,
    logout,
    loginDemo,
    customClientId,
    setCustomClientId,
    hasValidClientId,
  } = useAuth();
  const { voiceEnabled, setVoiceEnabled, selectedVoice } = useVoiceAlerts();
  const isMaskedValue = (val?: string | null): boolean => {
    const s = String(val || '').trim();
    if (!s) return false;
    return /^\*{4,}/.test(s) || /^•{4,}/.test(s) || s === '********';
  };
  const [apiKey, setApiKey] = useState(
    apiCredentials?.apiKey && !isMaskedValue(apiCredentials.apiKey) ? apiCredentials.apiKey : ''
  );
  // Never pre-fill API Secret with a masked token string when keys are already configured
  const [apiSecret, setApiSecret] = useState('');
  const [serverHasExistingKeys, setServerHasExistingKeys] = useState<boolean>(
    Boolean(apiCredentials?.isVerified && apiCredentials?.apiKey)
  );
  const [serverMaskedKey, setServerMaskedKey] = useState<string>(
    apiCredentials?.apiKey ? maskApiKey(apiCredentials.apiKey) : ''
  );
  const [environment, setEnvironment] = useState<'PROD' | 'TESTNET'>(apiCredentials?.environment || 'PROD');
  const [googleClientIdDraft, setGoogleClientIdDraft] = useState<string>(customClientId || '');
  const [originCopied, setOriginCopied] = useState<boolean>(false);
  const [clientIdSavedBadge, setClientIdSavedBadge] = useState<boolean>(false);
  const [botToken, setBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState<boolean>(false);
  const [whatsappProvider, setWhatsappProvider] = useState<'CALLMEBOT' | 'META'>('CALLMEBOT');
  const [whatsappPhone, setWhatsappPhone] = useState<string>('');
  const [whatsappApiKey, setWhatsappApiKey] = useState<string>('');
  const [whatsappRecipientPhone, setWhatsappRecipientPhone] = useState<string>('');
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState<string>('');
  const [whatsappAccessToken, setWhatsappAccessToken] = useState<string>('');
  const [whatsappTestResult, setWhatsappTestResult] = useState<{ ok: boolean; status: number; message: string } | null>(null);
  const [isTestingWhatsApp, setIsTestingWhatsApp] = useState<boolean>(false);
  const [cloudServerSyncInfo, setCloudServerSyncInfo] = useState<{
    savedToCloudServer: boolean;
    serverIp: string;
    savedAt: string;
    maskedKey: string;
    persistedChannels: string[];
  } | null>(null);
  const [ntfyTopic, setNtfyTopic] = useState<string>('deltaai-dhanraj-9842');
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [enabledEvents, setEnabledEvents] = useState(DEFAULT_NOTIFICATION_CONFIG.enabledEvents);
  const [lowImpactNewsPriority, setLowImpactNewsPriority] = useState<'low' | 'high'>(
    DEFAULT_NOTIFICATION_CONFIG.lowImpactNewsPriority === 'high' ? 'high' : 'low'
  );
  const [mobileTestResults, setMobileTestResults] = useState<{
    ntfy?: MobileDispatchChannelResult;
    telegram?: MobileDispatchChannelResult;
    webhook?: MobileDispatchChannelResult;
  } | null>(null);
  const [telegramVerificationResult, setTelegramVerificationResult] = useState<TelegramTestVerificationResult | null>(null);
  const [isTestingMobileAlert, setIsTestingMobileAlert] = useState<boolean>(false);
  const [copiedNtfyUrl, setCopiedNtfyUrl] = useState<boolean>(false);
  const [signatureOutput, setSignatureOutput] = useState<any | null>(null);
  const [testingSig, setTestingSig] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState<boolean>(false);
  const [togglingLiveGate, setTogglingLiveGate] = useState<boolean>(false);
  const [routingMode, setRoutingMode] = useState<'DUAL_STACK' | 'IPV4_ONLY' | 'IPV6_ONLY'>('DUAL_STACK');
  const [publicIpv4, setPublicIpv4] = useState<string>('34.47.205.98');
  const [publicIpv6, setPublicIpv6] = useState<string>('2600:1900:0:3803::700');
  const [diagnosticResult, setDiagnosticResult] = useState<any | null>(null);
  const [testingDiagnostic, setTestingDiagnostic] = useState<boolean>(false);
  const [copiedIpv4, setCopiedIpv4] = useState<boolean>(false);
  const [copiedIpv6, setCopiedIpv6] = useState<boolean>(false);
  const [copiedBoth, setCopiedBoth] = useState<boolean>(false);

  const authorizedOrigin = `http://${publicIpv4 || '34.47.205.98'}`;
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (isOpen) {
      setGoogleClientIdDraft(customClientId || '');
      // Never pre-fill API Secret with a masked token string; keep blank when already configured
      setApiSecret('');
      if (apiCredentials) {
        const keyStr = (apiCredentials.apiKey || '').trim();
        const secretStr = (apiCredentials.apiSecret || '').trim();
        const keyIsMasked = isMaskedValue(keyStr);
        setApiKey(keyIsMasked ? '' : keyStr);
        setEnvironment(apiCredentials.environment || 'PROD');
        if (keyStr.length >= 4 && (apiCredentials.isVerified || secretStr.length >= 8)) {
          setServerHasExistingKeys(true);
          setServerMaskedKey(keyIsMasked ? keyStr : maskApiKey(keyStr));
        }
      }
      setShowUnlockConfirm(false);
      setAuthError(null);
      setMobileTestResults(null);
      setTelegramVerificationResult(null);
      setWhatsappTestResult(null);

      fetch('/api/delta/config')
        .then(res => res.json())
        .then(data => {
          if (data.routingMode) setRoutingMode(data.routingMode);
          if (data.publicIpv4) setPublicIpv4(data.publicIpv4);
          if (data.publicIpv6) setPublicIpv6(data.publicIpv6);
        })
        .catch(() => {});

      fetch('/api/delta/auth-status')
        .then(res => res.json())
        .then(data => {
          if (data?.hasCredentials) {
            setServerHasExistingKeys(true);
            if (data.maskedKey) setServerMaskedKey(data.maskedKey);
          }
        })
        .catch(() => {});

      fetch('/api/delta/server-config', {
        headers: {
          ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
          'x-admin-email': 'dhanrajk69@gmail.com',
        },
      })
        .then(res => res.json())
        .then(data => {
          if (data.config) {
            const cfg = data.config;
            const hasSavedCreds = Boolean(
              data.hasExistingKeys ||
                cfg.hasApiSecret ||
                (cfg.apiKey && !isMaskedValue(cfg.apiKey)) ||
                cfg.maskedKey
            );
            if (hasSavedCreds) {
              setServerHasExistingKeys(true);
              if (cfg.maskedKey || data.maskedKey) {
                setServerMaskedKey(cfg.maskedKey || data.maskedKey);
              } else if (cfg.apiKey) {
                setServerMaskedKey(maskApiKey(cfg.apiKey));
              }
            }
            if (cfg.apiKey && !isMaskedValue(cfg.apiKey)) {
              setApiKey((prev) => prev || cfg.apiKey);
            }
            // Intentionally do NOT pre-fill apiSecret from server config
            if (cfg.environment) setEnvironment(cfg.environment);
            if (cfg.routingMode) setRoutingMode(cfg.routingMode);
            if (cfg.notificationConfig) {
              const nc = cfg.notificationConfig;
              if (nc.telegramBotToken) setBotToken(nc.telegramBotToken);
              if (nc.telegramChatId) setTelegramChatId(nc.telegramChatId);
              if (nc.enabledEvents) setEnabledEvents(nc.enabledEvents);
              if (nc.lowImpactNewsPriority === 'low' || nc.lowImpactNewsPriority === 'silent') {
                setLowImpactNewsPriority('low');
              } else if (nc.lowImpactNewsPriority === 'high' || nc.lowImpactNewsPriority === 'default') {
                setLowImpactNewsPriority('high');
              }
            }
          }
          if (data.serverIp) setPublicIpv4(data.serverIp);
        })
        .catch(() => {});

      fetchMobileNotificationConfig(sessionToken).then((cfg) => {
        if (cfg.telegramBotToken) setBotToken(cfg.telegramBotToken);
        if (cfg.telegramChatId) setTelegramChatId(cfg.telegramChatId);
        if (cfg.enabledEvents) setEnabledEvents(cfg.enabledEvents);
        if (cfg.lowImpactNewsPriority === 'low' || (cfg.lowImpactNewsPriority as string) === 'silent') {
          setLowImpactNewsPriority('low');
        } else if (cfg.lowImpactNewsPriority === 'high' || cfg.lowImpactNewsPriority === 'default') {
          setLowImpactNewsPriority('high');
        }
      });
    }
  }, [isOpen, apiCredentials, customClientId, sessionToken]);

  const handleUpdateRoutingMode = async (mode: 'DUAL_STACK' | 'IPV4_ONLY' | 'IPV6_ONLY') => {
    setRoutingMode(mode);
    try {
      await fetch('/api/delta/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ routingMode: mode }),
      });
    } catch {}
  };

  const handleTestIpDiagnostics = async () => {
    setTestingDiagnostic(true);
    setDiagnosticResult(null);
    try {
      const res = await fetch('/api/delta/ip-diagnostic', {
        headers: {
          ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
        },
      });
      const data = await res.json();
      setDiagnosticResult(data);
      if (data.publicIpv4) setPublicIpv4(data.publicIpv4);
      if (data.publicIpv6) setPublicIpv6(data.publicIpv6);
    } catch (e: any) {
      setDiagnosticResult({ error: e.message || 'Diagnostic request failed' });
    } finally {
      setTestingDiagnostic(false);
    }
  };

  const handleCopyText = async (text: string, type: 'ipv4' | 'ipv6' | 'both') => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (type === 'ipv4') {
      setCopiedIpv4(true);
      setTimeout(() => setCopiedIpv4(false), 2000);
      onSendTestNotification('IP Copied to Clipboard', `IPv4 ${text} copied for Delta Exchange whitelist.`);
    } else if (type === 'ipv6') {
      setCopiedIpv6(true);
      setTimeout(() => setCopiedIpv6(false), 2000);
      onSendTestNotification('IP Copied to Clipboard', `IPv6 ${text} copied for Delta Exchange whitelist.`);
    } else {
      setCopiedBoth(true);
      setTimeout(() => setCopiedBoth(false), 2000);
      onSendTestNotification('IPs Copied to Clipboard', `Both IPs (${text}) copied for Delta Exchange whitelist.`);
    }
  };

  if (!isOpen) return null;

  const trimmedDraftClientId = googleClientIdDraft.trim();
  const isDraftClientIdValid = isValidGoogleClientId(trimmedDraftClientId);

  const handleCopyOrigin = async () => {
    const textToCopy = authorizedOrigin || 'http://34.47.205.98';
    const ok = await copyToClipboard(textToCopy);
    if (ok) {
      setOriginCopied(true);
      setTimeout(() => setOriginCopied(false), 2000);
      onSendTestNotification('Origin Copied', `${textToCopy} copied to clipboard for Google Cloud Console.`);
    }
  };

  const handleApplyGoogleClientId = () => {
    setAuthError(null);
    if (trimmedDraftClientId && !isDraftClientIdValid) {
      setAuthError(
        'Invalid Google OAuth Web Client ID. Must end with .apps.googleusercontent.com (e.g., 1234567890-abcdef.apps.googleusercontent.com).'
      );
      return;
    }
    setCustomClientId(trimmedDraftClientId);
    setClientIdSavedBadge(true);
    setTimeout(() => setClientIdSavedBadge(false), 2000);
  };

  const isValidKeyFormat =
    apiKey.trim().length >= 8 &&
    !isMaskedValue(apiKey) &&
    !apiKey.trim().toLowerCase().startsWith('demo_') &&
    apiSecret.trim().length >= 8 &&
    !isMaskedValue(apiSecret) &&
    !apiSecret.trim().toLowerCase().startsWith('demo_');

  const isConfiguredLocally = Boolean(
    apiCredentials?.apiKey &&
    apiCredentials.apiKey.trim().length >= 4 &&
    !apiCredentials.apiKey.trim().toLowerCase().startsWith('demo_') &&
    (apiCredentials.isVerified ||
      (apiCredentials.apiSecret && apiCredentials.apiSecret.trim().length >= 8))
  );

  const hasExistingKeys = Boolean(serverHasExistingKeys || isConfiguredLocally);
  const hasValidCredentialsForGate = hasExistingKeys || isValidKeyFormat;

  // Ensure a valid 3-part HMAC session token before invoking session-protected endpoints
  const resolveValidSessionToken = async (): Promise<string> => {
    if (sessionToken && sessionToken.split('.').length === 3) {
      return sessionToken;
    }
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        if (data?.token && String(data.token).split('.').length === 3) {
          return String(data.token);
        }
      }
    } catch {}
    return sessionToken || '';
  };

  const handleToggleLiveGate = async (targetUnlock: boolean) => {
    setAuthError(null);
    const effectiveKey = (apiKey.trim() || apiCredentials?.apiKey || '').trim();
    const effectiveSecret = (apiSecret.trim() || apiCredentials?.apiSecret || '').trim();

    if (targetUnlock && (effectiveKey.length < 8 || effectiveSecret.length < 8)) {
      setAuthError('Valid Delta Exchange India API Key and API Secret (min 8 characters) are required to unlock the Live Execution Gate.');
      return;
    }

    setTogglingLiveGate(true);
    try {
      const res = await fetch('/api/delta/live-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-delta-live-unlocked': targetUnlock ? 'true' : 'false',
          'x-admin-email': 'dhanrajk69@gmail.com',
          Authorization: `Bearer ${sessionToken || 'admin-local-session-dhanrajk69'}`,
        },
        body: JSON.stringify({
          unlocked: targetUnlock,
          apiKey: effectiveKey,
          apiSecret: effectiveSecret,
          environment,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAuthError(data.error || 'Failed to update Live Execution Gate');
        return;
      }

      if (targetUnlock && onSaveApiCredentials && effectiveKey && effectiveSecret) {
        onSaveApiCredentials({
          apiKey: effectiveKey,
          apiSecret: effectiveSecret,
          environment,
          isVerified: true,
          verifiedAt: Date.now(),
        });
      }

      setShowUnlockConfirm(false);
      onToggleServerLiveGate?.(Boolean(data.serverLiveGateEnabled), data);
    } catch (e: any) {
      setAuthError(e.message || 'Unable to toggle Live Execution Gate');
    } finally {
      setTogglingLiveGate(false);
    }
  };

  const handleTestSignature = async () => {
    setAuthError(null);
    const trimmedKey = apiKey.trim();
    const trimmedSecret = apiSecret.trim();

    // If secret left blank while keys already exist on server, test the server's saved live connection directly
    if (!trimmedSecret && hasExistingKeys) {
      setTestingSig(true);
      try {
        const walletRes = await fetch(`/api/delta/wallet?_t=${Date.now()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-delta-environment': environment,
            'x-admin-email': 'dhanrajk69@gmail.com',
            ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
          },
        });
        const walletData = await walletRes.json().catch(() => null);
        if (walletData && (walletData.status === 'diagnostic_error' || walletData.status === 'error' || walletData.diagnosticError)) {
          const errMsg = walletData.diagnosticError?.message || walletData.error || 'Delta Exchange India rejected the saved server API credentials.';
          setAuthError(errMsg);
          onSendTestNotification?.('Delta Exchange India Connection Issue', errMsg);
          return;
        }
        const equity = walletData?.wallet?.totalEquity ?? 0;
        const available = walletData?.wallet?.availableMargin ?? 0;
        onSendTestNotification?.(
          'Delta Live Connection Verified',
          `Verified saved server credentials with Delta Exchange India. Total Equity: $${equity.toFixed(2)} · Available: $${available.toFixed(2)}`
        );
      } catch (e: any) {
        setAuthError(e.message || 'Live connection verification failed');
      } finally {
        setTestingSig(false);
      }
      return;
    }

    if (!isValidKeyFormat) {
      setAuthError('Please enter valid Delta Exchange India API Key and API Secret (min 8 characters, non-demo) for HMAC generation.');
      setSignatureOutput(null);
      return;
    }
    setTestingSig(true);
    try {
      const activeSessionToken = await resolveValidSessionToken();
      const [sigRes, walletRes] = await Promise.all([
        fetch('/api/delta/signature-test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-email': 'dhanrajk69@gmail.com',
            ...(activeSessionToken ? { 'Authorization': `Bearer ${activeSessionToken}` } : {}),
          },
          body: JSON.stringify({
            apiKey: trimmedKey,
            apiSecret: trimmedSecret,
            method: 'GET',
            path: '/v2/positions',
          }),
        }),
        fetch(`/api/delta/wallet?_t=${Date.now()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-email': 'dhanrajk69@gmail.com',
            'x-delta-api-key': trimmedKey,
            'x-delta-api-secret': trimmedSecret,
            'x-delta-environment': environment,
            ...(activeSessionToken ? { 'Authorization': `Bearer ${activeSessionToken}` } : {}),
          },
        }),
      ]);

      const data = await sigRes.json().catch(() => null);
      const walletData = await walletRes.json().catch(() => null);

      if (walletData && (walletData.status === 'diagnostic_error' || walletData.status === 'error' || walletData.diagnosticError)) {
        const errMsg = walletData.diagnosticError?.message || walletData.error || 'Delta Exchange India rejected the API credentials.';
        setAuthError(errMsg);
        onSendTestNotification?.('Delta Exchange India Connection Issue', errMsg);
        setSignatureOutput(null);
        return;
      }

      if (!sigRes.ok || data?.error) {
        setAuthError(data?.error || 'Failed to generate local HMAC signature');
        setSignatureOutput(null);
      } else {
        setSignatureOutput(data);
        setServerHasExistingKeys(true);
        setServerMaskedKey(maskApiKey(trimmedKey));
        const equity = walletData?.wallet?.totalEquity ?? 0;
        const available = walletData?.wallet?.availableMargin ?? 0;
        onSendTestNotification?.(
          'Delta Live Connection Verified',
          `Verified live connection with Delta Exchange India. Total Equity: $${equity.toFixed(2)} · Available: $${available.toFixed(2)}`
        );
        if (onSaveApiCredentials) {
          onSaveApiCredentials({
            apiKey: trimmedKey,
            apiSecret: trimmedSecret,
            environment,
            isVerified: true,
            verifiedAt: Date.now(),
          });
        }
      }
    } catch (e: any) {
      setAuthError(e.message || 'Signature calculation failed');
      setSignatureOutput(null);
    } finally {
      setTestingSig(false);
    }
  };

  const handleSave = async () => {
    setAuthError(null);

    if (trimmedDraftClientId && !isDraftClientIdValid) {
      setAuthError(
        'Invalid Google OAuth Web Client ID. Must end with .apps.googleusercontent.com or be left blank for Local Session Mode.'
      );
      return;
    }
    setCustomClientId(trimmedDraftClientId);

    const trimmedKey = isMaskedValue(apiKey) ? '' : apiKey.trim();
    const trimmedSecret = isMaskedValue(apiSecret) ? '' : apiSecret.trim();

    // If API secret is left blank and keys are already configured on the server,
    // skip API secret validation & HMAC re-auth and preserve the server's saved secret!
    const keepingExistingServerSecret = !trimmedSecret && hasExistingKeys;
    let shouldSendNewCredentials = false;

    if (!keepingExistingServerSecret && (trimmedKey || trimmedSecret)) {
      if (!isValidKeyFormat) {
        setAuthError('Valid Delta Exchange India API Key & Secret (min 8 characters, non-demo) are required.');
        return;
      }

      try {
        const activeSessionToken = await resolveValidSessionToken();
        const [sigRes, walletRes] = await Promise.all([
          fetch('/api/delta/signature-test', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-email': 'dhanrajk69@gmail.com',
              ...(activeSessionToken ? { 'Authorization': `Bearer ${activeSessionToken}` } : {}),
            },
            body: JSON.stringify({
              apiKey: trimmedKey,
              apiSecret: trimmedSecret,
              method: 'GET',
              path: '/v2/positions',
            }),
          }),
          fetch(`/api/delta/wallet?_t=${Date.now()}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-email': 'dhanrajk69@gmail.com',
              'x-delta-api-key': trimmedKey,
              'x-delta-api-secret': trimmedSecret,
              'x-delta-environment': environment,
              ...(activeSessionToken ? { 'Authorization': `Bearer ${activeSessionToken}` } : {}),
            },
          }),
        ]);

        const data = await sigRes.json().catch(() => null);
        const walletData = await walletRes.json().catch(() => null);

        if (walletData && (walletData.status === 'diagnostic_error' || walletData.status === 'error' || walletData.diagnosticError)) {
          const errMsg = walletData.diagnosticError?.message || walletData.error || 'Delta Exchange India rejected the API credentials.';
          setAuthError(errMsg);
          onSendTestNotification?.('Delta Exchange India Connection Issue', errMsg);
          return;
        }

        if (!sigRes.ok || data?.error) {
          setAuthError(data?.error || 'Local HMAC validation failed.');
          return;
        }

        setSignatureOutput(data);
        setServerHasExistingKeys(true);
        setServerMaskedKey(maskApiKey(trimmedKey));
        shouldSendNewCredentials = true;

        const equity = walletData?.wallet?.totalEquity ?? 0;
        const available = walletData?.wallet?.availableMargin ?? 0;
        onSendTestNotification?.(
          'Delta Live Wallet Verified',
          `Successfully connected to Delta Exchange India. Total Equity: $${equity.toFixed(2)} · Available: $${available.toFixed(2)}`
        );

        if (onSaveApiCredentials) {
          onSaveApiCredentials({
            apiKey: trimmedKey,
            apiSecret: trimmedSecret,
            environment,
            isVerified: true,
            verifiedAt: Date.now(),
          });
        }
      } catch (e: any) {
        setAuthError(e.message || 'Unable to test local HMAC keys');
        return;
      }
    } else if (!keepingExistingServerSecret && !trimmedKey && !trimmedSecret && !hasExistingKeys) {
      if (onClearApiCredentials) {
        onClearApiCredentials();
      }
    }

    // Persist configuration & credentials to Cloud Server backend (~/.deltaai-data/config.json)
    // Omit apiKey / apiSecret when keeping existing server keys so the saved secret is never overwritten
    const cleanBotToken = botToken.trim();
    const cleanChatId = telegramChatId.trim();
    try {
      const serverConfigPayload: Record<string, any> = {
        environment,
        routingMode,
        notificationConfig: {
          telegramBotToken: cleanBotToken,
          telegramChatId: cleanChatId,
          priority: 'high',
          lowImpactNewsPriority,
          enabledEvents,
        },
      };
      if (shouldSendNewCredentials) {
        serverConfigPayload.apiKey = trimmedKey;
        serverConfigPayload.apiSecret = trimmedSecret;
      }

      const serverConfigRes = await fetch('/api/delta/server-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': 'dhanrajk69@gmail.com',
          ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify(serverConfigPayload),
      });
      const serverConfigData = await serverConfigRes.json();
      if (serverConfigRes.ok && serverConfigData.savedToCloudServer) {
        setCloudServerSyncInfo(serverConfigData);
        setSaveSuccess(true);
        const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        onSendTestNotification?.(
          'Cloud Server Synced (34.47.205.98)',
          `✓ Saved & Synced to Cloud Server (34.47.205.98) at ${timeStr} — Active across Desktop & Mobile`
        );
        setTimeout(() => {
          setSaveSuccess(false);
          onClose();
        }, 1200);
        return;
      }
    } catch (err: any) {
      console.warn('Failed to save to cloud server:', err);
    }

    saveMobileNotificationConfig(
      {
        telegramBotToken: cleanBotToken,
        telegramChatId: cleanChatId,
        priority: 'high',
        lowImpactNewsPriority,
        enabledEvents,
      },
      sessionToken
    ).catch((err) => {
      console.warn('Failed to save mobile notification config:', err);
    });

    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 800);
  };

  const handleDisconnectKeys = () => {
    setApiKey('');
    setApiSecret('');
    setServerHasExistingKeys(false);
    setServerMaskedKey('');
    setSignatureOutput(null);
    setAuthError(null);
    if (onClearApiCredentials) {
      onClearApiCredentials();
    }
  };

  const handleSendMobileTest = async () => {
    const cleanBotToken = botToken.trim();
    const cleanChatId = telegramChatId.trim();
    if (!cleanBotToken || !cleanChatId) {
      setAuthError('Please enter both Telegram Bot Token and Telegram Chat ID before verifying connectivity.');
      return;
    }

    setIsTestingMobileAlert(true);
    setMobileTestResults(null);
    setTelegramVerificationResult(null);
    setAuthError(null);
    try {
      // Invoke secure server-side verification endpoint (POST /api/notifications/telegram/test)
      const verification = await testTelegramConnection(
        cleanBotToken,
        cleanChatId,
        enabledEvents,
        sessionToken,
        lowImpactNewsPriority
      );

      setTelegramVerificationResult(verification);
      setMobileTestResults({
        telegram: {
          configured: true,
          ok: verification.success,
          status: verification.status || (verification.success ? 200 : 400),
          message: verification.description,
        },
      });

      if (verification.success) {
        onSendTestNotification?.(
          'Telegram Connectivity Verified',
          `Verified ${verification.botUsername || 'Telegram Bot'} & delivered test message to ${cleanChatId} (${verification.latencyMs ?? 0}ms)`
        );
      } else {
        setAuthError(verification.description || 'Failed to verify Telegram connectivity. Check Bot Token and Chat ID.');
      }
    } catch (err: any) {
      setAuthError(`Telegram connectivity test failed: ${err?.message || 'Network error'}`);
    } finally {
      setIsTestingMobileAlert(false);
    }
  };

  const modalNode = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-xl panel-delta border-cyan-500/25 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent pointer-events-none" />
        <div className="panel-delta-header h-12 px-4 border-cyan-500/15 bg-[#040a20]/80">
          <div className="flex items-center gap-2 min-w-0">
            <Key className="w-4 h-4 text-cyan-400 shrink-0" />
            <h2 className="panel-delta-title text-white normal-case tracking-wide">Delta Exchange India Settings</h2>
            {isConfiguredLocally ? (
              <span className="badge-delta badge-delta-live font-mono-numbers">
                <CheckCircle2 className="w-3 h-3" />
                <span>Credentials Stored Locally</span>
              </span>
            ) : (
              <span className="badge-delta badge-delta-paper font-mono-numbers">
                <AlertCircle className="w-3 h-3" />
                <span>Credentials Unconfigured</span>
              </span>
            )}
          </div>
          <button onClick={onClose} className="btn-delta-sm btn-secondary px-2" aria-label="Close settings">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded flex items-center justify-center bg-white/10">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                  Google Trader Authentication
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`badge-delta font-mono ${
                    hasValidClientId
                      ? 'badge-delta-armed'
                      : 'badge-delta-standby'
                  }`}
                  title={
                    hasValidClientId
                      ? 'Valid Google OAuth Web Client ID configured'
                      : 'Local Session Mode (Configure VITE_GOOGLE_CLIENT_ID for live Google OAuth)'
                  }
                >
                  {hasValidClientId ? 'LIVE OAUTH READY' : 'LOCAL SESSION MODE'}
                </span>
                {isAuthenticated ? (
                  <span className="badge-delta badge-delta-live font-mono">
                    AUTHENTICATED
                  </span>
                ) : (
                  <span className="badge-delta badge-delta-standby font-mono">
                    LOGGED OUT
                  </span>
                )}
              </div>
            </div>
            {isAuthenticated && user ? (
              <div className="flex items-center justify-between gap-3 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full object-cover ring-1 ring-emerald-500/70" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-white text-xs">
                      {user.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-white font-bold text-xs truncate">{user.name}</div>
                    <div className="text-slate-400 text-[10px] font-mono truncate">{user.email}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="btn-delta-sm btn-danger"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400">
                  Sign in with Google to link institutional identity & preferences.
                </span>
                <button
                  type="button"
                  onClick={() => loginDemo({ name: 'Dhanraj K', email: 'dhanrajk69@gmail.com' })}
                  title="Local Session Mode (Configure VITE_GOOGLE_CLIENT_ID for live Google OAuth)"
                  className="btn-delta-sm btn-primary shrink-0"
                >
                  Continue as Dhanraj (dhanrajk69@gmail.com)
                </button>
              </div>
            )}

            {/* Custom Google OAuth Web Client ID & Authorized JavaScript Origin */}
            <div className="pt-2.5 border-t border-slate-800/90 space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-slate-300 font-medium">
                    Google OAuth Web Client ID (<span className="font-mono text-cyan-400">*.apps.googleusercontent.com</span>)
                  </label>
                  {customClientId && (
                    <button
                      type="button"
                      onClick={() => {
                        setGoogleClientIdDraft('');
                        setCustomClientId('');
                      }}
                      className="text-[10px] text-rose-400 hover:text-rose-300 font-medium cursor-pointer"
                    >
                      Clear Client ID
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={googleClientIdDraft}
                    onChange={(e) => setGoogleClientIdDraft(e.target.value)}
                    placeholder="e.g. 1234567890-abcdef123456.apps.googleusercontent.com"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleApplyGoogleClientId}
                    className="btn-delta btn-secondary shrink-0"
                  >
                    {clientIdSavedBadge ? '✓ Saved' : 'Apply ID'}
                  </button>
                </div>
                <span className="text-[10px] text-slate-500 block mt-1">
                  Saved in <span className="font-mono text-slate-400">localStorage</span>. Leave blank in preview to use Local Session Mode without <span className="font-mono text-slate-400">Error 401: invalid_client</span>.
                </span>
              </div>

              <div>
                <label className="text-[11px] text-slate-300 font-medium block mb-1">
                  Authorized JavaScript Origin (Paste into Google Cloud Console)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={authorizedOrigin}
                    aria-label="Google Cloud Console Authorized JavaScript Origin"
                    className="flex-1 bg-slate-900/90 border border-slate-800 rounded px-2.5 py-1.5 text-cyan-300 font-mono text-xs select-all focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyOrigin}
                    title="Copy current window.location.origin to clipboard"
                    className="btn-delta btn-toggle-active shrink-0"
                  >
                    {originCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Copy Origin</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3 pt-3 border-t border-slate-800/90">
            <h3 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <span>1. Outbound IP Routing & Dual-Stack Whitelist</span>
            </h3>
            <div className="space-y-2">
              <label className="text-[11px] text-slate-400 block">Outbound IP Routing Mode</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'DUAL_STACK', label: 'Dual-Stack (Auto-Fallback)' },
                  { id: 'IPV4_ONLY', label: 'IPv4 Only (family: 4)' },
                  { id: 'IPV6_ONLY', label: 'IPv6 Only (family: 6)' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => handleUpdateRoutingMode(mode.id as any)}
                    className={`btn-delta h-auto py-2 flex-col items-start text-left ${
                      routingMode === mode.id
                        ? 'btn-toggle-active'
                        : 'btn-secondary'
                    }`}
                  >
                    <div className="font-bold">{mode.label.split(' ')[0]} {mode.label.split(' ')[1]}</div>
                    <div className="text-[9px] opacity-75 truncate w-full">{mode.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Live Dual-IP Whitelist Helper Card */}
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-300">Detected Public Server IPs (For Delta API Whitelist)</span>
                <button
                  type="button"
                  onClick={handleTestIpDiagnostics}
                  disabled={testingDiagnostic}
                  className="btn-delta-sm btn-toggle-active"
                >
                  {testingDiagnostic ? 'Testing Protocols...' : 'Test IPv4 & IPv6 Connection'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
                <div
                  onClick={() => handleCopyText(publicIpv4, 'ipv4')}
                  className="p-2 bg-slate-900/90 hover:bg-slate-850 rounded-lg border border-slate-800/80 hover:border-cyan-500/50 flex items-center justify-between cursor-pointer transition group"
                  title="Click to copy IPv4 address"
                >
                  <div className="min-w-0 pr-1">
                    <span className="text-[10px] text-slate-500 block">IPv4 Address</span>
                    <span className="text-cyan-300 font-bold select-all font-mono">{publicIpv4}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyText(publicIpv4, 'ipv4');
                    }}
                    className="btn-delta-sm btn-secondary shrink-0"
                  >
                    {copiedIpv4 ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedIpv4 ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                <div
                  onClick={() => handleCopyText(publicIpv6, 'ipv6')}
                  className="p-2 bg-slate-900/90 hover:bg-slate-850 rounded-lg border border-slate-800/80 hover:border-emerald-500/50 flex items-center justify-between cursor-pointer transition group"
                  title="Click to copy IPv6 address"
                >
                  <div className="min-w-0 pr-1">
                    <span className="text-[10px] text-slate-500 block">IPv6 Address</span>
                    <span className="text-emerald-300 font-bold truncate max-w-[120px] inline-block align-bottom select-all font-mono">{publicIpv6}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyText(publicIpv6, 'ipv6');
                    }}
                    className="btn-delta-sm btn-secondary shrink-0"
                  >
                    {copiedIpv6 ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedIpv6 ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => handleCopyText(`${publicIpv4}, ${publicIpv6}`, 'both')}
                  className="btn-delta btn-secondary w-full"
                >
                  {copiedBoth ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
                  <span>{copiedBoth ? 'Copied Both IP Addresses (Comma-Separated)' : 'Copy Both (Comma-Separated for Delta Whitelist)'}</span>
                </button>
              </div>

              {diagnosticResult && (
                <div className="mt-2 p-2 bg-slate-900 rounded border border-slate-800 text-[10px] font-mono space-y-1">
                  <div className="text-cyan-400 font-bold">Protocol Connection Diagnostics:</div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>IPv4 Protocol:</span>
                    <span className={diagnosticResult.ipv4?.status === 'PASS' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {diagnosticResult.ipv4?.status} ({diagnosticResult.ipv4?.latencyMs}ms) {diagnosticResult.ipv4?.error ? `- ${diagnosticResult.ipv4.error}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>IPv6 Protocol:</span>
                    <span className={diagnosticResult.ipv6?.status === 'PASS' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {diagnosticResult.ipv6?.status} ({diagnosticResult.ipv6?.latencyMs}ms) {diagnosticResult.ipv6?.error ? `- ${diagnosticResult.ipv6.error}` : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
              2. Exchange Gateway & Execution Mode
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Gateway Endpoint</label>
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono-numbers"
                >
                  <option value="PROD">Delta India Production (api.india.delta.exchange)</option>
                  <option value="TESTNET">Delta India Testnet (cdn.india.delta.exchange)</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Platform Mode</label>
                <select
                  value={tradingMode}
                  onChange={(e) => setTradingMode(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono-numbers"
                >
                  <option value="PAPER">Paper Demo (Simulated Funds)</option>
                  <option value="LIVE">Live India (Real Delta Funds)</option>
                </select>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                3. Delta Exchange India API Keys
              </h3>
              {(apiKey || apiSecret || isConfiguredLocally) && (
                <button
                  type="button"
                  onClick={handleDisconnectKeys}
                  className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 font-medium cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Disconnect / Clear Keys</span>
                </button>
              )}
            </div>
            {/* Server-Side Live Execution Gate Controller */}
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-slate-200 uppercase tracking-wider text-[10px]">
                  Server Live Execution Gate
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {serverLiveGateEnabled ? (
                    <span className="badge-delta badge-delta-live font-mono">
                      LIVE GATE: UNLOCKED (ACTIVE)
                    </span>
                  ) : (
                    <span className="badge-delta badge-delta-danger font-mono">
                      LIVE GATE: LOCKED (SAFETY ON)
                    </span>
                  )}

                  {hasValidCredentialsForGate && (
                    serverLiveGateEnabled ? (
                      <button
                        type="button"
                        disabled={togglingLiveGate}
                        onClick={() => handleToggleLiveGate(false)}
                        className="btn-delta-sm btn-danger font-mono"
                      >
                        <Lock className="w-3 h-3" />
                        <span>Lock Live Gate</span>
                      </button>
                    ) : !showUnlockConfirm ? (
                      <button
                        type="button"
                        disabled={togglingLiveGate}
                        onClick={() => setShowUnlockConfirm(true)}
                        className="btn-delta-sm btn-primary font-mono"
                      >
                        <Unlock className="w-3 h-3" />
                        <span>Unlock Live Gate</span>
                      </button>
                    ) : null
                  )}
                </div>
              </div>

              {showUnlockConfirm && !serverLiveGateEnabled && hasValidCredentialsForGate && (
                <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-500/60 space-y-2">
                  <div className="flex items-start gap-2 text-[10.5px] text-amber-200">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-amber-300 block">
                        Confirm Live Real-Funds Execution
                      </span>
                      <span className="text-slate-300">
                        Unlocking the Live Execution Gate permits LIVE orders using your Delta Exchange India API credentials ({environment}).
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowUnlockConfirm(false)}
                      className="btn-delta-sm btn-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={togglingLiveGate}
                      onClick={() => handleToggleLiveGate(true)}
                      className="btn-delta-sm btn-primary"
                    >
                      <Unlock className="w-3 h-3" />
                      <span>
                        {togglingLiveGate ? 'Unlocking...' : 'Confirm Live Real-Funds Execution'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">API Key</label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  hasExistingKeys && serverMaskedKey
                    ? `Configured on server (${serverMaskedKey}) — leave blank to keep`
                    : 'Enter Delta Exchange India Live API Key'
                }
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono-numbers text-xs focus:border-emerald-500 focus:outline-none"
              />
              {(apiKey || (hasExistingKeys && serverMaskedKey)) && (
                <span className="text-[10px] text-slate-500 block mt-0.5 font-mono">
                  Active key: {apiKey ? maskApiKey(apiKey) : serverMaskedKey}
                </span>
              )}
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">API Secret (HMAC-SHA256)</label>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder={
                  hasExistingKeys
                    ? 'Already configured on server (leave blank to keep existing secret)'
                    : 'Enter Delta Exchange India Live API Secret'
                }
                autoComplete="new-password"
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono-numbers text-xs focus:border-emerald-500 focus:outline-none"
              />
              {hasExistingKeys && !apiSecret.trim() && (
                <span className="text-[10px] text-emerald-400/90 block mt-0.5 font-mono">
                  ✓ Server secret active &amp; protected — saving other settings will keep it unchanged
                </span>
              )}
            </div>
            {authError && (
              <div className="p-2.5 bg-rose-950/60 border border-rose-800 rounded text-[11px] text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>{authError}</span>
              </div>
            )}
            <div className="space-y-1">
              <button
                type="button"
                onClick={handleTestSignature}
                disabled={testingSig}
                className="btn-delta btn-secondary font-mono-numbers"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>{testingSig ? 'Connecting to Delta India via IPv4...' : 'Test & Verify Live Connection (api.india.delta.exchange)'}</span>
              </button>
              <span className="text-[10px] text-slate-500 block">
                Live Diagnostic: Dispatches an authenticated query through IPv4 (34.47.205.98) to verify API Key whitelist, HMAC secret, and account balances.
              </span>
            </div>
            {signatureOutput && (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded text-[11px] font-mono-numbers text-slate-300 overflow-x-auto space-y-1.5">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Local HMAC-SHA256 Computed (Offline Diagnostic)</span>
                </div>
                <div className="text-[10px] text-slate-400 bg-slate-900/90 p-1.5 rounded border border-slate-800">
                  {signatureOutput.disclaimer}
                </div>
                <div>Masked API Key: {signatureOutput.headers?.['api-key']}</div>
                <div>Timestamp: {signatureOutput.headers?.timestamp}</div>
                <div className="truncate text-slate-400">Signature: {signatureOutput.headers?.signature}</div>
              </div>
            )}
          </div>
          <div className="space-y-3 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-cyan-400" />
                <span>4. TELEGRAM BOT ALERTS</span>
              </h3>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/35 text-[10px] font-mono text-cyan-300 tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                SERVER-SIDE TELEGRAM RELAY · VM 34.47.205.98
              </span>
            </div>

            {/* Two Focused Telegram Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Telegram Bot Token <span className="text-slate-500 font-normal">(from @BotFather)</span>
                </label>
                <input
                  type="text"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456789:ABC-DEF1234..."
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono-numbers text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Telegram Chat ID <span className="text-slate-500 font-normal">(@username, numeric, or -100...)</span>
                </label>
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="@your_username, numeric user ID, or -100..."
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono-numbers text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>

            {/* 4 Event Routing Checkboxes */}
            <div className="pt-1">
              <label className="text-[11px] text-slate-400 block mb-1.5 font-medium">Alert Events Sent to Telegram:</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px]">
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledEvents.autoPilot}
                    onChange={(e) => setEnabledEvents({ ...enabledEvents, autoPilot: e.target.checked, fills: e.target.checked })}
                    className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>Auto-Pilot Fills</span>
                </label>
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledEvents.tpSl}
                    onChange={(e) => setEnabledEvents({ ...enabledEvents, tpSl: e.target.checked })}
                    className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>TP1–4 & Stop-Loss</span>
                </label>
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledEvents.killSwitch}
                    onChange={(e) => setEnabledEvents({ ...enabledEvents, killSwitch: e.target.checked })}
                    className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>Kill Switch</span>
                </label>
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledEvents.staleSignals}
                    onChange={(e) => setEnabledEvents({ ...enabledEvents, staleSignals: e.target.checked })}
                    className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>Stale Pauses</span>
                </label>
              </div>
            </div>

            {/* Low-Impact Market News Delivery Priority */}
            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] text-slate-300 font-medium">
                  Low-Impact Market News Priority
                </label>
                <span className="text-[10px] font-mono text-slate-500">
                  {lowImpactNewsPriority === 'low' ? 'priority: low · disable_notification: true' : 'priority: high · disable_notification: false'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLowImpactNewsPriority('low')}
                  className={`btn-delta h-auto py-2 px-2.5 flex-col items-start text-left ${
                    lowImpactNewsPriority === 'low' ? 'btn-toggle-active' : 'btn-secondary'
                  }`}
                >
                  <div className="font-semibold text-[11px]">Low Priority (Silent)</div>
                  <div className="text-[9.5px] opacity-75">Uses disable_notification: true (no mobile push)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setLowImpactNewsPriority('high')}
                  className={`btn-delta h-auto py-2 px-2.5 flex-col items-start text-left ${
                    lowImpactNewsPriority === 'high' ? 'btn-toggle-active' : 'btn-secondary'
                  }`}
                >
                  <div className="font-semibold text-[11px]">High Priority (Push)</div>
                  <div className="text-[9.5px] opacity-75">Standard Telegram channel with mobile push alert</div>
                </button>
              </div>
              <span className="text-[10px] text-slate-500 block">
                Trade fills, TP/SL hits, kill switch, and high-impact market catalysts always send as high-priority push alerts.
              </span>
            </div>

            {/* Dedicated Pre-Deployment Connectivity Verification Button & Status Telemetry */}
            <div className="pt-2 space-y-2.5 border-t border-slate-800/80">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleSendMobileTest}
                  disabled={isTestingMobileAlert || !botToken.trim() || !telegramChatId.trim()}
                  title="Invoke secure server-side Telegram getMe & sendMessage verification before live deployment"
                  className="btn-delta btn-toggle-active disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isTestingMobileAlert ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-300" />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-cyan-300" />
                  )}
                  <span>
                    {isTestingMobileAlert ? 'Verifying via Server Relay...' : '[Send Test Telegram Alert]'}
                  </span>
                </button>

                <span className="text-[10px] text-slate-400 font-mono">
                  Endpoint: <code className="text-cyan-400">POST /api/notifications/telegram/test</code>
                </span>
              </div>

              {telegramVerificationResult && (
                <div
                  className={`p-2.5 rounded-lg border text-xs font-mono space-y-1 ${
                    telegramVerificationResult.success
                      ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/35 border-rose-500/40 text-rose-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {telegramVerificationResult.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      )}
                      <span>
                        {telegramVerificationResult.success
                          ? 'TELEGRAM CONNECTIVITY VERIFIED · READY FOR LIVE DEPLOYMENT'
                          : 'TELEGRAM VERIFICATION FAILED'}
                      </span>
                    </div>
                    {telegramVerificationResult.latencyMs !== undefined && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-950/70 border border-slate-700/70 text-slate-300">
                        HTTP {telegramVerificationResult.status || 200} · {telegramVerificationResult.latencyMs}ms
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-300 leading-relaxed">
                    {telegramVerificationResult.description}
                  </div>
                  {telegramVerificationResult.success && (
                    <div className="flex items-center gap-3 flex-wrap text-[10px] text-emerald-300/90 pt-0.5">
                      {telegramVerificationResult.botUsername && (
                        <span>Bot: <strong>{telegramVerificationResult.botUsername}</strong></span>
                      )}
                      {telegramVerificationResult.chatId && (
                        <span>Chat ID: <strong>{telegramVerificationResult.chatId}</strong></span>
                      )}
                      {telegramVerificationResult.messageId && (
                        <span>Msg ID: <strong>#{telegramVerificationResult.messageId}</strong></span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                5. Voice Alert Profile
              </h3>
              <button
                type="button"
                onClick={() => {
                  const next = !voiceEnabled;
                  setVoiceEnabled(next);
                  if (next) {
                    announceVoiceActivated();
                  }
                }}
                className={`btn-delta-sm font-mono-numbers ${
                  voiceEnabled
                    ? 'btn-toggle-active'
                    : 'btn-secondary'
                }`}
              >
                {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                <span>{voiceEnabled ? 'Voice: ON' : 'Voice: OFF'}</span>
              </button>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-[11px] font-semibold text-white truncate">
                  {selectedVoice?.name || 'System Soft Female Voice (Default)'}
                </div>
                <div className="text-[10px] font-mono-numbers tabular-nums text-slate-400">
                  Pitch {SOFT_FEMALE_VOICE_CADENCE.pitch.toFixed(2)} · Rate {SOFT_FEMALE_VOICE_CADENCE.rate.toFixed(2)} · Vol {SOFT_FEMALE_VOICE_CADENCE.volume.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-cyan-500/15 flex items-center justify-between bg-[#040a20]/60">
          <span className="text-[11px] text-slate-400 font-mono-numbers">
            {saveSuccess ? '✓ Settings saved locally!' : 'Stored in client session state only'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-delta btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="btn-delta btn-primary uppercase"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalNode, document.body);
  }
  return modalNode;
};
