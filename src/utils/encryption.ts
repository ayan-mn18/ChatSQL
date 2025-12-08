import crypto from 'crypto';

// ============================================
// ENCRYPTION UTILITY
// AES-256-GCM encryption for sensitive data like database passwords
// ============================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits

/**
 * Get encryption key from environment
 * Must be a 32-byte (256-bit) key
 */
const getEncryptionKey = (): Buffer => {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
  // If key is a hex string, convert to buffer
  if (key.length === 64) {
    return Buffer.from(key, 'hex');
  }
  
  // If key is a plain string, derive a key using PBKDF2
  return crypto.pbkdf2Sync(key, 'chatsql-salt', 100000, 32, 'sha256');
};

/**
 * Encrypt a string using AES-256-GCM
 * Returns: base64 encoded string of (iv + authTag + ciphertext)
 * 
 * @param plaintext - The string to encrypt (e.g., database password)
 * @returns Encrypted string (base64 encoded)
 */
export const encrypt = (plaintext: string): string => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  // Combine: iv (16 bytes) + authTag (16 bytes) + ciphertext
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, 'base64')
  ]);
  
  return combined.toString('base64');
};

/**
 * Decrypt a string that was encrypted with encrypt()
 * 
 * @param encryptedData - Base64 encoded encrypted string
 * @returns Original plaintext string
 */
export const decrypt = (encryptedData: string): string => {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Extract: iv (16 bytes) + authTag (16 bytes) + ciphertext
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext.toString('base64'), 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

/**
 * Generate a secure random encryption key
 * Use this to generate the ENCRYPTION_KEY for .env
 * 
 * @returns 64-character hex string (32 bytes / 256 bits)
 */
export const generateEncryptionKey = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

// ============================================
// USAGE EXAMPLE:
// ============================================
// 
// // Generate a key for .env (run once):
// console.log('ENCRYPTION_KEY=' + generateEncryptionKey());
// 
// // Encrypt a password:
// const encrypted = encrypt('my-database-password');
// 
// // Decrypt when needed (e.g., to connect to user's DB):
// const password = decrypt(encrypted);
// ============================================
