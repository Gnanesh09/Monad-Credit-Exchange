import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden px-6">
      <div className="pointer-events-none absolute h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,hsl(56_96%_58%/.18),transparent_65%)]" />
      <div className="relative text-center">
        <p className="num text-sm text-primary">404 · no such block</p>
        <h1 className="mt-4 font-display text-6xl font-semibold md:text-7xl">This page never settled.</h1>
        <p className="mx-auto mt-4 max-w-md text-muted-foreground">The address you followed does not exist, or the loan you are looking for has a different id.</p>
        <div className="mt-9 flex justify-center gap-3">
          <Link href="/app" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground">Open the market</Link>
          <Link href="/" className="inline-flex h-11 items-center rounded-full px-6 text-sm text-muted-foreground ring-1 ring-inset ring-border hover:text-foreground">Home</Link>
        </div>
      </div>
    </main>
  );
}
