import type { AppStore } from "../../state/store";
import type { ModDestination } from "../../audio/types";
import { h, clear } from "../dom";

const MOD_DESTINATIONS: { value: ModDestination; label: string }[] = [
  { value: "brightness", label: "Brightness" },
  { value: "filter", label: "Filter Sweep" },
  { value: "reverb", label: "Reverb" },
  { value: "tremolo", label: "Tremolo" },
  { value: "motorDepth", label: "Motor Depth" },
  { value: "hardness", label: "Mallet Hardness" },
];

export function buildMidiPanel(store: AppStore): HTMLElement {
  const deviceSelect = h("select", { class: "select-control" }) as HTMLSelectElement;
  const channelSelect = h("select", { class: "select-control" }) as HTMLSelectElement;
  channelSelect.appendChild(h("option", { value: "omni" }, "Omni (all channels)"));
  for (let i = 1; i <= 16; i++) channelSelect.appendChild(h("option", { value: String(i) }, `Channel ${i}`));

  const destSelect = h("select", { class: "select-control" }) as HTMLSelectElement;
  for (const d of MOD_DESTINATIONS) destSelect.appendChild(h("option", { value: d.value }, d.label));

  const clockSelect = h("select", { class: "select-control" }) as HTMLSelectElement;
  clockSelect.appendChild(h("option", { value: "internal" }, "Internal"));
  clockSelect.appendChild(h("option", { value: "midi" }, "MIDI Clock"));

  const supportNote = h("p", { class: "hint" }, "");
  const mappingsList = h("div", { class: "row", style: "flex-direction:column;align-items:flex-start;gap:4px;" });
  const learnNote = h("p", { class: "hint status-msg", style: "display:none;" });

  function renderDevices(): void {
    const ui = store.getMidiUiState();
    deviceSelect.replaceChildren(h("option", { value: "any" }, "Any connected device"));
    for (const d of ui.devices) deviceSelect.appendChild(h("option", { value: d.id }, d.name));
    deviceSelect.value = ui.selectedInputId;
    channelSelect.value = ui.channelFilter === "omni" ? "omni" : String(ui.channelFilter);
    destSelect.value = ui.modDestination;
    clockSelect.value = store.getTransport().clockSource;
    const desktopNote = window.glockworkDesktop?.isElectron ? " Running in the desktop app for the most reliable MIDI support." : "";
    supportNote.textContent = ui.supported
      ? ui.devices.length
        ? `${ui.devices.length} MIDI input${ui.devices.length === 1 ? "" : "s"} detected.${desktopNote}`
        : `Web MIDI is available, but no input devices are connected yet.${desktopNote}`
      : "Web MIDI isn't available in this browser. Try Chrome, Edge, or the desktop app for full MIDI support.";

    clear(mappingsList);
    const entries = Object.entries(ui.ccMappings);
    if (entries.length === 0) {
      mappingsList.appendChild(h("span", { class: "hint" }, "No MIDI Learn mappings yet."));
    } else {
      for (const [cc, mapping] of entries) {
        mappingsList.appendChild(
          h(
            "div",
            { class: "row", style: "gap:6px;" },
            h("span", { class: "hint" }, `CC${cc} → ${mapping.label}`),
            h("button", { class: "small-btn", type: "button", onClick: () => store.clearMidiMapping(Number(cc)) }, "clear"),
          ),
        );
      }
    }
    if (ui.learnActive && ui.learnArmed) {
      learnNote.style.display = "block";
      learnNote.className = "hint status-msg ok";
      learnNote.textContent = `MIDI Learn armed for "${ui.learnArmed.label}" — move a control knob on your MIDI device now.`;
    } else {
      learnNote.style.display = "none";
    }
  }

  deviceSelect.addEventListener("change", () => store.setMidiInput(deviceSelect.value as "any" | string));
  channelSelect.addEventListener("change", () => store.setMidiChannel(channelSelect.value === "omni" ? "omni" : Number(channelSelect.value)));
  destSelect.addEventListener("change", () => store.setModDestination(destSelect.value as ModDestination));
  clockSelect.addEventListener("change", () => {
    store.setClockSource(clockSelect.value as "internal" | "midi");
    renderDevices();
  });

  store.events.on("midi-changed", renderDevices);

  const led = h("span", { class: "midi-led" });
  store.midi.events.on("activity", () => {
    led.classList.add("active");
    window.setTimeout(() => led.classList.remove("active"), 100);
  });
  store.events.on("midi-changed", () => led.classList.toggle("supported", store.getMidiUiState().supported));

  renderDevices();

  return h(
    "div",
    { class: "panel" },
    h("div", { class: "panel-title" }, h("span", { class: "dot" }), "MIDI Settings", led),
    supportNote,
    h("div", { class: "control-grid", style: "grid-template-columns:1fr;gap:8px;" },
      h("div", { class: "field-control" }, h("div", { class: "field-label" }, "Input Device"), deviceSelect),
      h("div", { class: "field-control" }, h("div", { class: "field-label" }, "Channel"), channelSelect),
      h("div", { class: "field-control" }, h("div", { class: "field-label" }, "Mod Wheel Destination"), destSelect),
      h("div", { class: "field-control" }, h("div", { class: "field-label" }, "Clock Source"), clockSelect),
    ),
    h("div", { class: "section-divider" }, "MIDI Learn"),
    h("p", { class: "hint" }, "Right-click (or long-press) any knob to arm MIDI Learn for it."),
    learnNote,
    mappingsList,
    h(
      "button",
      { class: "icon-button", type: "button", style: "margin-top:8px;", onClick: () => store.cancelMidiLearn() },
      "Cancel Learn",
    ),
  );
}
