const slotCount = 10;
const asanaSlots = Array(slotCount).fill(null);

let holdingStartedAt = 0;
let elapsedTime = 0;
let holdingInterval = null;
let isHolding = false;

let sessionStartedAt = null;
let sessionElapsedTime = 0;
let sessionInterval = null;
let isSessionActive = false;
let isSessionEnded = false;

let editingIndex = null;
let soundEnabled = true;
let audioContext = null;
let lastQualifiedSlotBeep = false;
let scriptSourceText = "";

const elements = {
  mainTime: document.getElementById("mainTime"),
  milliseconds: document.getElementById("ms"),
  mainButton: document.getElementById("mainBTN"),
  matrix: document.getElementById("singleColumn"),
  totalDisplay: document.getElementById("totalDisplay"),
  slotCount: document.getElementById("slotCount"),
  sessionStatus: document.getElementById("sessionStatus"),
  shortcutAction: document.getElementById("shortcutAction"),
  endSession: document.getElementById("endSession"),
  endedNote: document.getElementById("endedNote"),
  resetModal: document.getElementById("resetModal"),
  codeModal: document.getElementById("codeModal"),
  scriptSource: document.getElementById("scriptSource"),
  codeMessage: document.getElementById("codeMessage"),
  liveMessage: document.getElementById("liveMessage"),
  soundToggle: document.getElementById("soundToggle"),
  soundIcon: document.getElementById("soundIcon"),
  soundLabel: document.getElementById("soundLabel")
};

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((milliseconds % 1000) / 10);

  return {
    main: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    fraction: `.${String(centiseconds).padStart(2, "0")}`
  };
}

function formatHoldingTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const centiseconds = Math.floor((milliseconds % 1000) / 10);
  return `${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function filledCount() {
  return asanaSlots.filter((time) => time !== null).length;
}

function nextEmptyIndex() {
  return asanaSlots.findIndex((time) => time === null);
}

function playBeep(frequency, duration, type = "sine") {
  if (!soundEnabled) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio is not supported by this browser.");
    }

    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") void audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    gain.gain.setValueAtTime(0.12, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch (error) {
    console.warn("Audio feedback could not be played.", error);
  }
}

function updateTimerDisplay() {
  const formatted = formatTime(elapsedTime);
  elements.mainTime.textContent = formatted.main;
  elements.milliseconds.textContent = formatted.fraction;
}

function updateTotalDisplay() {
  const totalSeconds = Math.round(sessionElapsedTime / 1000);
  elements.totalDisplay.textContent = String(totalSeconds);
  elements.totalDisplay.classList.toggle("bg-red", sessionStartedAt !== null && (totalSeconds <= 150 || totalSeconds > 190));
  elements.totalDisplay.classList.toggle("bg-green", sessionStartedAt !== null && totalSeconds > 150 && totalSeconds <= 190);
}

function getButtonState() {
  if (isSessionEnded) return { text: "Reset All", className: "reset-state" };
  if (isHolding) return { text: "Stop", className: "stop" };
  if (sessionStartedAt === null) return { text: "Start", className: "start" };

  const next = nextEmptyIndex();
  if (next === -1) return { text: "Stop Total Time", className: "stop-total" };
  return { text: `A${next + 1}`, className: "start" };
}

function updateInterface() {
  const button = getButtonState();
  elements.mainButton.textContent = button.text;
  elements.mainButton.className = `btn ${button.className}`;
  elements.shortcutAction.textContent = button.text;
  elements.slotCount.textContent = `${filledCount()}/${slotCount} Asanas`;
  elements.sessionStatus.textContent = isHolding
    ? `HOLDING A${nextEmptyIndex() + 1}`
    : isSessionActive
      ? "TOTAL TIME RUNNING"
      : isSessionEnded
        ? "SESSION STOPPED"
        : "STANDBY";
  elements.endSession.hidden = !isSessionActive || isSessionEnded;
  elements.endedNote.hidden = !isSessionEnded;
}

function renderMatrix() {
  elements.matrix.replaceChildren();

  asanaSlots.forEach((time, index) => {
    const row = document.createElement("div");
    row.className = "matrix-item";
    row.dataset.index = String(index);

    if (time !== null) {
      row.classList.add("filled", time < 4500 ? "hold-red" : "hold-sky");
    }
    if (isHolding && nextEmptyIndex() === index) row.classList.add("active-holding");

    const label = document.createElement("span");
    label.className = "matrix-label";
    label.textContent = `A${index + 1}`;
    row.append(label);

    if (editingIndex === index) {
      renderEditor(row, index, time);
    } else {
      const timeLabel = document.createElement("span");
      timeLabel.className = "matrix-time";
      timeLabel.dataset.time = "";
      timeLabel.textContent = time === null
        ? isHolding && nextEmptyIndex() === index
          ? formatHoldingTime(elapsedTime)
          : "--.--"
        : formatHoldingTime(time);
      row.append(timeLabel);

      const actions = document.createElement("div");
      actions.className = "matrix-actions";
      const editButton = document.createElement("button");
      editButton.className = "inline-edit-btn";
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.title = "Edit holding time";
      editButton.setAttribute("aria-label", `Edit A${index + 1} holding time`);
      editButton.addEventListener("click", () => startEditing(index));
      actions.append(editButton);
      row.append(actions);
    }

    elements.matrix.append(row);
  });
}

function renderEditor(row, index, currentTime) {
  const editor = document.createElement("div");
  editor.className = "matrix-edit-container";

  const secondsInput = document.createElement("input");
  secondsInput.className = "inline-text-field";
  secondsInput.type = "text";
  secondsInput.inputMode = "numeric";
  secondsInput.pattern = "[0-9]*";
  secondsInput.maxLength = 2;
  secondsInput.placeholder = "00";
  secondsInput.setAttribute("aria-label", `A${index + 1} seconds`);

  const hundredthsInput = document.createElement("input");
  hundredthsInput.className = "inline-text-field";
  hundredthsInput.type = "text";
  hundredthsInput.inputMode = "numeric";
  hundredthsInput.pattern = "[0-9]*";
  hundredthsInput.maxLength = 2;
  hundredthsInput.placeholder = "00";
  hundredthsInput.setAttribute("aria-label", `A${index + 1} hundredths`);

  if (currentTime !== null) {
    secondsInput.value = String(Math.floor(currentTime / 1000)).padStart(2, "0");
    hundredthsInput.value = String(Math.floor((currentTime % 1000) / 10)).padStart(2, "0");
  }

  const dot = document.createElement("span");
  dot.className = "time-dot-field";
  dot.textContent = ".";
  editor.append(secondsInput, dot, hundredthsInput);
  row.append(editor);

  const actions = document.createElement("div");
  actions.className = "matrix-actions";
  const saveButton = document.createElement("button");
  saveButton.className = "inline-save-btn";
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => saveManualSlot(index, secondsInput.value, hundredthsInput.value));

  const cancelButton = document.createElement("button");
  cancelButton.className = "inline-cancel-btn";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => {
    editingIndex = null;
    renderMatrix();
  });
  actions.append(saveButton, cancelButton);
  row.append(actions);

  for (const input of [secondsInput, hundredthsInput]) {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 2);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") saveManualSlot(index, secondsInput.value, hundredthsInput.value);
    });
  }
  secondsInput.addEventListener("input", () => {
    if (secondsInput.value.length === 2) hundredthsInput.focus();
  });
  secondsInput.focus();
  if (currentTime !== null) secondsInput.select();
}

function startEditing(index) {
  editingIndex = index;
  renderMatrix();
}

function saveManualSlot(index, secondsText, hundredthsText) {
  const seconds = Number.parseInt(secondsText, 10) || 0;
  let hundredths = Number.parseInt(hundredthsText, 10) || 0;
  if (hundredthsText.length === 1) hundredths *= 10;

  asanaSlots[index] = seconds * 1000 + hundredths * 10;
  editingIndex = null;

  if (sessionStartedAt === null) {
    sessionStartedAt = Date.now();
    sessionElapsedTime = 0;
    isSessionActive = true;
    startSessionInterval();
  }

  renderMatrix();
  updateTotalDisplay();
  updateInterface();
}

function startSessionInterval() {
  clearInterval(sessionInterval);
  sessionInterval = window.setInterval(() => {
    if (sessionStartedAt === null || !isSessionActive) return;
    sessionElapsedTime = Date.now() - sessionStartedAt;
    updateTotalDisplay();
  }, 10);
}

function startHoldingInterval() {
  clearInterval(holdingInterval);
  holdingInterval = window.setInterval(() => {
    elapsedTime = Date.now() - holdingStartedAt;
    updateTimerDisplay();

    const activeIndex = nextEmptyIndex();
    const activeRow = elements.matrix.querySelector(`[data-index="${activeIndex}"] [data-time]`);
    if (activeRow) activeRow.textContent = formatHoldingTime(elapsedTime);

    if (elapsedTime >= 4500 && !lastQualifiedSlotBeep) {
      lastQualifiedSlotBeep = true;
      playBeep(1200, 0.15, "triangle");
    }
  }, 10);
}

function stopHoldingAndSave() {
  elapsedTime = Date.now() - holdingStartedAt;
  isHolding = false;
  clearInterval(holdingInterval);
  holdingInterval = null;
  lastQualifiedSlotBeep = false;

  const targetIndex = nextEmptyIndex();
  if (targetIndex !== -1) asanaSlots[targetIndex] = elapsedTime;

  updateTimerDisplay();
  renderMatrix();
  updateInterface();
  playBeep(600, 0.12);
}

function stopTotalTime() {
  if (sessionStartedAt !== null && isSessionActive) {
    sessionElapsedTime = Date.now() - sessionStartedAt;
  }
  clearInterval(sessionInterval);
  sessionInterval = null;
  clearInterval(holdingInterval);
  holdingInterval = null;
  isSessionActive = false;
  isSessionEnded = true;
  isHolding = false;
  updateTotalDisplay();
  renderMatrix();
  updateInterface();
  playBeep(520, 0.2);
}

function showResetModal() {
  elements.resetModal.classList.add("active");
  elements.resetModal.setAttribute("aria-hidden", "false");
  document.getElementById("confirmReset").focus();
}

function hideModal(modal) {
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

function resetAll() {
  asanaSlots.fill(null);
  clearInterval(sessionInterval);
  clearInterval(holdingInterval);
  sessionInterval = null;
  holdingInterval = null;
  holdingStartedAt = 0;
  elapsedTime = 0;
  isHolding = false;
  sessionStartedAt = null;
  sessionElapsedTime = 0;
  isSessionActive = false;
  isSessionEnded = false;
  editingIndex = null;
  lastQualifiedSlotBeep = false;

  updateTimerDisplay();
  updateTotalDisplay();
  renderMatrix();
  updateInterface();
  hideModal(elements.resetModal);
  playBeep(440, 0.1);
}

function handleMainButton() {
  if (isSessionEnded) {
    showResetModal();
    return;
  }

  if (sessionStartedAt === null) {
    sessionStartedAt = Date.now();
    sessionElapsedTime = 0;
    isSessionActive = true;
    startSessionInterval();
    elapsedTime = 0;
    updateTimerDisplay();
    updateTotalDisplay();
    updateInterface();
    playBeep(700, 0.1);
    return;
  }

  if (isHolding) {
    stopHoldingAndSave();
    return;
  }

  const next = nextEmptyIndex();
  if (next === -1) {
    stopTotalTime();
    return;
  }

  holdingStartedAt = Date.now();
  elapsedTime = 0;
  isHolding = true;
  lastQualifiedSlotBeep = false;
  updateTimerDisplay();
  renderMatrix();
  updateInterface();
  startHoldingInterval();
  playBeep(880, 0.1);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  elements.soundToggle.classList.toggle("is-muted", !soundEnabled);
  elements.soundToggle.setAttribute("aria-label", soundEnabled ? "Mute audio feedback" : "Enable audio feedback");
  elements.soundToggle.title = soundEnabled ? "Mute audio feedback" : "Enable audio feedback";
  elements.soundIcon.textContent = soundEnabled ? "♪" : "♪";
  elements.soundLabel.textContent = soundEnabled ? "Sound on" : "Sound off";
}

async function openCodeViewer() {
  elements.codeMessage.textContent = "";
  elements.codeModal.classList.add("active");
  elements.codeModal.setAttribute("aria-hidden", "false");

  try {
    const response = await fetch(new URL("./script.js", window.location.href));
    if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
    scriptSourceText = await response.text();
    elements.scriptSource.textContent = scriptSourceText;
  } catch (error) {
    elements.scriptSource.textContent = "Unable to load script.js. Open the app through a local web server to view its source here.";
    elements.codeMessage.textContent = error instanceof Error ? error.message : "Source loading failed.";
  }
}

async function copyCode() {
  if (!scriptSourceText) {
    elements.codeMessage.textContent = "The source is not available to copy.";
    return;
  }

  try {
    await navigator.clipboard.writeText(scriptSourceText);
    elements.codeMessage.textContent = "script.js copied to clipboard.";
  } catch (error) {
    elements.codeMessage.textContent = "Clipboard access was denied. Select and copy the code manually.";
    console.error("Could not copy script.js.", error);
  }
}

document.getElementById("mainBTN").addEventListener("click", handleMainButton);
document.getElementById("endSession").addEventListener("click", stopTotalTime);
document.getElementById("confirmReset").addEventListener("click", resetAll);
document.getElementById("cancelReset").addEventListener("click", () => hideModal(elements.resetModal));
document.getElementById("openCode").addEventListener("click", openCodeViewer);
document.getElementById("closeCode").addEventListener("click", () => hideModal(elements.codeModal));
document.getElementById("copyCode").addEventListener("click", copyCode);
document.getElementById("soundToggle").addEventListener("click", toggleSound);

for (const modal of [elements.resetModal, elements.codeModal]) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) hideModal(modal);
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideModal(elements.resetModal);
    hideModal(elements.codeModal);
    return;
  }

  if (event.code !== "Space" || event.repeat) return;
  if (elements.resetModal.classList.contains("active") || elements.codeModal.classList.contains("active")) return;
  if (editingIndex !== null) return;
  if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "BUTTON"].includes(event.target.tagName)) return;

  event.preventDefault();
  handleMainButton();
});

renderMatrix();
updateTimerDisplay();
updateTotalDisplay();
updateInterface();
