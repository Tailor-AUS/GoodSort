// ══════════════════════════════════════════════════════════════
// The Good Sort — 1:3 Scale 240L Yellow Bin + Sliding Divider
// ══════════════════════════════════════════════════════════════
// Print at 1:3 scale on Snapmaker U1 (270×270×270mm bed)
// All dimensions in mm (real-world in comments, model = real/3)
//
// Components (print separately):
//   1. bin_shell()        — the yellow bin body
//   2. rail_pair_width()  — 2 rail tracks for the width-axis divider
//   3. rail_pair_depth()  — 2 rail tracks for the depth-axis divider
//   4. divider_width()    — sliding wall (width direction)
//   5. divider_depth()    — sliding wall (depth direction)
//   6. centre_post()      — locking intersection post
//
// To render one part: uncomment it at the bottom of the file

// ── Parameters (real-world mm, divided by scale) ──────────────
scale       = 1/3;

// SULO 240L internal dimensions (real)
real_width  = 560;    // side to side
real_depth  = 640;    // front to back
real_height = 580;    // internal depth
real_taper  = 30;     // each side narrows by this at the bottom

// Model dimensions
w  = real_width  * scale;  // ~187mm
d  = real_depth  * scale;  // ~213mm
h  = real_height * scale;  // ~193mm
tp = real_taper  * scale;  // ~10mm taper per side

// Wall thicknesses
bin_wall    = 2.5;    // bin shell wall
div_thick   = 2.0;    // divider wall thickness
rail_h      = 4.0;    // rail track height
rail_slot   = 2.4;    // slot width in rail (divider slides through)
notch_space = 50 * scale; // ~17mm between notch detents
notch_depth = 0.6;    // how deep the click notch is
notch_width = 2.0;    // notch width along rail

// Divider height (shorter than bin so items can slide out when tipped)
div_height  = 400 * scale; // ~133mm (leaves ~60mm clearance at bottom)

// Centre post
post_size   = 8;      // square cross-section of centre locking post


// ── Modules ───────────────────────────────────────────────────

// Tapered bin shell (open top, no bottom for easy printing)
module bin_shell() {
    difference() {
        // Outer shell — tapered box
        hull() {
            // Top (wider)
            translate([0, 0, h])
                cube([w + bin_wall*2, d + bin_wall*2, 0.01], center=true);
            // Bottom (narrower due to taper)
            translate([0, 0, 0])
                cube([w + bin_wall*2 - tp*2, d + bin_wall*2 - tp*2, 0.01], center=true);
        }
        // Inner cavity
        hull() {
            translate([0, 0, h + 0.1])
                cube([w, d, 0.01], center=true);
            translate([0, 0, bin_wall])
                cube([w - tp*2, d - tp*2, 0.01], center=true);
        }
    }
}

// Rail track — clips to inner bin wall, has a slot for the divider to slide through
module rail_track(length, with_notches=true) {
    difference() {
        // Rail body
        cube([length, rail_h, rail_h]);
        // Slot for divider
        translate([-0.1, (rail_h - rail_slot)/2, rail_h * 0.3])
            cube([length + 0.2, rail_slot, rail_h]);
    }
    // Notch detents inside the slot
    if (with_notches) {
        for (i = [1 : floor(length / notch_space) - 1]) {
            translate([i * notch_space - notch_width/2, (rail_h - rail_slot)/2 - notch_depth, rail_h * 0.3])
                cube([notch_width, notch_depth + 0.1, rail_h * 0.5]);
            translate([i * notch_space - notch_width/2, (rail_h + rail_slot)/2, rail_h * 0.3])
                cube([notch_width, notch_depth + 0.1, rail_h * 0.5]);
        }
    }
}

// Rail pair for width-axis divider (these mount on front + back inner walls)
module rail_pair_width() {
    // Front rail
    rail_track(w - tp*1.5);
    // Back rail (offset for visual clarity when printing)
    translate([0, rail_h + 5, 0])
        rail_track(w - tp*1.5);
}

