import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Copy text to the clipboard, returning whether it actually succeeded.
//
// `navigator.clipboard.writeText` is only available in *secure contexts*
// (HTTPS or localhost). This gateway is very often reached over plain HTTP
// via a LAN IP (e.g. http://192.168.x.x:PORT), where `navigator.clipboard`
// is `undefined` and a naive call throws synchronously — the copy silently
// never happens and any "copied!" feedback is skipped too. To stay reliable
// across those contexts we fall back to a hidden <textarea> +
// `document.execCommand('copy')`, which works on plain HTTP.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied / not focused — fall through to legacy path.
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    // Off-screen so the fallback is invisible. `position:fixed` avoids
    // scrolling the page to the element on some browsers.
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.left = '-9999px'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)
    textarea.select()
    // execCommand is deprecated but remains the only sync copy primitive
    // available outside secure contexts; the modern API is preferred above.
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

// SQLite stores timestamps as `YYYY-MM-DD HH:MM:SS` with no timezone marker, so
// passing them straight to `new Date(...)` makes the browser read them as LOCAL
// time when they are actually UTC — shifting every displayed time by the
// viewer's offset. These helpers tag the value as UTC before parsing. (#170)

/** Convert a SQLite UTC datetime string into an ISO-8601 UTC string. */
export function sqliteUtcToIso(value: string): string {
  // Already ISO (has 'T' and a zone/offset)? Leave it alone.
  if (value.includes('T')) return value;
  return value.replace(' ', 'T') + 'Z';
}

/** Format a SQLite UTC datetime string as the viewer's local time-of-day. */
export function formatSqliteUtcToLocalTime(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' },
): string {
  if (!value) return '—';
  const date = new Date(sqliteUtcToIso(value));
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], options);
}
