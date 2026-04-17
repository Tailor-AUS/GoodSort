// ══════════════════════════════════════════════════════════════
// Insert V2: Lift-Out Caddy with Handle
// ══════════════════════════════════════════════════════════════
// Same cross divider but with a central handle so the runner
// can grab the whole insert, lift it out, extract CDS items,
// and drop it back in. Also has a floor per quadrant (mesh/holes)
// so items don't fall between sections.

scale = 1/3;

real_w = 560;  real_d = 640;  real_taper = 30;
w  = real_w * scale;
d  = real_d * scale;
tp = real_taper * scale;

wall       = 2.0;
height     = 350 * scale;  // 117mm — shorter so it's easy to lift
rim_inset  = 2;
clearance  = 0.5;

insert_w = w - rim_inset*2 - clearance;
insert_d = d - rim_inset*2 - clearance;

floor_thick = 1.5;
drain_r     = 3.0;   // larger holes in the floor for drainage
handle_h    = 25;     // handle sticks up above the rim

$fn = 20;

module insert_v2() {
    // Width divider
    translate([-insert_w/2, -wall/2, floor_thick])
        cube([insert_w, wall, height]);

    // Depth divider
    translate([-wall/2, -insert_d/2, floor_thick])
        cube([wall, insert_d, height]);

    // Floor with drain holes — one per quadrant
    for (qx = [-1, 1]) {
        for (qy = [-1, 1]) {
            ox = qx * insert_w/4;
            oy = qy * insert_d/4;
            difference() {
                translate([ox - insert_w/4 + wall/2, oy - insert_d/4 + wall/2, 0])
                    cube([insert_w/2 - wall, insert_d/2 - wall, floor_thick]);
                // Grid of drain holes
                for (i = [0:3]) {
                    for (j = [0:2]) {
                        translate([
                            ox - insert_w/4 + 12 + i * ((insert_w/2 - 24) / 3),
                            oy - insert_d/4 + 12 + j * ((insert_d/2 - 24) / 2),
                            -0.1
                        ]) cylinder(h = floor_thick + 0.2, r = drain_r);
                    }
                }
            }
        }
    }

    // Top rim flange
    translate([0, 0, height + floor_thick]) {
        difference() {
            cube([insert_w + 4, insert_d + 4, 3], center=true);
            cube([insert_w - 6, insert_d - 6, 3.1], center=true);
        }
    }

    // Central handle — arch over the cross intersection
    translate([0, 0, height + floor_thick]) {
        // Two posts
        translate([-15, -wall/2, 0]) cube([3, wall, handle_h]);
        translate([12, -wall/2, 0]) cube([3, wall, handle_h]);
        // Bridge
        translate([-15, -wall/2, handle_h - 3]) cube([30, wall + 2, 3]);
        // Rounded grip
        translate([0, 0, handle_h - 1.5])
            rotate([90, 0, 0])
                cylinder(h = wall + 2, r = 4, center=true);
    }

    // Labels
    translate([-insert_w/4, -insert_d/4, height + floor_thick + 3])
        linear_extrude(1) text("GLASS", size=5, halign="center", valign="center", font="Arial:style=Bold");
    translate([insert_w/4, -insert_d/4, height + floor_thick + 3])
        linear_extrude(1) text("CANS", size=5, halign="center", valign="center", font="Arial:style=Bold");
    translate([-insert_w/4, insert_d/4, height + floor_thick + 3])
        linear_extrude(1) text("PAPER", size=4, halign="center", valign="center", font="Arial:style=Bold");
    translate([insert_w/4, insert_d/4, height + floor_thick + 3])
        linear_extrude(1) text("PLSTC", size=4, halign="center", valign="center", font="Arial:style=Bold");
}

insert_v2();