// Rail pair for depth-axis divider (mount on left + right inner walls)
module rail_pair_depth() {
    rail_track(d - tp*1.5);
    translate([0, rail_h + 5, 0])
        rail_track(d - tp*1.5);
}

// Sliding divider wall (width direction — slides left/right)
module divider_width() {
    // Main wall panel
    cube([d - tp*1.5 - 2, div_thick, div_height]);

    // Top grip/label strip (wider for grabbing + label area)
    translate([-2, -1.5, div_height])
        cube([d - tp*1.5 + 2, div_thick + 3, 5]);

    // Centre slot (cut from top, half height) for interlocking with depth divider
    // This will be done as a difference in the assembly
}

// Sliding divider wall (depth direction — slides front/back)
module divider_depth() {
    cube([w - tp*1.5 - 2, div_thick, div_height]);

    // Top grip/label strip
    translate([-2, -1.5, div_height])
        cube([w - tp*1.5 + 2, div_thick + 3, 5]);
}

// Centre post — locks the two dividers at their intersection
module centre_post() {
    difference() {
        cube([post_size, post_size, div_height * 0.8]);
        // Cross slots for the two divider walls
        translate([-0.1, (post_size - div_thick)/2 - 0.1, -0.1])
            cube([post_size + 0.2, div_thick + 0.2, div_height + 0.2]);
        translate([(post_size - div_thick)/2 - 0.1, -0.1, -0.1])
            cube([div_thick + 0.2, post_size + 0.2, div_height + 0.2]);
    }
}

// ── Drain holes for divider walls ─────────────────────────────
module divider_width_with_drains() {
    difference() {
        divider_width();
        // Drain holes along bottom edge
        for (i = [0 : 8]) {
            translate([15 + i * ((d - tp*1.5) / 9), -0.1, 10])
                cylinder(h = div_thick + 0.2, r = 3, $fn=12);
        }
    }
}

module divider_depth_with_drains() {
    difference() {
        divider_depth();
        for (i = [0 : 6]) {
            translate([15 + i * ((w - tp*1.5) / 7), -0.1, 10])
                cylinder(h = div_thick + 0.2, r = 3, $fn=12);
        }
    }
}


// ── Assembly view (for visualisation, don't print this) ───────
module assembly() {
    color("Gold", 0.3) bin_shell();

    // Width divider (slides left-right) — positioned at centre
    color("Green", 0.8)
        translate([0, -div_thick/2, bin_wall + (h - div_height)/2])
            translate([-((d - tp*1.5 - 2)/2), 0, 0])
                divider_width_with_drains();

    // Depth divider (slides front-back) — positioned at centre
    color("DarkGreen", 0.8)
        translate([-div_thick/2, 0, bin_wall + (h - div_height)/2])
            translate([0, -((w - tp*1.5 - 2)/2), 0])
                rotate([0, 0, 90])
                    divider_depth_with_drains();

    // Centre post
    color("Black")
        translate([-post_size/2, -post_size/2, bin_wall])
            centre_post();

    // Rails (width axis — on front and back walls)
    color("Gray")
        translate([-(w - tp*1.5)/2, d/2 - rail_h, bin_wall + 5])
            rail_track(w - tp*1.5);
    color("Gray")
        translate([-(w - tp*1.5)/2, -d/2, bin_wall + 5])
            rail_track(w - tp*1.5);

    // Rails (depth axis — on left and right walls)
    color("DarkGray")
        translate([w/2 - rail_h, -(d - tp*1.5)/2, bin_wall + 5])
            rotate([0, 0, 90])
                rail_track(d - tp*1.5);
    color("DarkGray")
        translate([-w/2, -(d - tp*1.5)/2, bin_wall + 5])
            rotate([0, 0, 90])
                rail_track(d - tp*1.5);
}


// ══════════════════════════════════════════════════════════════
// UNCOMMENT ONE AT A TIME TO RENDER + EXPORT AS STL:
// ══════════════════════════════════════════════════════════════

// Show full assembly (for preview only — don't print this)
// assembly();

// Individual parts for printing:
// bin_shell();
// rail_pair_width();
// rail_pair_depth();
// divider_width_with_drains();
// divider_depth_with_drains();
// centre_post();
