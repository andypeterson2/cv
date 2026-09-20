/**
 * The origin secret this Worker presents to cv.
 *
 * cv accepts a comma-separated set of secrets, so the value rotates without an
 * outage. A sender presents a single entry — the first — because forwarding the raw
 * setting would send the literal "new,old", which matches nothing and gets a 403.
 * cv keeps accepting the remaining entries until the rotation finishes.
 */
export function currentOriginSecret(raw: string | undefined): string | undefined {
  const [first] = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return first;
}
