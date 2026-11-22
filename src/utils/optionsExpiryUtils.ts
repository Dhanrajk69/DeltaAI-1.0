/**
 * Options Expiry and DTE Utility
 * Dynamically computes real-time upcoming crypto options expiry cycles
 * conforming strictly to Delta Exchange India standards (12:00 UTC / 17:30 IST).
 */

const MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

export const DELTA_INDIA_EXPIRY_UTC_HOUR = 12; // 12:00 UTC = 17:30 IST (5:30 PM IST)

export interface OptionsExpiryInfo {
  timestamp: number;
  dateStr: string;   // e.g. "17-NOV-2026"
  dte: number;       // e.g. 0 or 5
  display: string;   // e.g. "17-NOV-2026 (0d)"
  type: 'CURRENT_WEEK' | 'NEXT_WEEK' | 'MONTHLY' | 'CUSTOM';
}

/**
 * Format a Date to "DD-MMM-YYYY" in UTC (e.g. 17-NOV-2026)
 */
export function formatExpiryDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = MONTH_NAMES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Calculate DTE using the exact formula:
 * max(0, ceil((expiryTimestamp - now) / 86,400,000))
 */
export function calculateDte(expiryTimestamp: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((expiryTimestamp - now) / 86400000));
}

/**
 * Format display string as [DD-MMM-YYYY] ([DTE]d)
 */
export function formatExpiryWithDte(dateStr: string, dte: number): string {
  if (dateStr.includes('(') && dateStr.includes('d)')) return dateStr;
  return `${dateStr} (${dte}d)`;
}

/**
 * Parse a standard expiry date string ("17-NOV-2026", "2026-11-17", or "171126")
 * into a Date object strictly anchored at 12:00:00 UTC (17:30 IST).
 */
export function parseExpiryString(dateStr: string): Date | null {
  try {
    const cleanStr = dateStr.replace(/\s*\(.*?\)/g, '').trim();
    if (/^\d{6}$/.test(cleanStr)) {
      const dd = parseInt(cleanStr.slice(0, 2), 10);
      const mm = parseInt(cleanStr.slice(2, 4), 10) - 1;
      const yy = 2000 + parseInt(cleanStr.slice(4, 6), 10);
      if (!isNaN(dd) && !isNaN(mm) && !isNaN(yy) && mm >= 0 && mm <= 11) {
        return new Date(Date.UTC(yy, mm, dd, DELTA_INDIA_EXPIRY_UTC_HOUR, 0, 0, 0));
      }
    }
    const isoMatch = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const yr = parseInt(isoMatch[1], 10);
      const mo = parseInt(isoMatch[2], 10) - 1;
      const dy = parseInt(isoMatch[3], 10);
      if (!isNaN(yr) && !isNaN(mo) && !isNaN(dy)) {
        return new Date(Date.UTC(yr, mo, dy, DELTA_INDIA_EXPIRY_UTC_HOUR, 0, 0, 0));
      }
    }
    const parts = cleanStr.split('-');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const monthIdx = MONTH_NAMES.indexOf(parts[1].toUpperCase());
    const year = parseInt(parts[2], 10);
    if (isNaN(day) || monthIdx === -1 || isNaN(year)) return null;
    return new Date(Date.UTC(year, monthIdx, day, DELTA_INDIA_EXPIRY_UTC_HOUR, 0, 0, 0));
  } catch {
    return null;
  }
}

/**
 * Parse an option contract symbol suffix (DDMMYY, e.g., P-BTC-64200-171126 -> 2026-11-17T12:00:00Z)
 * or fallback expiry string into its exact UTC settlement timestamp (12:00 UTC / 5:30 PM IST).
 */
export function parseOptionSymbolExpiryUtcMs(
  symbol?: string | null,
  fallbackExpiry?: string | null
): number | null {
  const sym = String(symbol || '').trim().toUpperCase();
  const symMatch = sym.match(/^[CP]-[A-Z0-9]+-\d+(?:\.\d+)?-(\d{6})$/);
  if (symMatch) {
    const code = symMatch[1];
    const dd = code.slice(0, 2);
    const mm = code.slice(2, 4);
    const yy = code.slice(4, 6);
    const ms = Date.parse(`20${yy}-${mm}-${dd}T12:00:00Z`);
    if (Number.isFinite(ms)) return ms;
  }
  if (fallbackExpiry) {
    const parsed = parseExpiryString(fallbackExpiry);
    if (parsed && Number.isFinite(parsed.getTime())) {
      return parsed.getTime();
    }
  }
  return null;
}

