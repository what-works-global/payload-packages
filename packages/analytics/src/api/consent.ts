const EEA_UK_CH_COUNTRY_CODES = new Set([
  'AT',
  'BE',
  'BG',
  'CH',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
])

// Vercel, AWS Amplify Hosting / CloudFront, and Cloudflare each expose the
// viewer's country under a different header. Amplify only forwards
// cloudfront-viewer-country on its Web Compute (Next.js SSR) platform.
const COUNTRY_HEADERS = ['x-vercel-ip-country', 'cloudfront-viewer-country', 'cf-ipcountry']

// eslint-disable-next-line @typescript-eslint/require-await
export async function GET(request: Request) {
  const country =
    COUNTRY_HEADERS.map((header) => request.headers.get(header)?.toUpperCase()).find(Boolean) ||
    null
  const requiresConsent = country ? EEA_UK_CH_COUNTRY_CODES.has(country) : true

  return Response.json({ requiresConsent })
}
