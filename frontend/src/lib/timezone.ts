// Timezone preference + utilities. Persisted in localStorage so it survives
// reloads and is shared across tabs. Default = America/El_Salvador (CST,
// UTC-6) since that's the home market.
//
// Two responsibilities live here:
//   1. The user-facing preference (get/set/subscribe).
//   2. TZ-aware date math + formatting that the rest of the app needs but
//      the standard JS Date API doesn't offer cleanly.
//
// We avoid pulling a TZ library: Intl.DateTimeFormat (built-in to every
// modern browser) gives us exactly what we need.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'nexus_timezone';
const EVENT_NAME = 'nexus_timezone_change';

export const DEFAULT_TZ = 'America/El_Salvador';

// A short, opinionated list — anything actually present on the platform.
// `useTimezone()` will accept any IANA zone if the user types one manually.
export const COMMON_TIMEZONES: Array<{ tz: string; label: string }> = [
  { tz: 'America/El_Salvador', label: 'El Salvador (UTC−6)' },
  { tz: 'America/Mexico_City', label: 'Mexico City (UTC−6)' },
  { tz: 'America/Guatemala',   label: 'Guatemala (UTC−6)' },
  { tz: 'America/Tegucigalpa', label: 'Tegucigalpa (UTC−6)' },
  { tz: 'America/Managua',     label: 'Managua (UTC−6)' },
  { tz: 'America/Costa_Rica',  label: 'Costa Rica (UTC−6)' },
  { tz: 'America/Panama',      label: 'Panama (UTC−5)' },
  { tz: 'America/Bogota',      label: 'Bogotá (UTC−5)' },
  { tz: 'America/Lima',        label: 'Lima (UTC−5)' },
  { tz: 'America/New_York',    label: 'New York (UTC−5/−4)' },
  { tz: 'America/Chicago',     label: 'Chicago (UTC−6/−5)' },
  { tz: 'America/Denver',      label: 'Denver (UTC−7/−6)' },
  { tz: 'America/Los_Angeles', label: 'Los Angeles (UTC−8/−7)' },
  { tz: 'America/Sao_Paulo',   label: 'São Paulo (UTC−3)' },
  { tz: 'UTC',                 label: 'UTC' },
  { tz: 'Europe/Madrid',       label: 'Madrid (UTC+1/+2)' },
  { tz: 'Europe/London',       label: 'London (UTC+0/+1)' },
];

export function getTimezone(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v : DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

export function setTimezone(tz: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, tz);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: tz }));
  } catch {
    /* localStorage may be disabled */
  }
}

// React hook with cross-component live sync. Any component that uses
// useTimezone() rerenders when the user picks a new TZ anywhere in the app.
export function useTimezone(): [string, (tz: string) => void] {
  const [tz, setTz] = useState<string>(getTimezone());
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setTz(detail || getTimezone());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTz(getTimezone());
    };
    window.addEventListener(EVENT_NAME, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return [tz, setTimezone];
}

// ── TZ-aware date math ──────────────────────────────────────────────────

// Returns the offset (in minutes) of the given date in the given TZ from
// UTC. E.g. America/El_Salvador on a normal day → -360 (six hours behind).
//
// Used as the building block for "midnight in tz", "start of week in tz",
// etc. so the rest of the calendar math can be done by simple addition.
export function tzOffsetMinutes(tz: string, date: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const hour = +get('hour');
  const asUtc = Date.UTC(
    +get('year'), +get('month') - 1, +get('day'),
    hour === 24 ? 0 : hour,
    +get('minute'), +get('second'),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Midnight (00:00:00) of the calendar day that the given moment belongs
// to in the target TZ, returned as a UTC Date. Use .toISOString() for the
// server.
export function tzMidnight(tz: string, date: Date = new Date()): Date {
  const offsetMin = tzOffsetMinutes(tz, date);
  // Project `date` into the target zone as a "naive" timestamp, zero out
  // the time, then project back to UTC.
  const projected = new Date(date.getTime() + offsetMin * 60000);
  projected.setUTCHours(0, 0, 0, 0);
  return new Date(projected.getTime() - offsetMin * 60000);
}

// Monday 00:00 of the week the given moment belongs to, in the target TZ.
export function tzWeekStart(tz: string, date: Date = new Date()): Date {
  const offsetMin = tzOffsetMinutes(tz, date);
  const projected = new Date(date.getTime() + offsetMin * 60000);
  const dow = projected.getUTCDay() || 7; // 1=Mon..7=Sun
  projected.setUTCHours(0, 0, 0, 0);
  projected.setUTCDate(projected.getUTCDate() - dow + 1);
  return new Date(projected.getTime() - offsetMin * 60000);
}

// 1st-of-month 00:00 in the target TZ.
export function tzMonthStart(tz: string, date: Date = new Date()): Date {
  const offsetMin = tzOffsetMinutes(tz, date);
  const projected = new Date(date.getTime() + offsetMin * 60000);
  projected.setUTCHours(0, 0, 0, 0);
  projected.setUTCDate(1);
  return new Date(projected.getTime() - offsetMin * 60000);
}

// ── Display formatting ──────────────────────────────────────────────────

// Cheap heuristic: does this string look like an ISO 8601 date or
// timestamp? Used by the data-tab cell renderer to decide whether to
// reformat in the user's timezone.
export function looksLikeIsoTimestamp(s: string): boolean {
  if (s.length < 10) return false;
  if (s[4] !== '-' || s[7] !== '-') return false;
  // Either a bare date (YYYY-MM-DD) or a full timestamp
  if (s.length === 10) return /^\d{4}-\d{2}-\d{2}$/.test(s);
  return /^\d{4}-\d{2}-\d{2}[T ]/.test(s);
}

// Format a Date or ISO string in the chosen TZ. `kind` picks a sensible
// preset rather than asking every caller to spell out Intl options.
export function formatInTz(
  value: Date | string,
  tz: string,
  kind: 'datetime' | 'date' | 'time' | 'short' | 'hour' | 'day' | 'month' = 'datetime',
): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  const opts: Intl.DateTimeFormatOptions = (() => {
    switch (kind) {
      case 'datetime': return { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
      case 'date':     return { year: 'numeric', month: '2-digit', day: '2-digit' };
      case 'time':     return { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
      case 'short':    return { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
      case 'hour':     return { hour: '2-digit', hour12: false };
      case 'day':      return { month: '2-digit', day: '2-digit' };
      case 'month':    return { year: 'numeric', month: 'short' };
    }
  })();
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(d);
}
