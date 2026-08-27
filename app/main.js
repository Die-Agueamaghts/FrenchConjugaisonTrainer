const verbs = window.verbs || [];

const verbSelect = document.getElementById("verb-select");
const errorMsg = document.getElementById("error-msg");
const grid = document.getElementById("conjugation-grid");
const tenseButtons = document.getElementById("tense-buttons");
let activeModeFilter = "alle";
let currentVerbData = null;
let selectedModeFilters = ["alle"];
let selectedTenseFilters = ["alle"];

function restoreModeCheckboxes() {
  const modeInputs = Array.from(
    document.querySelectorAll('.quickstart input[type="checkbox"]'),
  );
  const useAll = selectedModeFilters.includes("alle");
  modeInputs.forEach((input) => {
    input.checked = useAll
      ? input.dataset.mode === "alle"
      : selectedModeFilters.includes(input.dataset.mode);
  });
}

function restoreTenseCheckboxes() {
  const tenseInputs = Array.from(
    document.querySelectorAll('#tense-buttons input[type="checkbox"]'),
  );
  if (tenseInputs.length === 0) {
    return;
  }
  const useAll = selectedTenseFilters.includes("alle");
  tenseInputs.forEach((input) => {
    if (input.dataset.tense === "alle") {
      input.checked = useAll;
    } else {
      input.checked = useAll
        ? false
        : selectedTenseFilters.includes(input.dataset.tense);
    }
  });
}

function createOption(verb) {
  const option = document.createElement("option");
  option.value = verb.id;
  option.textContent = verb.label;
  return option;
}

