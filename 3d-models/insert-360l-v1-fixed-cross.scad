// ══════════════════════════════════════════════════════════════
// Insert V1 for SULO 360L Kompakt: Fixed Open-Bottom Cross
// ══════════════════════════════════════════════════════════════

s = 1/4;

// 360L Kompakt internal dims (estimated from external - wall thickness)
real_w = 650 - 8;   // 642mm internal width
real_d = 625 - 8;   // 617mm internal depth
wall_t = 4;

w  = real_w * s;    // ~160
d  = real_d * s;    // ~154
st_w = 20 * s;      // taper
st_d = 15 * s;

div_thick = 3.0;    // slightly thicker for 360L
height    = 500 * s; // 125mm — taller bin so taller divider
rim_w     = 3;       // clearance from rim

drain_r = 2.5;
corner_r = 5 * s;

$fn = 20;

module rounded_rect(w, d, h, r) {
    hull() {
        for (x = [-w/2+r, w/2-r])
            for (y = [-d/2+r, d/2-r])
                translate([x, y, 0]) cylinder(h=h, r=r);
    }
}

module insert_360l_v1() {
    insert_w = w - rim_w*2;
    insert_d = d - rim_w*2;

    // Width divider (left-right)
    difference() {
        translate([-insert_w/2, -div_thick/2, 0])
            cube([insert_w, div_thick, height]);
        for (i = [0:7])
            translate([-insert_w/2 + 12 + i*(insert_w-24)/7, 0, 8])
                rotate([90,0,0]) cylinder(h=div_thick+2, r=drain_r, center=true);
    }

    // Depth divider (front-back)
    difference() {
        translate([-div_thick/2, -insert_d/2, 0])
            cube([div_thick, insert_d, height]);
        for (i = [0:6])
            translate([0, -insert_d/2 + 12 + i*(insert_d-24)/6, 8])
                rotate([0,90,0]) cylinder(h=div_thick+2, r=drain_r, center=true);
    }

    // Top rim flange — sits on the bin rim
    translate([0, 0, height])
        difference() {
            rounded_rect(insert_w + 6, insert_d + 6, 4, corner_r);
            translate([0, 0, -0.1])
                rounded_rect(insert_w - 8, insert_d - 8, 4.2, corner_r - 1);
        }

    // Labels
    translate([-insert_w/4, -insert_d/4, height + 4])
        linear_extrude(1.2) text("GLASS", size=5, halign="center", valign="center", font="Arial:style=Bold");
    translate([insert_w/4, -insert_d/4, height + 4])
        linear_extrude(1.2) text("CANS", size=5, halign="center", valign="center", font="Arial:style=Bold");
    translate([-insert_w/4, insert_d/4, height + 4])
        linear_extrude(1.2) text("PAPER", size=4.5, halign="center", valign="center", font="Arial:style=Bold");
    translate([insert_w/4, insert_d/4, height + 4])
        linear_extrude(1.2) text("PLSTC", size=4.5, halign="center", valign="center", font="Arial:style=Bold");
}

insert_360l_v1();
