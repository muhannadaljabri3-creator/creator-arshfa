const path = require("path");
const fsp = require("fs/promises");
const sharp = require("sharp");

let workerPromise = null;
const MAX_IMAGE_PAGES = 100;
const stripDirectionMarks = (text) => text.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");

async function getWorker(cachePath) {
  if (!workerPromise) {
    const { createWorker } = require("tesseract.js");
    const languagePath = path.join(
      path.dirname(require.resolve("@tesseract.js-data/ara")),
      "4.0.0_best_int"
    );
    // Without errorHandler, a failed language download throws uncaught and would crash the main process.
    workerPromise = new Promise((resolve, reject) => {
      createWorker("ara", 1, {
        cachePath,
        langPath: languagePath,
        errorHandler: (e) => reject(e instanceof Error ? e : new Error(String(e))),
      }).then(resolve, reject);
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

async function renderPdfFirstPage(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = require("@napi-rs/canvas");
  const data = new Uint8Array(await fsp.readFile(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport, canvas }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await doc.destroy();
  }
}

async function* imagePages(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".bmp") {
    const { createCanvas, loadImage } = require("@napi-rs/canvas");
    const image = await loadImage(filePath);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    yield canvas.toBuffer("image/png");
    return;
  }

  const metadata = await sharp(filePath, { animated: true }).metadata();
  const pageCount = metadata.pages || 1;
  if (pageCount > MAX_IMAGE_PAGES) {
    throw new Error(`الصورة تحتوي على صفحات كثيرة جداً (الحد ${MAX_IMAGE_PAGES})`);
  }

  for (let page = 0; page < pageCount; page++) {
    yield await sharp(filePath, { page }).rotate().png().toBuffer();
  }
}

async function prepareImagePages(filePath) {
  const pages = [];
  for await (const page of imagePages(filePath)) pages.push(page);
  return pages;
}

async function recognize(filePath, cachePath) {
  const ext = path.extname(filePath).toLowerCase();
  const worker = await getWorker(cachePath);
  const pages = [];
  const inputs = ext === ".pdf" ? [await renderPdfFirstPage(filePath)] : imagePages(filePath);
  for await (const input of inputs) {
    const { data } = await worker.recognize(input);
    if (data.text) pages.push(data.text);
  }
  return pages.join("\n");
}

const normalizeDigits = (s) =>
  s.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
// Drops diacritics/tatweel and unifies alef/yaa/taa-marbuta forms so OCR variants still match.
const normalizeArabic = (s) =>
  s
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");

function findKnown(text, list) {
  const hay = normalizeArabic(text);
  for (const item of list || []) {
    if (hay.includes(normalizeArabic(item))) return item;
  }
  return "";
}

function labeledValue(text, pattern) {
  const lines = stripDirectionMarks(normalizeDigits(text)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index++) {
    const originalLine = lines[index];
    const match = normalizeArabic(originalLine).match(pattern);
    if (!match) continue;
    const prefixLength = match[0].length - (match[1] || "").length;
    const value = (originalLine.slice(prefixLength) || "").trim();
    if (value) return value.replace(/^[\s:：\-–—/]+|[\s:：\-–—]+$/g, "").trim();
    const next = lines[index + 1]?.trim() || "";
    if (next && !/^(?:العدد|عدد|الموضوع|موضوع|اسم|الموظف|الموظفه|التاريخ)/.test(normalizeArabic(next))) {
      return next.replace(/^[\s:：\-–—/]+|[\s:：\-–—]+$/g, "").trim();
    }
  }
  return "";
}

function extractFields(text, { subjects = [], people = [] } = {}) {
  const normalized = stripDirectionMarks(normalizeDigits(text));
  const labeledNumber = labeledValue(text, /^(?:العدد|عدد|رقم(?:\s+الكتاب)?)\s*[:：\-]?\s*(.*)$/);
  const numberMatch = normalized.match(/(?:العدد|عدد|رقم(?:\s+الكتاب)?)\s*[:：\-]?\s*([0-9]+(?:\s*\/\s*[0-9A-Za-z\u0621-\u064A]+)*)/);
  let date = "";
  const ymd = normalized.match(/(19\d{2}|20\d{2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/);
  if (ymd) {
    date = `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  } else {
    const dmy = normalized.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(19\d{2}|20\d{2})/);
    if (dmy) date = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const labeledSubject = labeledValue(text, /^(?:الموضوع|موضوع(?:\s+الكتاب)?|بشأن|م\s*\/)\s*[:：\-]?\s*(.*)$/);
  const labeledPerson = labeledValue(text, /^(?:اسم\s*(?:الموظف|الموظفه|المعني|المعنيه)|الموظف|الموظفه|الاسم)\s*[:：\-]?\s*(.*)$/);
  const labeledNumberValue = labeledNumber.replace(/\s+/g, "").slice(0, 64);
  return {
    number: labeledNumberValue || (numberMatch ? numberMatch[1].replace(/\s+/g, "") : ""),
    subject: labeledSubject || findKnown(text, subjects),
    person: labeledPerson || findKnown(text, people),
    date,
  };
}

async function terminate() {
  if (!workerPromise) return;
  const p = workerPromise;
  workerPromise = null;
  try {
    await (await p).terminate();
  } catch (e) {}
}

module.exports = { recognize, prepareImagePages, extractFields, terminate };
