import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { GUEST_COOKIE, isGuestId, newGuestId } from "./guest";

export function readGuestId(): string | null {
  const fromStore = getCookie(GUEST_COOKIE);
  if (isGuestId(fromStore)) return fromStore;
  const header = getRequest()?.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${GUEST_COOKIE}=`)) continue;
    const value = decodeURIComponent(trimmed.slice(GUEST_COOKIE.length + 1));
    return isGuestId(value) ? value : null;
  }
  return null;
}

export function mintGuestCookie(): void {
  if (readGuestId()) return;
  setCookie(GUEST_COOKIE, newGuestId(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}
