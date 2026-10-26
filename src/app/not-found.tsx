import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">404</p>
      <h1 className="mt-2 text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-ink-muted">The page or record does not exist, or you are not authorised to view it.</p>
      <Link href="/dashboard" className="btn-primary mt-6">Back to overview</Link>
    </main>
  );
}
