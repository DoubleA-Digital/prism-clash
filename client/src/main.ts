// Prism Clash client entry: boots the game loop, the screen router and settings.

import "./ui/style.css";
import "@prism/shared";
import { audio } from "./audio/audio";
import { Game } from "./game";
import { installDevHooks } from "./devhooks";
import { applySettings } from "./settings";
import { Screens } from "./ui/screens";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas missing");

applySettings();
const game = new Game(canvas);
installDevHooks((x, y) => game.cam.toScreen(x, y));
new Screens(game);

// Browsers only allow audio after a user gesture.
const unlock = () => {
  audio.unlock();
  applySettings();
};
window.addEventListener("pointerdown", unlock, { once: false });
window.addEventListener("keydown", unlock, { once: false });
