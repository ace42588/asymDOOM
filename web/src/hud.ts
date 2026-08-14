// HTML HUD driven by the engine's stdout protocol.
//
// Lines the asym engine fork emits (in addition to vanilla "doom: N, ..."):
//   asym: role marine|demon|spectator
//   asym: body <species> hp <n> maxhp <n>
//   asym: points <n> mods <h> <s> <d> <r>
//   asym: hop <species>
//   asym: spectate
//   asym: win marine|demons

const el = (id: string) => document.getElementById(id)!;

let bannerTimer: number | undefined;

function banner(text: string, sticky = false) {
  const b = el("hud-banner");
  b.textContent = text;
  b.classList.remove("hidden");
  if (bannerTimer) window.clearTimeout(bannerTimer);
  if (!sticky) {
    bannerTimer = window.setTimeout(() => b.classList.add("hidden"), 4000);
  }
}

export function setRole(role: string) {
  const r = el("hud-role");
  r.textContent = role === "marine" ? "You are the Marine" : role === "demon" ? "Demon" : "Spectating";
  r.classList.toggle("demon", role !== "marine");
  if (role === "demon") {
    el("hud-mods").classList.remove("hidden");
    el("hud-hint").classList.remove("hidden");
  }
}

export function applySettings(settings: {
  onMarineDeath?: string;
  onDemonDeath?: string;
  demonView?: string;
}) {
  const label = (v: string | undefined, fallback: string) => (v ?? fallback).replace(/_/g, " ");
  el("set-marine-death").textContent = `marine death: ${label(settings.onMarineDeath, "demons_win")}`;
  el("set-demon-death").textContent = `demon death: ${label(settings.onDemonDeath, "possess_next")}`;
  el("set-demon-view").textContent = `demon view: ${label(settings.demonView, "first_person")}`;
}

export function handleLine(line: string): void {
  if (line.startsWith("doom: 10")) {
    banner("Game started");
    return;
  }
  if (line.startsWith("Running emscripten_set_main_loop")) {
    el("hud-catchup").classList.add("hidden");
    return;
  }
  if (
    line.startsWith("asym: waiting") ||
    line.startsWith("asym: got ") ||
    line.startsWith("asym: graphics") ||
    line.startsWith("asym: gamestart") ||
    line.startsWith("asym: loading") ||
    line.startsWith("asym: frame") ||
    line.startsWith("asym: setup") ||
    line.startsWith("asym: map ") ||
    line.startsWith("asym: level ") ||
    line.startsWith("asym: renderer")
  ) {
    const catchup = el("hud-catchup");
    catchup.textContent = line.replace(/^asym:\s*/, "");
    catchup.classList.toggle(
      "hidden",
      line.startsWith("asym: got start") ||
        line.startsWith("asym: graphics") ||
        line.startsWith("asym: renderer") ||
        line.startsWith("asym: map loaded"),
    );
    return;
  }
  if (!line.startsWith("asym: ")) return;
  const parts = line.slice(6).trim().split(/\s+/);

  switch (parts[0]) {
    case "role":
      setRole(parts[1]);
      break;

    case "body": {
      el("hud-body").classList.remove("hidden");
      el("hud-body").textContent = `${parts[1]}  ${parts[3]}/${parts[5]} HP`;
      break;
    }

    case "points": {
      el("hud-points").textContent = `${parts[1]} pts`;
      const mods: Array<[string, string]> = [
        ["mod-h", "H"],
        ["mod-s", "S"],
        ["mod-d", "D"],
        ["mod-r", "R"],
      ];
      mods.forEach(([id, letter], i) => {
        const lvl = Number(parts[3 + i] ?? 0);
        const m = el(id);
        m.textContent = `${letter}${lvl}`;
        m.classList.toggle("owned", lvl > 0);
      });
      break;
    }

    case "hop":
      setRole("demon");
      banner(`Possessed ${parts[1]}`);
      break;

    case "spectate":
      setRole("spectator");
      el("hud-body").classList.add("hidden");
      banner("No demons left - spectating the marine", true);
      break;

    case "win":
      banner(parts[1] === "demons" ? "DEMONS WIN" : "THE MARINE PREVAILS", true);
      break;

    case "catchup":
      el("hud-catchup").classList.toggle("hidden", parts[1] !== "1");
      break;
  }
}
