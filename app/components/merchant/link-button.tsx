import Link from "next/link";
import type { ComponentProps } from "react";
import styles from "@/components/arc/button/button.module.css";

type Props = ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
};

/** A navigation link that looks like an Arc button. Navigation stays a real link. */
export function LinkButton({ variant = "primary", size = "md", className, children, ...props }: Props) {
  return (
    <Link {...props} className={[styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ")} style={{ textDecoration: "none", ...props.style }}>
      {children}
    </Link>
  );
}
