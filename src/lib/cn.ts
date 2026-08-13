/** Tiny class-name joiner — drops falsey values and collapses whitespace. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
