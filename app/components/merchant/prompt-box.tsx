import { CopyButton } from "@/components/arc/copy-button/copy-button";
import styles from "./prompt-box.module.css";

/** A prompt to paste into a coding agent. Plain text, not code, so nothing gets syntax colored. */
export function PromptBox({ text, label = "Prompt" }: { text: string; label?: string }) {
  return (
    <figure className={styles.box}>
      <figcaption className={styles.head}>
        <span>{label}</span>
        <CopyButton value={text} label="Copy prompt" variant="plain" />
      </figcaption>
      <p className={styles.text}>{text}</p>
    </figure>
  );
}
