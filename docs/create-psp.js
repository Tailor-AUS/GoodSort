const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
        ShadingType, PageNumber, PageBreak, LevelFormat } = require('docx');
const fs = require('fs');

const DARK = "0F172A";
const GREY = "64748B";
const GREEN = "16A34A";
const YELLOW = "EAB308";
const border = { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };
const CW = 9026;

function para(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120 }, alignment: opts.align, children: [new TextRun({ text, font: "Arial", size: 22, color: opts.color || GREY, ...opts })] });
}
function boldPara(label, text) {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: label, font: "Arial", size: 22, bold: true, color: DARK }), new TextRun({ text, font: "Arial", size: 22, color: GREY })] });
}
function bullet(text) {
  return new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text, font: "Arial", size: 22, color: GREY })] });
}
function bulletBold(label, text) {
  return new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: label, font: "Arial", size: 22, bold: true, color: DARK }), new TextRun({ text, font: "Arial", size: 22, color: GREY })] });
}
function numbered(label, text) {
  return new Paragraph({ numbering: { reference: "numbers", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: label, font: "Arial", size: 22, bold: true, color: DARK }), new TextRun({ text, font: "Arial", size: 22, color: GREY })] });
}
function trow(cells, isHeader = false) {
  return new TableRow({ children: cells.map(c => new TableCell({ borders, margins: cellMargins, width: { size: c.w, type: WidthType.DXA }, shading: isHeader ? { fill: DARK, type: ShadingType.CLEAR } : (c.shade ? { fill: c.shade, type: ShadingType.CLEAR } : undefined), children: [new Paragraph({ children: [new TextRun({ text: c.t, font: "Arial", size: 20, bold: isHeader || c.b, color: isHeader ? "FFFFFF" : (c.c || DARK) })] })] })) });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, font: "Arial", color: DARK }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, font: "Arial", color: DARK }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ]
  },
  numbering: { config: [
    { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  ]},
  sections: [
    // COVER
    { properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Crispr Projects Pty Ltd (ABN 85 680 798 770) trading as The Good Sort", font: "Arial", size: 16, color: GREY })] })] }) },
      children: [
        new Paragraph({ spacing: { before: 2400 } }),
        para("PRIVATE SECTOR PATHWAYS PROGRAM", { size: 20, bold: true }),
        para("Smart Waste Management Solutions Across Queensland\u2019s Ecotourism Sites", { size: 20 }),
        new Paragraph({ spacing: { after: 240 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: YELLOW } }, children: [new TextRun({ text: " ", size: 8 })] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "The Good Sort", font: "Arial", size: 56, bold: true, color: DARK })] }),
        new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: "AI-Powered Container Recycling for Queensland Ecotourism", font: "Arial", size: 28, color: GREEN })] }),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [2400, 6626], rows: [
          trow([{t:"Applicant",w:2400,b:true},{t:"Crispr Projects Pty Ltd",w:6626}]),
          trow([{t:"ABN",w:2400,b:true},{t:"85 680 798 770",w:6626}]),
          trow([{t:"Trading As",w:2400,b:true},{t:"The Good Sort",w:6626}]),
          trow([{t:"Contact",w:2400,b:true},{t:"Knox Hart, Director",w:6626}]),
          trow([{t:"Email",w:2400,b:true},{t:"knox.hart@tailorco.au",w:6626}]),
          trow([{t:"Location",w:2400,b:true},{t:"Moorooka, QLD 4105",w:6626}]),
          trow([{t:"Website",w:2400,b:true},{t:"thegoodsort.org",w:6626}]),
          trow([{t:"Funding Sought",w:2400,b:true},{t:"$100,000 (excluding GST)",w:6626}]),
          trow([{t:"Pilot Duration",w:2400,b:true},{t:"6 months (June \u2013 December 2026)",w:6626}]),
        ]}),
        new Paragraph({ spacing: { before: 480 } }),
        para("Submitted: April 2026", { size: 20 }),
        para("Confidential", { size: 20, italics: true }),
      ]
    },
    // MAIN
    { properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" } }, children: [new TextRun({ text: "The Good Sort", font: "Arial", size: 18, bold: true, color: DARK }), new TextRun({ text: "  |  PSP Application  |  Smart Waste Management for Ecotourism", font: "Arial", size: 18, color: GREY })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Page ", font: "Arial", size: 16, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: GREY })] })] }) },
      children: [
        // 1. EXECUTIVE SUMMARY
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("1. Executive Summary")] }),
        para("The Good Sort is a Queensland-built AI-powered container recycling platform that turns beverage waste into revenue through Australia\u2019s Container Deposit Scheme (CDS). We propose deploying smart recycling stations at 3 remote ecotourism pilot sites across Queensland, using computer vision to identify, classify, and incentivise proper container sorting by visitors."),
        para("Every year, millions of CDS-eligible containers are discarded into general waste at Queensland\u2019s national parks, islands, and campgrounds \u2014 containers worth 10 cents each under the Container Refund Scheme. These containers pollute ecosystems, attract wildlife, and represent lost revenue that could fund conservation."),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("The Campsite Problem")] }),
        para("Many Queensland campsites and ecotourism sites already have Containers for Change collection points. But these are passive bins that rely entirely on goodwill \u2014 and goodwill doesn\u2019t scale. There is no financial incentive for anyone to drive to a remote campsite to collect containers, so they sit uncollected. Rangers are too busy with conservation to manage waste logistics. Scheduled pickups are infrequent and reactive rather than demand-driven."),
        para("The result: bins overflow, containers end up in general waste or scattered around campsites, and the 10-cent CDS value is lost to landfill. Worse, there is no incentive for campers themselves to sort properly \u2014 or to pick up containers left behind by others."),
        para("The Good Sort solves both sides of this problem simultaneously:"),
        bulletBold("For campers and visitors: ", "A direct financial incentive (5 cents per container) to sort correctly and to pick up containers left by others. A camper walking past scattered cans on a trail can photograph them, earn credits, and deposit them in the sorted bin. The campsite gets cleaner because cleaning up now pays."),
        bulletBold("For collection: ", "The runner marketplace creates a real market where none existed. Remote runs are priced higher (6\u20138 cents per container) through our dynamic pricing algorithm, making it financially viable for local contractors to service even the most remote sites. When bins are full, runners are notified automatically \u2014 no ranger involvement needed."),
        para("This transforms passive Containers for Change points from goodwill-dependent infrastructure into active, incentivised sorting stations with a self-sustaining collection market."),

        para("Our solution:"),
        bulletBold("AI-powered identification: ", "Visitors photograph containers using their phone. Our Tailor Vision API instantly classifies the material, confirms CDS eligibility, and tells the visitor which bin to use."),
        bulletBold("Incentivised behaviour change: ", "Visitors earn 5-cent sorting credits per container, redeemable via bank transfer."),
        bulletBold("Smart bin monitoring: ", "QR-coded bins track fill levels and material composition in real time \u2014 enabling demand-driven collection."),
        bulletBold("Runner marketplace: ", "Local runners claim collection runs via the app with dynamic pricing, delivering sorted containers to the nearest CDS depot."),
        bulletBold("Revenue-generating: ", "Each container earns 7.68 cents in COEX handling fees plus scrap value, creating a self-sustaining model after the pilot."),
        para("The platform is live at thegoodsort.org, operational in Brisbane, and ready for ecotourism deployment."),

        // 2. SOLUTION
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("2. Solution Description")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2.1 How It Works")] }),
        numbered("Scan: ", "Visitor opens thegoodsort.org on their phone (no app download \u2014 progressive web app). They photograph their empty container."),
        numbered("Sort: ", "Tailor Vision (our AI) identifies the container \u2014 material type, brand, CDS eligibility. The app tells the visitor which of 4 colour-coded bins to use: Blue (aluminium), Teal (PET), Amber (glass), or Green (other)."),
        numbered("Earn: ", "The visitor earns 5 cents per eligible container as a sorting credit, credited to their account and redeemable via bank transfer."),
        numbered("Collect: ", "When bins reach capacity, local runners are notified. They claim the run, pick up sorted containers, and deliver to the nearest Containers for Change depot. The depot pays The Good Sort the 10c refund plus 7.68c handling fee."),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2.2 Key Features")] }),
        bulletBold("No app download: ", "Works in the browser as a PWA. Visitors access via QR code on the bin."),
        bulletBold("Offline-capable: ", "PWA caches the interface. For ecotourism, we add an offline queue that stores scans locally and syncs when connectivity returns."),
        bulletBold("Multilingual-ready: ", "Visual-first design. AI classification is language-independent \u2014 identifies containers visually."),
        bulletBold("Accessible: ", "Large touch targets, high-contrast UI, camera-based interaction. No typing required."),
        bulletBold("Climate resilient: ", "Standard UV-stabilised HDPE bins. No electronics in bins. All intelligence is in the cloud."),
        bulletBold("Australian AI: ", "Powered by Tailor Vision (tailor.au). All data processed on Australian Azure infrastructure."),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2.3 Technology Stack")] }),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [3000, 6026], rows: [
          trow([{t:"Component",w:3000},{t:"Technology",w:6026}], true),
          trow([{t:"Frontend",w:3000,b:true},{t:"Next.js 16, React 19, PWA (thegoodsort.org)",w:6026}]),
          trow([{t:"Backend API",w:3000,b:true},{t:".NET 9 Aspire on Azure Container Apps",w:6026}]),
          trow([{t:"AI Vision",w:3000,b:true},{t:"Tailor Vision API (api.tailor.au) \u2014 Australian-hosted",w:6026}]),
          trow([{t:"Database",w:3000,b:true},{t:"Azure SQL",w:6026}]),
          trow([{t:"Maps",w:3000,b:true},{t:"Google Maps API (bin locations, runner routing)",w:6026}]),
          trow([{t:"Auth",w:3000,b:true},{t:"Email OTP via Azure Communication Services",w:6026}]),
          trow([{t:"Payments",w:3000,b:true},{t:"ABA bank file generation for cashouts",w:6026}]),
        ]}),

        // 3. IMPERATIVES
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("3. Alignment with Challenge Imperatives")] }),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [2200, 6826], rows: [
          trow([{t:"Imperative",w:2200},{t:"How The Good Sort Addresses It",w:6826}], true),
          trow([{t:"Cost",w:2200,b:true},{t:"Free for visitors. Revenue-positive: each container generates 7.68c handling fee + scrap value. After pilot, CDS revenue funds ongoing operations without government subsidy.",w:6826}]),
          trow([{t:"Rural & Remote",w:2200,b:true},{t:"No infrastructure required beyond bins. No power, plumbing, or connectivity hardware. AI runs on visitors\u2019 phones. Offline mode queues scans when out of range. Footprint: 4 wheelie bins per site.",w:6826}]),
          trow([{t:"Stakeholder Engagement",w:2200,b:true},{t:"Traditional Owners can be local runners, earning income from collection on Country. Rangers benefit from reduced litter. Tourism operators host bins and track recycling metrics.",w:6826}]),
          trow([{t:"Useability",w:2200,b:true},{t:"Camera-based, visual-first. No forms, typing, or complex menus. Works on any smartphone via QR code. Colour-coded bins are intuitive regardless of language or digital literacy.",w:6826}]),
          trow([{t:"Future Growth",w:2200,b:true},{t:"Software-based: adding a site costs one set of bins and a QR code. Runner marketplace scales automatically. As tourism grows toward 2045, the platform scales linearly with visitors.",w:6826}]),
        ]}),

        // 4. ROADMAP
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("4. Implementation Roadmap")] }),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [1600, 1400, 6026], rows: [
          trow([{t:"Phase",w:1600},{t:"Timeline",w:1400},{t:"Activities",w:6026}], true),
          trow([{t:"1. Setup",w:1600,b:true},{t:"Jun 2026",w:1400},{t:"Site selection with DETSI (3 sites). Stakeholder engagement. Procure and deploy 12 bins (4 per site). Configure offline mode.",w:6026}]),
          trow([{t:"2. Soft Launch",w:1600,b:true},{t:"Jul 2026",w:1400},{t:"Deploy at Site 1 (highest-traffic). Onboard 2\u20133 local runners. Monitor AI accuracy. Establish baseline metrics.",w:6026}]),
          trow([{t:"3. Expansion",w:1600,b:true},{t:"Aug\u2013Sep",w:1400},{t:"Roll out to Sites 2 and 3. Scale runner marketplace. Refine dynamic pricing. Introduce gamification.",w:6026}]),
          trow([{t:"4. Optimise",w:1600,b:true},{t:"Oct\u2013Nov",w:1400},{t:"Analyse diversion rates and behaviour data. Optimise collection schedules. Mid-pilot report to DETSI.",w:6026}]),
          trow([{t:"5. Evaluate",w:1600,b:true},{t:"Dec 2026",w:1400},{t:"Final evaluation. Present results: containers diverted, participation rate, revenue, cost per container. Deliver scale-up plan.",w:6026}]),
        ]}),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("4.1 Proposed Pilot Sites")] }),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [2500, 2000, 2200, 2326], rows: [
          trow([{t:"Site Type",w:2500},{t:"Example",w:2000},{t:"Challenge",w:2200},{t:"Tests",w:2326}], true),
          trow([{t:"High-traffic national park",w:2500},{t:"Springbrook NP",w:2000},{t:"High volume, day visitors",w:2200},{t:"Scalability and engagement",w:2326}]),
          trow([{t:"Island campground",w:2500},{t:"North Stradbroke Is.",w:2000},{t:"Remote, limited access",w:2200},{t:"Offline mode and logistics",w:2326}]),
          trow([{t:"Eco-lodge",w:2500},{t:"O\u2019Reilly\u2019s Rainforest",w:2000},{t:"Operator-managed",w:2200},{t:"Operator integration",w:2326}]),
        ]}),
        para("Final site selection in consultation with DETSI\u2019s Tourism Division."),

        // 5. IMPACT
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("5. Measuring Impact and Success")] }),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [3200, 2400, 3426], rows: [
          trow([{t:"Metric",w:3200},{t:"Target (6 months)",w:2400},{t:"How Measured",w:3426}], true),
          trow([{t:"Containers diverted from landfill",w:3200},{t:"15,000+",w:2400},{t:"Platform scan records + depot receipts",w:3426}]),
          trow([{t:"Unique visitors using platform",w:3200},{t:"1,000+",w:2400},{t:"User registrations",w:3426}]),
          trow([{t:"Visitor participation rate",w:3200},{t:">15% of site visitors",w:2400},{t:"Users / total visitors (ranger counts)",w:3426}]),
          trow([{t:"AI classification accuracy",w:3200},{t:">95%",w:2400},{t:"Verified against depot acceptance",w:3426}]),
          trow([{t:"Container litter reduction",w:3200},{t:">40% reduction",w:2400},{t:"Before/after litter audits",w:3426}]),
          trow([{t:"Collection cost per container",w:3200},{t:"<8 cents",w:2400},{t:"Total costs / containers collected",w:3426}]),
          trow([{t:"CDS revenue generated",w:3200},{t:"$2,600+",w:2400},{t:"Depot settlement records",w:3426}]),
          trow([{t:"CO2 equivalent saved",w:3200},{t:"525 kg",w:2400},{t:"35g CO2e per container (industry std)",w:3426}]),
        ]}),
        bullet("Monthly reporting to DETSI with real-time dashboard access"),
        bullet("Before/after litter audits at each pilot site"),
        bullet("Visitor surveys at 3-month and 6-month intervals"),
        bullet("Final evaluation report with state-wide scale-up recommendations"),

        // 6. BUDGET
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("6. Budget")] }),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [4000, 1800, 3226], rows: [
          trow([{t:"Item",w:4000},{t:"Cost (ex GST)",w:1800},{t:"Notes",w:3226}], true),
          trow([{t:"Bin procurement and deployment",w:4000,b:true},{t:"$8,400",w:1800},{t:"12 bins @ $700 each incl. QR labels, delivery",w:3226}]),
          trow([{t:"Offline mode development",w:4000,b:true},{t:"$15,000",w:1800},{t:"Service worker offline scan queueing and sync",w:3226}]),
          trow([{t:"Ecotourism UX adaptations",w:4000,b:true},{t:"$10,000",w:1800},{t:"Signage design, multilingual hints, outdoor UI",w:3226}]),
          trow([{t:"Tailor Vision API usage",w:4000,b:true},{t:"$6,000",w:1800},{t:"~15,000 classifications @ ~$0.03/call",w:3226}]),
          trow([{t:"Azure hosting (6 months)",w:4000,b:true},{t:"$4,800",w:1800},{t:"Container Apps, SQL, CDN, email service",w:3226}]),
          trow([{t:"Runner onboarding and payouts",w:4000,b:true},{t:"$12,000",w:1800},{t:"Recruitment, training, guaranteed minimums",w:3226}]),
          trow([{t:"Stakeholder engagement",w:4000,b:true},{t:"$8,000",w:1800},{t:"Site visits, Traditional Owner consultation, training",w:3226}]),
          trow([{t:"Project management",w:4000,b:true},{t:"$18,000",w:1800},{t:"6-month PT project lead, reporting, evaluation",w:3226}]),
          trow([{t:"Signage and collateral",w:4000,b:true},{t:"$5,000",w:1800},{t:"Weatherproof signs, QR displays, bin stickers",w:3226}]),
          trow([{t:"Contingency (12%)",w:4000,b:true},{t:"$10,800",w:1800},{t:"Unforeseen costs",w:3226}]),
          trow([{t:"TOTAL",w:4000,b:true},{t:"$98,000",w:1800,b:true,c:GREEN},{t:"Within $100,000 budget",w:3226,b:true,c:GREEN}]),
        ]}),

        // 7. TEAM
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("7. Team Qualifications")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("7.1 Crispr Projects Pty Ltd")] }),
        para("Queensland-registered company based in Moorooka, Brisbane. Operates The Good Sort container recycling platform and is the parent entity for Tailor Intelligence, an Australian AI software company."),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("7.2 Key Personnel")] }),
        boldPara("Knox Hart \u2014 Director and Lead", ""),
        bullet("Founder of Tailor Intelligence (tailor.au) \u2014 AI software for Australian enterprise"),
        bullet("Built The Good Sort end-to-end: AI vision, marketplace, runner logistics, payments"),
        bullet("Experience deploying Azure infrastructure for Australian government and corporate clients"),
        bullet("Based in Brisbane, Queensland"),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("7.3 Capabilities")] }),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [3000, 6026], rows: [
          trow([{t:"Capability",w:3000},{t:"Evidence",w:6026}], true),
          trow([{t:"AI/Computer Vision",w:3000,b:true},{t:"Tailor Vision API live in production, >95% accuracy",w:6026}]),
          trow([{t:"Mobile Development",w:3000,b:true},{t:"PWA live at thegoodsort.org with camera, offline, responsive",w:6026}]),
          trow([{t:"Marketplace/Logistics",w:3000,b:true},{t:"Runner marketplace with dynamic pricing, GPS, gamification",w:6026}]),
          trow([{t:"CDS/Recycling",w:3000,b:true},{t:"Deep COEX knowledge, depot logistics, ABA payment files",w:6026}]),
          trow([{t:"Cloud Infrastructure",w:3000,b:true},{t:"Azure Container Apps, SQL, ACS \u2014 all deployed",w:6026}]),
          trow([{t:"Government Experience",w:3000,b:true},{t:"Tailor serves AU government clients with sovereign AI",w:6026}]),
        ]}),

        // 8. SUSTAINABILITY
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("8. Sustainability Beyond the Pilot")] }),
        para("The Good Sort is designed to be financially self-sustaining. The revenue model does not depend on ongoing government funding:"),
        new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [5000, 4026], rows: [
          trow([{t:"Revenue Line",w:5000},{t:"Per Container",w:4026}], true),
          trow([{t:"CDS refund (paid by depot)",w:5000},{t:"10.00 cents",w:4026}]),
          trow([{t:"COEX handling fee (as registered CRP)",w:5000},{t:"7.68 cents",w:4026}]),
          trow([{t:"Scrap material value (aluminium avg)",w:5000},{t:"~2.00 cents",w:4026}]),
          trow([{t:"Total revenue",w:5000,b:true},{t:"19.68 cents",w:4026,b:true,c:GREEN}]),
          trow([{t:"Less: Sorter credit",w:5000},{t:"-5.00 cents",w:4026}]),
          trow([{t:"Less: Runner payout (avg)",w:5000},{t:"-5.50 cents",w:4026}]),
          trow([{t:"Less: AI + hosting",w:5000},{t:"-1.50 cents",w:4026}]),
          trow([{t:"Net margin per container",w:5000,b:true},{t:"7.68 cents",w:4026,b:true,c:GREEN}]),
        ]}),
        bullet("Phase 1 (pilot): 3 sites, 15,000 containers, PSP funded"),
        bullet("Phase 2 (2027): 20 high-traffic sites, funded by pilot revenue + investment"),
        bullet("Phase 3 (2028+): 100+ sites state-wide, expansion to all CDS states"),

        // 9. MAINTENANCE
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("9. Maintenance and Staffing")] }),
        para("As required by the challenge statement:"),
        bulletBold("Bin servicing: ", "Demand-driven via smart fill tracking. Runners (contractors) handle collection \u2014 no additional government staff."),
        bulletBold("Technology: ", "Cloud-hosted with zero on-site hardware. Updates deployed remotely. No on-site IT staff."),
        bulletBold("Runner management: ", "Self-onboarding via app. Pricing, assignment, rating, payment all automated."),
        bulletBold("Ongoing cost: ", "After pilot, operational costs covered by CDS revenue. No government subsidy required."),

        // 10. CLOSING
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("10. Closing Statement")] }),
        para("The Good Sort transforms beverage container waste from an environmental liability into a revenue-generating community asset. By combining AI-powered identification with financial incentives and a logistics marketplace, we make recycling effortless, rewarding, and measurable at Queensland\u2019s most treasured natural places."),
        para("We are a Queensland company, building Australian technology, solving an Australian problem. The platform is live, the AI works, and the economics are proven. What we need is the opportunity to deploy at ecotourism scale \u2014 and the partnership with DETSI to make it happen."),
        para("We welcome the opportunity to present our solution to the assessment panel on 20 May 2026."),
        new Paragraph({ spacing: { before: 480 } }),
        boldPara("Knox Hart", ""),
        para("Director, Crispr Projects Pty Ltd"),
        para("Trading as The Good Sort"),
        para("knox.hart@tailorco.au | thegoodsort.org"),
      ]
    }
  ]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("C:\\Users\\knoxh\\GoodSort\\docs\\PSP-Application-GoodSort.docx", buffer);
  console.log("Done: PSP-Application-GoodSort.docx created");
});