function loadVerbData(verbId) {
  const url = `./js/${verbId}.js`;
  errorMsg.style.display = "none";
  grid.innerHTML = "";
  document.getElementById("verb-infinitiv").textContent = "Lade...";
  document.getElementById("verb-auxiliaire").textContent = "...";
  document.getElementById("verb-groupe").textContent = "...";

  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Ladefehler: ${response.status} für ${url}`);
      }
      return response.text();
    })
    .then((text) => {
      const jsonText = text
        .replace(/^\s*(?:const\s+verbDaten|window\.verbDaten)\s*=\s*/i, "")
        .replace(/;\s*$/, "");
      try {
        return JSON.parse(jsonText);
      } catch (err) {
        throw new Error("Fehler beim Parsen der JS-Datei");
      }
    })
    .catch((fetchErr) => {
      return loadVerbDataByScript(url).catch((scriptErr) => {
        throw new Error(`${fetchErr.message}; ${scriptErr.message}`);
      });
    });
}

function loadVerbDataByScript(url) {
  return new Promise((resolve, reject) => {
    const existingData = window.verbDaten;
    if (existingData !== undefined) {
      delete window.verbDaten;
    }

    const script = document.createElement("script");
    script.src = url;
    script.onload = () => {
      const data = window.verbDaten;
      script.remove();
      if (existingData !== undefined) {
        window.verbDaten = existingData;
      } else {
        delete window.verbDaten;
      }
      if (data) {
        resolve(data);
      } else {
        reject(new Error(`Keine Daten in ${url}.`));
      }
    };
    script.onerror = () => {
      script.remove();
      if (existingData !== undefined) {
        window.verbDaten = existingData;
      }
      reject(new Error(`Fehler beim Laden der Skriptdatei ${url}.`));
    };
    document.head.appendChild(script);
  });
}

function renderConjugation(data) {
  currentVerbData = data;
  document.getElementById("verb-title").textContent = data.verbe;
  document.getElementById("verb-infinitiv").textContent = data.infinitif || "–";
  document.getElementById("verb-auxiliaire").textContent =
    data.auxiliaire || "–";
  document.getElementById("verb-groupe").textContent = data.groupe || "–";

  grid.innerHTML = "";

  for (const [mode, tenses] of Object.entries(data.modes || {})) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.mode = mode;

    const title = document.createElement("h3");
    title.textContent = mode;
    card.appendChild(title);

    for (const [tense, forms] of Object.entries(tenses)) {
      const table = document.createElement("table");
      table.className = "tense-table";

      const tbody = document.createElement("tbody");
      tbody.dataset.tense = tense;

      const headerRow = document.createElement("tr");
      const tenseClass = normalizeCssClass(tense);
      headerRow.className = `tense-heading tense-${tenseClass}`;
      headerRow.innerHTML = `
                <td colspan="2">
                    <span>${tense}</span>
                    <span class="tts-controls">
                        <button type="button" class="tts-button play-button" aria-label="${tense} vorlesen">▶</button>
                        <button type="button" class="tts-button pause-button" aria-label="Vorlesen pausieren">⏸</button>
                        <button type="button" class="tts-button stop-button" aria-label="Vorlesen stoppen">⏹</button>
                    </span>
                </td>
            `;
      const playButton = headerRow.querySelector(".play-button");
      const pauseButton = headerRow.querySelector(".pause-button");
      const stopButton = headerRow.querySelector(".stop-button");
      if (playButton) {
        playButton.addEventListener("click", () => {
          playSpeech(mode, tense, forms);
        });
      }
      if (pauseButton) {
        pauseButton.addEventListener("click", () => {
          pauseSpeech();
        });
      }
      if (stopButton) {
        stopButton.addEventListener("click", () => {
          stopSpeech();
        });
      }
      tbody.appendChild(headerRow);

      forms.forEach((form) => {
        const row = document.createElement("tr");
        const splitIndex = findPronounSplit(form);
        const pronoun = form.substring(0, splitIndex).trim();
        const verbForm = form.substring(splitIndex).trim();
        row.innerHTML = `
                    <td class="pronoun">${pronoun}</td>
                    <td class="verb-form">${verbForm}</td>
                `;
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      card.appendChild(table);
    }
    grid.appendChild(card);
  }
}

function normalizeCssClass(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findPronounSplit(form) {
  const apostropheIndex = form.indexOf("'");
  if (apostropheIndex > 0) {
    return apostropheIndex + 1;
  }
  const firstSpace = form.indexOf(" ");
  return firstSpace < 0 ? form.length : firstSpace;
}

let currentUtterance = null;

function playSpeech(mode, tense, forms) {
  if (!window.speechSynthesis) {
    alert("Text-to-Speech wird von diesem Browser nicht unterstützt.");
    return;
  }
  if (window.speechSynthesis.paused && window.speechSynthesis.speaking) {
    window.speechSynthesis.resume();
    return;
  }
  const text = `${mode}, ${tense}. ${forms.join(". ")}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.onend = () => {
    currentUtterance = null;
  };
  currentUtterance = utterance;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function pauseSpeech() {
  if (!window.speechSynthesis) {
    return;
  }
  if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause();
  }
}

