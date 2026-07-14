import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: "positive" | "warning" | "danger" | "info" | "neutral" | "violet";
  children: ReactNode;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function Button({
  variant = "primary",
  busy = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button className={`button button-${variant}`} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {busy ? <Spinner label="Working" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Panel({ className = "", children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section className={`panel ${className}`} {...props}>
      {children}
    </section>
  );
}

export function StatePanel({
  type,
  title,
  description,
  action,
}: {
  type: "empty" | "error" | "denied" | "revoked";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const symbols = { empty: "○", error: "!", denied: "×", revoked: "↯" };
  return (
    <div className={`state-panel state-panel-${type}`} role={type === "error" ? "alert" : "status"}>
      <span className="state-symbol" aria-hidden="true">{symbols[type]}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
        {action ? <div className="state-action">{action}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({ lines = 3, compact = false }: { lines?: number; compact?: boolean }) {
  return (
    <div className={`skeleton-stack ${compact ? "skeleton-compact" : ""}`} aria-label="Loading content" role="status">
      <span className="skeleton-block skeleton-title" />
      {Array.from({ length: lines }, (_, index) => (
        <span className="skeleton-block" style={{ width: `${92 - index * 9}%` }} key={index} />
      ))}
    </div>
  );
}

export function Hash({ value }: { value: string }) {
  const [algorithm, digest] = value.split(":");
  return (
    <code className="hash" title={value}>
      {algorithm}:<span>{digest ? `${digest.slice(0, 8)}…${digest.slice(-6)}` : value}</span>
    </code>
  );
}

export function DefinitionList({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="definition-list">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="visually-hidden">{children}</span>;
}
