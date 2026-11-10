/* WHICH BROWSER, WHICH PAGE, WHAT WENT WRONG WITH THE TYPING — on every sign-in audit row (10 Nov 2026).
   "20+ agents cannot log in with their CB number and agentos123": the stored passwords were right, and twelve people sent
   something else 39 times on new Linux PCs, but auth_log could not say which browser, which page, or whether Caps Lock or
   Number Lock was involved — the diagnosis had to be pieced together from the sessions of the people who DID get in.

   signinClient(userAgent, body) → a short label such as "Firefox 136 | Linux | /agent/ | caps,numpad_off".
   It is sent to PostgREST as the x-cbx-signin header on the sign-in request only (index.mjs builds that one client with
   db(env, {...})), and migration-070's column default copies it onto every auth_log row written during that request.
   That keeps it out of the SHARED-AUTH blocks in auth.mjs, which the Wimpy service copies verbatim.

   WHAT IT MAY CARRY — nothing about the password's content:
     - browser family + major version, and the operating system, from the User-Agent header
     - the page path the sign-in came from (body.page), only if it is a plain path; otherwise "other page"
     - up to four yes/no typing facts the page observed (body.hints), from a FIXED list — anything else is dropped:
         caps        Caps Lock was on while the password was typed
         numpad_off  a keypad digit was pressed with Number Lock off, so it never went in
         filled      the password arrived without being typed (the browser's saved password, or paste)
         space       the password starts or ends with a space
   The result uses only header-safe characters and is at most 120 characters. */

export const HINTS = ['caps', 'numpad_off', 'filled', 'space'];
const MAX = 120;

function browserOf(ua) {
  const m = (re) => { const x = re.exec(ua); return x ? x[1] : ''; };
  let v;
  if ((v = m(/Edg(?:e|A|iOS)?\/(\d+)/))) return 'Edge ' + v;
  if ((v = m(/OPR\/(\d+)/))) return 'Opera ' + v;
  if ((v = m(/SamsungBrowser\/(\d+)/))) return 'Samsung ' + v;
  if ((v = m(/FxiOS\/(\d+)/))) return 'Firefox ' + v;
  if ((v = m(/Firefox\/(\d+)/))) return 'Firefox ' + v;
  if ((v = m(/CriOS\/(\d+)/))) return 'Chrome ' + v;
  if ((v = m(/Chrome\/(\d+)/))) return 'Chrome ' + v;
  if (/Safari\//.test(ua) && (v = m(/Version\/(\d+)/))) return 'Safari ' + v;
  return ua ? 'other browser' : 'unknown browser';
}

function systemOf(ua) {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'Mac';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return '';
}

function pageOf(page) {
  if (page == null || page === '') return '';
  return typeof page === 'string' && /^\/[A-Za-z0-9/_-]{0,40}$/.test(page) ? page : 'other page';
}

export function signinClient(userAgent, body) {
  const ua = String(userAgent || '').slice(0, 512);
  const b = body && typeof body === 'object' ? body : {};
  const sent = Array.isArray(b.hints) ? b.hints.filter((h) => typeof h === 'string') : [];
  const hints = HINTS.filter((h) => sent.includes(h));
  const parts = [browserOf(ua), systemOf(ua), pageOf(b.page), hints.join(',')].filter(Boolean);
  return parts.join(' | ').replace(/[^A-Za-z0-9 ./_,|-]/g, '').slice(0, MAX);
}
