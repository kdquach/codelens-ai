// apps/server/src/utils/crypto.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Tạo 32-byte key từ secret bằng SHA-256
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'codelens-default-aes-encryption-secret-32bytes!';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Mã hóa chuỗi token bằng AES-256-GCM
 * Định dạng lưu trữ: iv:authTag:encryptedData (hex)
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Giải mã chuỗi token đã mã hóa bằng AES-256-GCM
 */
export function decryptToken(encryptedPayload: string): string {
  if (!encryptedPayload) return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    // Nếu token chưa được mã hóa định dạng AES-GCM (ví dụ plain token cũ)
    return encryptedPayload;
  }

  const [ivHex, tagHex, dataHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(dataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error: any) {
    console.error('❌ [Crypto] Giải mã AES-256 thất bại:', error.message);
    return '';
  }
}