/**
 * Helper to find the last Friday of a given month at 12:00:00 UTC (17:30 IST)
 */
function findLastFridayOfMonth(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0, DELTA_INDIA_EXPIRY_UTC_HOUR, 0, 0, 0));
  const dayOfWeek = lastDay.getUTCDay(); // 0 = Sun ... 5 = Fri ... 6 = Sat
  const diff = (dayOfWeek - 5 + 7) % 7;
  lastDay.setUTCDate(lastDay.getUTCDate() - diff);
  return lastDay.getTime();
}

/**
 * Cycle 1: Weekly
 * Closest upcoming Friday at 12:00 UTC (17:30 IST)
 */
export function getClosestFridayExpiry(refTime: number = Date.now()): OptionsExpiryInfo {
  const now = new Date(refTime);
  const currentUtcDay = now.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat

  let daysUntilFriday = (5 - currentUtcDay + 7) % 7;

  // If today is Friday, check if 12:00 UTC (17:30 IST) has passed
  if (daysUntilFriday === 0) {
    const todayCutoff = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      DELTA_INDIA_EXPIRY_UTC_HOUR,
      0,
      0,
      0
    );
    if (refTime >= todayCutoff) {
      daysUntilFriday = 7;
    }
  }

  const expiryDate = new Date(refTime + daysUntilFriday * 86400000);
  const expiryTimestamp = Date.UTC(
    expiryDate.getUTCFullYear(),
    expiryDate.getUTCMonth(),
    expiryDate.getUTCDate(),
    DELTA_INDIA_EXPIRY_UTC_HOUR,
    0,
    0,
    0
  );

  const dte = calculateDte(expiryTimestamp, refTime);
  const dateStr = formatExpiryDate(new Date(expiryTimestamp));

  return {
    timestamp: expiryTimestamp,
    dateStr,
    dte,
    display: formatExpiryWithDte(dateStr, dte),
    type: 'CURRENT_WEEK',
  };
}

/**
 * Cycle 0: 0-DTE (Today before 12:00 UTC / 17:30 IST)
 */
export function getTodayExpiry(refTime: number = Date.now()): OptionsExpiryInfo | null {
  const now = new Date(refTime);
  const expiryTimestamp = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    DELTA_INDIA_EXPIRY_UTC_HOUR,
    0,
    0,
    0
  );

  if (refTime >= expiryTimestamp) {
    return null;
  }

  const dte = calculateDte(expiryTimestamp, refTime);
  const dateStr = formatExpiryDate(new Date(expiryTimestamp));

  return {
    timestamp: expiryTimestamp,
    dateStr,
    dte,
    display: `${dateStr} (${dte}d / Today)`,
    type: 'CUSTOM',
  };
}

/**
 * Next valid active daily expiry strictly > 12:00 UTC (today before 12:00 UTC, else tomorrow 12:00 UTC)
 */
export function getNextValidDailyExpiry(refTime: number = Date.now()): OptionsExpiryInfo {
  const today = getTodayExpiry(refTime);
  if (today) return today;
  const now = new Date(refTime);
  const tomorrowTimestamp = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    DELTA_INDIA_EXPIRY_UTC_HOUR,
    0,
    0,
    0
  );
  const dte = calculateDte(tomorrowTimestamp, refTime);
  const dateStr = formatExpiryDate(new Date(tomorrowTimestamp));
  return {
    timestamp: tomorrowTimestamp,
    dateStr,
    dte,
    display: formatExpiryWithDte(dateStr, dte),
    type: 'CUSTOM',
  };
}

/**
 * Generate the clean list starting strictly from the active non-expired contract:
 */
export function getActiveExpiryList(refTime: number = Date.now()): OptionsExpiryInfo[] {
  const now = new Date(refTime);

  // Calculate today's settlement cutoff: 12:00:00 UTC (17:30 IST)
  const todayExpiryUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    DELTA_INDIA_EXPIRY_UTC_HOUR,
    0,
    0,
    0
  );

  // If current UTC time has passed 12:00 UTC, today's contract has already expired and settled!
  const hasTodayExpired = refTime >= todayExpiryUtc;

  const expiries: OptionsExpiryInfo[] = [];
  const seenDates = new Set<string>();
  const addUnique = (info: OptionsExpiryInfo | null) => {
    if (info && !seenDates.has(info.dateStr)) {
      seenDates.add(info.dateStr);
      expiries.push(info);
    }
  };

  if (!hasTodayExpired) {
    addUnique(getTodayExpiry(refTime));
  } else {
    addUnique(getNextValidDailyExpiry(refTime));
  }

  addUnique(getClosestFridayExpiry(refTime));
  addUnique(getNextWeekFridayExpiry(refTime));
  addUnique(getMonthlyOptionsExpiry(refTime));

  return expiries;
}

