(() => {
  // -----------------------
  // Helpers
  // -----------------------
  const $ = (sel) => document.querySelector(sel);
  const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  const pad2 = (n) => String(n).padStart(2, "0");
  const toISODate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const parseISODate = (s) => {
    // safe local parse
    const [y,m,d] = s.split("-").map(Number);
    return new Date(y, m-1, d, 0,0,0,0);
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const daysBetweenInclusive = (startISO, endISO) => {
    const a = parseISODate(startISO);
    const b = parseISODate(endISO);
    const ms = (b - a);
    const days = Math.floor(ms / (24*60*60*1000)) + 1;
    return Math.max(0, days);
  };
  const isWithin = (todayISO, startISO, endISO) => todayISO >= startISO && todayISO <= endISO;

  function toast(msg, ms = 2400){
    const t = $("#toast");
    $("#toastTitle").textContent = "Saved";
    $("#toastDesc").textContent = msg;
    $("#toastMarkDone").style.display = "none";
    $("#toastSnooze").style.display = "none";
    $("#toastDismiss").textContent = "Close";
    t.style.display = "flex";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.style.display = "none", ms);
  }

  // -----------------------
  // Storage
  // -----------------------
  const KEY = "remember_v1_state";

  const defaultState = () => ({
    version: 1,
    selectedCapacityId: null,
    capacities: [
      { id: uid(), name: "Focus", note: "Deep work & attention", record: "Best streak: 5 days" },
      { id: uid(), name: "Fitness", note: "Strength & cardio", record: "5K: 24:10" }
    ],
    objectives: [
      // {id, capacityId, name, measure, target, startDate, endDate, time, reward, notes, snoozes: { [dateISO]: untilTs }, lastReminder: { [dateISO]: ts } }
    ],
    dailyLogs: {
      // [dateISO]: { [objectiveId]: { value, done, ts } }
    }
  });

  function load(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return defaultState();
      const st = JSON.parse(raw);
      // basic migration safety
      if(!st || typeof st !== "object") return defaultState();
      if(!Array.isArray(st.capacities)) st.capacities = [];
      if(!Array.isArray(st.objectives)) st.objectives = [];
      if(!st.dailyLogs || typeof st.dailyLogs !== "object") st.dailyLogs = {};
      if(!st.selectedCapacityId && st.capacities[0]) st.selectedCapacityId = st.capacities[0].id;
      return st;
    }catch(e){
      console.warn("Load failed; using defaults", e);
      return defaultState();
    }
  }

  function save(){
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function resetAll(){
    localStorage.removeItem(KEY);
    state = defaultState();
    if(state.capacities[0]) state.selectedCapacityId = state.capacities[0].id;
    save();
    render();
    toast("Reset complete.");
  }

  let state = load();
  if(!state.selectedCapacityId && state.capacities[0]) state.selectedCapacityId = state.capacities[0].id;
  save();

  // -----------------------
  // Derived getters
  // -----------------------
  const todayISO = () => toISODate(new Date());
  const selectedCapacity = () => state.capacities.find(c => c.id === state.selectedCapacityId) || state.capacities[0] || null;
  const objectivesForSelected = () => state.objectives.filter(o => o.capacityId === (selectedCapacity()?.id || ""));
  const activeTodayObjectives = () => {
    const cap = selectedCapacity();
    if(!cap) return [];
    const t = todayISO();
    return state.objectives
      .filter(o => o.capacityId === cap.id && isWithin(t, o.startDate, o.endDate));
  };

  // -----------------------
  // UI: capacities
  // -----------------------
  function renderCapacityList(){
    const el = $("#capacityList");
    el.innerHTML = "";

    if(state.capacities.length === 0){
      el.innerHTML = `<div class="muted">No capacities yet. Add one.</div>`;
      return;
    }

    state.capacities.forEach(cap => {
      const selected = cap.id === state.selectedCapacityId;
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="left" style="min-width:0">
          <div class="title">
            <span>${escapeHtml(cap.name)}</span>
            ${selected ? `<span class="tag" style="color:rgba(56,211,159,.95); border-color: rgba(56,211,159,.35)">Selected</span>` : `<span class="tag">Capacity</span>`}
          </div>
          <div class="meta">${escapeHtml(cap.note || "")}</div>
        </div>
        <div class="actions">
          <button class="btn" data-act="select" data-id="${cap.id}">Open</button>
          <button class="btn" data-act="edit" data-id="${cap.id}">Edit</button>
          <button class="btn danger" data-act="del" data-id="${cap.id}">Delete</button>
        </div>
      `;
      el.appendChild(div);
    });

    el.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if(act === "select"){
          state.selectedCapacityId = id;
          save(); render();
        } else if(act === "edit"){
          editCapacity(id);
        } else if(act === "del"){
          deleteCapacity(id);
        }
      });
    });
  }

  function editCapacity(id){
    const cap = state.capacities.find(c => c.id === id);
    if(!cap) return;
    const name = prompt("Capacity name:", cap.name);
    if(name === null) return;
    const note = prompt("Capacity note (optional):", cap.note || "");
    if(note === null) return;
    cap.name = name.trim() || cap.name;
    cap.note = note.trim();
    save(); render();
    toast("Capacity updated.");
  }

  function deleteCapacity(id){
    const cap = state.capacities.find(c => c.id === id);
    if(!cap) return;
    if(!confirm(`Delete capacity “${cap.name}”? This will also remove its objectives and logs.`)) return;

    // remove objectives and associated logs
    const objIds = state.objectives.filter(o => o.capacityId === id).map(o => o.id);
    state.objectives = state.objectives.filter(o => o.capacityId !== id);
    for(const day in state.dailyLogs){
      for(const oid of objIds){
        if(state.dailyLogs[day] && state.dailyLogs[day][oid]) delete state.dailyLogs[day][oid];
      }
    }

    state.capacities = state.capacities.filter(c => c.id !== id);
    if(state.selectedCapacityId === id){
      state.selectedCapacityId = state.capacities[0]?.id || null;
    }
    save(); render();
    toast("Capacity deleted.");
  }

  function quickAddCapacity(){
    const name = prompt("New capacity name:");
    if(name === null) return;
    const trimmed = name.trim();
    if(!trimmed) return;
    const note = prompt("Note (optional):", "");
    if(note === null) return;

    const cap = { id: uid(), name: trimmed, note: (note || "").trim(), record: "" };
    state.capacities.unshift(cap);
    state.selectedCapacityId = cap.id;
    save(); render();
    toast("Capacity added.");
  }

  // -----------------------
  // UI: record editor
  // -----------------------
  function renderRecordEditor(){
    const el = $("#recordEditor");
    el.innerHTML = "";

    if(state.capacities.length === 0){
      el.innerHTML = `<div class="muted">Add capacities to set records.</div>`;
      return;
    }

    state.capacities.forEach(cap => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="left" style="min-width:0">
          <div class="title">
            <span>${escapeHtml(cap.name)}</span>
            <span class="tag">Record</span>
          </div>
          <div class="meta">${escapeHtml(cap.record || "—")}</div>
        </div>
        <div class="actions">
          <button class="btn" data-id="${cap.id}">Edit record</button>
        </div>
      `;
      div.querySelector("button").addEventListener("click", () => {
        const val = prompt(`Best current record for ${cap.name}:`, cap.record || "");
        if(val === null) return;
        cap.record = val.trim();
        save(); renderRecordEditor();
        toast("Record updated.");
      });
      el.appendChild(div);
    });
  }

  // -----------------------
  // UI: capacity select + title
  // -----------------------
  function renderCapacitySelect(){
    const sel = $("#capacitySelect");
    sel.innerHTML = "";
    if(state.capacities.length === 0){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No capacities";
      sel.appendChild(opt);
      sel.disabled = true;
      $("#rightTitle").textContent = "Objectives";
      return;
    }
    sel.disabled = false;
    state.capacities.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    sel.value = state.selectedCapacityId || state.capacities[0].id;
    const cap = selectedCapacity();
    $("#rightTitle").textContent = cap ? `Objectives — ${cap.name}` : "Objectives";
  }

  // -----------------------
  // Objectives CRUD
  // -----------------------
  function showObjectiveComposer(show){
    $("#objectiveComposer").style.display = show ? "block" : "none";
  }

  function defaultDates(){
    const t = new Date();
    const start = toISODate(t);
    const end = toISODate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 27));
    return {start, end};
  }

  function startAddObjective(){
    if(!selectedCapacity()){
      alert("Add a capacity first.");
      return;
    }
    const {start, end} = defaultDates();
    $("#objName").value = "";
    $("#objMeasure").value = "minutes";
    $("#objTarget").value = 30;
    $("#objStart").value = start;
    $("#objEnd").value = end;
    $("#objTime").value = "09:00";
    $("#objReward").value = "";
    $("#objNotes").value = "";
    showObjectiveComposer(true);
    $("#objName").focus();
  }

  function saveObjectiveFromComposer(){
    const cap = selectedCapacity();
    if(!cap) return;

    const name = $("#objName").value.trim();
    const measure = $("#objMeasure").value;
    const startDate = $("#objStart").value;
    const endDate = $("#objEnd").value;
    const time = $("#objTime").value || "09:00";
    const reward = $("#objReward").value.trim();
    const notes = $("#objNotes").value.trim();
    let target = Number($("#objTarget").value || 0);

    if(!name){ alert("Objective name is required."); return; }
    if(!startDate || !endDate){ alert("Start and end dates are required."); return; }
    if(endDate < startDate){ alert("End date must be on/after start date."); return; }
    if(measure === "boolean") target = 1;
    target = clamp(target, 0, 1000000);

    const obj = {
      id: uid(),
      capacityId: cap.id,
      name,
      measure,
      target,
      startDate,
      endDate,
      time,
      reward,
      notes,
      snoozes: {},      // dateISO -> untilTs
      lastReminder: {}  // dateISO -> ts
    };

    state.objectives.unshift(obj);
    save();
    showObjectiveComposer(false);
    render();
    toast("Objective added.");
  }

  function editObjective(id){
    const obj = state.objectives.find(o => o.id === id);
    if(!obj) return;

    const name = prompt("Objective name:", obj.name);
    if(name === null) return;

    const measure = prompt("Measure (minutes | count | boolean):", obj.measure);
    if(measure === null) return;
    const m = (measure.trim() || obj.measure).toLowerCase();
    if(!["minutes","count","boolean"].includes(m)){
      alert("Measure must be minutes, count, or boolean.");
      return;
    }

    const targetStr = prompt("Daily target (number). Ignored for boolean:", String(obj.target));
    if(targetStr === null) return;
    let target = Number(targetStr);
    if(Number.isNaN(target)) target = obj.target;
    if(m === "boolean") target = 1;

    const startDate = prompt("Start date (YYYY-MM-DD):", obj.startDate);
    if(startDate === null) return;
    const endDate = prompt("End date (YYYY-MM-DD):", obj.endDate);
    if(endDate === null) return;
    if(endDate < startDate){
      alert("End date must be on/after start date.");
      return;
    }

    const time = prompt("Daily reminder time (HH:MM):", obj.time);
    if(time === null) return;

    const reward = prompt("Completion reward:", obj.reward || "");
    if(reward === null) return;

    const notes = prompt("Notes (short):", obj.notes || "");
    if(notes === null) return;

    obj.name = (name.trim() || obj.name);
    obj.measure = m;
    obj.target = clamp(target, 0, 1000000);
    obj.startDate = startDate.trim() || obj.startDate;
    obj.endDate = endDate.trim() || obj.endDate;
    obj.time = time.trim() || obj.time;
    obj.reward = reward.trim();
    obj.notes = notes.trim();

    save(); render();
    toast("Objective updated.");
  }

  function deleteObjective(id){
    const obj = state.objectives.find(o => o.id === id);
    if(!obj) return;
    if(!confirm(`Delete objective “${obj.name}”?`)) return;

    state.objectives = state.objectives.filter(o => o.id !== id);
    for(const day in state.dailyLogs){
      if(state.dailyLogs[day] && state.dailyLogs[day][id]) delete state.dailyLogs[day][id];
    }
    save(); render();
    toast("Objective deleted.");
  }

  // -----------------------
  // Daily logs
  // -----------------------
  function getLog(dateISO, objId){
    if(!state.dailyLogs[dateISO]) state.dailyLogs[dateISO] = {};
    return state.dailyLogs[dateISO][objId] || null;
  }

  function setLog(dateISO, objId, patch){
    if(!state.dailyLogs[dateISO]) state.dailyLogs[dateISO] = {};
    const existing = state.dailyLogs[dateISO][objId] || { value: 0, done: false, ts: Date.now() };
    const next = { ...existing, ...patch, ts: Date.now() };
    state.dailyLogs[dateISO][objId] = next;
    save();
  }

  function markDoneToday(objId){
    const obj = state.objectives.find(o => o.id === objId);
    if(!obj) return;
    const t = todayISO();
    if(obj.measure === "boolean"){
      setLog(t, objId, { value: 1, done: true });
    } else {
      // If already has value, just mark done; else set to target
      const existing = getLog(t, objId);
      const val = existing?.value ?? 0;
      const newVal = val > 0 ? val : obj.target;
      setLog(t, objId, { value: newVal, done: newVal >= obj.target });
    }
    renderToday();
    toast("Logged for today.");
  }

  // -----------------------
  // Rendering: objectives
  // -----------------------
  function objectiveProgressForDate(obj, dateISO){
    const log = getLog(dateISO, obj.id);
    const val = log?.value ?? 0;
    const done = log?.done ?? false;
    let pct = 0;
    if(obj.measure === "boolean"){
      pct = done ? 100 : 0;
    } else if(obj.target <= 0){
      pct = 0;
    } else {
      pct = clamp(Math.round((val / obj.target) * 100), 0, 100);
    }
    return { val, done, pct };
  }

  function renderToday(){
    const el = $("#todayList");
    el.innerHTML = "";
    const cap = selectedCapacity();
    if(!cap){
      el.innerHTML = `<div class="muted">Add a capacity to begin.</div>`;
      return;
    }

    const t = todayISO();
    const objs = activeTodayObjectives();

    if(objs.length === 0){
      el.innerHTML = `<div class="muted">No objectives active today for <b>${escapeHtml(cap.name)}</b>.</div>`;
      return;
    }

    objs.forEach(obj => {
      const { val, done, pct } = objectiveProgressForDate(obj, t);
      const div = document.createElement("div");
      div.className = "item";

      const measureLabel = obj.measure === "minutes" ? "min" : (obj.measure === "count" ? "count" : "done");
      const targetLabel = obj.measure === "boolean" ? "" : ` / ${obj.target} ${measureLabel}`;
      const when = obj.time ? `⏰ ${obj.time}` : "";

      div.innerHTML = `
        <div class="left" style="min-width:0">
          <div class="title">
            <span>${escapeHtml(obj.name)}</span>
            <span class="tag">${when || "Today"}</span>
            ${done ? `<span class="tag" style="color:rgba(56,211,159,.95); border-color: rgba(56,211,159,.35)">Done</span>` : `<span class="tag">In progress</span>`}
          </div>
          <div class="meta">
            <div>${escapeHtml(obj.startDate)} → ${escapeHtml(obj.endDate)} · Reward: <b>${escapeHtml(obj.reward || "—")}</b></div>
            ${obj.notes ? `<div>Notes: ${escapeHtml(obj.notes)}</div>` : ``}
          </div>
          <div class="progress" aria-hidden="true">
            <div class="bar ${done ? "good" : (pct >= 70 ? "accent" : (pct >= 30 ? "warn" : "bad"))}" style="width:${pct}%"></div>
          </div>
          <div class="tiny" style="margin-top:8px">
            Today: <b>${obj.measure === "boolean" ? (done ? "Done" : "Not done") : `${val} ${measureLabel}${targetLabel}`}</b>
          </div>
        </div>
        <div class="actions">
          ${obj.measure === "boolean" ? `
            <button class="btn good" data-act="done" data-id="${obj.id}">${done ? "Done ✅" : "Mark done"}</button>
          ` : `
            <button class="btn" data-act="add" data-id="${obj.id}">+ Log</button>
            <button class="btn good" data-act="done" data-id="${obj.id}">Mark done</button>
          `}
        </div>
      `;

      div.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
          const act = btn.dataset.act;
          const id = btn.dataset.id;
          if(act === "done"){
            markDoneToday(id);
          } else if(act === "add"){
            logAmountToday(id);
          }
        });
      });

      el.appendChild(div);
    });
  }

  function logAmountToday(objId){
    const obj = state.objectives.find(o => o.id === objId);
    if(!obj) return;
    const t = todayISO();
    const existing = getLog(t, objId);
    const current = existing?.value ?? 0;
    const label = obj.measure === "minutes" ? "minutes" : "count";
    const raw = prompt(`Log today’s amount for “${obj.name}” (${label}):`, String(current));
    if(raw === null) return;
    const val = clamp(Number(raw), 0, 1000000);
    if(Number.isNaN(val)) return;
    setLog(t, objId, { value: val, done: (obj.measure === "boolean") ? !!val : (obj.target > 0 ? val >= obj.target : false) });
    renderToday();
    toast("Logged for today.");
  }

  function renderObjectives(){
    const el = $("#objectiveList");
    el.innerHTML = "";
    const cap = selectedCapacity();
    if(!cap){
      el.innerHTML = `<div class="muted">Add a capacity to start creating objectives.</div>`;
      return;
    }

    const t = todayISO();
    const objs = objectivesForSelected().slice().sort((a,b) => (b.startDate.localeCompare(a.startDate)));

    if(objs.length === 0){
      el.innerHTML = `<div class="muted">No objectives yet for <b>${escapeHtml(cap.name)}</b>.</div>`;
      return;
    }

    objs.forEach(obj => {
      const active = isWithin(t, obj.startDate, obj.endDate);
      const totalDays = daysBetweenInclusive(obj.startDate, obj.endDate);
      const elapsed = active ? daysBetweenInclusive(obj.startDate, t) : (t < obj.startDate ? 0 : totalDays);
      const pctWindow = totalDays ? clamp(Math.round((elapsed / totalDays) * 100), 0, 100) : 0;

      const { pct } = objectiveProgressForDate(obj, t);
      const statusTag = active ? `Active` : (t < obj.startDate ? `Upcoming` : `Completed period`);

      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="left" style="min-width:0">
          <div class="title">
            <span>${escapeHtml(obj.name)}</span>
            <span class="tag">${statusTag}</span>
            <span class="tag">⏰ ${escapeHtml(obj.time || "—")}</span>
            <span class="tag">${escapeHtml(obj.measure)}</span>
          </div>
          <div class="meta">
            <div>${escapeHtml(obj.startDate)} → ${escapeHtml(obj.endDate)} · Daily target: <b>${obj.measure === "boolean" ? "Done" : `${obj.target}`}</b></div>
            <div>Reward: <b>${escapeHtml(obj.reward || "—")}</b></div>
          </div>

          <div class="progress" aria-hidden="true" title="Period progress">
            <div class="bar accent" style="width:${pctWindow}%"></div>
          </div>
          <div class="tiny" style="margin-top:8px">
            Period progress: <b>${pctWindow}%</b>
            ${active ? ` · Today progress: <b>${pct}%</b>` : ``}
          </div>
        </div>

        <div class="actions">
          <button class="btn" data-act="edit" data-id="${obj.id}">Edit</button>
          <button class="btn danger" data-act="del" data-id="${obj.id}">Delete</button>
        </div>
      `;

      div.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
          const act = btn.dataset.act;
          const id = btn.dataset.id;
          if(act === "edit") editObjective(id);
          if(act === "del") deleteObjective(id);
        });
      });

      el.appendChild(div);
    });
  }

  // -----------------------
  // Reminders
  // -----------------------
  function canNotify(){
    return ("Notification" in window);
  }

  async function enableNotifications(){
    if(!canNotify()){
      alert("Notifications not supported in this browser.");
      return;
    }
    const res = await Notification.requestPermission();
    toast(res === "granted" ? "Notifications enabled." : "Notifications not enabled.");
  }

  function maybeFireReminder(){
    const cap = selectedCapacity();
    if(!cap) return;
    const tISO = todayISO();
    const now = new Date();
    const nowHHMM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const nowTs = Date.now();

    // pick the earliest due objective that hasn't been reminded recently
    const due = activeTodayObjectives()
      .filter(o => (o.time || "00:00") <= nowHHMM)
      .filter(o => {
        // if snoozed, ignore until snooze expires
        const until = o.snoozes?.[tISO];
        if(until && nowTs < until) return false;

        // if already done today, ignore
        const { done } = objectiveProgressForDate(o, tISO);
        if(done) return false;

        // reminder once per 20 minutes max
        const last = o.lastReminder?.[tISO] || 0;
        return (nowTs - last) > (20 * 60 * 1000);
      })
      .sort((a,b) => (a.time || "").localeCompare(b.time || ""));

    if(due.length === 0) return;

    const obj = due[0];
    obj.lastReminder = obj.lastReminder || {};
    obj.lastReminder[tISO] = nowTs;
    save();

    showReminderToast(obj);

    if(canNotify() && Notification.permission === "granted"){
      try{
        new Notification("Remember: objective time", {
          body: `${obj.name} (${selectedCapacity()?.name || "Capacity"})`,
          tag: `remember-${obj.id}-${tISO}`
        });
      }catch(e){
        // ignore if browser blocks
      }
    }
  }

  function showReminderToast(obj){
    const t = $("#toast");
    $("#toastTitle").textContent = "Reminder";
    $("#toastDesc").textContent = `Time for: ${obj.name} · Capacity: ${selectedCapacity()?.name || ""}`;
    $("#toastMarkDone").style.display = "inline-flex";
    $("#toastSnooze").style.display = "inline-flex";
    $("#toastDismiss").textContent = "Dismiss";
    t.style.display = "flex";

    $("#toastMarkDone").onclick = () => {
      markDoneToday(obj.id);
      t.style.display = "none";
    };
    $("#toastSnooze").onclick = () => {
      const tISO = todayISO();
      obj.snoozes = obj.snoozes || {};
      obj.snoozes[tISO] = Date.now() + (10 * 60 * 1000);
      save();
      t.style.display = "none";
      toast("Snoozed 10 minutes.");
    };
    $("#toastDismiss").onclick = () => {
      t.style.display = "none";
    };
  }

  // -----------------------
  // Render root
  // -----------------------
  function render(){
    $("#todayPill").textContent = `Today: ${todayISO()}`;
    renderCapacityList();
    renderRecordEditor();
    renderCapacitySelect();
    renderToday();
    renderObjectives();
  }

  // -----------------------
  // Events
  // -----------------------
  $("#btnQuickAddCapacity").addEventListener("click", quickAddCapacity);
  $("#capacitySelect").addEventListener("change", (e) => {
    state.selectedCapacityId = e.target.value;
    save(); render();
  });

  $("#btnAddObjective").addEventListener("click", startAddObjective);
  $("#btnCancelObjective").addEventListener("click", () => showObjectiveComposer(false));
  $("#btnSaveObjective").addEventListener("click", saveObjectiveFromComposer);

  $("#btnEnableNotifs").addEventListener("click", enableNotifications);
  $("#btnReset").addEventListener("click", resetAll);

  // Reminder loop (checks every 20 seconds; lightweight)
  setInterval(maybeFireReminder, 20 * 1000);
  // Also check on focus
  window.addEventListener("focus", () => maybeFireReminder());

  // Start
  render();

  // -----------------------
  // HTML escaping
  // -----------------------
  function escapeHtml(str){
    return String(str ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
})();
