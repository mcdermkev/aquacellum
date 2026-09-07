import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderSource } from "./worker.mjs";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_DERIVATIVE_BYTES = 4 * 1024 * 1024;
const MAX_PEAK_RSS_MIB = 1536;
const scriptPath = fileURLToPath(import.meta.url);

function chunk(type, payload) {
  const padding = payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  const result = Buffer.alloc(8);
  result.write(type, 0, 4, "ascii");
  result.writeUInt32LE(payload.length, 4);
  return Buffer.concat([result, payload, padding]);
}

function uint24(value) {
  const result = Buffer.alloc(3);
  result.writeUIntLE(value, 0, 3);
  return result;
}

function animatedWebpFromStatic(staticWebp, width, height) {
  if (staticWebp.subarray(0, 4).toString("ascii") !== "RIFF"
      || staticWebp.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error("static_webp_fixture_invalid");
  }
  const imageChunks = staticWebp.subarray(12);
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02;
  uint24(width - 1).copy(vp8x, 4);
  uint24(height - 1).copy(vp8x, 7);
  const animation = Buffer.alloc(6);
  animation.writeUInt16LE(0, 4);
  const frameHeader = Buffer.concat([
    uint24(0), uint24(0), uint24(width - 1), uint24(height - 1), uint24(100), Buffer.from([0]),
  ]);
  const frame = chunk("ANMF", Buffer.concat([frameHeader, imageChunks]));
  const payload = Buffer.concat([
    Buffer.from("WEBP", "ascii"), chunk("VP8X", vp8x), chunk("ANIM", animation), frame, frame,
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

async function writeCreatedImage(path, width, height, format, withMetadata = false) {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 31, g: 113, b: 173 } },
  });
  if (withMetadata) image = image.withMetadata({ orientation: 6 });
  if (format === "jpeg") image = image.jpeg({ quality: 90, chromaSubsampling: "4:4:4" });
  else if (format === "png") image = image.png({ compressionLevel: 9 });
  else if (format === "webp") image = image.webp({ quality: 90, effort: 5 });
  else throw new Error(`unsupported_fixture_format:${format}`);
  await image.toFile(path);
}

async function runCase(path, name) {
  const source = await readFile(path);
  const started = process.hrtime.bigint();
  try {
    const rendered = await renderSource(source);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const peakRssMiB = process.resourceUsage().maxRSS / 1024;
    const outputs = Object.fromEntries(["hero", "thumb"].map((variant) => {
      const output = rendered[variant];
      return [variant, {
        width: output.width,
        height: output.height,
        byteSize: output.bytes.length,
        checksumHex: output.checksumHex,
      }];
    }));
    const invalidOutput = Object.values(outputs).some((output) =>
      output.byteSize < 1 || output.byteSize > MAX_DERIVATIVE_BYTES
    );
    if (invalidOutput) throw new Error("corpus_derivative_bound_failed");
    console.log(JSON.stringify({
      name, outcome: "accepted", sourceBytes: source.length,
      width: rendered.metadata.width, height: rendered.metadata.height,
      format: rendered.container, elapsedMs: Number(elapsedMs.toFixed(2)),
      peakRssMiB: Number(peakRssMiB.toFixed(2)), outputs,
    }));
  } catch (error) {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const peakRssMiB = process.resourceUsage().maxRSS / 1024;
    console.log(JSON.stringify({
      name, outcome: "rejected", sourceBytes: source.length,
      code: String(error?.code || error?.message || "UNKNOWN"),
      elapsedMs: Number(elapsedMs.toFixed(2)), peakRssMiB: Number(peakRssMiB.toFixed(2)),
    }));
  }
}