/**
 * Cycle 2: Weekly / Bi-Weekly
 * Next Friday at 12:00 UTC (17:30 IST)
 */
export function getNextWeekFridayExpiry(refTime: number = Date.now()): OptionsExpiryInfo {
  const currentWeek = getClosestFridayExpiry(refTime);
  const nextFridayTimestamp = currentWeek.timestamp + 7 * 86400000;
  const dte = calculateDte(nextFridayTimestamp, refTime);
  const dateStr = formatExpiryDate(new Date(nextFridayTimestamp));

  return {
    timestamp: nextFridayTimestamp,
    dateStr,
    dte,
    display: formatExpiryWithDte(dateStr, dte),
    type: 'NEXT_WEEK',
  };
}

/**
 * Cycle 3: Monthly
 * Last Friday of the active or next calendar month at 12:00 UTC (17:30 IST)
 */
export function getMonthlyOptionsExpiry(refTime: number = Date.now()): OptionsExpiryInfo {
  const now = new Date(refTime);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  let lastFridayTimestamp = findLastFridayOfMonth(currentYear, currentMonth);

  // If the last Friday of this month is past or within 4 days, roll to next month's last Friday
  if (lastFridayTimestamp <= refTime + 4 * 86400000) {
    const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    const nextMonth = (currentMonth + 1) % 12;
    lastFridayTimestamp = findLastFridayOfMonth(nextMonthYear, nextMonth);
  }

  const dte = calculateDte(lastFridayTimestamp, refTime);
  const dateStr = formatExpiryDate(new Date(lastFridayTimestamp));

  return {
    timestamp: lastFridayTimestamp,
    dateStr,
    dte,
    display: formatExpiryWithDte(dateStr, dte),
    type: 'MONTHLY',
  };
}

/**
 * Get all 3 standard upcoming option expiry cycles at once
 */
export function getStandardExpiryCycles(refTime: number = Date.now()): {
  currentWeek: OptionsExpiryInfo;
  nextWeek: OptionsExpiryInfo;
  monthly: OptionsExpiryInfo;
} {
  return {
    currentWeek: getClosestFridayExpiry(refTime),
    nextWeek: getNextWeekFridayExpiry(refTime),
    monthly: getMonthlyOptionsExpiry(refTime),
  };
}

/**
 * Advance an expiry cycle forward for the Rolling Engine
 * When user clicks [Roll Forward], advances active legs to the following weekly/monthly series
 */
export function advanceExpiryCycle(
  currentExpiryStr?: string,
  refTime: number = Date.now()
): OptionsExpiryInfo {
  const cycles = getStandardExpiryCycles(refTime);
  
  if (!currentExpiryStr) {
    return cycles.nextWeek;
  }

  const cleanCurrent = currentExpiryStr.replace(/\s*\(.*?\)/g, '').trim().toUpperCase();

  // If currently on currentWeek, advance to nextWeek
  if (cleanCurrent === cycles.currentWeek.dateStr) {
    return cycles.nextWeek;
  }

  // If currently on nextWeek, advance to 3rd week (or monthly)
  if (cleanCurrent === cycles.nextWeek.dateStr) {
    const thirdFridayTimestamp = cycles.nextWeek.timestamp + 7 * 86400000;
    const dte = calculateDte(thirdFridayTimestamp, refTime);
    const dateStr = formatExpiryDate(new Date(thirdFridayTimestamp));
    return {
      timestamp: thirdFridayTimestamp,
      dateStr,
      dte,
      display: formatExpiryWithDte(dateStr, dte),
      type: 'CUSTOM',
    };
  }

  // Try parsing custom expiry date and advancing by 7 days
  const parsed = parseExpiryString(cleanCurrent);
  if (parsed) {
    const nextTimestamp = parsed.getTime() + 7 * 86400000;
    const dte = calculateDte(nextTimestamp, refTime);
    const dateStr = formatExpiryDate(new Date(nextTimestamp));
    return {
      timestamp: nextTimestamp,
      dateStr,
      dte,
      display: formatExpiryWithDte(dateStr, dte),
      type: 'CUSTOM',
    };
  }

  return cycles.nextWeek;
}
