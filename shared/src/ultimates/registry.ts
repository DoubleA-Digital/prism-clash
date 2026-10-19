// Importing an ultimate file registers it (defineUlt). To add one: create its file,
// then add one import line here. Echo Storm's delayed second casts (the "flash" effect with
// v = -1 cast / -2 recast) are handled in echo-storm.ts.

import "./meteor-rain";
import "./overdrive";
import "./rift-collapse";
import "./echo-storm";
import "./final-stand";
import "./hunters-eye";

export { allUlts, ultDef } from "../sim/hooks";
