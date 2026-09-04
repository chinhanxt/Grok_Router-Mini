import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonStorage {
  async read(filePath, defaultValue = []) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') return defaultValue;
      console.error(`Error reading ${filePath}:`, err);
      return defaultValue;
    }
  }

  async write(filePath, data) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpFile = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmpFile, filePath);
  }
}
