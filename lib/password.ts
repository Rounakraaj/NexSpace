import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const saltBytes = 16;
const keyBytes = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(saltBytes).toString("hex");
  const key = await scrypt(password, salt, keyBytes) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [version, salt, encodedKey, extra] = storedHash.split(":");
  if (version !== "scrypt" || !salt || !encodedKey || extra !== undefined) return false;
  if (!new RegExp(`^[a-f0-9]{${saltBytes * 2}}$`, "i").test(salt)) return false;
  if (!new RegExp(`^[a-f0-9]{${keyBytes * 2}}$`, "i").test(encodedKey)) return false;

  const actual = await scrypt(password, salt, keyBytes) as Buffer;
  const expected = Buffer.from(encodedKey, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
