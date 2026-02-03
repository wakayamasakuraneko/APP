// G8をカテゴリーベースの色分けに完全対応

// ==========================================
// 1. データベース設定 & 基本操作 (IndexedDB)
// ==========================================

const DB_NAME = "CatManagementDB";
const DB_VERSION = 1;
const STORE_SUMMARY = "cat_summaries";
const STORE_DETAIL = "cat_details";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SUMMARY)) db.createObjectStore(STORE_SUMMARY, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_DETAIL)) db.createObjectStore(STORE_DETAIL, { keyPath: "id" });
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveDB(storeName, data) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(data);
    tx.oncomplete = () => resolve();
  });
}

async function getDB(storeName, id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result);
  });
}

async function deleteDB(id) {
  const db = await openDB();
  const tx = db.transaction([STORE_SUMMARY, STORE_DETAIL], "readwrite");
  tx.objectStore(STORE_SUMMARY).delete(id);
  tx.objectStore(STORE_DETAIL).delete(id);
}

// ==========================================
// 2. グローバル変数 & 状態管理
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
let currentCatId = urlParams.get("id") || "test";
let chartMinDate = null;

let ageMode = "estimate",
  logs = { ff: [], vaccine: [], flea: [], weight: [] },
  eventSummaries = { surgery: null, rescue1: null, rescue2: null };
let weightChart = null,
  activeEditType = "",
  catPhotoBase64 = "";

// ==========================================
// 3. ユーティリティ (共通整形・計算)
// ==========================================
function formatDateShort(dateStr) {
  if (!dateStr || dateStr === "---") return "---";
  if (dateStr === "不明") return "不明";
  return "'" + dateStr.substring(2).replace(/-/g, "/");
}

function calcAgeTextAt(birth, target, mode) {
  if (!birth) return "---";
  const b = new Date(birth),
    t = new Date(target);
  let y = t.getFullYear() - b.getFullYear(),
    m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) {
    y--;
    m += 12;
  }
  const pref = mode === "exact" ? "" : mode === "rough" ? "おおよそ" : "推定";
  return mode === "rough" ? `${pref}${y}歳` : `${pref}${y}歳${m}ヶ月`;
}

function setElapsedText(id, val) {
  const out = document.getElementById(id);
  if (!out || !val) {
    if (out) out.textContent = "";
    return;
  }
  const d = new Date(val),
    now = new Date();
  let y = now.getFullYear() - d.getFullYear(),
    m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
    y--;
    m += 12;
  }
  out.textContent = `(最終日から${y}年${m}ヶ月)`;
}
function applyStatusTheme(statusText) {
  const stamp = document.getElementById("status_stamp");
  if (!stamp) return;

  // 既存の st- 系を剥がす
  stamp.classList.remove("st-grad", "st-medical", "st-trial", "st-death", "st-stay");

  const s = (statusText || "").toString().trim();
  const base = s.split(/[（(]/)[0].trim(); // "Trial中(○○)" → "Trial中"

  // G5の選択肢に合わせて分類
  if (base.includes("卒業")) stamp.classList.add("st-grad");
  else if (base.includes("永眠")) stamp.classList.add("st-death");
  else if (base.includes("Trial")) stamp.classList.add("st-trial");
  else if (base.includes("治療") || base.includes("入院")) stamp.classList.add("st-medical");
  else stamp.classList.add("st-stay"); // 保護中/預け中など
}

// ==========================================
// 4. UI表示制御 (スクロール・タブ・入力切替)
// ==========================================

window.addEventListener("scroll", () => {
  const stickyName = document.getElementById("sticky_name_bar");
  const dispName = document.getElementById("disp_name");
  const rect = dispName.getBoundingClientRect();
  if (rect.top < 0) {
    stickyName.querySelector(".name-text").textContent = dispName.textContent;
    stickyName.style.display = "block";
  } else {
    stickyName.style.display = "none";
  }
});

function toggleDateInput(unknown) {
  const dateInp = document.getElementById("modal_date");
  if (unknown) {
    dateInp.value = "";
    dateInp.disabled = true;
    dateInp.style.backgroundColor = "#eee";
  } else {
    dateInp.disabled = false;
    dateInp.style.backgroundColor = "#fff";
  }
}

function toggleStatusDetail() {
  const status = document.getElementById("cat_status_input").value;
  const detailInput = document.getElementById("status_detail_input");

  if (status === "預け中" || status === "Trial中") {
    detailInput.style.display = "block";
  } else {
    detailInput.style.display = "none";
    detailInput.value = "";
  }
}

function initTopSlider() {
  const pages = document.getElementById("top_pages");
  const tabs = document.querySelectorAll("[data-top-tab]");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      pages.dataset.page = btn.dataset.topTab;
      tabs.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
    });
  });
}

