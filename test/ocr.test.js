const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const { extractFields, prepareImagePages } = require("../ocr");
const { loadSettings, saveSettings } = require("../settings-store");

test("extracts number, date, subject, and employee from Arabic OCR text", () => {
  assert.deepEqual(
    extractFields("العدد: ٤٥٢/ش\nالتاريخ 2025/3/7\nالموضوع إجازة\nالموظف علي أحمد", {
      subjects: ["إجازة", "نقل"],
      people: ["علي أحمد"],
    }),
    { number: "452/ش", subject: "إجازة", person: "علي أحمد", date: "2025-03-07" }
  );
});

test("extracts labeled values even when OCR inserts right-to-left marks", () => {
  assert.deepEqual(
    extractFields("\u200fالعدد: ٤٥٢/ش\n\u200fالموضوع: إجازة سنوية\n\u200fاسم الموظف: علي أحمد", {
      subjects: [],
      people: [],
    }),
    { number: "452/ش", subject: "إجازة سنوية", person: "علي أحمد", date: "" }
  );
});

test("extracts a labeled book number when the document says رقم الكتاب", () => {
  assert.equal(extractFields("رقم الكتاب: ١٢٣/أ").number, "123/أ");
});

test("persists and reloads folder paths and OCR dictionaries", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arshfa-settings-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, "config", "settings.json");
  assert.equal((await loadSettings(settingsPath)).scanFolder, "");

  const saved = await saveSettings(settingsPath, {
    scanFolder: path.join(dir, "scanner"),
    archiveFolder: path.join(dir, "archive"),
    subjects: ["إجازة سنوية"],
    people: ["علي أحمد"],
  });
  assert.deepEqual(await loadSettings(settingsPath), saved);
});

test("normalizes common scanner image formats to OCR-ready PNG", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arshfa-ocr-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const source = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();

  const formats = [
    ["png", (image) => image.png()],
    ["jpg", (image) => image.jpeg()],
    ["tiff", (image) => image.tiff()],
    ["webp", (image) => image.webp()],
    ["gif", (image) => image.gif()],
    ["avif", (image) => image.avif()],
  ];

  for (const [extension, encode] of formats) {
    const inputPath = path.join(dir, `sample.${extension}`);
    await encode(sharp(source)).toFile(inputPath);
    const [page] = await prepareImagePages(inputPath);
    assert.equal((await sharp(page).metadata()).format, "png", extension);
  }

  const bmpPath = path.join(dir, "sample.bmp");
  const bmp = Buffer.alloc(70);
  bmp.write("BM");
  bmp.writeUInt32LE(70, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(2, 18);
  bmp.writeInt32LE(2, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(16, 34);
  await writeFile(bmpPath, bmp);
  assert.equal((await prepareImagePages(bmpPath))[0].subarray(1, 4).toString(), "PNG");
});
