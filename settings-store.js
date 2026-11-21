const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const defaults = {
  scanFolder: "",
  archiveFolder: "",
  subjects: ["إجازة","انقطاع","غياب","مباشرة","نقل","علاوة","إضافة شهادة","عدم الالتزام","ترك عمل","تنسيب","انفكاك"],
  people: ["علي أحمد","عمر جبار","زينب أحمد","محمد محمود","فاطمة حسن"],
};

function normalizeSettings(value, base = defaults) {
  const next = { ...base };
  if (!value || typeof value !== "object" || Array.isArray(value)) return next;
  for (const key of ["scanFolder", "archiveFolder"]) {
    if (typeof value[key] === "string") next[key] = value[key];
  }
  for (const key of ["subjects", "people"]) {
    if (Array.isArray(value[key])) {
      next[key] = value[key].filter((item) => typeof item === "string").slice(0, 1000);
    }
  }
  return next;
}

async function loadSettings(filePath) {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return normalizeSettings();
    throw error;
  }
}

async function saveSettings(filePath, value, base) {
  const settings = normalizeSettings(value, base);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return settings;
}

module.exports = { defaults, loadSettings, normalizeSettings, saveSettings };