function switchModalSlide(idx) {
  const pages = document.getElementById("modal_slide_pages");
  pages.dataset.page = idx;
  document.querySelectorAll(".modal-tab-btn").forEach((btn, i) => {
    btn.classList.toggle("active", i === idx);
  });
}

// ==========================================
// 5. 画像処理 (ドラッグ&ドロップ・圧縮)
// ==========================================

const dropZone = document.getElementById("photo_drop_zone");
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  processImage(e.dataTransfer.files[0]);
});

function handleImageSelect(e) {
  processImage(e.target.files[0]);
}

function processImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width,
        h = img.height,
        max = 600;
      if (w > h && w > max) {
        h *= max / w;
        w = max;
      } else if (h > max) {
        w *= max / h;
        h = max;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      catPhotoBase64 = canvas.toDataURL("image/jpeg", 0.6);
      displayPhoto(catPhotoBase64);
      saveAllData();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function displayPhoto(base64) {
  const img = document.getElementById("cat_photo_img"),
    ph = document.getElementById("photo_placeholder"),
    del = document.getElementById("photo_del_btn");
  if (base64) {
    img.src = base64;
    img.style.display = "block";
    ph.style.display = "none";
    del.style.display = "flex";
  } else {
    img.style.display = "none";
    ph.style.display = "block";
    del.style.display = "none";
  }
}

function deletePhoto() {
  if (confirm("写真を削除しますか?")) {
    catPhotoBase64 = "";
    displayPhoto("");
    saveAllData();
  }
}

// ==========================================
// 6. データ管理 (保存・読み込み・削除)
// ==========================================

async function saveAllData() {
  if (!currentCatId) return;
  const name = document.getElementById("disp_name").textContent;
  const fullData = {
    id: currentCatId === "new" ? `cat_${Date.now()}` : currentCatId,
    name: name === "---" ? "" : name,
    status: document.getElementById("status_stamp").textContent,
    gender: document.getElementById("disp_gender").textContent.replace("---", ""),
    birthDate: document.getElementById("birth_val_hidden").value,
    ageMode: ageMode,
    pattern: document.getElementById("disp_pattern").textContent.replace("---", ""),
    features: document.getElementById("disp_features").textContent.replace("---", ""),
    origin: document.getElementById("disp_origin").textContent.replace("---", ""),
    mc: document.getElementById("disp_mc").textContent.replace("---", ""),
    foster: document.getElementById("cat_foster_input").value,
    rescueNote: document.getElementById("cat_rescue_note").value,
    photo: catPhotoBase64,
    logs: logs,
    eventSummaries: eventSummaries,
    notes: document.getElementById("cat_notes").value,
  };

  if (currentCatId === "new") {
    currentCatId = fullData.id;
    window.history.replaceState(null, "", `?id=${currentCatId}`);
  }

  await saveDB(STORE_DETAIL, fullData);

  if (fullData.name) {
    const summary = {
      id: fullData.id,
      name: fullData.name,
      gender: fullData.gender,
      birthDate: fullData.birthDate,
      age_text: document.getElementById("summary_age").textContent,
      ff_result: logs.ff[0]?.type || "未検査",
      last_vaccine: logs.vaccine[0]?.date || "",
      last_flea: logs.flea[0]?.date || "",
      status: fullData.status,
      origin: fullData.origin,
      foster: fullData.foster,
      photo: fullData.photo,
    };
    await saveDB(STORE_SUMMARY, summary);
  }
}

async function loadAllData() {
  if (!currentCatId || currentCatId === "new") return;

  const d = await getDB(STORE_DETAIL, currentCatId);
  if (!d) return;

  document.getElementById("disp_name").textContent = d.name || "---";
  document.getElementById("status_stamp").textContent = d.status || "在留";
  applyStatusTheme(d.status || "在留");

  document.getElementById("disp_gender").textContent = d.gender || "---";
  document.getElementById("birth_val_hidden").value = d.birthDate || "";
  document.getElementById("disp_pattern").textContent = d.pattern || "---";
  document.getElementById("disp_features").textContent = d.features || "---";
  document.getElementById("disp_origin").textContent = d.origin || "---";
  document.getElementById("disp_mc").textContent = d.mc || "---";

  document.getElementById("cat_foster_input").value = d.foster || "";
  document.getElementById("disp_foster_summary").textContent = d.foster || "(未登録)";
  document.getElementById("cat_rescue_note").value = d.rescueNote || "";
  document.getElementById("cat_notes").value = d.notes || "";

  if (d.ageMode) ageMode = d.ageMode;

  if (d.photo) {
    catPhotoBase64 = d.photo;
    displayPhoto(d.photo);
  }
  if (d.logs) logs = d.logs;
  if (d.eventSummaries) {
    eventSummaries = d.eventSummaries;
    if (eventSummaries.surgery && eventSummaries.surgery.date && eventSummaries.surgery.date !== "不明") {
      const rawW = eventSummaries.surgery.weight ? eventSummaries.surgery.weight.replace("kg", "") : "";
      addWeightEntry(eventSummaries.surgery.date, rawW, { text: "不妊去勢手術", category: "surgery" });
    }
  }

  function normalizeWeightEventsByDate() {
    if (!logs?.weight) return;

    const hasDate = (arr, date) => Array.isArray(arr) && arr.some((x) => x?.date === date);

    logs.weight.forEach((entry) => {
      if (!entry || !Array.isArray(entry.events)) return;

      entry.events = entry.events.map((ev) => {
        // すでに {text, category} ならそのまま
        if (typeof ev === "object" && ev !== null) return ev;

        const text = String(ev);

        // ★ “文字列推定”は禁止：日付だけでカテゴリを決める
        let category = "weight";
        if (eventSummaries?.surgery?.date === entry.date) category = "surgery";
        else if (hasDate(logs.vaccine, entry.date)) category = "vaccine";
        else if (hasDate(logs.flea, entry.date)) category = "flea";
        else if (hasDate(logs.ff, entry.date)) category = "ff";

        return { text, category };
      });
    });
  }
  normalizeWeightEventsByDate();

  updateAgeFromBirth(d.birthDate);

  Object.keys(logs).forEach((key) => {
    const box = document.querySelector(`.log-box[data-log="${key}"]`);
    if (box) updateLogDisplay(box);
  });
  Object.keys(eventSummaries).forEach((key) => {
    const s = eventSummaries[key];
    if (s) {
      const b = document.querySelector(`.log-box[data-log="${key}"]`);
      if (b) {
        b.querySelector("[data-res-date]").textContent = formatDateShort(s.date);
        b.querySelector("[data-res-age]").textContent = s.age;
        b.querySelector("[data-res-weight]").textContent = s.weight;
      }
    }
  });
}

async function saveAndBack() {
  if (document.getElementById("disp_name").textContent === "---") {
    if (!confirm("名前未入力のため一覧に登録されません。戻りますか?")) return;
  } else {
    await saveAllData();
  }
  window.location.href = "List.html";
}

// ==========================================
// 7. 基本情報編集モーダル
// ==========================================

function openBasicModal() {
  switchModalSlide(0);
  document.getElementById("cat_name_input").value = document.getElementById("disp_name").textContent.replace("---", "");
  document.getElementById("cat_status_input").value = document.getElementById("status_stamp").textContent;
  document.getElementById("cat_gender_input").value = document
    .getElementById("disp_gender")
    .textContent.replace("---", "");
  const bInp = document.getElementById("cat_birth_input");
  bInp.type = "text";
  bInp.value = document.getElementById("birth_val_hidden").value;
  document.getElementById("age_mode_input").value = ageMode;
  previewAgeInModal();
  document.getElementById("cat_pattern_input").value = document
    .getElementById("disp_pattern")
    .textContent.replace("---", "");
  document.getElementById("cat_features_input").value = document
    .getElementById("disp_features")
    .textContent.replace("---", "");
  document.getElementById("cat_origin_input").value = document
    .getElementById("disp_origin")
    .textContent.replace("---", "");
  document.getElementById("cat_mc_input").value = document.getElementById("disp_mc").textContent.replace("---", "");
  document.getElementById("basic-modal-overlay").style.display = "flex";
}

function closeBasicModal() {
  document.getElementById("basic-modal-overlay").style.display = "none";
}

function previewAgeInModal() {
  const b = document.getElementById("cat_birth_input").value,
    m = document.getElementById("age_mode_input").value,
    res = b ? calcAgeTextAt(b, new Date().toISOString().split("T")[0], m) : "---";
  document.getElementById("modal_age_preview").textContent = res;
}

async function submitBasicInfo() {
  document.getElementById("disp_name").textContent = document.getElementById("cat_name_input").value || "---";

  const statusBase = document.getElementById("cat_status_input").value;
  const statusDetail = document.getElementById("status_detail_input").value.trim();
  const finalStatus = statusDetail ? `${statusBase}(${statusDetail})` : statusBase;
  document.getElementById("status_stamp").textContent = finalStatus;
  applyStatusTheme(finalStatus);

  document.getElementById("disp_gender").textContent = document.getElementById("cat_gender_input").value || "---";
  const b = document.getElementById("cat_birth_input").value;
  document.getElementById("birth_val_hidden").value = b;
  ageMode = document.getElementById("age_mode_input").value;
  document.getElementById("disp_pattern").textContent = document.getElementById("cat_pattern_input").value || "---";
  document.getElementById("disp_features").textContent = document.getElementById("cat_features_input").value || "---";
  document.getElementById("disp_origin").textContent = document.getElementById("cat_origin_input").value || "---";
  document.getElementById("disp_mc").textContent = document.getElementById("cat_mc_input").value || "---";
  document.getElementById("disp_foster_summary").textContent =
    document.getElementById("cat_foster_input").value || "(未登録)";

  updateAgeFromBirth(b);
  await saveAllData();
  closeBasicModal();
}

async function deleteCurrentCat() {
  if (!confirm("全データを削除します。よろしいですか?")) return;
  await deleteDB(currentCatId);
  window.location.href = "List.html";
}

// ==========================================
// 8. 医療ログ編集モーダル & 追加処理
// ==========================================

function openEditModal(type) {
  activeEditType = type;
  const overlay = document.getElementById("modal-overlay"),
    title = document.getElementById("modal-title"),
    selArea = document.getElementById("modal_select_area"),
    hint = document.getElementById("modal_hint"),
    dateInp = document.getElementById("modal_date");
  dateInp.type = "text";
  dateInp.value = "";
  document.getElementById("modal_weight").value = "";
  selArea.innerHTML = "";
  hint.textContent = "";

  const titles = {
    ff: "FF検査",
    surgery: "不妊去勢手術",
    vaccine: "ワクチン接種",
    flea: "ノミ・寄生虫駆除",
    weight: "体重記録",
  };
  title.textContent = titles[type] || "編集";

  if (type === "ff") {
    selArea.innerHTML = `<select id="modal_type"><option value="">結果を選択してください</option><option value="陰性(-)">陰性(-)</option><option value="陽性(FIV+)">陽性(FIV+)</option><option value="陽性(FeLV+)">陽性(FeLV+)</option><option value="陽性(FIV+/FeLV+)">陽性(FIV+/FeLV+)</option></select>`;
    hint.textContent = "※ 結果未入力で「追加」できません。";
  } else if (type === "vaccine") {
    selArea.innerHTML = `<select id="modal_type"><option value="">ワクチンの種類</option><option value="3種">3種</option><option value="4種">4種</option><option value="5種">5種</option></select>`;
    hint.textContent = "※ ワクチンの種類、体重入力は任意です。";
  } else if (type === "flea") {
    selArea.innerHTML = `
      <div class="pattern-area" style="position:relative;">
        <input type="text" id="modal_type" placeholder="薬を選択または手入力" autocomplete="off" oninput="showFleaBtn()" />
        <ul class="menu-root" id="modal_flea_menu"></ul>
        <button id="confirm_flea_btn" type="button" onclick="confirmFlea()" style="display:none; position:absolute; right:0; top:0; height:100%; padding:0 15px; background:var(--accent); color:white; border:none; border-radius:0 8px 8px 0; cursor:pointer; z-index:5;">決定</button>
      </div>`;
    initFleaMenu();
    hint.textContent = "※ 駆除薬、体重入力は任意です。";
  } else if (type === "weight") {
    selArea.innerHTML = `<input type="text" id="modal_type" placeholder="イベント(例:通院、食欲不振など)" autocomplete="off" />`;
    hint.textContent = "※ イベント入力は任意です。";
  }
  overlay.style.display = "flex";
}

function closeEditModal() {
  document.getElementById("modal-overlay").style.display = "none";
}

async function submitModalData() {
  const isUnknown = document.getElementById("modal_date_unknown").checked;
  const d = isUnknown ? "不明" : document.getElementById("modal_date").value;
  if (!d) return alert("日付を選択するか「不明」にチェックしてください");
  const w = isUnknown ? "" : document.getElementById("modal_weight").value;
  const t = document.getElementById("modal_type")?.value || "";

  if (activeEditType === "ff" && !t) return alert("結果を選択してください");

  if (activeEditType === "surgery") {
    const age = isUnknown ? "---" : calcAgeTextAt(document.getElementById("birth_val_hidden").value, d, ageMode);
    eventSummaries.surgery = { date: d, age: age, weight: w ? w + "kg" : "---" };
    if (!isUnknown) addWeightEntry(d, w, { text: "不妊去勢手術", category: "surgery" });
  } else if (activeEditType === "weight") {
    if (!isUnknown) addWeightEntry(d, w, t ? { text: t, category: "weight" } : null);
  } else {
    logs[activeEditType].unshift({
      date: d,
      weight: w,
      type: t,
      category: activeEditType,
    });
    logs[activeEditType].sort((a, b) => {
      if (a.date === "不明") return 1;
      if (b.date === "不明") return -1;
      return new Date(b.date) - new Date(a.date);
    });

    // 体重グラフ用のラベル作成
    let syncLabel = t || activeEditType;
    if (activeEditType === "ff") syncLabel = "FF: " + t;
    if (!isUnknown) addWeightEntry(d, w, { text: syncLabel, category: activeEditType });
  }

  updateLogDisplay(document.querySelector(`.log-box[data-log="${activeEditType}"]`));
  await saveAllData();
  closeEditModal();
}

// ==========================================
// 9. ログ表示更新 & 履歴削除
// ==========================================
function updateLogDisplay(box) {
  if (!box) return;
  const key = box.dataset.log;
  if (!logs[key] && !eventSummaries[key] && key !== "surgery") return;
  if (box.querySelector(".event-summary")) {
    const s = eventSummaries[key] || { date: "---", age: "---", weight: "---" };
    box.querySelector("[data-res-date]").textContent = formatDateShort(s.date);
    box.querySelector("[data-res-age]").textContent = s.age;
    box.querySelector("[data-res-weight]").textContent = s.weight;
  }
  if (key === "vaccine") {
    const last = logs.vaccine[0]?.date;
    document.getElementById("summary_vaccine").textContent = last ? formatDateShort(last) : "未実施";
    setElapsedText("vaccine_elapsed", last);
  }
  if (key === "flea") {
    const last = logs.flea[0]?.date;
    document.getElementById("summary_flea").textContent = last ? formatDateShort(last) : "未実施";
    setElapsedText("flea_elapsed", last);
  }
  if (key === "ff") {
    const res = logs.ff[0]?.type || "未検査";
    const cell = document.getElementById("summary_ff");
    cell.textContent = res;

    cell.className =
      "badge-val " +
      (res.includes("陽性")
        ? res.includes("FIV")
          ? res.includes("FeLV")
            ? "test-positive-both"
            : "test-positive-fiv"
          : "test-positive-felv"
        : res === "未検査"
          ? "test-none"
          : "test-negative");

    if (typeof applyFFResultTheme === "function") {
      applyFFResultTheme(res);
    }
  }
  const last = logs[key]?.[0],
    prev = logs[key]?.[1];
  const delLastBtn = box.querySelector("[data-del-last]");
  if (delLastBtn) {
    if (last) {
      delLastBtn.style.display = "inline";
      delLastBtn.setAttribute("onclick", `delLogItemByIndex('${key}', 0)`);
    } else delLastBtn.style.display = "none";
  }
  const delPrevBtn = box.querySelector("[data-del-prev]");
  if (delPrevBtn) {
    if (prev) {
      delPrevBtn.style.display = "inline";
      delPrevBtn.setAttribute("onclick", `delLogItemByIndex('${key}', 1)`);
    } else delPrevBtn.style.display = "none";
  }
  if (box.querySelector("[data-last]"))
    box.querySelector("[data-last]").innerHTML = last ? formatItem(last, key) : "---";
  if (box.querySelector("[data-prev]"))
    box.querySelector("[data-prev]").innerHTML = prev ? formatItem(prev, key) : "---";
  const hList = box.querySelector("[data-history]"),
    sum = box.querySelector("details > summary");
  if (hList && logs[key]) {
    hList.innerHTML = "";
    logs[key].slice(2).forEach((it, idx) => {
      const li = document.createElement("li");
      li.innerHTML = `${formatItem(it, key)} <span class="del-circle-x" onclick="delLogItemByIndex('${key}', ${idx + 2})">⊗</span>`;
      hList.appendChild(li);
    });
    if (sum) {
      const count = Math.max(0, logs[key].length - 2);
      sum.textContent = `もっと前の履歴(${count === 0 ? "履歴なし" : count + "件"})`;
    }
  }
}

window.delLogItemByIndex = async function (key, idx) {
  let targetDate = key === "surgery" ? eventSummaries.surgery?.date : logs[key][idx]?.date;
  if (!targetDate) return;
  if (!confirm(targetDate === "不明" ? "この記録を削除しますか?" : `日付:${targetDate} の記録を削除しますか?`)) return;
  if (targetDate === "不明") {
    if (key === "surgery") eventSummaries.surgery = null;
    else logs[key].splice(idx, 1);
  } else {
    const normDate = targetDate.replace(/\//g, "-");
    ["ff", "vaccine", "flea", "weight"].forEach((k) => {
      logs[k] = logs[k].filter((item) => item.date.replace(/\//g, "-") !== normDate);
    });
    if (eventSummaries.surgery && eventSummaries.surgery.date.replace(/\//g, "-") === normDate)
      eventSummaries.surgery = null;
  }
  Object.keys(logs).forEach((k) => {
    const box = document.querySelector(`.log-box[data-log="${k}"]`);
    if (box) updateLogDisplay(box);
  });
  const sBox = document.querySelector('.log-box[data-log="surgery"]');
  if (sBox) updateLogDisplay(sBox);
  await saveAllData();
};

function formatItem(item, key) {
  let s = formatDateShort(item.date);
  if (item.weight) s += ` / ${item.weight}kg`;
  if (item.type) s += ` / ${wrapEventWithColor(item.type, item.category || key)}`;
  if (item.events) {
    s += ` / ${item.events
      .map((e) => {
        if (typeof e === "object") {
          return wrapEventWithColor(e.text, e.category);
        }
        return wrapEventWithColor(e, key);
      })
      .join(" ")}`;
  }
  return s;
}

function wrapEventWithColor(text, category) {
  if (!text) return "";
  let cls = "";

  // FF系はテキストで判定(従来通り)
  if (text.includes("FIV+/FeLV+")) cls = "label-positive-both";
  else if (text.includes("FeLV+")) cls = "label-positive-felv";
  else if (text.includes("FIV+")) cls = "label-positive-fiv";
  else if (text.includes("陽性")) cls = "label-positive";
  else if (text.includes("陰性")) cls = "label-negative";
  // それ以外はカテゴリーで判定
  else if (category === "surgery") cls = "label-surgery";
  else if (category === "vaccine") cls = "label-vaccine";
  else if (category === "flea") cls = "label-flea";

  return cls ? `<span class="${cls}">${text}</span>` : text;
}

// ==========================================
// 10. 体重管理 & グラフ表示 (Chart.js)
// ==========================================

function addWeightEntry(date, weight, event) {
  let entry = logs.weight.find((i) => i.date === date);
  // 重複チェック用のテキスト抽出 helper
  const getTxt = (e) => (typeof e === "object" && e !== null ? e.text : e);

  if (entry) {
    if (weight) entry.weight = weight;
    if (event) {
      const newTxt = getTxt(event);
      // 既存イベントに同じテキストが存在しなければ追加
      if (!entry.events.some((e) => getTxt(e) === newTxt)) {
        entry.events.push(event);
      }
    }
  } else {
    logs.weight.push({ date: date, weight: weight, events: event ? [event] : [] });
  }
  logs.weight.sort((a, b) => new Date(b.date) - new Date(a.date));
  const wBox = document.querySelector('.log-box[data-log="weight"]');
  if (wBox) updateLogDisplay(wBox);
}

function updateWeightChart() {
  const ctx = document.getElementById("weightChart").getContext("2d");
  let chartData = logs.weight.filter((i) => i.weight).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (chartMinDate) chartData = chartData.filter((i) => i.date >= chartMinDate);
  if (weightChart) weightChart.destroy();

  const controls = document.getElementById("chart_controls");
  if (chartData.length === 0) {
    if (controls) controls.style.display = "flex";
    return;
  }
  if (controls) controls.style.display = "flex";
  const isMobile = window.innerWidth <= 600;

  // ラベル生成（オブジェクト/文字列 両対応）
  const customLabels = chartData.map((it) => {
    const res = [formatDateShort(it.date)];
    if (it.events && it.events.length > 0) {
      it.events.forEach((ev) => {
        res.push(typeof ev === "object" && ev !== null ? ev.text : ev);
      });
    }
    return res;
  });

  weightChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          data: chartData.map((i) => ({ x: i.date, y: i.weight })),
          borderColor: "#888",
          backgroundColor: "rgba(136, 136, 136, 0.1)",
          pointBackgroundColor: chartData.map((i) => getBestEventColor(i.events)),
          pointBorderColor: "#fff",
          pointBorderWidth: 1,
          pointRadius: 7,
          pointHoverRadius: 15,
          borderWidth: 2,
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function (context) {
              const date = new Date(context[0].parsed.x);
              const y = date.getFullYear();
              const m = (date.getMonth() + 1).toString().padStart(2, "0");
              const d = date.getDate().toString().padStart(2, "0");
              return `${y}/${m}/${d}`;
            },
            label: function (context) {
              const item = chartData[context.dataIndex];
              let label = ` 体重: ${context.parsed.y}kg`;
              if (item.events && item.events.length > 0) {
                const evTexts = item.events.map((e) => (typeof e === "object" && e !== null ? e.text : e));
                label += ` [${evTexts.join(", ")}]`;
              }
              return label;
            },
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "day", displayFormats: { day: "yyyy/MM/dd" } },
          ticks: {
            autoSkip: false,
            minRotation: 45,
            maxRotation: 90,
            source: "data",
            callback: function (value, index) {
              return customLabels[index];
            },
            color: function (context) {
              const item = chartData[context.index];
              if (!item || !item.events || item.events.length === 0) return "#333";
              return getBestEventColor(item.events);
            },
            font: { size: isMobile ? 9 : 10, weight: "normal" },
          },
        },
        y: { beginAtZero: false },
      },
    },
  });
}

