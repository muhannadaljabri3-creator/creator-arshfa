/* واجهة أرشفة - تعمل مع Electron عبر preload.js، ويمكن فتحها للمعاينة في المتصفح. */
const $ = (id) => document.getElementById(id);
const state = {
  files: [], logs: [], subjects: ["إجازة","انقطاع","غياب","مباشرة","نقل","علاوة","إضافة شهادة","عدم الالتزام","ترك عمل","تنسيب","انفكاك"],
  people: ["علي أحمد","عمر جبار","زينب أحمد","محمد محمود","فاطمة حسن"],
  scanFolder: "", archiveFolder: "", watching: false, activeReviewId: null, filter: "all"
};
const titles = {dashboard:"لوحة التحكم",inbox:"استقبال ملفات السكنر",processing:"المعالجة المباشرة",review:"قائمة المراجعة",archive:"الأرشيف",settings:"الإعدادات",logs:"سجل العمليات"};
const statusText = {queued:"بانتظار المعالجة",processing:"قيد المعالجة",review:"تحتاج مراجعة",archived:"مكتمل",failed:"تعذر التعامل"};
const supported = [".pdf",".jpg",".jpeg",".png",".tif",".tiff",".bmp",".gif",".webp",".avif"];

function notify(message){const t=$("toast");t.textContent=message;t.classList.add("show");clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.remove("show"),3000);}
function log(action,detail){state.logs.unshift({time:new Date().toLocaleString("ar-IQ"),action,detail});renderLogs();}
function id(){return (crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random()));}
function ext(name){return (name.match(/\.[^.]+$/)||[""])[0].toLowerCase();}
function safeName(s){return String(s||"").trim().replace(/[\\/:*?"<>|]/g,"").replace(/\s+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");}
function displayPath(p){return p||"لم يتم تحديده";}
function enqueueForOcr(item){
  if(!window.arshfa?.enqueueFile||!item.sourcePath)return false;
  item.status="queued";item.note="أضيف الملف إلى قائمة المعالجة";
  window.arshfa.enqueueFile({id:item.id,path:item.sourcePath,name:item.name,subjects:state.subjects,people:state.people}).then(result=>{
    if(item.status==="queued"&&result?.status){
      item.status=result.status;item.note=result.message||item.note;renderAll();
    }
  }).catch(e=>{
    item.status="failed";item.note="تعذر إضافة الملف: "+e.message;renderAll();
  });
  return true;
}
function addFile(file,sourcePath=""){
  const name=file.name||"ملف بدون اسم";
  if(!supported.includes(ext(name))){notify("نوع الملف غير مدعوم: "+name);return;}
  const duplicate=state.files.some(x=>x.name===name && x.size===(file.size||0) && x.lastModified===(file.lastModified||0));
  if(duplicate)return;
  sourcePath=sourcePath||file.path||"";
  const item={id:id(),name,size:file.size||0,lastModified:file.lastModified||Date.now(),sourcePath,status:"queued",received:new Date().toLocaleString("ar-IQ"),number:"",subject:"",person:"",date:"",type:"كتاب",note:"بانتظار المعالجة",fileRef:null};
  // File object is retained only in this running session for manual processing/preview.
  item.fileRef=file;
  state.files.unshift(item);
  log("استلام ملف",name);
  renderAll();
  if(window.arshfa){if(!enqueueForOcr(item)){item.status="failed";item.note="تعذر تحديد مسار الملف لمعالجته.";renderAll();}}
  else{item.note="معاينة المتصفح: يلزم Electron لمعالجة الملفات تلقائياً.";}
}
function showPage(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id==="page-"+page));
  document.querySelectorAll(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("pageTitle").textContent=titles[page]||"أرشفة";
}
function statusBadge(s){return `<span class="status status-${s}">${statusText[s]||s}</span>`;}
function renderStats(){
  const total=state.files.length,archived=state.files.filter(x=>x.status==="archived").length,review=state.files.filter(x=>x.status==="review").length,queued=state.files.filter(x=>["queued","processing"].includes(x.status)).length,failed=state.files.filter(x=>x.status==="failed").length;
  $("statReceived").textContent=total;$("statArchived").textContent=archived;$("statQueued").textContent=queued;$("statReview").textContent=review;
  $("miniQueued").textContent=queued;$("miniReview").textContent=review;$("miniFailed").textContent=failed;
  $("processingQueued").textContent=state.files.filter(x=>x.status==="queued").length;$("processingActive").textContent=state.files.filter(x=>x.status==="processing").length;$("processingDone").textContent=archived;
  $("navInbox").textContent=total;$("navReview").textContent=review;$("reviewTotal").textContent=review+" كتاب";
  const pct=total?Math.round(archived/total*100):0;$("progressPercent").textContent=pct+"%";$("progressBar").style.width=pct+"%";$("progressDone").textContent=archived+" مكتمل";$("progressTotal").textContent=total+" مستلم";
  $("queueCount").textContent=queued;$("reviewCount").textContent=review;$("errorCount").textContent=failed;
  $("dashScanPath").textContent=displayPath(state.scanFolder);$("dashArchivePath").textContent=displayPath(state.archiveFolder);
  $("watchLabel").textContent=state.watching?"مراقبة السكنر تعمل":"المراقبة متوقفة";$("watchDot").classList.toggle("on",state.watching);
}
function renderRecent(){
  const rows=state.files.slice(0,5);
  $("recentRows").innerHTML=rows.length?rows.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.received)}</td><td>${statusBadge(x.status)}</td><td><button class="small-action" data-open="${x.id}">عرض</button></td></tr>`).join(""):`<tr><td colspan="4" class="empty">لا توجد ملفات حتى الآن. حدد مجلد السكنر للبدء.</td></tr>`;
}
function renderInbox(){
  let list=state.files;
  if(state.filter!=="all")list=list.filter(x=>x.status===state.filter);
  $("inboxCount").textContent=list.length+" ملف";
  $("inboxRows").innerHTML=list.length?list.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.received)}</td><td>${escapeHtml(ext(x.name).replace(".","").toUpperCase())}</td><td>${statusBadge(x.status)}</td><td><button class="small-action" data-open="${x.id}">تفاصيل</button></td></tr>`).join(""):`<tr><td colspan="5" class="empty">لا توجد ملفات ضمن هذا التصنيف.</td></tr>`;
  document.querySelectorAll(".filter").forEach(b=>b.classList.toggle("active",b.dataset.filter===state.filter));
}
function renderProcessing(){
  const list=state.files.filter(x=>["queued","processing","failed"].includes(x.status));
  $("processingRows").innerHTML=list.length?list.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${statusBadge(x.status)}</td><td>${escapeHtml(x.received)}</td><td>${escapeHtml(x.note||"—")}</td></tr>`).join(""):`<tr><td colspan="4" class="empty">لا توجد مهام حالياً.</td></tr>`;
}
function renderReview(){
  const list=state.files.filter(x=>x.status==="review");
  $("reviewList").innerHTML=list.length?list.map(x=>`<button class="review-item ${state.activeReviewId===x.id?"selected":""}" data-review="${x.id}"><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.note||"تحتاج مراجعة")} · ${escapeHtml(x.received)}</small></button>`).join(""):`<div class="empty">لا توجد كتب معلقة للمراجعة.</div>`;
  if(!state.activeReviewId || !list.some(x=>x.id===state.activeReviewId)){ $("reviewForm").classList.add("hidden");$("reviewEmpty").classList.remove("hidden"); }
}
function renderArchive(){
  const q=($("archiveSearch")?.value||"").trim().toLowerCase();
  const list=state.files.filter(x=>x.status==="archived").filter(x=>([x.archivedName,x.number,x.subject,x.person].join(" ").toLowerCase()).includes(q));
  $("archiveRows").innerHTML=list.length?list.map(x=>`<tr><td>${escapeHtml(x.archivedName||x.name)}</td><td>${escapeHtml(x.number||"—")}</td><td>${escapeHtml(x.subject||"—")}</td><td>${escapeHtml(x.person||"—")}</td><td>${escapeHtml(x.archivedAt||"—")}</td><td>${escapeHtml(x.destination||"تم الحفظ")}</td></tr>`).join(""):`<tr><td colspan="6" class="empty">لا توجد ملفات مؤرشفة تطابق البحث.</td></tr>`;
}
function renderLogs(){$("logsRows").innerHTML=state.logs.length?state.logs.map(x=>`<tr><td>${escapeHtml(x.time)}</td><td>${escapeHtml(x.action)}</td><td>${escapeHtml(x.detail)}</td></tr>`).join(""):`<tr><td colspan="3" class="empty">لا توجد عمليات مسجلة.</td></tr>`;}
function renderTags(){
  $("subjectTags").innerHTML=state.subjects.map((x,i)=>`<span class="tag">${escapeHtml(x)} <button data-remove-subject="${i}" title="حذف">×</button></span>`).join("");
  $("personTags").innerHTML=state.people.map((x,i)=>`<span class="tag">${escapeHtml(x)} <button data-remove-person="${i}" title="حذف">×</button></span>`).join("");
}
function renderAll(){renderStats();renderRecent();renderInbox();renderProcessing();renderReview();renderArchive();renderTags();renderLogs();}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function openReview(fileId){
  const x=state.files.find(f=>f.id===fileId);if(!x)return;
  state.activeReviewId=x.id;$("reviewId").value=x.id;$("reviewOriginal").value=x.name;$("reviewNumber").value=x.number||"";$("reviewDate").value=x.date||"";$("reviewSubject").value=x.subject||"";$("reviewPerson").value=x.person||"";$("reviewType").value=x.type||"كتاب";
  $("reviewEmpty").classList.add("hidden");$("reviewForm").classList.remove("hidden");renderReview();
  showPage("review");
}
async function chooseFolder(kind){
  if(window.arshfa?.chooseFolder){
    try{
      const path=await window.arshfa.chooseFolder();if(!path)return;
      if(kind==="scan"){state.scanFolder=path;$("scanFolder").value=path;}else{state.archiveFolder=path;$("archiveFolder").value=path;}
      await saveLocalSettings();renderStats();notify("تم تحديد المجلد وحفظه.");
    }catch(e){notify("تعذر حفظ إعدادات المجلد: "+e.message);}
  }else{
    notify("اختيار المجلدات تلقائياً متاح بعد تشغيل المشروع عبر Electron.");
  }
}
async function startWatch(){
  if(!state.scanFolder){notify("حدد مجلد السكنر أولاً من الإعدادات.");showPage("settings");return;}
  if(!state.archiveFolder){notify("حدد مجلد الأرشيف أولاً.");showPage("settings");return;}
  if(window.arshfa?.startWatching){
    try{await window.arshfa.startWatching(state.scanFolder);state.watching=true;notify("بدأت مراقبة مجلد السكنر.");}
    catch(e){notify("تعذر بدء المراقبة: "+e.message);}
  }else{notify("المراقبة التلقائية تحتاج تشغيل البرنامج عبر Electron.");}
  renderStats();
}
async function stopWatch(){
  if(window.arshfa?.stopWatching){await window.arshfa.stopWatching();}
  state.watching=false;renderStats();notify("تم إيقاف المراقبة.");
}
function saveLocalSettings(){
  const settings={scanFolder:state.scanFolder,archiveFolder:state.archiveFolder,subjects:state.subjects,people:state.people};
  try{localStorage.setItem("arshfa-settings",JSON.stringify(settings));}catch(e){}
  return window.arshfa?.setSettings?window.arshfa.setSettings(settings):Promise.resolve(settings);
}
function loadLocalSettings(){
  try{const s=JSON.parse(localStorage.getItem("arshfa-settings")||"{}");state.scanFolder=s.scanFolder||"";state.archiveFolder=s.archiveFolder||"";if(s.subjects)state.subjects=s.subjects;if(s.people)state.people=s.people;}catch(e){}
  $("scanFolder").value=state.scanFolder;$("archiveFolder").value=state.archiveFolder;
}
function suggestFromText(text){
  const normalized=text.replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const numberMatch=normalized.match(/عدد\s*[:：\-]?\s*([0-9]{2,}(?:\/[A-Za-zء-ي]+)?)/i);
  let subject="";
  for(const s of state.subjects){if(text.includes(s)){subject=s;break;}}
  let person="";
  for(const p of state.people){if(text.includes(p)){person=p;break;}}
  const dateMatch=normalized.match(/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  return {number:numberMatch?.[1]||"",subject,person,date:dateMatch?`${dateMatch[1]}-${dateMatch[2].padStart(2,"0")}-${dateMatch[3].padStart(2,"0")}`:""};
}
function makeFilename(x){
  const parts=[safeName(x.number),safeName(x.subject),safeName(x.person)].filter(Boolean);
  return (parts.length?parts.join("_"):"كتاب_غير_محدد")+(ext(x.name)||".pdf");
}
async function approveReview(event){
  event.preventDefault();const x=state.files.find(f=>f.id===$("reviewId").value);if(!x)return;
  x.number=$("reviewNumber").value.trim();x.date=$("reviewDate").value.trim();x.subject=$("reviewSubject").value.trim();x.person=$("reviewPerson").value.trim();x.type=$("reviewType").value;
  if(!x.number&&!x.subject){notify("أدخل العدد أو الموضوع على الأقل.");return;}
  x.archivedName=makeFilename(x);x.status="archived";x.archivedAt=new Date().toLocaleString("ar-IQ");x.note="اعتمد المستخدم البيانات يدوياً";
  if(window.arshfa?.approveDocument && x.sourcePath){
    try{const result=await window.arshfa.approveDocument({id:x.id,sourcePath:x.sourcePath,archiveFolder:state.archiveFolder,filename:x.archivedName,metadata:{number:x.number,subject:x.subject,person:x.person,date:x.date,type:x.type}});x.destination=result?.destination||state.archiveFolder;}
    catch(e){x.status="review";notify("لم يتم الحفظ على القرص: "+e.message);return;}
  }else if(x.fileRef && window.arshfa?.saveImportedFile){
    try{const result=await window.arshfa.saveImportedFile({filePath:x.fileRef.path,archiveFolder:state.archiveFolder,filename:x.archivedName});x.destination=result?.destination||state.archiveFolder;}
    catch(e){x.status="review";notify("تعذر حفظ الملف: "+e.message);return;}
  }else{x.destination="حالة تجريبية - لم يتم حفظ ملف فعلي";}
  log("اعتماد وأرشفة",x.archivedName);state.activeReviewId=null;$("reviewForm").classList.add("hidden");$("reviewEmpty").classList.remove("hidden");renderAll();notify("تم اعتماد بيانات الكتاب.");
}
function importFiles(){ $("filePicker").click(); }
function setupEvents(){
  document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
  document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.goto)));
  $("refreshBtn").addEventListener("click",renderAll);
  $("quickStart").addEventListener("click",startWatch);$("startWatchBtn").addEventListener("click",startWatch);$("stopWatchBtn").addEventListener("click",stopWatch);
  $("chooseScan").addEventListener("click",()=>chooseFolder("scan"));$("chooseArchive").addEventListener("click",()=>chooseFolder("archive"));
  $("importBtn").addEventListener("click",importFiles);$("importSettingsBtn").addEventListener("click",importFiles);
  $("filePicker").addEventListener("change",e=>{
    [...e.target.files].forEach(f=>addFile(f,window.arshfa?.getPathForFile?.(f)||""));
    e.target.value="";
    notify("تمت إضافة الملفات إلى قائمة الاستقبال.");
  });
  document.querySelectorAll(".filter").forEach(b=>b.addEventListener("click",()=>{state.filter=b.dataset.filter;renderInbox();}));
  $("reviewForm").addEventListener("submit",approveReview);
  $("skipReviewBtn").addEventListener("click",()=>{state.activeReviewId=null;renderReview();});
  $("addSubjectBtn").addEventListener("click",async()=>{const v=$("newSubject").value.trim();if(v&&!state.subjects.includes(v)){state.subjects.push(v);$("newSubject").value="";renderTags();try{await saveLocalSettings();}catch(e){notify("تعذر حفظ الإعدادات: "+e.message);}}});
  $("addPersonBtn").addEventListener("click",async()=>{const v=$("newPerson").value.trim();if(v&&!state.people.includes(v)){state.people.push(v);$("newPerson").value="";renderTags();try{await saveLocalSettings();}catch(e){notify("تعذر حفظ الإعدادات: "+e.message);}}});
  $("saveSettingsBtn").addEventListener("click",async()=>{try{await saveLocalSettings();notify("تم حفظ الإعدادات.");}catch(e){notify("تعذر حفظ الإعدادات: "+e.message);}});
  $("archiveSearch").addEventListener("input",renderArchive);
  $("retryQueueBtn").addEventListener("click",()=>{
    const retryable=state.files.filter(x=>x.status==="failed"&&x.sourcePath);
    if(!retryable.length){notify("لا توجد ملفات فاشلة قابلة لإعادة المحاولة.");return;}
    retryable.forEach(enqueueForOcr);renderAll();notify("أعيدت الملفات الفاشلة إلى قائمة المعالجة.");
  });
  $("clearLogsBtn").addEventListener("click",()=>{state.logs=[];renderLogs();});
  document.addEventListener("click",e=>{
    const open=e.target.closest("[data-open]");if(open){const x=state.files.find(f=>f.id===open.dataset.open);if(x?.status==="review")openReview(x.id);else notify(x?.note||"تفاصيل الملف");}
    const rev=e.target.closest("[data-review]");if(rev)openReview(rev.dataset.review);
    const rs=e.target.closest("[data-remove-subject]");if(rs){state.subjects.splice(Number(rs.dataset.removeSubject),1);renderTags();saveLocalSettings().catch(e=>notify("تعذر حفظ الإعدادات: "+e.message));}
    const rp=e.target.closest("[data-remove-person]");if(rp){state.people.splice(Number(rp.dataset.removePerson),1);renderTags();saveLocalSettings().catch(e=>notify("تعذر حفظ الإعدادات: "+e.message));}
  });
}
function bindElectron(){
  if(!window.arshfa)return;
  window.arshfa.onFileDetected(file=>{addFile({name:file.name,size:file.size||0,lastModified:file.lastModified||Date.now()},file.path);});
  window.arshfa.onWatchStatus(v=>{state.watching=!!v;renderStats();});
  window.arshfa.onProcessingUpdate(update=>{
    const x=state.files.find(f=>f.id===update.id);if(x){x.status=update.status||x.status;if(update.fields){const f=update.fields;x.number=f.number||x.number;x.subject=f.subject||x.subject;x.person=f.person||x.person;x.date=f.date||x.date;}x.note=update.message||x.note;renderAll();}
  });
  window.arshfa.onQueueError(err=>{log("خطأ معالجة",err.message||String(err));notify(err.message||"حدث خطأ أثناء المعالجة");});
}
async function init(){
  loadLocalSettings();setupEvents();bindElectron();
  $("todayLabel").textContent=new Date().toLocaleDateString("ar-IQ",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  if(window.arshfa?.getSettings){
    try{
      const s=await window.arshfa.getSettings();
      if(s){
        const hasLegacyLocal=Boolean(state.scanFolder||state.archiveFolder);
        state.scanFolder=s.hasSavedSettings?s.scanFolder:(s.scanFolder||state.scanFolder);
        state.archiveFolder=s.hasSavedSettings?s.archiveFolder:(s.archiveFolder||state.archiveFolder);
        if(s.hasSavedSettings){state.subjects=s.subjects||state.subjects;state.people=s.people||state.people;}
        $("scanFolder").value=state.scanFolder;$("archiveFolder").value=state.archiveFolder;
        if(!s.hasSavedSettings&&hasLegacyLocal)await saveLocalSettings();
      }
    }catch(e){notify("تعذر تحميل الإعدادات المحفوظة: "+e.message);}
  }
  renderAll();
}
document.addEventListener("DOMContentLoaded",init);
