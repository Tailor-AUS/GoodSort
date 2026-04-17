// ══════════════════════════════════════════════════════════════
// Insert V2 for SULO 360L Kompakt: Lift-Out Caddy with Handle
// ══════════════════════════════════════════════════════════════
// Runner grabs handle, lifts whole insert, extracts CDS, drops back.
// Perforated floor per quadrant. Open drain slots.

s = 1/4;

real_w = 642;  real_d = 617;
w = real_w * s;  d = real_d * s;

div_thick   = 3.0;
height      = 450 * s;  // 112mm — shorter for easy lifting
floor_thick = 2.0;
rim_w       = 3;
drain_r     = 3.5;
corner_r    = 5 * s;
handle_h    = 30;
handle_w    = 50;

$fn = 20;

module rounded_rect(w, d, h, r) {
    hull() {
        for (x = [-w/2+r, w/2-r])
            for (y = [-d/2+r, d/2-r])
                translate([x, y, 0]) cylinder(h=h, r=r);
    }
}

module insert_360l_v2() {
    iw = w - rim_w*2;
    id = d - rim_w*2;

    // Width divider
    translate([-iw/2, -div_thick/2, floor_thick])
        cube([iw, div_thick, height]);

    // Depth divider
    translate([-div_thick/2, -id/2, floor_thick])
        cube([div_thick, id, height]);

    // Perforated floor — 4 quadrants with drain slots
    for (qx = [-1, 1]) {
        for (qy = [-1, 1]) {
            ox = qx * iw/4;
            oy = qy * id/4;
            qw = iw/2 - div_thick - 1;
            qd = id/2 - div_thick - 1;
            difference() {
                translate([ox - qw/2, oy - qd/2, 0])
                    cube([qw, qd, floor_thick]);
                // Slot drain pattern (longer slots, not circles)
                for (i = [0:3]) {
                    for (j = [0:2]) {
                        translate([
                            ox - qw/2 + 8 + i * ((qw - 16) / 3),
                            oy - qd/2 + 8 + j * ((qd - 16) / 2),
                            -0.1
                        ]) hull() {
                            cylinder(h = floor_thick + 0.2, r = drain_r);
                            translate([8, 0, 0]) cylinder(h = floor_thick + 0.2, r = drain_r);
                        }
                    }
                }
            }
        }
    }

    // Top rim flange with rounded corners
    translate([0, 0, height + floor_thick])
        difference() {
            rounded_rect(iw + 8, id + 8, 4, corner_r);
            translate([0, 0, -0.1])
                rounded_rect(iw - 6, id - 6, 4.2, corner_r - 1);
        }

    // Central handle — ergonomic arch
    translate([0, 0, height + floor_thick + 4]) {
        // Two vertical posts
        for (side = [-1, 1]) {
            translate([side * handle_w/2, -div_thick/2, 0])
                cube([4, div_thick + 4, handle_h - 4]);
        }
        // Arch bridge with rounded grip
        hull() {
            translate([-handle_w/2, 0, handle_h - 6])
                rotate([0, 90, 0]) cylinder(h = handle_w, d = 6, $fn=16);
            translate([-handle_w/2 + 5, 0, handle_h - 2])
                rotate([0, 90, 0]) cylinder(h = handle_w - 10, d = 5, $fn=16);
        }
    }

    // Labels
    fh = height + floor_thick + 4;
    translate([-iw/4, -id/4, fh]) linear_extrude(1) text("GLASS", size=5, halign="center", valign="center", font="Arial:style=Bold");
    translate([iw/4, -id/4, fh]) linear_extrude(1) text("CANS", size=5, halign="center", valign="center", font="Arial:style=Bold");
    translate([-iw/4, id/4, fh]) linear_extrude(1) text("PAPER", size=4.5, halign="center", valign="center", font="Arial:style=Bold");
    translate([iw/4, id/4, fh]) linear_extrude(1) text("PLSTC", size=4.5, halign="center", valign="center", font="Arial:style=Bold");
}

insert_360l_v2();
