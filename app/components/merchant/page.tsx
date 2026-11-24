import type { ReactNode } from "react";
import styles from "./page.module.css";

/** The one page container for dashboard views: gutter, max width and header rhythm. */
export function Page({ title, description, actions, back, tabs, children }: { title: string; description?: ReactNode; actions?: ReactNode; back?: ReactNode; tabs?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <header className={styles.header}>
          <div className={styles.heading}>
            {back}
            <h1 className={styles.title}>{title}</h1>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
        {tabs}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, description, actions, children, className, flush }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={[styles.card, flush ? styles.flush : "", className].filter(Boolean).join(" ")} aria-label={title}>
      {(title || actions) && (
        <div className={styles.cardHead}>
          <div className={styles.cardHeading}>
            {title && <h2 className={styles.cardTitle}>{title}</h2>}
            {description && <p className={styles.cardDescription}>{description}</p>}
          </div>
          {actions && <div className={styles.cardActions}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Grid({ children, columns = "2-1", align = "stretch" }: { children: ReactNode; columns?: "2-1" | "1-1" | "1-1-1" | "1-2"; align?: "stretch" | "start" }) {
  return <div className={styles.grid} data-columns={columns} data-align={align}>{children}</div>;
}
