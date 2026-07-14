"use client";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="configuration-screen">
      <div className="brand-mark large" aria-hidden="true">DT</div>
      <div className="state-panel state-panel-error" role="alert"><span className="state-symbol" aria-hidden="true">!</span><div><h1>This view could not be rendered</h1><p>No action was executed. Retry the view or return after the service recovers.</p><div className="state-action"><button className="button button-primary" onClick={reset}>Retry</button></div></div></div>
    </main>
  );
}