function getBestEventColor(events) {
  if (!events || events.length === 0) return "#888";

  const getScore = (ev) => {
    // オブジェクトならプロパティを展開、文字列ならそのまま使用
    const t = typeof ev === "object" && ev !== null ? ev.text : ev;
    const c = typeof ev === "object" && ev !== null ? ev.category : "";

    // 1. FF陽性を最優先(危険度高)
    if (t.includes("FIV+/FeLV+") || t.includes("陽性") || t.includes("FIV") || t.includes("FeLV")) return 100;

    // 2. カテゴリー判定 (新データ用: 確実)
    // リターン後の数字はグラフでどの色を使うかの優先度
    if (c === "surgery") return 70;
    if (c === "vaccine") return 60;
    if (c === "flea") return 50;

    // 3. 文字列判定 (旧データ用バックアップ)
    // if (t.match(/手術|surgery/)) return 70;
    // if (t.match(/ワクチン|種|vaccine/)) return 60;
    // if (t.match(/駆除|レボ|ブロード|ネクス|フロント|アドボ|マイフリー|flea/)) return 50;

    if (t.includes("陰性")) return 30;
    return 10;
  };

  let top = events[0],
    max = -1;
  events.forEach((ev) => {
    let s = getScore(ev);
    if (s > max) {
      max = s;
      top = ev;
    }
  });

  const topTxt = typeof top === "object" && top !== null ? top.text : top;
  const topCat = typeof top === "object" && top !== null ? top.category : "";

  // 色の決定
  if (topTxt.includes("FIV+/FeLV+")) return "#a806ff";
  if (topTxt.includes("FeLV+")) return "#f50284";
  if (topTxt.includes("FIV+")) return "#d46d39";

  //  文字列判定 (旧データ用バックアップ)
  // if (topCat === "surgery" || topTxt.match(/手術|surgery/)) return "#81418d";
  // if (topCat === "vaccine" || topTxt.match(/ワクチン|種|vaccine/)) return "#a99628";
  // if (topCat === "flea" || topTxt.match(/駆除|レボ|ブロード|ネクス|フロント|アドボ|マイフリー|flea/)) return "#1cc810";

  if (topCat === "surgery") return "#81418d";
  if (topCat === "vaccine") return "#a99628";
  if (topCat === "flea") return "#1cc810";

  if (topTxt.includes("陽性")) return "#f50284"; // 汎用陽性
  if (topTxt.includes("陰性")) return "#1565c0";

  return "#888";
}

