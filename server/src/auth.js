import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(pw, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(pw, stored) {
  const [salt, hex] = stored.split(':');
  const key = await scryptAsync(pw, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}