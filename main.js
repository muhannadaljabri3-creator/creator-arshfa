const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const chokidar = require("chokidar");

let mainWindow;
let watcher = null;
let settings = { scanFolder: "", archiveFolder: "" };
const seen = new Set();
const allowed = new Set([".pdf",".jpg",".jpeg",".png",".tif",".tiff"]);

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
  mainWindow.loadFile("index.html");
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
  if(watcher)await watcher.close();
  settings.scanFolder=folder;
  watcher=chokidar.watch(folder,{ignoreInitial:false,awaitWriteFinish:{stabilityThreshold:1500,pollInterval:300},depth:4});
  watcher.on("add",emitFile);
  watcher.on("error",error=>send("scanner:error",{message:error.message}));
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
ipcMain.handle("scanner:enqueue",async(_e,payload)=>{
  // The watcher reports paths; OCR and automatic extraction are intentionally a separate next integration step.
  send("scanner:processing-update",{id:payload.id,status:"queued",message:"تم استلام الملف وإضافته لقائمة العمل"});
  return true;
});