// スライダー操作時の処理
function onSliderChange(val) {
  const slider = document.getElementById("timeSlider");
  const max = parseInt(slider.max);
  const days = parseInt(val);

  if (days >= max - 5) {
    chartMinDate = null;
    document.getElementById("range_label").textContent = "全期間";
  } else {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    chartMinDate = d.toISOString().split("T")[0];
    document.getElementById("range_label").textContent = `${y}/${m}/${day} 〜 (${days}日分)`;
  }
  updateWeightChart();
}

function openGraphModal() {
  const modal = document.getElementById("graph-modal-overlay");
  modal.style.display = "flex";

  const validData = logs.weight.filter((i) => i.weight && i.date && i.date !== "不明");
  let maxDays = 90;

  if (validData.length > 0) {
    validData.sort((a, b) => new Date(a.date) - new Date(b.date));
    const oldDate = new Date(validData[0].date);
    const nowDate = new Date();
    const diffTime = Math.abs(nowDate - oldDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 30) {
      maxDays = diffDays + 10;
    }
  }

  const slider = document.getElementById("timeSlider");
  slider.max = maxDays;
  slider.value = maxDays;
  onSliderChange(maxDays);
}

function closeGraphModal() {
  document.getElementById("graph-modal-overlay").style.display = "none";
}

