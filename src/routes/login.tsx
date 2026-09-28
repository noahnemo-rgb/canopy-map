import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-ink px-6 text-paper">
      <div className="w-full max-w-sm space-y-4">
        <p className="font-display text-3xl text-leaf">Canopy</p>
        <h1 className="text-lg font-medium">Sign in to your map</h1>
        <p className="text-sm text-mute">Your repos stay on your account. Nobody else sees the map.</p>
        {authEnabled ? (
          GROK_PROVIDERS.map((p) => (
            <button
              key={p.providerId}
              type="button"
              onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              className="w-full rounded-md border border-line bg-panel px-4 py-3 text-sm font-medium text-paper hover:border-leaf"
            >
              Continue with {p.label}
            </button>
          ))
        ) : (
          <p className="text-sm text-mute">Sign-in is disabled.</p>
        )}
      </div>
    </main>
  );
}
