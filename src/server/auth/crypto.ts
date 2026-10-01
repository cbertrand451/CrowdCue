import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export class TokenCipher {
  constructor(
    private readonly activeKeyId: string,
    private readonly keys: Record<string, Buffer>,
  ) {
    if (
      !Object.hasOwn(keys, activeKeyId) ||
      Object.values(keys).some(
        (key) => !Buffer.isBuffer(key) || key.length !== 32,
      )
    ) {
      throw new Error('Invalid token encryption configuration');
    }
  }
  encrypt(value: string, context: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys[this.activeKeyId],
      nonce,
    );
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return {
      keyId: this.activeKeyId,
      data: Buffer.concat([
        Buffer.from([1]),
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]),
    };
  }
  decrypt(data: Buffer, keyId: string, context: string) {
    const key = this.keys[keyId];
    if (!key || data.length < 30 || data[0] !== 1)
      throw new Error('Unable to decrypt credentials');
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        data.subarray(1, 13),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(data.subarray(13, 29));
      return Buffer.concat([
        decipher.update(data.subarray(29)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Unable to decrypt credentials');
    }
  }
}
