/** One date format everywhere (locale-aware short date, e.g. "Oct 27, 2026" or "27 Oct 2026"). */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(+d)) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "in 29 days · 27 Oct 2026" / "3 days ago · 24 Jul 2026" / "today · …" */
export function formatRelative(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(+d)) return '—';
  const days = Math.round((+d - Date.now()) / 86_400_000);
  const rel =
    days === 0
      ? 'today'
      : days > 0
        ? `in ${days} day${days === 1 ? '' : 's'}`
        : `${-days} day${days === -1 ? '' : 's'} ago`;
  return `${rel} · ${formatDate(iso)}`;
}

/**
 * Date + time in one place, e.g. "27 Oct 2026, 14:30". Used for `title=`
 * tooltips and detail rows — routes must never call `toLocaleString()` directly,
 * or the timezone/format silently varies per screen.
 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(+d)) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Clock time only, e.g. "14:30". */
export function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(+d)) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
