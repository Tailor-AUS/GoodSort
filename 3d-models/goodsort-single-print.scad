// ══════════════════════════════════════════════════════════════
// The Good Sort — 1:3 Scale Single-Print Prototype
// ══════════════════════════════════════════════════════════════
// One piece, no assembly. Bin + fixed cross divider.
// Fits Snapmaker U1 bed (270×270×270mm)
//
// Print settings: PETG, 0.2mm layers, 15% infill, no supports needed

scale = 1/3;

// SULO 240L internal dimensions (real mm)
real_width  = 560;
real_depth  = 640;
real_height = 580;
real_taper  = 30;

// Scaled
w  = real_width  * scale;  // 187mm
d  = real_depth  * scale;  // 213mm
h  = real_height * scale;  // 193mm
tp = real_taper  * scale;  // 10mm

// Walls
bin_wall  = 2.0;
div_thick = 2.0;

// Divider sits in top portion — open gap at bottom for tipping
div_height  = 400 * scale;  // 133mm
bottom_gap  = h - div_height; // ~60mm open at bottom

// Drain hole radius
drain_r = 2.5;
drain_count_w = 6;  // holes per divider (width wall)
drain_count_d = 8;  // holes per divider (depth wall)

$fn = 20;

module tapered_box(top_w, top_d, bot_w, bot_d, height, wall) {
    difference() {
        hull() {
            translate([0, 0, height])
                cube([top_w, top_d, 0.01], center=true);
            cube([bot_w, bot_d, 0.01], center=true);
        }
        hull() {
            translate([0, 0, height + 0.1])
                cube([top_w - wall*2, top_d - wall*2, 0.01], center=true);
            translate([0, 0, wall])
                cube([bot_w - wall*2, bot_d - wall*2, 0.01], center=true);
        }
    }
}

module bin_with_dividers() {
    // Bin shell
    tapered_box(
        w + bin_wall*2, d + bin_wall*2,
        w + bin_wall*2 - tp*2, d + bin_wall*2 - tp*2,
        h, bin_wall
    );

    // Width divider (runs front-to-back, centred left-right)
    // Sits in the top portion with a gap at the bottom
    difference() {
        translate([0, 0, bottom_gap])
            cube([div_thick, d - tp*1.2, div_height], center=true);

        // Drain holes
        for (i = [0 : drain_count_d - 1]) {
            translate([0,
                       -d/2 + tp + 15 + i * ((d - tp*2 - 30) / (drain_count_d - 1)),
                       bottom_gap + 12])
                rotate([0, 90, 0])
                    cylinder(h = div_thick + 2, r = drain_r, center=true);
        }
    }

    // Depth divider (runs left-to-right, centred front-to-back)
    difference() {
        translate([0, 0, bottom_gap])
            cube([w - tp*1.2, div_thick, div_height], center=true);

        // Drain holes
        for (i = [0 : drain_count_w - 1]) {
            translate([-w/2 + tp + 15 + i * ((w - tp*2 - 30) / (drain_count_w - 1)),
                       0,
                       bottom_gap + 12])
                rotate([90, 0, 0])
                    cylinder(h = div_thick + 2, r = drain_r, center=true);
        }
    }

    // Labels — raised text on top edge of each divider wall
    // Front-left quadrant: GLASS
    translate([-w/4, -d/4, h - 1])
        linear_extrude(1.5)
            text("GLASS", size=6, halign="center", valign="center", font="Arial:style=Bold");

    // Front-right quadrant: CANS
    translate([w/4, -d/4, h - 1])
        linear_extrude(1.5)
            text("CANS", size=6, halign="center", valign="center", font="Arial:style=Bold");

    // Back-left quadrant: PAPER
    translate([-w/4, d/4, h - 1])
        linear_extrude(1.5)
            text("PAPER", size=5, halign="center", valign="center", font="Arial:style=Bold");

    // Back-right quadrant: PLASTIC
    translate([w/4, d/4, h - 1])
        linear_extrude(1.5)
            text("PLSTC", size=5, halign="center", valign="center", font="Arial:style=Bold");
}

bin_with_dividers();
