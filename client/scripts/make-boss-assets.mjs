import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../public/assets');
const assetsDir =
  'C:/Users/AYK/.cursor/projects/c-Users-AYK-Desktop-govorbit/assets';

const jobs = [
  {
    src: 'c__Users_AYK_AppData_Roaming_Cursor_User_workspaceStorage_c5f3b9b94938db5b691bada50e7dc7ef_images_image-eb058d14-c6a9-4500-8bef-815ab4493f15.png',
    out: 'cubikon-idle.png',
    size: 192,
  },
  {
    src: 'c__Users_AYK_AppData_Roaming_Cursor_User_workspaceStorage_c5f3b9b94938db5b691bada50e7dc7ef_images_image-aa67bc1b-850f-4278-90d1-7f1fb336f279.png',
    out: 'cubikon-angry.png',
    size: 220,
  },
  {
    src: 'c__Users_AYK_AppData_Roaming_Cursor_User_workspaceStorage_c5f3b9b94938db5b691bada50e7dc7ef_images_image-1f1238c4-7c56-4b2e-b671-e61a9da26ed1.png',
    out: 'protegit.png',
    size: 72,
  },
];

function colorDist(r1, g1, b1, r2, g2, b2) {
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

function isBackgroundPixel(r, g, b) {
  // Orange / red backdrop
  if (r > 140 && g < 150 && b < 130 && r > g + 20 && r > b + 25) return true;
  // Near white
  if (r > 228 && g > 228 && b > 228) return true;
  // Dark flat backdrop
  if (r < 42 && g < 42 && b < 48) return true;
  // Mid gray plate (common in angry cubikon export)
  if (r > 55 && r < 95 && g > 55 && g < 95 && b > 55 && b < 95) {
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread < 18) return true;
  }
  return false;
}

/** Flood-remove backdrop from corners + per-pixel key */
async function stripBackground(srcPath, outPath, size) {
  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const visited = new Uint8Array(w * h);
  const queue = [];

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    const vi = y * w + x;
    if (visited[vi]) return;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!isBackgroundPixel(r, g, b)) return;
    visited[vi] = 1;
    queue.push(x, y);
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  while (queue.length) {
    const x = queue.pop();
    const y = queue.pop();
    const i = (y * w + x) * 4;
    data[i + 3] = 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // Second pass: soften fringe halos
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] === 0) continue;
    if (isBackgroundPixel(r, g, b)) data[i + 3] = 0;
    else if (r > 200 && g > 200 && b > 200) data[i + 3] = Math.min(data[i + 3], 48);
  }

  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 8 })
    .png()
    .toFile(outPath);
  console.log('wrote', outPath);
}

for (const job of jobs) {
  await stripBackground(join(assetsDir, job.src), join(outDir, job.out), job.size);
}
