import Provider, { Scope } from "./Provider.js";

const hashCache = new Map();

async function sha256Hex(email) {
  if (hashCache.has(email)) return hashCache.get(email);
  const data = new TextEncoder().encode(email);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  hashCache.set(email, hashHex);
  return hashHex;
}

export default class LibravatarProvider extends Provider {
  constructor() {
    super("Libravatar", Scope.EMAIL);
  }

  async getUrl(mail) {
    const hashHex = await sha256Hex(mail.getEmail().trim().toLowerCase());
    return `https://seccdn.libravatar.org/avatar/${hashHex}?d=404`;
  }
}
