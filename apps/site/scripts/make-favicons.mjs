// Makes the favicon set and the social preview image from the logo.
//
//   pnpm --filter @god/site favicons        (run on server-f, never on the laptop)
//
// Input:  src/assets/god-logo.png (1367 x 538, indigo on transparent: the globe mark on the left, the words
//         "GLOBAL OMNI DATA" on the right).
// Output (checked in, so a normal build does not need to run this):
//   public/icon-32.png, icon-180.png, icon-512.png   the globe mark only, indigo on transparent, square
//   public/og-image.png                              1200 x 630 social preview: the full logo on the page colour
//
// To change the mark, replace the logo and run this again on server-f, then commit the PNGs.
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const logo = here("../src/assets/god-logo.png");
const out = here("../public/");
await mkdir(out, { recursive: true });

// The globe mark ends at about x = 490 and the wordmark starts at about x = 530, so cut at 510.
const MARK_CUT = 510;
const meta = await sharp(logo).metadata();
// Two steps, because sharp runs trim before extract inside one pipeline.
const left = await sharp(logo)
  .ensureAlpha()
  .extract({ left: 0, top: 0, width: MARK_CUT, height: meta.height })
  .png()
  .toBuffer();
const mark = await sharp(left).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });

// Centre the trimmed mark on a transparent square with 6% breathing room.
const { width: w, height: h } = mark.info;
const side = Math.max(w, h);
const pad = Math.round(side * 0.06);
const size = side + 2 * pad;
const square = await sharp({
  create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    { input: mark.data, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) },
  ])
  .png()
  .toBuffer();

for (const px of [32, 180, 512]) {
  await sharp(square)
    .resize(px, px, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toFile(`${out}icon-${px}.png`);
  console.log(`icon-${px}.png (mark ${w}x${h} trimmed from the logo, square ${size})`);
}

// Social preview: the full logo, centred on the site's page colour (#F5F6FB).
const logoWide = await sharp(logo)
  .resize({ width: 760 })
  .png()
  .toBuffer({ resolveWithObject: true });
await sharp({
  create: { width: 1200, height: 630, channels: 4, background: "#F5F6FB" },
})
  .composite([
    {
      input: logoWide.data,
      left: Math.round((1200 - logoWide.info.width) / 2),
      top: Math.round((630 - logoWide.info.height) / 2),
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile(`${out}og-image.png`);
console.log("og-image.png (1200x630)");
