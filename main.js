const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const chokidar = require("chokidar");
const ocr = require("./ocr");

let mainWindow;
let watcher = null;
let settings = { scanFolder: "", archiveFolder: "" };
const seen = new Set();
const allowed = new Set([".pdf",".jpg",".jpeg",".png",".tif",".tiff",".bmp",".gif",".webp",".avif"]);

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1050, minHeight: 700,
    backgroundColor: "#f3f6f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname,"index.html"));
}
app.whenReady().then(createWindow);
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});

function send(channel,payload){if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send(channel,payload);}
async function waitUntilStable(filePath){
  let previous=-1, stable=0;
  for(let i=0;i<40;i++){
    try{
      const stat=await fsp.stat(filePath);
      if(stat.size===previous&&stat.size>0)stable++;else stable=0;
      previous=stat.size;
      if(stable>=3)return true;
    }catch(e){return false;}
    await new Promise(r=>setTimeout(r,500));
  }
  return false;
}
async function emitFile(filePath){
  const ext=path.extname(filePath).toLowerCase();
  if(!allowed.has(ext)||seen.has(filePath))return;
  const stable=await waitUntilStable(filePath);
  if(!stable)return;
  seen.add(filePath);
  const stat=await fsp.stat(filePath);
  send("scanner:file-detected",{path:filePath,name:path.basename(filePath),size:stat.size,lastModified:stat.mtimeMs});
}
ipcMain.handle("dialog:choose-folder",async()=>{
  const result=await dialog.showOpenDialog(mainWindow,{properties:["openDirectory","createDirectory"]});
  return result.canceled?null:result.filePaths[0];
});
ipcMain.handle("settings:get",()=>settings);
ipcMain.handle("settings:set",(_e,next)=>{settings={...settings,...next};return settings;});
ipcMain.handle("watch:start",async(_e,folder)=>{
  if(!folder)throw new Error("لم يتم تحديد مجلد السكنر");
  const folderStat=await fsp.stat(folder);
  if(!folderStat.isDirectory())throw new Error("المسار المحدد ليس مجلداً");
  if(watcher)await watcher.close();
  settings.scanFolder=folder;
  const nextWatcher=chokidar.watch(folder,{ignoreInitial:false,awaitWriteFinish:{stabilityThreshold:1500,pollInterval:300},depth:4});
  watcher=nextWatcher;
  nextWatcher.on("add",emitFile);
  nextWatcher.on("error",error=>send("scanner:error",{message:error.message}));
  try{
    await new Promise((resolve,reject)=>{
      nextWatcher.once("ready",resolve);
      nextWatcher.once("error",reject);
    });
  }catch(error){
    await nextWatcher.close();
    if(watcher===nextWatcher)watcher=null;
    throw error;
  }
  send("scanner:watch-status",true);
  return true;
});
ipcMain.handle("watch:stop",async()=>{
  if(watcher){await watcher.close();watcher=null;}
  send("scanner:watch-status",false);return true;
});
ipcMain.handle("document:approve",async(_e,payload)=>{
  const {sourcePath,archiveFolder,filename}=payload;
  if(!sourcePath||!archiveFolder||!filename)throw new Error("بيانات الحفظ غير مكتملة");
  await fsp.mkdir(archiveFolder,{recursive:true});
  const ext=path.extname(sourcePath)||".pdf";
  const base=path.basename(filename,path.extname(filename));
  let target=path.join(archiveFolder,base+ext),n=1;
  while(fs.existsSync(target)){target=path.join(archiveFolder,`${base}_${n++}${ext}`);}
  await fsp.copyFile(sourcePath,target);
  const a=await fsp.stat(sourcePath),b=await fsp.stat(target);
  if(a.size!==b.size){await fsp.rm(target,{force:true});throw new Error("فشل التحقق من النسخة المحفوظة");}
  return {destination:target};
});
ipcMain.handle("document:save-imported",async(_e,payload)=>{
  const {filePath,archiveFolder,filename}=payload;
  if(!filePath||!archiveFolder)throw new Error("مسار الملف أو الأرشيف غير محدد");
  await fsp.mkdir(archiveFolder,{recursive:true});
  const ext=path.extname(filePath)||".pdf";
  const base=path.basename(filename||path.basename(filePath),path.extname(filename||filePath));
  let target=path.join(archiveFolder,base+ext),n=1;
  while(fs.existsSync(target)){target=path.join(archiveFolder,`${base}_${n++}${ext}`);}
  await fsp.copyFile(filePath,target);
  return {destination:target};
});
const ocrQueue=[];
let ocrRunning=false;
async function runOcrQueue(){
  if(ocrRunning)return;
  ocrRunning=true;
  while(ocrQueue.length){
    const job=ocrQueue.shift();
    send("scanner:processing-update",{id:job.id,status:"processing",message:"جارٍ قراءة الكتاب بمحرك OCR العربي"});
    try{
      const text=await ocr.recognize(job.path,path.join(app.getPath("userData"),"tessdata"));
      const fields=ocr.extractFields(text,{subjects:job.subjects,people:job.people});
      const found=[fields.number,fields.subject,fields.person].filter(Boolean).length;
      send("scanner:processing-update",{id:job.id,status:"review",fields,message:found?`تم استخراج ${found} من 3 حقول، يرجى المراجعة`:"لم يتم التعرف على بيانات، أدخلها يدوياً"});
    }catch(e){
      send("scanner:processing-update",{id:job.id,status:"failed",message:"فشلت قراءة الملف: "+e.message});
    }
  }
  ocrRunning=false;
}
app.on("before-quit",()=>{ocr.terminate();});
ipcMain.handle("scanner:enqueue",async(_e,payload)=>{
  if(!payload||!payload.path)throw new Error("مسار الملف غير محدد");
  const list=v=>Array.isArray(v)?v.filter(x=>typeof x==="string"):[];
  ocrQueue.push({id:payload.id,path:payload.path,subjects:list(payload.subjects),people:list(payload.people)});
  send("scanner:processing-update",{id:payload.id,status:"queued",message:"تم استلام الملف وإضافته لقائمة العمل"});
  runOcrQueue();
  return true;
});
