import { normalizeNames, secureDerangement, createSecretLink, revealSecret, validateBaseUrl, validatePayload } from "./core.js";

const $ = (id) => document.getElementById(id);
let pendingRound = null;
let linkRows = [];
let drawing = false;
let toastTimer;
let secret = null;

function showError(id, message) {
  const target = $(id);
  target.textContent = message;
  target.hidden = !message;
}
function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500);
}
function humanDate(date) {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setFullYear(year, month - 1, day);
  value.setHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" }).format(value);
}
function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function cleanBase(value) {
  return validateBaseUrl(value).href;
}
function localAddress(url) {
  const hostname = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}
function roundDetails(round) {
  return [round.budget ? `Budget: ${round.budget}` : "", round.date ? `Übergabe: ${humanDate(round.date)}` : ""].filter(Boolean).join(" · ");
}
function messageFor(row) {
  const details = roundDetails(row);
  return `Hallo ${row.giver}!\n\nDie Namen für „${row.event}“ sind gezogen. Über deinen persönlichen Link siehst du, wen du beschenkst:\n\n${row.link}\n\n${details ? details + "\n\n" : ""}Bitte behalte deinen Wichtelnamen und diesen Link für dich. Viel Freude beim Schenken!`;
}
function openPanel(panel, focusId) {
  for (const id of ["setup", "review", "results"]) $(id).hidden = id !== panel;
  if (focusId) $(focusId).focus();
}
function validateRound() {
  const names = normalizeNames($("names").value);
  const event = $("event").value.trim();
  const budget = $("budget").value.trim();
  const date = $("date").value;
  if (!event || event.length > 100) throw new Error("Bitte gib der Runde einen Namen mit höchstens 100 Zeichen.");
  if (budget.length > 60) throw new Error("Die Budgetangabe darf höchstens 60 Zeichen haben.");
  if ($("date").validity.badInput || !validDate(date)) throw new Error("Bitte wähle ein gültiges Übergabedatum.");
  const checked = validatePayload({ v: 1, giver: names[0], recipient: names[1], event, budget, date });
  return { names, event: checked.event, budget: checked.budget, date: checked.date, baseUrl: cleanBase($("base-url").value.trim()) };
}
function appendDetail(label, value) {
  if (!value) return;
  const group = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  group.append(dt, dd);
  $("gift-details").append(group);
}
function hideRecipient() {
  $("reveal-result").hidden = true;
  $("reveal-start").hidden = false;
  $("recipient-name").textContent = "";
  $("gift-details").replaceChildren();
}
async function initRecipient() {
  $("organizer").hidden = true;
  $("recipient").hidden = false;
  $("reveal-start").hidden = true;
  try {
    secret = await revealSecret(location.hash);
    document.title = "Dein Wichtelumschlag · Unter uns";
    $("reveal-event").textContent = secret.event;
    $("reveal-greeting").textContent = `Hallo ${secret.giver}.`;
    $("reveal-start").hidden = false;
    $("reveal-button").addEventListener("click", () => {
      $("revealed-greeting").textContent = `Dein Auftrag, ${secret.giver}:`;
      $("recipient-name").textContent = secret.recipient;
      $("gift-details").replaceChildren();
      appendDetail("Geschenkbudget", secret.budget);
      appendDetail("Übergabe", humanDate(secret.date));
      $("reveal-start").hidden = true;
      $("reveal-result").hidden = false;
      $("revealed-title").focus();
    });
    $("hide-button").addEventListener("click", () => { hideRecipient(); $("reveal-button").focus(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) hideRecipient(); });
  } catch (error) {
    $("reveal-error").hidden = false;
    $("reveal-error-text").textContent = error.message || "Der Link ist unvollständig oder wurde verändert.";
  }
}
function manualCopy(container, value) {
  container.replaceChildren();
  const label = document.createElement("label");
  const text = document.createElement("textarea");
  text.id = `copy-${crypto.randomUUID()}`;
  label.htmlFor = text.id;
  label.textContent = "Automatisches Kopieren ist hier nicht erlaubt. Markierten Text bitte mit Strg+C oder auf dem Handy kopieren.";
  text.value = value;
  text.readOnly = true;
  text.rows = 5;
  container.append(label, text);
  text.focus();
  text.select();
}
async function copyValue(value, container, onSuccess) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
    container.replaceChildren();
    onSuccess();
  } catch {
    manualCopy(container, value);
  }
}
function renderResults(round) {
  const local = localAddress(round.baseUrl);
  $("results-summary").textContent = `${round.event} · ${linkRows.length} persönliche Links. ${local ? "Das sind lokale Testlinks. Sie funktionieren nicht auf den Rechnern deines Teams. Vor der echten Ziehung die Seite veröffentlichen." : "Öffne jeden Slack-DM separat und kopiere die passende Nachricht."}`;
  $("result-list").replaceChildren();
  for (const row of linkRows) {
    const li = document.createElement("li");
    li.className = "result-row";
    const header = document.createElement("div");
    header.className = "result-row-header";
    const person = document.createElement("div");
    const name = document.createElement("h3");
    name.className = "person-name";
    name.textContent = row.giver;
    const status = document.createElement("span");
    status.className = "row-status";
    status.textContent = "Noch nicht kopiert";
    person.append(name, status);
    const buttons = document.createElement("div");
    buttons.className = "row-buttons";
    const messageButton = document.createElement("button");
    messageButton.type = "button";
    messageButton.className = "button secondary";
    messageButton.textContent = "Slack-Nachricht kopieren";
    messageButton.setAttribute("aria-label", `Slack-Nachricht für ${row.giver} kopieren`);
    const linkButton = document.createElement("button");
    linkButton.type = "button";
    linkButton.className = "text-button";
    linkButton.textContent = "Nur Link";
    linkButton.setAttribute("aria-label", `Persönlichen Link für ${row.giver} kopieren`);
    const manual = document.createElement("div");
    manual.className = "manual-copy";
    messageButton.addEventListener("click", () => copyValue(messageFor(row), manual, () => {
      status.textContent = "Nachricht kopiert, Versand erfolgt in Slack";
      notify(`Nachricht für ${row.giver} kopiert.`);
    }));
    linkButton.addEventListener("click", () => copyValue(row.link, manual, () => {
      status.textContent = "Link kopiert, Versand erfolgt in Slack";
      notify(`Link für ${row.giver} kopiert.`);
    }));
    buttons.append(messageButton, linkButton);
    header.append(person, buttons);
    const preview = document.createElement("p");
    preview.className = "message-preview";
    preview.textContent = messageFor({ ...row, link: "[persönlicher, geheimer Link]" });
    li.append(header, preview, manual);
    $("result-list").append(li);
  }
}
function initOrganizer() {
  const base = new URL(location.href);
  base.hash = "";
  base.search = "";
  $("base-url").value = base.href;
  if (localAddress(base.href)) {
    $("environment-note").textContent = "Lokale Vorschau: Hier kannst du alles ausprobieren. Links mit localhost funktionieren nur auf diesem Rechner. Für die Teamrunde muss diese Webseite über HTTPS erreichbar sein.";
    $("environment-note").hidden = false;
  }
  $("event").value = `Teamwichteln ${new Date().getFullYear()}`;
  const updateCount = () => {
    const count = $("names").value.split(/\r?\n/).filter((line) => line.trim()).length;
    $("name-count").textContent = `${count} ${count === 1 ? "Name" : "Namen"}`;
  };
  $("names").addEventListener("input", updateCount);
  $("demo-button").addEventListener("click", () => {
    if ($("names").value.trim()) { notify("Das Beispiel ist nur für ein leeres Namensfeld gedacht."); return; }
    $("names").value = "Felix\nMira\nJonas\nLena\nSamira\nDavid";
    updateCount();
    $("names").focus();
  });
  $("setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    showError("form-error", "");
    try {
      pendingRound = validateRound();
      $("review-summary").textContent = `${pendingRound.event} · ${pendingRound.names.length} Personen`;
      $("review-details").textContent = roundDetails(pendingRound);
      $("review-names").replaceChildren();
      for (const name of pendingRound.names) {
        const li = document.createElement("li");
        li.textContent = name;
        $("review-names").append(li);
      }
      showError("draw-error", "");
      openPanel("review", "review-title");
    } catch (error) { showError("form-error", error.message); }
  });
  $("edit-button").addEventListener("click", () => { if (!drawing) openPanel("setup", "names"); });
  $("draw-button").addEventListener("click", async () => {
    if (drawing || !pendingRound) return;
    drawing = true;
    $("draw-button").disabled = true;
    $("edit-button").disabled = true;
    $("draw-button").textContent = "Die Namen werden gezogen …";
    showError("draw-error", "");
    try {
      const round = pendingRound;
      const recipients = secureDerangement(round.names);
      const generated = [];
      for (let i = 0; i < round.names.length; i += 1) {
        const payload = { v: 1, giver: round.names[i], recipient: recipients[i], event: round.event, budget: round.budget, date: round.date };
        const link = await createSecretLink(round.baseUrl, payload);
        generated.push({ giver: payload.giver, event: payload.event, budget: payload.budget, date: payload.date, link });
      }
      linkRows = generated;
      renderResults(round);
      openPanel("results", "results-title");
    } catch (error) { showError("draw-error", error.message || "Die Ziehung ist fehlgeschlagen. Bitte versuche es erneut."); }
    finally {
      drawing = false;
      $("draw-button").disabled = false;
      $("edit-button").disabled = false;
      $("draw-button").textContent = "Jetzt geheim auslosen";
    }
  });
  $("download-button").addEventListener("click", () => {
    if (!linkRows.length) return;
    const text = `GEHEIME WICHTELLINKS · ${pendingRound.event}\nNur für die organisierende Person. Wer einen Link besitzt, kann das zugehörige Ergebnis öffnen.\nEs wurde noch keine Nachricht automatisch versendet.\n\n${linkRows.map(messageFor).join("\n\n" + "=".repeat(50) + "\n\n")}\n`;
    const objectUrl = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `wichtellinks-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    notify("Download angestoßen. Bewahre die Datei privat auf.");
  });
  $("reset-button").addEventListener("click", () => { $("reset-confirm").hidden = false; $("reset-confirm-button").focus(); });
  $("reset-cancel-button").addEventListener("click", () => { $("reset-confirm").hidden = true; $("reset-button").focus(); });
  $("reset-confirm-button").addEventListener("click", () => {
    linkRows = [];
    pendingRound = null;
    $("result-list").replaceChildren();
    $("reset-confirm").hidden = true;
    openPanel("setup", "names");
  });
  window.addEventListener("beforeunload", (event) => { if (linkRows.length) { event.preventDefault(); event.returnValue = ""; } });
}

if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
  $("setup-form").hidden = true;
  showError("fatal-error", "Für diese Webseite brauchst du einen aktuellen Browser und HTTPS (oder localhost für eine lokale Vorschau). Bitte öffne sie nicht direkt als Datei.");
  if (location.hash) {
    $("organizer").hidden = true;
    $("recipient").hidden = false;
    $("reveal-start").hidden = true;
    $("reveal-error").hidden = false;
    $("reveal-error-text").textContent = "Bitte öffne den vollständigen Link über HTTPS in einem aktuellen Browser.";
  }
} else if (location.hash) {
  void initRecipient();
} else {
  initOrganizer();
}

// Slack may reuse an existing tab for a different fragment on the same page.
// Reload so it never displays the previous persons result for the new link.
window.addEventListener("hashchange", () => location.reload());

