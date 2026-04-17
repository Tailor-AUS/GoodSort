// ══════════════════════════════════════════════════════════════
// Assembly: SULO 360L Kompakt + Insert V1 (for visualisation)
// ══════════════════════════════════════════════════════════════

s = 1/4;
swd = 250 * s;  // wheel diameter scaled
sh  = 1028 * s; // body height scaled
sb_ = 6 * s;    // base thickness

// Include both models
use <sulo-360l-kompakt.scad>;
use <insert-360l-v1-fixed-cross.scad>;

// Position insert inside the bin body
// Insert sits at the top, resting on the rim
// Bin internal bottom starts at swd/2 + base_thick

insert_z = sh - (500 * s) + 5;  // position so top aligns with rim

color("DimGray", 0.25) sulo_360l();
color("LimeGreen", 0.85) translate([0, 0, insert_z]) insert_360l_v1();
