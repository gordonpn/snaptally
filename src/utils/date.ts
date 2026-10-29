/** Validates a calendar date in YYYY-MM-DD format. */
export function isValidDate(dateStr: string): boolean {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Returns current calendar date in local YYYY-MM-DD format. */
export function getTodayDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Returns yesterday's calendar date in local YYYY-MM-DD format. */
export function getYesterdayDate(now: Date = new Date()): string {
  const target = new Date(now.getTime());
  target.setDate(target.getDate() - 1);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Formats a YYYY-MM-DD date into feed headings: Today, Yesterday, or date string. */
export function formatDateHeading(dateStr: string, now: Date = new Date()): string {
  const today = getTodayDate(now);
  if (dateStr === today) {
    return "Today";
  }
  const yesterday = getYesterdayDate(now);
  if (dateStr === yesterday) {
    return "Yesterday";
  }
  return dateStr;
}

/** Formats YYYY-MM string into month and year label, e.g. October 2026. */
export function formatMonthName(monthStr?: string): string {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    return "This Month";
  }
  const [year, month] = monthStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}