function stopSpeech() {
  if (!window.speechSynthesis) {
    return;
  }
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

function buildTenseButtons(modes) {
  tenseButtons.innerHTML = "";
  if (
    !currentVerbData ||
    !Array.isArray(modes) ||
    modes.includes("alle") ||
    modes.length === 0
  ) {
    return;
  }

  const tenses = new Set();
  modes.forEach((mode) => {
    const modeData = (currentVerbData.modes || {})[mode];
    if (modeData) {
      Object.keys(modeData).forEach((tense) => tenses.add(tense));
    }
  });

  if (tenses.size === 0) {
    return;
  }

  const availableTenses = Array.from(tenses);
  const hasSavedTenses =
    selectedTenseFilters.length > 0 && !selectedTenseFilters.includes("alle");
  const validTenseSelections = hasSavedTenses
    ? selectedTenseFilters.filter((tense) => availableTenses.includes(tense))
    : [];

  if (hasSavedTenses && validTenseSelections.length === 0) {
    selectedTenseFilters = ["alle"];
  }

  const allButton = document.createElement("label");
  allButton.dataset.tense = "alle";
  allButton.innerHTML = `<input type="checkbox" data-tense="alle"><span>Alle</span>`;
  const allInput = allButton.querySelector("input");
  allInput.checked =
    selectedTenseFilters.includes("alle") || validTenseSelections.length === 0;
  allInput.addEventListener("change", (event) => {
    updateTenseSelection(event.target);
  });
  tenseButtons.appendChild(allButton);

  availableTenses.forEach((tense) => {
    const label = document.createElement("label");
    label.dataset.tense = tense;
    label.className = "tense-label";
    label.innerHTML = `<input type="checkbox" data-tense="${tense}"><span>${tense}</span>`;
    const input = label.querySelector("input");
    input.checked = selectedTenseFilters.includes("alle")
      ? false
      : selectedTenseFilters.includes(tense);
    input.addEventListener("change", (event) => {
      updateTenseSelection(event.target);
    });
    tenseButtons.appendChild(label);
  });

  restoreTenseCheckboxes();

  if (
    selectedTenseFilters.includes("alle") ||
    validTenseSelections.length === 0
  ) {
    updateTenseSelection();
  }
}

function applyModeFilter() {
  const selectedModes = selectedModeFilters;
  const cards = grid.querySelectorAll(".card");
  cards.forEach((card) => {
    card.style.display =
      selectedModes.length === 0 ||
      selectedModes.includes("alle") ||
      selectedModes.includes(card.dataset.mode)
        ? ""
        : "none";
  });
  applyTenseFilter();
}

function applyTenseFilter() {
  const selectedTenses = Array.from(
    document.querySelectorAll('#tense-buttons input[type="checkbox"]'),
  )
    .filter((input) => input.checked)
    .map((input) => input.dataset.tense);

  const cards = grid.querySelectorAll(".card");
  if (selectedTenses.length === 0 || selectedTenses.includes("alle")) {
    cards.forEach((card) => {
      const rows = card.querySelectorAll("tbody[data-tense]");
      rows.forEach((tbody) => {
        tbody.style.display = "";
      });
    });
    return;
  }

  cards.forEach((card) => {
    const rows = card.querySelectorAll("tbody[data-tense]");
    rows.forEach((tbody) => {
      tbody.style.display = selectedTenses.includes(tbody.dataset.tense)
        ? ""
        : "none";
    });
  });
}

function selectAllTense() {
  const tenseInputs = Array.from(
    document.querySelectorAll('#tense-buttons input[type="checkbox"]'),
  );
  const allInput = tenseInputs.find((input) => input.dataset.tense === "alle");

  tenseInputs.forEach((input) => {
    if (input.dataset.tense !== "alle") {
      input.checked = false;
    }
  });

  if (allInput) {
    allInput.checked = true;
  }

  selectedTenseFilters = ["alle"];
  applyTenseFilter();
}

function selectTense(input) {
  const tenseInputs = Array.from(
    document.querySelectorAll('#tense-buttons input[type="checkbox"]'),
  );
  const allInput = tenseInputs.find((item) => item.dataset.tense === "alle");
  const selectedTenses = tenseInputs.filter(
    (item) => item.checked && item.dataset.tense !== "alle",
  );

  if (input && input.dataset.tense !== "alle" && input.checked && allInput) {
    allInput.checked = false;
  }

  if (selectedTenses.length === 0) {
    if (allInput) {
      allInput.checked = true;
    }
    selectedTenseFilters = ["alle"];
  } else {
    selectedTenseFilters = selectedTenses.map((item) => item.dataset.tense);
  }

  applyTenseFilter();
}

function updateTenseSelection(changedInput) {
  const tenseInputs = Array.from(
    document.querySelectorAll('#tense-buttons input[type="checkbox"]'),
  );
  const allInput = tenseInputs.find((input) => input.dataset.tense === "alle");
  const selectedTenses = tenseInputs.filter(
    (input) => input.checked && input.dataset.tense !== "alle",
  );

  if (changedInput && changedInput.dataset.tense === "alle") {
    if (changedInput.checked) {
      selectAllTense();
      return;
    }

    if (selectedTenses.length === 0) {
      selectAllTense();
      return;
    }
  }

  if (selectedTenses.length > 0) {
    selectTense(changedInput);
    return;
  }

  selectAllTense();
}

function selectAllMode() {
  const modeInputs = Array.from(
    document.querySelectorAll('.quickstart input[type="checkbox"]'),
  );
  const allInput = modeInputs.find((input) => input.dataset.mode === "alle");

  modeInputs.forEach((input) => {
    if (input.dataset.mode !== "alle") {
      input.checked = false;
    }
  });

  if (allInput) {
    allInput.checked = true;
  }

  selectedModeFilters = ["alle"];
  activeModeFilter = "alle";
  buildTenseButtons(["alle"]);
  applyModeFilter();
}

function selectMode(input) {
  const modeInputs = Array.from(
    document.querySelectorAll('.quickstart input[type="checkbox"]'),
  );
  const allInput = modeInputs.find((item) => item.dataset.mode === "alle");
  const selectedModes = modeInputs.filter(
    (item) => item.checked && item.dataset.mode !== "alle",
  );

  if (input && input.dataset.mode !== "alle" && input.checked && allInput) {
    allInput.checked = false;
  }

  if (selectedModes.length === 0) {
    if (allInput) {
      allInput.checked = true;
    }
    selectedModeFilters = ["alle"];
    activeModeFilter = "alle";
  } else {
    selectedModeFilters = selectedModes.map((item) => item.dataset.mode);
    activeModeFilter = "multiple";
  }

  const modes = activeModeFilter === "alle" ? ["alle"] : selectedModeFilters;
  buildTenseButtons(modes);
  applyModeFilter();
}

function updateModeSelection(changedInput) {
  const modeInputs = Array.from(
    document.querySelectorAll('.quickstart input[type="checkbox"]'),
  );
  const allInput = modeInputs.find((input) => input.dataset.mode === "alle");
  const selectedModes = modeInputs.filter(
    (input) => input.checked && input.dataset.mode !== "alle",
  );

  if (changedInput && changedInput.dataset.mode === "alle") {
    if (changedInput.checked) {
      selectAllMode();
      return;
    }

    if (selectedModes.length === 0) {
      selectAllMode();
      return;
    }
  }

  if (selectedModes.length > 0) {
    selectMode(changedInput);
    return;
  }

  selectAllMode();
}

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.style.display = "block";
  document.getElementById("verb-title").textContent = "Fehler";
  document.getElementById("verb-infinitiv").textContent = "–";
  document.getElementById("verb-auxiliaire").textContent = "–";
  document.getElementById("verb-groupe").textContent = "–";
  document.getElementById("loading-indicator").style.display = "none";
  setLoading(false);
}

