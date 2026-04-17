// ══════════════════════════════════════════════════════════════
// Insert V1: Fixed Open-Bottom Cross
// ══════════════════════════════════════════════════════════════
// Simplest design. + shaped cross sits in the bin.
// Open bottom = items fall out when council truck tips.
// Friction-fits into the bin-shell-only.

scale = 1/3;

real_w = 560;  real_d = 640;  real_taper = 30;
w  = real_w * scale;
d  = real_d * scale;
tp = real_taper * scale;

wall       = 2.0;     // divider wall thickness
height     = 400 * scale;  // 133mm — leaves ~60mm gap at bottom
rim_inset  = 2;       // matches bin rim ledge

// Size the insert to sit at the top of the bin, resting on the rim
insert_w = w - rim_inset*2 - 0.5;  // 0.5mm clearance for fit
insert_d = d - rim_inset*2 - 0.5;

drain_r = 2.0;

module insert_v1() {
    // Width divider (runs left-right through centre)
    difference() {
        translate([-insert_w/2, -wall/2, 0])
            cube([insert_w, wall, height]);
        // Drain holes
        for (i = [0:6])
            translate([-insert_w/2 + 15 + i*(insert_w-30)/6, 0, 8])
                rotate([90,0,0]) cylinder(h=wall+2, r=drain_r, center=true, $fn=16);
    }

    // Depth divider (runs front-back through centre)
    difference() {
        translate([-wall/2, -insert_d/2, 0])
            cube([wall, insert_d, height]);
        for (i = [0:7])
            translate([0, -insert_d/2 + 15 + i*(insert_d-30)/7, 8])
                rotate([0,90,0]) cylinder(h=wall+2, r=drain_r, center=true, $fn=16);
    }

    // Top rim flange — rests on the bin rim ledge
    translate([0, 0, height]) {
        difference() {
            cube([insert_w + 4, insert_d + 4, 3], center=true);
            cube([insert_w - 6, insert_d - 6, 3.1], center=true);
        }
    }

    // Labels (raised text on top flange)
    translate([-insert_w/4, -insert_d/4, height + 3])
        linear_extrude(1) text("GLASS", size=5, halign="center", valign="center", font="Arial:style=Bold");
    translate([insert_w/4, -insert_d/4, height + 3])
        linear_extrude(1) text("CANS", size=5, halign="center", valign="center", font="Arial:style=Bold");
    translate([-insert_w/4, insert_d/4, height + 3])
        linear_extrude(1) text("PAPER", size=4, halign="center", valign="center", font="Arial:style=Bold");
    translate([insert_w/4, insert_d/4, height + 3])
        linear_extrude(1) text("PLSTC", size=4, halign="center", valign="center", font="Arial:style=Bold");
}

insert_v1();
