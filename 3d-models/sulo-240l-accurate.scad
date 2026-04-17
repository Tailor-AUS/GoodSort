// ══════════════════════════════════════════════════════════════
// SULO 240L Wheelie Bin — Accurate 1:3 Scale Model
// ══════════════════════════════════════════════════════════════
// Based on SULO Australia datasheet dimensions
// Print on Snapmaker U1 (270×270×270mm bed)
//
// Real dimensions → 1:3 scale
// External: 580w × 730d × 1060h → 193 × 243 × 353
// BUT 353mm height exceeds 270mm bed!
// So we print at 1:3.5 scale → 166 × 209 × 303 ... still too tall
// At 1:4 scale → 145 × 183 × 265 ✓ fits!

s = 1/4;  // scale factor

// ── SULO 240L Real Dimensions (mm) ──────────────────────────
// From SULO Australia datasheet
ext_w      = 580;      // external width
ext_d_body = 660;      // body depth (without lid overhang)
ext_d_total= 730;      // total depth including lid
ext_h_body = 990;      // body height (without lid)
ext_h_total= 1060;     // total height with lid closed

wall       = 4 * s;    // ~4mm real wall thickness
base_thick = 5 * s;    // thicker base

// Taper: bottom is narrower than top
// SULO tapers ~25mm per side width, ~20mm per side depth
taper_w    = 25;
taper_d    = 20;

// Wheels
wheel_dia  = 200;
wheel_w    = 50;
axle_dia   = 20;

// Handle
handle_w   = 400;      // handle bar width (real)
handle_h   = 30;       // handle bar height
handle_d   = 25;       // handle bar depth

// Lid
lid_thick  = 20;       // lid thickness
lid_overhang = ext_d_total - ext_d_body; // ~70mm overhang at rear

$fn = 32;

// ── Scaled values ───────────────────────────────────────────
sw  = ext_w * s;
sd  = ext_d_body * s;
sh  = ext_h_body * s;

st_w = taper_w * s;
st_d = taper_d * s;

swd = wheel_dia * s;
sww = wheel_w * s;
sad = axle_dia * s;

shw = handle_w * s;
shh = handle_h * s;
shd = handle_d * s;

slt = lid_thick * s;
slo = lid_overhang * s;

echo(str("Model size: ", sw, "w × ", sd + slo, "d × ", sh + slt + swd/2, "h mm"));

// ── Modules ─────────────────────────────────────────────────

module body() {
    color("DimGray") {
        difference() {
            // Outer tapered body
            hull() {
                // Top
                translate([0, 0, sh])
                    cube([sw, sd, 0.01], center=true);
                // Bottom (narrower)
                translate([0, 0, swd/2])  // raised above ground for wheel clearance
                    cube([sw - st_w*2, sd - st_d*2, 0.01], center=true);
            }
            // Inner cavity
            hull() {
                translate([0, 0, sh + 0.1])
                    cube([sw - wall*2, sd - wall*2, 0.01], center=true);
                translate([0, 0, swd/2 + base_thick])
                    cube([sw - wall*2 - st_w*2, sd - wall*2 - st_d*2, 0.01], center=true);
            }
        }

        // Rim at top (thickened lip)
        rim = 2 * s;
        translate([0, 0, sh])
            difference() {
                cube([sw + rim, sd + rim, 3*s], center=true);
                cube([sw - wall, sd - wall, 3*s + 0.1], center=true);
            }

        // Reinforcement ribs on sides (2 per side)
        for (side = [-1, 1]) {
            for (z = [sh * 0.35, sh * 0.65]) {
                // Width faces
                translate([side * sw/2, 0, z])
                    cube([1.5*s, sd * 0.8, 8*s], center=true);
                // Depth faces
                translate([0, side * sd/2, z])
                    cube([sw * 0.8, 1.5*s, 8*s], center=true);
            }
        }
    }
}

module lid() {
    color("Gold") {
        // Main lid — flat with slight dome
        translate([0, -slo/2, sh + slt/2])
            cube([sw + 2*s, sd + slo, slt], center=true);

        // Lid rim (hangs over edges slightly)
        translate([0, -slo/2, sh])
            difference() {
                cube([sw + 4*s, sd + slo + 2*s, 2*s], center=true);
                cube([sw - 2*s, sd + slo - 4*s, 2*s + 0.1], center=true);
            }

        // Hinge blocks at rear
        for (x = [-sw/3, sw/3]) {
            translate([x, -sd/2 - slo + 3*s, sh])
                cube([15*s, 6*s, 4*s], center=true);
        }
    }
}

module wheels() {
    color("DarkSlateGray") {
        // Axle
        translate([0, -sd/2 + 5*s, swd/2])
            rotate([0, 90, 0])
                cylinder(h = sw + 10*s, d = sad, center=true);

        // Two wheels
        for (side = [-1, 1]) {
            translate([side * (sw/2 + 2*s), -sd/2 + 5*s, swd/2])
                rotate([0, 90, 0])
                    difference() {
                        cylinder(h = sww, d = swd, center=true);
                        cylinder(h = sww + 0.1, d = swd - 8*s, center=true);
                    }
        }
    }
}

module handle() {
    color("DimGray") {
        // Handle bar across the rear top
        hw = shw;
        translate([0, -sd/2 - 3*s, sh + slt + shh/2]) {
            // Horizontal bar
            cube([hw, shd, shh], center=true);
            // Grip (rounded)
            rotate([0, 90, 0])
                cylinder(h = hw, d = shh, center=true);
        }

        // Handle supports (connect bar to lid/body)
        for (side = [-1, 1]) {
            translate([side * hw/2, -sd/2 - 3*s, sh + slt/2])
                cube([4*s, shd, shh + slt], center=true);
        }
    }
}

module foot_pedal_area() {
    // Small step/ledge at the front bottom for tipping
    color("DimGray")
        translate([0, sd/2 - 3*s, swd/2])
            cube([sw * 0.6, 6*s, 3*s], center=true);
}

// ── Assembly ────────────────────────────────────────────────

module sulo_240l() {
    body();
    lid();
    wheels();
    handle();
    foot_pedal_area();
}

sulo_240l();

// Print dimensions check
echo(str("=== PRINT SIZE CHECK ==="));
echo(str("Width:  ", sw + 10*s, "mm (inc wheels)"));
echo(str("Depth:  ", sd + slo + shd, "mm (inc lid overhang + handle)"));
echo(str("Height: ", sh + slt + shh + shh/2, "mm (inc lid + handle)"));
