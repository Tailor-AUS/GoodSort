// ══════════════════════════════════════════════════════════════
// Insert V3: Simple Half-Split (CDS vs Non-CDS)
// ══════════════════════════════════════════════════════════════
// Simplest possible permanent insert. One wall splits the bin
// into 2 halves: CDS side (cans, bottles, glass) vs everything
// else. Runner just grabs from the CDS side.
//
// This tests whether 2 sections is actually better than 4.
// Less sorting burden on the resident. Faster for the runner.

scale = 1/3;

real_w = 560;  real_d = 640;  real_taper = 30;
w  = real_w * scale;
d  = real_d * scale;
tp = real_taper * scale;

wall       = 2.5;     // slightly thicker — only one wall, needs to be sturdy
height     = 420 * scale;  // 140mm
rim_inset  = 2;
clearance  = 0.5;

insert_w = w - rim_inset*2 - clearance;
insert_d = d - rim_inset*2 - clearance;

drain_r = 2.0;

$fn = 16;

module insert_v3() {
    // Single divider wall — splits bin into CDS (left) and NON-CDS (right)
    difference() {
        translate([-wall/2, -insert_d/2, 0])
            cube([wall, insert_d, height]);
        // Drain holes
        for (i = [0:8])
            translate([0, -insert_d/2 + 12 + i*(insert_d-24)/8, 8])
                rotate([0,90,0]) cylinder(h=wall+2, r=drain_r, center=true);
    }

    // Top rim flange — asymmetric to show which side is which
    translate([0, 0, height]) {
        difference() {
            cube([insert_w + 4, insert_d + 4, 3], center=true);
            // Cut out the middle, leaving just the frame
            translate([0, 0, 0])
                cube([insert_w - 6, insert_d - 6, 3.1], center=true);
        }
    }

    // CDS side indicator — thicker left edge of flange (green in real product)
    translate([-insert_w/2 - 2, -insert_d/2 - 2, height])
        cube([3, insert_d + 4, 5]);

    // Labels on flange
    translate([-insert_w/4, 0, height + 3])
        linear_extrude(1.5) text("CDS", size=8, halign="center", valign="center", font="Arial:style=Bold");
    translate([-insert_w/4, -15, height + 3])
        linear_extrude(1) text("cans bottles glass", size=3.5, halign="center", valign="center");

    translate([insert_w/4, 0, height + 3])
        linear_extrude(1.5) text("OTHER", size=6, halign="center", valign="center", font="Arial:style=Bold");
    translate([insert_w/4, -12, height + 3])
        linear_extrude(1) text("paper plastic trays", size=3.5, halign="center", valign="center");
}

insert_v3();