// ==========================================
// 11. 特殊入力メニュー (毛柄・ノミ駆除薬)
// ==========================================

const patternData = {
  キジトラ系: ["キジトラ", "キジ白"],
  サバトラ系: ["サバトラ", "サバ白"],
  茶トラ系: ["茶トラ", "茶白"],
  黒白系: ["黒", "黒白", "白"],
  三毛系: ["三毛", "サビ"],
  その他: ["その他"],
};
const pInput = document.getElementById("cat_pattern_input");
const mainMenu = document.getElementById("modal_pattern_menu");
const confirmBtn = document.getElementById("confirm_pattern_btn");

// 毛柄メニュー生成
if (mainMenu) {
  Object.keys(patternData).forEach((cat) => {
    const li = document.createElement("li");
    li.className = "menu-item";
    li.innerHTML = cat + " ▶";
    const sub = document.createElement("ul");
    sub.className = "submenu";
    patternData[cat].forEach((p) => {
      const sli = document.createElement("li");
      sli.innerText = p;
      sli.onclick = (e) => {
        e.stopPropagation();
        pInput.value = p;
        mainMenu.classList.remove("active");
        showPatternBtn();
      };
      sub.appendChild(sli);
    });
    li.appendChild(sub);
    mainMenu.appendChild(li);
  });
}

