import { createServerFn } from "@tanstack/react-start";

export const guestCookiePresent = createServerFn({ method: "GET" }).handler(async () => {
  const { readGuestId } = await import("./guest.server");
  return { guest: readGuestId() !== null };
});

export const enterFreeMap = createServerFn({ method: "POST" }).handler(async () => {
  const { mintGuestCookie } = await import("./guest.server");
  mintGuestCookie();
  return { ok: true as const };
});
