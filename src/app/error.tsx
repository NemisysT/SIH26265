"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">
        The page could not be loaded. No action was completed. {error.digest && <span className="kbd-ref">Reference: {error.digest}</span>}
      </p>
      <button className="btn-primary mt-6" onClick={reset}>Try again</button>
    </main>
  );
}
