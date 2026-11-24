export const FORGE_URL = "https://forgeintel.co"
export const SITE_URL = "https://402reviews.xyz"
export const API_URL = "https://api.402reviews.xyz"
// Where API providers sign in and manage their listing.
export const APP_URL = "https://providers.402reviews.xyz"
// Server-side pages can point at a local API when testing.
export const SERVER_API_URL = process.env.LOCAL_API_URL ?? API_URL
export const SKILL_URL = `${SITE_URL}/SKILL.md`

// What people paste into their agent. The skill works out the rest.
export const SKILL_PROMPT = `Read ${SKILL_URL} and set it up.`