if (pInput) {
  pInput.onclick = (e) => {
    e.stopPropagation();
    mainMenu.classList.add("active");
  };
}
function showPatternBtn() {
  if (confirmBtn) confirmBtn.style.display = pInput.value ? "block" : "none";
}
function handlePatternKey(e) {
  if (e.key === "Enter") confirmPattern();
}
function confirmPattern() {
  if (confirmBtn) confirmBtn.style.display = "none";
  if (mainMenu) mainMenu.classList.remove("active");
}

// ノミ駆除薬のメニュー初期化
function initFleaMenu() {
  const drugs = [
    "レボリューション",
    "ブロードライン",
    "ネクスガード",
    "フロントライン",
    "アドボケート",
    "マイフリーガード",
  ];
  const menu = document.getElementById("modal_flea_menu");
  const inp = document.getElementById("modal_type");
  const btn = document.getElementById("confirm_flea_btn");
  if (!menu || !inp || !btn) return;

  // メニュー再構築の重複防止のため一度クリア
  menu.innerHTML = "";

  drugs.forEach((d) => {
    const li = document.createElement("li");
    li.className = "menu-item";
    li.textContent = d;
    li.onclick = (e) => {
      e.stopPropagation();
      inp.value = d;
      menu.classList.remove("active");
      btn.style.display = "block";
    };
    menu.appendChild(li);
  });

  inp.onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle("active");
  };
}

