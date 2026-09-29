import { createFileRoute } from "@tanstack/react-router";
import { SignInGate } from "@/lib/auth/gates";
import { guestCookiePresent } from "@/lib/auth/guest-fns";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { CanopyApp, Landing } from "@/components/canopy-app";

export const Route = createFileRoute("/")({
  loader: () => guestCookiePresent(),
  component: Home,
});

function Home() {
  const { guest } = Route.useLoaderData();
  const { user, isPending } = useCurrentUserState();
  const sessionUser = user && !user.isDevFallback ? user : null;
  if (isPending && !guest) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink text-paper">
        <p className="font-display text-3xl text-leaf">Canopy</p>
      </main>
    );
  }
  if (guest && !sessionUser) return <CanopyApp guest />;
  return (
    <SignInGate fallback={<Landing />}>
      <CanopyApp />
    </SignInGate>
  );
}
