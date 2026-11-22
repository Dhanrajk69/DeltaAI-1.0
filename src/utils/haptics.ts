/**
 * Native Android Haptic Tactile Feedback Utility
 * Provides physical haptic response on Android mobile devices via navigator.vibrate
 */

export type HapticType = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error';

export function triggerHaptic(type: HapticType = 'light'): void {
  if (typeof window === 'undefined' || !navigator || !navigator.vibrate) {
    return;
  }

  try {
    switch (type) {
      case 'selection':
      case 'light':
        // Short subtle tap
        navigator.vibrate(12);
        break;
      case 'medium':
        // Distinct press
        navigator.vibrate(28);
        break;
      case 'heavy':
        // Strong trigger
        navigator.vibrate(45);
        break;
      case 'success':
        // Double pulse for trade execution / profit target
        navigator.vibrate([18, 50, 24]);
        break;
      case 'warning':
        // Distinct alert pattern
        navigator.vibrate([30, 40, 30]);
        break;
      case 'error':
        // Triple harsh vibration
        navigator.vibrate([40, 50, 40, 50, 40]);
        break;
      default:
        navigator.vibrate(15);
    }
  } catch {
    // Graceful fallback on non-supported browsers
  }
}
