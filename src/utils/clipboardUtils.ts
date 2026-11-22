/**
 * Bulletproof clipboard utility that works reliably across:
 * - Embedded iframes (e.g. AI Studio preview environment)
 * - Restrictive permissions policies where navigator.clipboard.writeText is blocked
 * - Desktop and mobile browsers (iOS Safari, Android Chrome)
 * - HTTP and HTTPS contexts
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text || typeof text !== 'string') return false;

  const cleanText = text.trim();
  if (!cleanText) return false;

  // 1. Try synchronous document.execCommand('copy') FIRST
  // In embedded iframes (e.g. AI Studio preview environment) and mobile webviews,
  // navigator.clipboard.writeText may reject or require async permission checks.
  // By awaiting writeText first, the transient user activation token expires before any
  // fallback can run. Calling execCommand synchronously inside the click handler
  // captures the active user gesture immediately and succeeds reliably.
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = cleanText;

      // Make textarea unobtrusive but fully selectable within the viewport
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.style.opacity = '0.01';
      textarea.style.zIndex = '-9999';
      textarea.style.fontSize = '16px'; // Prevent auto-zoom on mobile iOS

      // Handle iOS Safari selection quirks
      if (typeof navigator !== 'undefined' && /ipad|ipod|iphone/i.test(navigator.userAgent)) {
        textarea.contentEditable = 'true';
        document.body.appendChild(textarea);

        const range = document.createRange();
        range.selectNodeContents(textarea);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        textarea.setSelectionRange(0, 999999);
      } else {
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, cleanText.length);
      }

      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (successful) {
        return true;
      }
    } catch {
      // Fall through to async Clipboard API
    }
  }

  // 2. Modern async Clipboard API fallback
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(cleanText);
      return true;
    } catch {
      // Failed in restricted context
    }
  }

  return false;
}
