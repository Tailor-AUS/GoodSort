// ══════════════════════════════════════════════════════════════
// Insert V4 for SULO 360L Kompakt: 8-Stream Depot-Ready Sort
// ══════════════════════════════════════════════════════════════
// Matches the 8-stream sort that depots use for maximum handling fees.
// Resident scans with the app → app tells them which section.
//
// Layout (proportional to stream volume):
//
// TOP ROW (3 sections — high volume):
//   ALUMINIUM (40%) | PET CLEAR (18%) | PET COLOURED (7%)
//
// BOTTOM ROW (5 sections — glass + small streams):
//   GLASS CLEAR (8%) | GLASS BROWN (7%) | GLASS GREEN (5%) | STEEL (3%) | HDPE/LPB (12%)
//
// Asymmetric sizing — big sections for big streams.

s = 1/4;

// 360L Kompakt internal
real_w = 642;
real_d = 617;
w = real_w * s;   // 160.5
d = real_d * s;   // 154.25

div_thick  = 2.5;
rim_w      = 3;
corner_r   = 5 * s;
drain_r    = 2.0;

// Insert dimensions
iw = w - rim_w * 2;  // ~154
id = d - rim_w * 2;  // ~148

// Row split: top row takes 55% of depth (high volume), bottom 45%
top_d = id * 0.55;
bot_d = id * 0.45;

// Top row column splits (% of width): ALU 50%, PET_CLR 30%, PET_COL 20%
alu_w     = iw * 0.50;
pet_clr_w = iw * 0.30;
pet_col_w = iw * 0.20;

// Bottom row column splits: GLASS_CLR 22%, GLASS_BRN 20%, GLASS_GRN 18%, STEEL 12%, HDPE_LPB 28%
gls_clr_w = iw * 0.22;
gls_brn_w = iw * 0.20;
gls_grn_w = iw * 0.18;
steel_w   = iw * 0.12;
hdpe_w    = iw * 0.28;

// Divider height (open bottom)
height = 450 * s;  // 112mm

$fn = 16;

module rounded_rect(w, d, h, r) {
    hull() {
        for (x = [-w/2+r, w/2-r])
            for (y = [-d/2+r, d/2-r])
                translate([x, y, 0]) cylinder(h=h, r=r);
    }
}

module divider_wall(length, thick, h) {
    difference() {
        cube([length, thick, h]);
        // Drain holes
        holes = max(2, floor(length / 20));
        for (i = [0:holes-1])
            translate([8 + i * ((length - 16) / max(1, holes-1)), thick/2, 8])
                rotate([90, 0, 0])
                    cylinder(h = thick + 2, r = drain_r, center=true);
    }
}

module label(txt, size, x, y, z) {
    translate([x, y, z])
        linear_extrude(1)
            text(txt, size=size, halign="center", valign="center", font="Arial:style=Bold");
}

module insert_360l_v4() {
    // Origin at centre of insert, bottom at z=0

    // ── Horizontal divider (splits top row from bottom row) ──
    translate([-iw/2, -id/2 + bot_d - div_thick/2, 0])
        divider_wall(iw, div_thick, height);

    // ── Top row vertical dividers (2 dividers = 3 sections) ──
    // Between ALU and PET_CLR
    x1 = -iw/2 + alu_w;
    translate([x1 - div_thick/2, -id/2 + bot_d, 0])
        cube([div_thick, top_d, height]);

    // Between PET_CLR and PET_COL
    x2 = -iw/2 + alu_w + pet_clr_w;
    translate([x2 - div_thick/2, -id/2 + bot_d, 0])
        cube([div_thick, top_d, height]);

    // ── Bottom row vertical dividers (4 dividers = 5 sections) ──
    bx1 = -iw/2 + gls_clr_w;
    bx2 = bx1 + gls_brn_w;
    bx3 = bx2 + gls_grn_w;
    bx4 = bx3 + steel_w;

    for (bx = [bx1, bx2, bx3, bx4]) {
        translate([bx - div_thick/2, -id/2, 0])
            cube([div_thick, bot_d, height]);
    }

    // ── Top rim flange ──
    translate([0, 0, height])
        difference() {
            rounded_rect(iw + 8, id + 8, 4, corner_r);
            translate([0, 0, -0.1])
                rounded_rect(iw - 4, id - 4, 4.2, corner_r - 1);
        }

    // ── Labels (raised text on rim) ──
    lz = height + 4;

    // Top row labels
    label("ALU", 4, -iw/2 + alu_w/2, -id/2 + bot_d + top_d/2, lz);
    label("PET", 3.5, -iw/2 + alu_w + pet_clr_w/2, -id/2 + bot_d + top_d/2 + 3, lz);
    label("CLR", 3, -iw/2 + alu_w + pet_clr_w/2, -id/2 + bot_d + top_d/2 - 3, lz);
    label("PET", 3, -iw/2 + alu_w + pet_clr_w + pet_col_w/2, -id/2 + bot_d + top_d/2 + 3, lz);
    label("COL", 2.5, -iw/2 + alu_w + pet_clr_w + pet_col_w/2, -id/2 + bot_d + top_d/2 - 3, lz);

    // Bottom row labels
    label("GLS", 3, -iw/2 + gls_clr_w/2, -id/2 + bot_d/2 + 2, lz);
    label("CLR", 2.5, -iw/2 + gls_clr_w/2, -id/2 + bot_d/2 - 3, lz);

    label("GLS", 3, -iw/2 + gls_clr_w + gls_brn_w/2, -id/2 + bot_d/2 + 2, lz);
    label("BRN", 2.5, -iw/2 + gls_clr_w + gls_brn_w/2, -id/2 + bot_d/2 - 3, lz);

    label("GLS", 3, -iw/2 + gls_clr_w + gls_brn_w + gls_grn_w/2, -id/2 + bot_d/2 + 2, lz);
    label("GRN", 2.5, -iw/2 + gls_clr_w + gls_brn_w + gls_grn_w/2, -id/2 + bot_d/2 - 3, lz);

    label("STL", 2.5, -iw/2 + gls_clr_w + gls_brn_w + gls_grn_w + steel_w/2, -id/2 + bot_d/2, lz);

    label("HDPE", 2.5, -iw/2 + gls_clr_w + gls_brn_w + gls_grn_w + steel_w + hdpe_w/2, -id/2 + bot_d/2 + 2, lz);
    label("LPB", 2.5, -iw/2 + gls_clr_w + gls_brn_w + gls_grn_w + steel_w + hdpe_w/2, -id/2 + bot_d/2 - 3, lz);

    // ── Colour-coded section indicators (small raised dots on rim edge) ──
    // These help the runner visually identify sections in low light
    // Blue dots = aluminium side, Green = glass, Red = plastic
}

insert_360l_v4();
