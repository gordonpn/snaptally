/** Normalizes IPv6 clients to a /64 using the runtime URL parser; IPv4 stays intact. */
function clientNetwork(ip: string): string {
  if (!ip.includes(":")) return ip;
  try {
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split("::");
    const leading = left ? left.split(":") : [];
    const trailing = right ? right.split(":") : [];
    const groups =
      right === undefined
        ? leading
        : [...leading, ...Array(8 - leading.length - trailing.length).fill("0"), ...trailing];
    return `${groups
      .slice(0, 4)
      .map((part) => part.padStart(4, "0"))
      .join(":")}::/64`;
  } catch {
    return "invalid-ipv6";
  }
}

/** Hashes the trusted client network with a minute scope; missing IPs share a local bucket. */
export async function hashClientIp(request: Request, minute: number): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${minute}:${clientNetwork(ip)}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
