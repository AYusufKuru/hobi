import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '../public/assets/droid.png');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="eye" cx="50%" cy="45%" r="50%">
      <stop offset="0%" stop-color="#ffe566"/>
      <stop offset="55%" stop-color="#f0a800"/>
      <stop offset="100%" stop-color="#a86800"/>
    </radialGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f2f4f7"/>
      <stop offset="45%" stop-color="#c8ced6"/>
      <stop offset="100%" stop-color="#8a929c"/>
    </linearGradient>
    <linearGradient id="core" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3a4048"/>
      <stop offset="100%" stop-color="#151820"/>
    </linearGradient>
  </defs>
  <path d="M18 14 C10 22, 10 42, 18 50 C22 46, 24 36, 24 32 C24 28, 22 18, 18 14 Z" fill="url(#plate)" stroke="#6a7078" stroke-width="1"/>
  <path d="M46 14 C54 22, 54 42, 46 50 C42 46, 40 36, 40 32 C40 28, 42 18, 46 14 Z" fill="url(#plate)" stroke="#6a7078" stroke-width="1"/>
  <ellipse cx="32" cy="32" rx="11" ry="16" fill="url(#core)" stroke="#0a0c10" stroke-width="1"/>
  <ellipse cx="32" cy="16" rx="5" ry="4" fill="#d8dde4" opacity="0.9"/>
  <circle cx="32" cy="30" r="5.5" fill="url(#eye)"/>
  <circle cx="30.5" cy="28.5" r="1.6" fill="#fff6c8" opacity="0.85"/>
  <rect x="28" y="44" width="3" height="6" rx="1" fill="#66e0ff" opacity="0.55"/>
  <rect x="33" y="44" width="3" height="6" rx="1" fill="#66e0ff" opacity="0.55"/>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
const meta = await sharp(out).metadata();
console.log('wrote', out, meta.width, 'x', meta.height, 'alpha=', meta.hasAlpha);
