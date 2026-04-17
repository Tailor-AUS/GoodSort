// ══════════════════════════════════════════════════════════════
// The Good Sort — 1:3 Scale Bin Shell (NO insert)
// ══════════════════════════════════════════════════════════════
// Print this once. Then print different inserts to drop in.
// Snapmaker U1: 270×270×270mm bed. This is 192×218×198mm.

scale = 1/3;

// SULO 240L real dimensions
real_w = 560;  real_d = 640;  real_h = 580;  real_taper = 30;

w  = real_w * scale;     // 187
d  = real_d * scale;     // 213
h  = real_h * scale;     // 193
tp = real_taper * scale; // 10

wall = 2.5;  // bin wall thickness
base = 1.5;  // thin base so you can test tipping

// ── Lip / rim at top (helps inserts sit flush) ──
rim_h = 4;
rim_inset = 2;  // small ledge inserts can rest on

module bin_shell() {
    // Main tapered body
    difference() {
        hull() {
            translate([0, 0, h]) cube([w + wall*2, d + wall*2, 0.01], center=true);
            cube([w + wall*2 - tp*2, d + wall*2 - tp*2, 0.01], center=true);
        }
        hull() {
            translate([0, 0, h + 0.1]) cube([w, d, 0.01], center=true);
            translate([0, 0, base]) cube([w - tp*2, d - tp*2, 0.01], center=true);
        }
    }

    // Rim / ledge at top — inserts rest on this
    difference() {
        translate([0, 0, h])
            cube([w + wall*2, d + wall*2, rim_h], center=true);
        translate([0, 0, h])
            cube([w - rim_inset*2, d - rim_inset*2, rim_h + 0.1], center=true);
    }
}

bin_shell();
