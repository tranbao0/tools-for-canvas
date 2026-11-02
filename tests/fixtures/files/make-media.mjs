// Writes tests/fixtures/files/tone.wav and clip.webm, the audio and video fixtures of the pane tests.
// Usage: node tests/fixtures/files/make-media.mjs
//
// tone.wav is 0.5 s of a 440 Hz sine wave: 8 kHz, 16-bit, mono, written byte by byte.
// clip.webm is 2 s of VP9 video, 320 by 180 pixels at 5 frames per second, with no sound.
// Chromium draws the frames, and the ffmpeg build that Playwright ships encodes them.
// Set FFMPEG_BIN to use another ffmpeg that has the libvpx-vp9 encoder.
// Both formats play in Chromium and in Firefox without a system codec.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const OUT = new URL('.', import.meta.url).pathname;
const WIDTH = 320;
const HEIGHT = 180;
const FRAMES = 10;
const FRAME_RATE = 5;

function writeTone() {
  const rate = 8000;
  const samples = rate / 2;
  const data = Buffer.alloc(samples * 2);
  for (let at = 0; at < samples; at += 1) {
    const fade = Math.min(1, at / 200, (samples - at) / 200);
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * at) / rate) * 12000 * fade), at * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path.join(OUT, 'tone.wav'), Buffer.concat([header, data]));
}

function findFfmpeg() {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(homedir(), '.cache', 'ms-playwright');
  const dir = existsSync(root)
    ? readdirSync(root).find((name) => name.startsWith('ffmpeg-'))
    : undefined;
  const bin = dir && path.join(root, dir, 'ffmpeg-linux');
  if (!bin || !existsSync(bin)) throw new Error('No ffmpeg found. Set FFMPEG_BIN.');
  return bin;
}

async function writeClip() {
  const ffmpeg = spawn(
    findFfmpeg(),
    [
      ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg'],
      ...[
        '-framerate',
        String(FRAME_RATE),
        '-i',
        'pipe:0',
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuv420p',
      ],
      ...['-b:v', '0', '-crf', '40', '-an', path.join(OUT, 'clip.webm')],
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('exit', (code) =>
      code === 0 ? resolve(undefined) : reject(new Error(`ffmpeg exit ${code}`)),
    );
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    for (let frame = 0; frame < FRAMES; frame += 1) {
      const left = 30 + (frame * (WIDTH - 60 - 40)) / (FRAMES - 1);
      await page.setContent(
        `<body style="margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:linear-gradient(135deg,#1d4f7a,#e0a63a);font:600 20px sans-serif;color:#fff;overflow:hidden">
          <div style="position:absolute;left:16px;top:12px">Lecture clip</div>
          <div style="position:absolute;left:${left}px;top:80px;width:40px;height:40px;border-radius:50%;background:#fff"></div>
          <div style="position:absolute;right:16px;bottom:12px">${frame + 1} / ${FRAMES}</div>
        </body>`,
      );
      ffmpeg.stdin.write(await page.screenshot({ type: 'jpeg', quality: 90 }));
    }
  } finally {
    await browser.close();
    ffmpeg.stdin.end();
  }
  await done;
}

writeTone();
await writeClip();
console.log(`Wrote tone.wav and clip.webm in ${OUT}`);
