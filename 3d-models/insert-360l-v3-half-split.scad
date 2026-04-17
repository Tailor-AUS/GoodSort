// ══════════════════════════════════════════════════════════════
// Insert V3 for SULO 360L Kompakt: Simple Half-Split (CDS vs Other)
// ══════════════════════════════════════════════════════════════
// One wall. CDS side (cans+glass+bottles) vs everything else.
// Least sorting burden. Runner grabs from one side only.

s = 1/4;

real_w = 642;  real_d = 617;
w = real_w * s;  d = real_d * s;

wall_t     = 3.5;     // thicker — single wall needs to be sturdy
height     = 500 * s;  // 125mm
rim_w      = 3;
drain_r    = 2.5;
corner_r   = 5 * s;

$fn = 20;

module rounded_rect(w, d, h, r) {
    hull() {
        for (x = [-w/2+r, w/2-r])
            for (y = [-d/2+r, d/2-r])
                translate([x, y, 0]) cylinder(h=h, r=r);
    }
}

module insert_360l_v3() {
    iw = w - rim_w*2;
    id = d - rim_w*2;

    // Single divider wall — splits bin 50/50
    difference() {
        translate([-wall_t/2, -id/2, 0])
            cube([wall_t, id, height]);
        // Drain holes
        for (i = [0:9])
            translate([0, -id/2 + 10 + i*(id-20)/9, 10])
                rotate([0,90,0]) cylinder(h=wall_t+2, r=drain_r, center=true);
    }

    // Top rim flange
    translate([0, 0, height])
        difference() {
            rounded_rect(iw + 8, id + 8, 4, corner_r);
            translate([0, 0, -0.1])
                rounded_rect(iw - 6, id - 6, 4.2, corner_r - 1);
        }

    // CDS side indicator — raised ridge on left edge
    translate([-iw/2 - 4, -id/2 - 4, height])
        cube([4, id + 8, 6]);

    // Large labels on the flange
    translate([-iw/4, 3, height + 4])
        linear_extrude(1.5) text("CDS", size=9, halign="center", valign="center", font="Arial:style=Bold");
    translate([-iw/4, -10, height + 4])
        linear_extrude(1) text("cans  glass  bottles", size=3.5, halign="center", valign="center");

    translate([iw/4, 3, height + 4])
        linear_extrude(1.5) text("OTHER", size=7, halign="center", valign="center", font="Arial:style=Bold");
    translate([iw/4, -10, height + 4])
        linear_extrude(1) text("paper  plastic  trays", size=3.5, halign="center", valign="center");

    // Visual arrow on CDS side pointing down into the bin
    translate([-iw/4, 0, height * 0.7])
        rotate([90, 0, 0])
            linear_extrude(1) text("v", size=15, halign="center", valign="center");
}

insert_360l_v3();
