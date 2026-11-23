import type { Leaderboard } from "@/lib/leaderboard"
import styles from "./review-backdrop.module.css"

// Real reviews from the leaderboard drift behind the sign-in card: one note
// per API, with the API's own name, icon and rating. Decoration only, so it
// is hidden from assistive tech and stays still for reduced motion.

export interface BackdropReview {
  domain: string
  name: string
  icon: string | null
  stars: number
  note: string
}

export function backdropReviews(board: Leaderboard | null, limit = 25) {
  return (board?.top ?? [])
    .filter((entry) => entry.notes.length > 0)
    .slice(0, limit)
    .map((entry) => ({
      domain: entry.domain,
      name: entry.name ?? entry.domain,
      icon: entry.icon_url,
      stars: entry.stars,
      note: entry.notes[0],
    }))
}

const STAR =
  "m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.45l-5.8 3.05 1.1-6.47L2.6 9.45l6.5-.95z"

function Card({ review }: { review: BackdropReview }) {
  return (
    <figure className={styles.card}>
      <figcaption className={styles.head}>
        {review.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={review.icon} alt="" className={styles.icon} loading="lazy" />
        ) : (
          <span className={styles.icon}>{review.name[0].toUpperCase()}</span>
        )}
        <span className={styles.name}>{review.name}</span>
        <span className={styles.stars}>
          {[0, 1, 2, 3, 4].map((i) => (
            <svg key={i} viewBox="0 0 24 24" data-on={i < Math.round(review.stars) || undefined}>
              <path d={STAR} />
            </svg>
          ))}
        </span>
      </figcaption>
      <p className={styles.note}>{review.note}</p>
      <span className={styles.domain}>{review.domain}</span>
    </figure>
  )
}

export function ReviewBackdrop({ reviews }: { reviews: BackdropReview[] }) {
  if (reviews.length === 0) return null
  const COLUMNS = 5
  // Deal the cards into columns, then pad short columns by repeating.
  const columns = Array.from({ length: COLUMNS }, (_, c) => {
    const own = reviews.filter((_, i) => i % COLUMNS === c)
    const base = own.length ? own : reviews
    const filled = [...base]
    for (let i = 0; filled.length < 5; i += 1) filled.push(reviews[(c + i) % reviews.length])
    return filled
  })
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <div className={styles.field}>
        {columns.map((cards, c) => (
          <div key={c} className={styles.column}>
            {/* Twice over, so the loop has no seam. */}
            {[...cards, ...cards].map((review, i) => (
              <Card key={`${review.domain}-${i}`} review={review} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
