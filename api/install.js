// api/install.js - Serve 1-Click Installer scripts for Windows PowerShell and macOS/Linux Bash
import fs from 'node:fs';
import path from 'node:path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  const { searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const type = searchParams.get('type') || '';

  if (type === 'ps1' || req.url.includes('.ps1')) {
    const filePath = path.join(process.cwd(), 'docs/install.ps1');
    if (fs.existsSync(filePath)) {
      return res.status(200).send(fs.readFileSync(filePath, 'utf8'));
    }
  }

  const filePath = path.join(process.cwd(), 'docs/install.sh');
  if (fs.existsSync(filePath)) {
    return res.status(200).send(fs.readFileSync(filePath, 'utf8'));
  }

  res.status(404).send('Not found');
}