function setLoading(isLoading) {
  document.getElementById("loading-indicator").style.display = isLoading
    ? "block"
    : "none";
  verbSelect.disabled = isLoading;
  document
    .querySelectorAll('.quickstart input[type="checkbox"]')
    .forEach((input) => {
      input.disabled = isLoading;
    });
  document
    .querySelectorAll('#tense-buttons input[type="checkbox"]')
    .forEach((input) => {
      input.disabled = isLoading;
    });
}

function setVerb(verbId) {
  if (!verbId) {
    showError("Kein Verb verfügbar.");
    return;
  }
  verbSelect.value = verbId;
  setLoading(true);
  loadVerbData(verbId)
    .then((data) => {
      setLoading(false);
      renderConjugation(data);
      restoreModeCheckboxes();
      updateModeSelection();
    })
    .catch((err) => showError(err.message));
}

function initialize() {
  verbs.forEach((verb) => verbSelect.appendChild(createOption(verb)));
  const defaultVerb = verbs.some((verb) => verb.id === "etre")
    ? "etre"
    : verbs[0]?.id || "";
  verbSelect.value = defaultVerb;
  verbSelect.addEventListener("change", () => {
    setVerb(verbSelect.value);
  });

  document
    .querySelectorAll('.quickstart input[type="checkbox"]')
    .forEach((input) => {
      input.addEventListener("change", (event) => {
        updateModeSelection(event.target);
      });
    });

  setVerb(verbSelect.value);
}

document.addEventListener("DOMContentLoaded", initialize);
