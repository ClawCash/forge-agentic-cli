import { createHash } from "node:crypto"

// A review's fingerprint, computed from the same fields anyone can read. The
// published log and app/public/verify-review.mjs depend on this exact form.

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonical(object[key])])
    )
  }
  return value ?? null
}

export const fingerprintOf = (record: Record<string, unknown>) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(record)))
    .digest("hex")}`
