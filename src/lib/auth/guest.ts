export const GUEST_COOKIE = "canopy_guest_id";

const GUEST_ID = /^guest-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuestId(value: string | null | undefined): value is string {
  return typeof value === "string" && value !== "dev-user" && GUEST_ID.test(value);
}

export function newGuestId(): string {
  return `guest-${crypto.randomUUID()}`;
}
