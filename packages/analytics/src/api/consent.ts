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

// eslint-disable-next-line @typescript-eslint/require-await
export async function GET(request: Request) {
  const country = request.headers.get('x-vercel-ip-country')?.toUpperCase() || null
  const requiresConsent = country ? EEA_UK_CH_COUNTRY_CODES.has(country) : true

  return Response.json({ requiresConsent })
}
