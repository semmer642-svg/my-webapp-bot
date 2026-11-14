import crypto from "node:crypto";

export function verifyTelegramInitData(initData: string, botToken: string): Record<string,string> {
  if (!initData || !botToken) throw new Error("Telegram auth is not configured");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Missing Telegram hash");
  params.delete("hash");
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now()/1000 - authDate) > 60*60*24) {
    throw new Error("Telegram initData expired");
  }
  const dataCheck = [...params.entries()].sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(calculated, "hex"), b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) throw new Error("Invalid Telegram signature");
  return Object.fromEntries(params.entries());
}
