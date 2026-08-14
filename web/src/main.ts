import { applySettings, handleLine, setRole } from "./hud";

declare global {
  interface Window {
    Module: Record<string, unknown>;
    callMain?: (args: string[]) => void;
  }
}

interface JoinResponse {
  role: "marine" | "demon";
  engineArgs: string[];
  settings: unknown;
  gameStarted: boolean;
}

async function boot() {
  const roleEl = document.getElementById("hud-role")!;

  let join: JoinResponse;
  try {
    const res = await fetch("/api/join", { method: "POST" });
    if (!res.ok) throw new Error(`join failed: ${res.status}`);
    join = (await res.json()) as JoinResponse;
  } catch (err) {
    roleEl.textContent = "Cannot reach gateway";
    console.error(err);
    return;
  }

  setRole(join.role);
  applySettings((join.settings ?? {}) as Parameters<typeof applySettings>[0]);

  if (join.role !== "marine" && !join.gameStarted) {
    const catchup = document.getElementById("hud-catchup")!;
    catchup.textContent = "Waiting for marine…";
    catchup.classList.remove("hidden");
    for (;;) {
      await new Promise((r) => setTimeout(r, 400));
      const st = await fetch("/api/session").then((r) => r.json() as Promise<{ gameStarted: boolean }>);
      if (st.gameStarted) break;
    }
    catchup.classList.add("hidden");
  }

  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const args = [...join.engineArgs, "-wss", `${wsProto}://${location.host}/ws`];

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const FRAME_W = 800;
  const FRAME_H = 600;
  const pinCanvasSize = () => {
    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = FRAME_W;
      canvas.height = FRAME_H;
    }
  };
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  new MutationObserver(pinCanvasSize).observe(canvas, {
    attributes: true,
    attributeFilter: ["width", "height"],
  });

  window.Module = {
    noInitialRun: true,
    noExitRuntime: true,
    canvas,
    onRuntimeInitialized: () => {
      const callMain =
        window.callMain ?? (window.Module as { callMain?: (a: string[]) => void }).callMain;
      if (!callMain) {
        console.error("callMain missing after runtime init");
        return;
      }
      callMain(args);
    },
    preRun: () => {
      const FS = (window.Module as { FS?: any }).FS;
      FS.createPreloadedFile("", "doom1.wad", "doom1.wad", true, true);
      FS.createPreloadedFile("", "default.cfg", "default.cfg", true, true);
    },
    print: (text: string) => {
      console.log(text);
      (window as unknown as { __asymPrints: string[] }).__asymPrints ??= [];
      (window as unknown as { __asymPrints: string[] }).__asymPrints.push(text);
      text.split("\n").forEach(handleLine);
    },
    printErr: (text: string) => console.error(text),
    setStatus: (text: string) => text && console.log("[status]", text),
  };

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    console.error("WebGL context lost");
  });
  canvas.addEventListener("click", () => canvas.focus());

  const script = document.createElement("script");
  script.src = "/websockets-doom.js";
  document.body.appendChild(script);
}

void boot();
