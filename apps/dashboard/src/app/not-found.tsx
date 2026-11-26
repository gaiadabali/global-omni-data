import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1>Page not found</h1>
      <p className="sub muted mt-2">There is nothing at this address.</p>
      <p className="mt-4">
        <Link className="btn primary" href="/">
          Go to the dashboard
        </Link>
      </p>
    </main>
  );
}
