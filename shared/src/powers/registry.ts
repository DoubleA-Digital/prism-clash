// Importing a power file registers it (definePower). To add a power: create its file,
// then add one import line here.

import "./portal-pair";
import "./singularity";
import "./hazards";

export { allPowers, powerDef } from "../sim/hooks";
export { COMBO_NAMES, triggerCombo } from "./combos";
