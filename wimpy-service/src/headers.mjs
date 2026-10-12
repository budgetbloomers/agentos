/**
 * THE SECURITY HEADERS, ONCE (Spec Kit 018). The Pages site sent these from site/_headers; the service sends the same on
 * every answer — the page and the API share one origin, so connect-src is 'self' and there is no CORS at all.
 * vercel.json repeats the CSP for the static page Vercel serves itself; test/hosting.test.mjs fails if the two differ.
 */
export const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
  + "img-src 'self' data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; base-uri 'none'; form-action 'self'; "
  + "object-src 'none'; frame-ancestors 'none'";

export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, must-revalidate',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',   // honoured only over TLS — which every public host must terminate
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': CSP,
};
