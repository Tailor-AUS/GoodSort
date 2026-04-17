// ══════════════════════════════════════════════════════════════
// SULO 360L Kompakt — Accurate 1:4 Scale Model
// ══════════════════════════════════════════════════════════════
// From official SULO datasheet dimensions
// Snapmaker U1 bed: 270×270×270mm
//
// Key difference from 240L: wider, shallower, taller, 50% more volume.
// Same kerbside footprint — the Kompakt innovation.

s = 1/4;  // scale

// ── SULO 360L Kompakt Real Dimensions (mm) ──────────────────
ext_w       = 650;      // E: Width
ext_d_body  = 625;      // C: Bin depth (body only)
ext_d_total = 848;      // D: Total depth (with lid overhang)
ext_h_body  = 1028;     // B: Bin height (body)
ext_h_total = 1100;     // A: Total height
handle_w    = 520;      // F: Handle width
wheel_span  = 680;      // G: Wheel/axle span width
wheel_dia   = 250;      // Larger wheels than 240L

wall        = 4;        // HDPE wall thickness (real mm)
base_thick  = 6;        // Base thickness

// Taper estimate (360L is less tapered than 240L due to Kompakt design)
taper_w     = 20;       // per side width
taper_d     = 15;       // per side depth

// Lid
lid_thick   = 25;
lid_overhang = ext_d_total - ext_d_body; // 223mm rear overhang (bigger lid)

$fn = 32;

// ── Scaled ──────────────────────────────────────────────────
sw   = ext_w * s;         // 162.5
sd   = ext_d_body * s;    // 156.25
sh   = ext_h_body * s;    // 257
st_w = taper_w * s;
st_d = taper_d * s;
swd  = wheel_dia * s;     // 62.5
sws  = wheel_span * s;    // 170
shw  = handle_w * s;      // 130
slt  = lid_thick * s;
slo  = lid_overhang * s;  // 55.75
sw_  = wall * s;
sb_  = base_thick * s;

echo(str("=== SULO 360L Kompakt 1:4 ==="));
echo(str("Body: ", sw, "w × ", sd, "d × ", sh, "h mm"));
echo(str("Total with lid+wheels: ", sw, "w × ", sd+slo, "d × ", sh+slt+swd/2, "h mm"));

// ── Body ────────────────────────────────────────────────────
module body() {
    color("DimGray") {
        difference() {
            // Outer — tapered box with rounded corners
            hull() {
                translate([0, 0, sh]) rounded_rect(sw, sd, 0.01, 8*s);
                translate([0, 0, swd/2]) rounded_rect(sw - st_w*2, sd - st_d*2, 0.01, 6*s);
            }
            // Inner cavity
            hull() {
                translate([0, 0, sh + 0.1]) rounded_rect(sw - sw_*2, sd - sw_*2, 0.01, 6*s);
                translate([0, 0, swd/2 + sb_]) rounded_rect(sw - sw_*2 - st_w*2, sd - sw_*2 - st_d*2, 0.01, 4*s);
            }
        }

        // Rim at top
        translate([0, 0, sh])
            difference() {
                rounded_rect(sw + 2*s, sd + 2*s, 4*s, 9*s);
                translate([0, 0, -0.1])
                    rounded_rect(sw - sw_*2 + 1*s, sd - sw_*2 + 1*s, 4*s + 0.2, 5*s);
            }

        // Lifting columns (textured grip areas on sides) — 360L has improved columns
        for (side = [-1, 1]) {
            translate([side * (sw/2 - 1*s), 0, sh * 0.3])
                cube([3*s, sd * 0.25, sh * 0.55], center=true);
        }

        // Reinforcement ribs
        for (side = [-1, 1]) {
            for (z = [sh * 0.3, sh * 0.6]) {
                translate([0, side * sd/2, z])
                    cube([sw * 0.85, 1.5*s, 6*s], center=true);
            }
        }

        // Rear foot step
        translate([0, -sd/2 + 3*s, swd/2])
            cube([sw * 0.4, 8*s, 4*s], center=true);
    }
}

// ── Lid ─────────────────────────────────────────────────────
module lid() {
    color("Gold") {
        // Main lid with slight dome profile
        translate([0, -slo/2, sh + slt/2])
            hull() {
                rounded_rect(sw + 2*s, sd + slo, slt * 0.3, 10*s);
                translate([0, 0, slt * 0.5])
                    rounded_rect(sw - 2*s, sd + slo - 4*s, 0.01, 8*s);
            }

        // Lid rim
        translate([0, -slo/2, sh])
            difference() {
                rounded_rect(sw + 4*s, sd + slo + 2*s, 2*s, 10*s);
                rounded_rect(sw - 4*s, sd + slo - 6*s, 2*s + 0.1, 6*s);
            }

        // Hinge blocks
        for (x = [-sw/3, sw/3]) {
            translate([x, -sd/2 - slo + 5*s, sh + 1*s])
                cube([12*s, 8*s, 4*s], center=true);
        }
    }
}

// ── Wheels ───────────────────────────────────────────────────
module wheels() {
    color("DarkSlateGray") {
        axle_d = 5 * s;
        tire_w = 12 * s;

        // Axle
        translate([0, -sd/2 + 8*s, swd/2])
            rotate([0, 90, 0])
                cylinder(h = sws, d = axle_d, center=true);

        // Wheels — larger 250mm for 360L
        for (side = [-1, 1]) {
            translate([side * sws/2, -sd/2 + 8*s, swd/2])
                rotate([0, 90, 0])
                    difference() {
                        cylinder(h = tire_w, d = swd, center=true);
                        cylinder(h = tire_w + 0.1, d = swd - 10*s, center=true);
                    }
        }
    }
}

// ── Handle ──────────────────────────────────────────────────
module handle() {
    color("DimGray") {
        // Patented hand grips — wider on 360L
        hh = 8 * s;
        hd = 6 * s;
        translate([0, -sd/2 - slo + 3*s, sh + slt + hh]) {
            // Bar
            hull() {
                translate([-shw/2, 0, 0]) rotate([0, 90, 0]) cylinder(h=0.01, d=hh);
                translate([shw/2, 0, 0]) rotate([0, 90, 0]) cylinder(h=0.01, d=hh);
            }
            // Rounded grip
            rotate([0, 90, 0])
                cylinder(h = shw, d = hh, center=true);
        }

        // Support brackets
        for (side = [-1, 1]) {
            translate([side * shw/2, -sd/2 - slo + 3*s, sh + slt/2])
                cube([4*s, hd, slt + hh*2], center=true);
        }
    }
}

// ── Utility ─────────────────────────────────────────────────
module rounded_rect(w, d, h, r) {
    hull() {
        for (x = [-w/2+r, w/2-r]) {
            for (y = [-d/2+r, d/2-r]) {
                translate([x, y, 0]) cylinder(h=h, r=r);
            }
        }
    }
}

// ── Assembly ────────────────────────────────────────────────
module sulo_360l() {
    body();
    lid();
    wheels();
    handle();
}

sulo_360l();