function showFleaBtn() {
  const inp = document.getElementById("modal_type");
  const btn = document.getElementById("confirm_flea_btn");
  if (inp && btn) btn.style.display = inp.value ? "block" : "none";
}

function confirmFlea() {
  const menu = document.getElementById("modal_flea_menu");
  const btn = document.getElementById("confirm_flea_btn");
  if (btn) btn.style.display = "none";
  if (menu) menu.classList.remove("active");
}

window.addEventListener(
  "click",
  (e) => {
    // 模様メニュー用
    if (pInput && mainMenu && !pInput.contains(e.target) && !mainMenu.contains(e.target)) {
      mainMenu.classList.remove("active");
    }
    // ノミ駆除メニュー用
    const fInp = document.getElementById("modal_type");
    const fMenu = document.getElementById("modal_flea_menu");
    if (fInp && fMenu && !fInp.contains(e.target) && !fMenu.contains(e.target)) {
      fMenu.classList.remove("active");
    }
  },
  true,
);

// ==========================================
// 12. 起動時初期化処理
// ==========================================

window.onload = async () => {
  const modalConfigs = [
    { id: "basic-modal-overlay", closeFn: closeBasicModal },
    { id: "modal-overlay", closeFn: closeEditModal },
    { id: "graph-modal-overlay", closeFn: closeGraphModal },
  ];
  modalConfigs.forEach(({ id, closeFn }) => {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    let startedOnOverlay = false;
    overlay.addEventListener("mousedown", (e) => {
      startedOnOverlay = e.target === overlay;
    });
    overlay.addEventListener("mouseup", (e) => {
      if (startedOnOverlay && e.target === overlay) closeFn();
      startedOnOverlay = false;
    });
  });
  await loadAllData();
  initTopSlider();
};

function updateAgeFromBirth(val) {
  const ageCell = document.getElementById("summary_age");
  const dateCell = document.getElementById("summary_birth_date");
  if (!val) {
    if (ageCell) ageCell.textContent = "---";
    if (dateCell) dateCell.textContent = "---";
    return;
  }
  if (dateCell) {
    const pref = ageMode === "exact" ? "確定" : ageMode === "rough" ? "概ね" : "推定";
    dateCell.textContent = `${pref}：${formatDateShort(val)}`;
  }
  if (ageCell) ageCell.textContent = calcAgeTextAt(val, new Date().toISOString().split("T")[0], ageMode);
}
