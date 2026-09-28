import { createFileRoute } from "@tanstack/react-router";
import { SignInGate } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { CanopyApp, Landing } from "@/components/canopy-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink text-paper">
        <p className="font-display text-3xl text-leaf">Canopy</p>
      </main>
    );
  }
  return (
    <SignInGate fallback={<Landing />}>
      <CanopyApp />
    </SignInGate>
  );
}