async function buildCorpus(root) {
  const paths = {
    jpeg20mp: join(root, "jpeg-20mp.jpg"),
    pngWide20mp: join(root, "png-8192x2441.png"),
    webp20mp: join(root, "webp-20mp.webp"),
    jpegMetadata: join(root, "jpeg-metadata.jpg"),
    overPixels: join(root, "over-pixels.png"),
    overDimension: join(root, "over-dimension.png"),
    svg: join(root, "source.svg"),
    jpegTrailing: join(root, "jpeg-trailing.jpg"),
    jpegTruncated: join(root, "jpeg-truncated.jpg"),
    pngTrailing: join(root, "png-trailing.png"),
    pngCrc: join(root, "png-crc.png"),
    webpTrailing: join(root, "webp-trailing.webp"),
    animatedWebp: join(root, "animated.webp"),
    oversized: join(root, "oversized.bin"),
    random: join(root, "random.bin"),
  };

  await writeCreatedImage(paths.jpeg20mp, 5000, 4000, "jpeg");
  await writeCreatedImage(paths.pngWide20mp, 8192, 2441, "png");
  await writeCreatedImage(paths.webp20mp, 5000, 4000, "webp");
  await writeCreatedImage(paths.jpegMetadata, 2400, 1600, "jpeg", true);
  await writeCreatedImage(paths.overPixels, 5000, 4001, "png");
  await writeCreatedImage(paths.overDimension, 8193, 1, "png");
  await writeFile(paths.svg, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

  const jpeg = await readFile(paths.jpegMetadata);
  const png = await readFile(paths.pngWide20mp);
  const webp = await readFile(paths.webp20mp);
  await writeFile(paths.jpegTrailing, Buffer.concat([jpeg, Buffer.from("<script>polyglot</script>")]));
  await writeFile(paths.jpegTruncated, jpeg.subarray(0, jpeg.length - 2));
  await writeFile(paths.pngTrailing, Buffer.concat([png, Buffer.from("trailing-polyglot")]));
  const badCrc = Buffer.from(png);
  badCrc[29] ^= 0xff;
  await writeFile(paths.pngCrc, badCrc);
  await writeFile(paths.webpTrailing, Buffer.concat([webp, Buffer.from("trailing-polyglot")]));
  const staticFrame = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 240, g: 20, b: 20 } },
  }).webp({ lossless: true }).toBuffer();
  await writeFile(paths.animatedWebp, animatedWebpFromStatic(staticFrame, 2, 2));
  await writeFile(paths.oversized, Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x41));
  await writeFile(paths.random, Buffer.from("not an image container at all"));

  return [
    { name: "valid-jpeg-20mp", path: paths.jpeg20mp, outcome: "accepted" },
    { name: "valid-png-8192x2441", path: paths.pngWide20mp, outcome: "accepted" },
    { name: "valid-webp-20mp", path: paths.webp20mp, outcome: "accepted" },
    { name: "valid-jpeg-metadata-stripped", path: paths.jpegMetadata, outcome: "accepted" },
    { name: "reject-over-pixels", path: paths.overPixels, outcome: "rejected",
      codes: ["SOURCE_DECODE_FAILED", "DECODED_DIMENSIONS_INVALID"] },
    { name: "reject-over-dimension", path: paths.overDimension, outcome: "rejected",
      codes: ["DECODED_DIMENSIONS_INVALID"] },
    { name: "reject-svg", path: paths.svg, outcome: "rejected", codes: ["FORMAT_UNSUPPORTED"] },
    { name: "reject-jpeg-trailing-polyglot", path: paths.jpegTrailing, outcome: "rejected",
      codes: ["JPEG_TRAILING_BYTES"] },
    { name: "reject-jpeg-truncated", path: paths.jpegTruncated, outcome: "rejected",
      codes: ["JPEG_EOI_MISSING", "JPEG_SEGMENT_TRUNCATED"] },
    { name: "reject-png-trailing-polyglot", path: paths.pngTrailing, outcome: "rejected",
      codes: ["PNG_TRAILING_OR_INVALID_IEND"] },
    { name: "reject-png-crc", path: paths.pngCrc, outcome: "rejected",
      codes: ["PNG_CHUNK_CRC_INVALID"] },
    { name: "reject-webp-trailing-polyglot", path: paths.webpTrailing, outcome: "rejected",
      codes: ["WEBP_LENGTH_INVALID"] },
    { name: "reject-animated-webp", path: paths.animatedWebp, outcome: "rejected",
      codes: ["ANIMATION_REJECTED"] },
    { name: "reject-source-over-8mib", path: paths.oversized, outcome: "rejected",
      codes: ["SOURCE_SIZE_INVALID"] },
    { name: "reject-random-bytes", path: paths.random, outcome: "rejected",
      codes: ["FORMAT_UNSUPPORTED"] },
  ];
}

async function main() {
  if (process.argv[2] === "--case") {
    await runCase(process.argv[3], process.argv[4]);
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "showcase-media-corpus-"));
  try {
    const cases = await buildCorpus(root);
    const results = [];
    for (const testCase of cases) {
      const child = spawnSync(process.execPath, [scriptPath, "--case", testCase.path, testCase.name], {
        encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
      });
      if (child.status !== 0) {
        throw new Error(`corpus_child_failed:${testCase.name}:${child.stderr.trim()}`);
      }
      const result = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1));
      if (result.outcome !== testCase.outcome) {
        throw new Error(`corpus_outcome_mismatch:${testCase.name}:${JSON.stringify(result)}`);
      }
      if (testCase.codes && !testCase.codes.includes(result.code)) {
        throw new Error(`corpus_code_mismatch:${testCase.name}:${JSON.stringify(result)}`);
      }
      if (result.sourceBytes > MAX_SOURCE_BYTES && testCase.name !== "reject-source-over-8mib") {
        throw new Error(`corpus_fixture_too_large:${testCase.name}`);
      }
      if (result.peakRssMiB > MAX_PEAK_RSS_MIB) {
        throw new Error(`corpus_peak_rss_exceeded:${testCase.name}:${result.peakRssMiB}`);
      }
      results.push(result);
      console.log(JSON.stringify(result));
    }
    const accepted = results.filter((result) => result.outcome === "accepted");
    console.log(JSON.stringify({
      event: "showcase_media_corpus_passed",
      node: process.version,
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
      cases: results.length,
      accepted: accepted.length,
      rejected: results.length - accepted.length,
      maxElapsedMs: Math.max(...results.map((result) => result.elapsedMs)),
      maxPeakRssMiB: Math.max(...results.map((result) => result.peakRssMiB)),
      rssCeilingMiB: MAX_PEAK_RSS_MIB,
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
