// Token degli inviti, uguale per gli adapter memory e Firebase (il server ha il suo in Python).

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 128 bit casuali in base32 (26 caratteri): mai un UUIDv7, che si indovina dal tempo. */
export function inviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}
