const { safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

class CredentialVault {
  constructor(dataDir, storage = safeStorage) {
    this.file = path.join(dataDir, 'credentials.json');
    this.storage = storage;
  }

  readAll() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid vault');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('密钥存储文件损坏，请先备份并恢复文件 / Credential storage is damaged; back up and restore the file first');
    }
  }

  save(reference, secret) {
    if (!this.storage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用 / System credential storage is unavailable');
    const values = this.readAll();
    values[reference] = this.storage.encryptString(secret).toString('base64');
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(values), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    return reference;
  }

  get(reference) {
    try {
      const encoded = this.readAll()[reference];
      if (!encoded) return null;
      return this.storage.decryptString(Buffer.from(encoded, 'base64'));
    } catch {
      // A migrated or damaged credential must not crash startup or erase other keys.
      // Callers treat null as requiring sign-in / API-key verification again.
      return null;
    }
  }
}

module.exports = { CredentialVault };
