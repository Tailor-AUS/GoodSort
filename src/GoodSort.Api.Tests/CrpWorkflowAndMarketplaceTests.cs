using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GoodSort.Api.Tests;

public class CrpWorkflowAndMarketplaceTests : IClassFixture<CrpWorkflowAndMarketplaceTests.CrpHost>
{
    private readonly CrpHost _host;
    public CrpWorkflowAndMarketplaceTests(CrpHost host) => _host = host;

    public class CrpHost : WebApplicationFactory<Program>
    {
        public readonly string DbName = $"crp-workflow-{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("ConnectionStrings:goodsortdb", string.Empty);
            builder.UseSetting("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789");
            builder.UseSetting("COEX_CRP_ACTIVE", "true");
            builder.UseSetting("PAYID_PAYOUTS_ENABLED", "true");
            builder.UseSetting("ADMIN_SEED_EMAIL", "admin@crp.test");

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GoodSortDbContext>>();
                services.RemoveAll<GoodSortDbContext>();
                services.AddDbContext<GoodSortDbContext>(o => o.UseInMemoryDatabase(DbName));
                services.RemoveAll<IHostedService>();
            });
        }
    }

    [Fact]
    public void Crp_ledger_calculates_exact_17_68c_unit_economics_in_basis_points()
    {
        // 1,000 containers under COEX SEQ Secondary-Sorted CRP:
        //   COEX Gross In: 1,000 * 17.68¢ = $176.80 (1,768,000 bp)
        //     - Refund:    1,000 * 10.00¢ = $100.00 (1,000,000 bp)
        //     - Handling:  1,000 *  7.68¢ =  $76.80 (  768,000 bp)
        //   Payouts Out:
        //     - Sorter:    1,000 * 10.00¢ = $100.00 (10,000¢)
        //     - Mafia:     1,000 *  1.00¢ =  $10.00 ( 1,000¢)
        //     - Runner:    1,000 *  3.00¢ =  $30.00 ( 3,000¢)
        //   Net Margin:    +$36.80 (+3.68¢/can = 368,000 bp)
        var ledger = CrpSettlement.BuildLedger(
            runId: Guid.NewGuid(),
            areaName: "MOOROOKA",
            crpActive: true,
            verifiedContainers: 1000,
            bagsVerified: 7,
            discrepancyStops: 0,
            householdPayoutCents: 10_000,
            containerMafiaCents: 1_000,
            runnerPayoutCents: 3_000,
            coexDocketRef: "COEX-SEQ-001");

        Assert.Equal("coex_crp", ledger.SettlementMode);
        Assert.Equal(1_000_000L, ledger.CoexRefundBasisPoints);
        Assert.Equal(768_000L, ledger.CoexHandlingFeeBasisPoints);
        Assert.Equal(1_768_000L, ledger.GrossRevenueBasisPoints);
        Assert.Equal(14_000, ledger.TotalPayoutCents);
        Assert.Equal(368_000L, ledger.NetMarginBasisPoints);
        Assert.Equal(176.80m, CrpSettlement.BasisPointsToDollars(ledger.GrossRevenueBasisPoints));
        Assert.Equal(36.80m, CrpSettlement.BasisPointsToDollars(ledger.NetMarginBasisPoints));
        Assert.Equal(3.68m, CrpSettlement.BasisPointsToCentsPerCan(ledger.NetMarginBasisPoints, 1000));
    }

    [Fact]
    public void Crp_10c_household_pickup_absorbs_launch_bonus_bridge_without_paying_15c()
    {
        var member = new Profile { Id = Guid.NewGuid(), PendingCents = 20 };
        var scans = new List<Scan>
        {
            new() { UserId = member.Id, RefundCents = 10, Status = "pending" },
            new() { UserId = member.Id, RefundCents = 10, Status = "pending" },
        };

        var credit = HouseholdCredit.ApplyPickup([member], scans, 2, 10);

        Assert.Equal(20, credit);
        Assert.Equal(0, member.PendingCents);
        Assert.Equal(20, member.ClearedCents);
    }

    [Fact]
    public async Task PayId_and_Aba_exports_claim_only_their_own_payout_method()
    {
        var options = new DbContextOptionsBuilder<GoodSortDbContext>()
            .UseInMemoryDatabase($"cashout-split-{Guid.NewGuid():N}")
            .Options;
        await using var db = new GoodSortDbContext(options);

        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ABA_PAYOUTS_ENABLED"] = "true",
                ["ABA_TRACE_BSB"] = "034002",
                ["ABA_TRACE_ACCOUNT"] = "98765432",
                ["ABA_USER_ID"] = "301500",
                ["PAYID_PAYOUTS_ENABLED"] = "true",
            })
            .Build();

        var abaUser = new Profile { Id = Guid.NewGuid(), Name = "Alice Sorter", Email = "alice@test.au", ClearedCents = 5000 };
        var payIdUser = new Profile { Id = Guid.NewGuid(), Name = "Bob Runner", Email = "bob@test.au", ClearedCents = 4500 };
        db.Profiles.AddRange(abaUser, payIdUser);
        await db.SaveChangesAsync();

        var svc = new CashoutService(db, cfg);

        var (abaOk, abaErr) = await svc.RequestCashout(abaUser.Id, 3000, "064000", "12345678", "ALICE SORTER");
        Assert.True(abaOk, abaErr);

        var (payOk, payErr) = await svc.RequestPayIdCashout(payIdUser.Id, 2500, "email", "bob@test.au", "BOB RUNNER");
        Assert.True(payOk, payErr);

        var csv = await svc.GeneratePayIdCsv();
        Assert.Contains("BOB RUNNER", csv);
        Assert.Contains("bob@test.au", csv);
        Assert.DoesNotContain("ALICE SORTER", csv);
        Assert.Equal("", await svc.GeneratePayIdCsv()); // second export finds nothing pending

        var aba = await svc.GenerateAbaFile();
        Assert.Contains("ALICE SORTER", aba);
        Assert.DoesNotContain("BOB RUNNER", aba);
        foreach (var line in aba.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => l.TrimEnd('\r')))
            Assert.Equal(120, line.Length);
        Assert.Equal("", await svc.GenerateAbaFile());
    }

    private record AuthMember(HttpClient Client, Guid ProfileId, string Email);

    private async Task<AuthMember> SignUp(string email, Guid? referrerId = null)
    {
        var client = _host.CreateClient();
        var send = await client.PostAsJsonAsync("/api/auth/send-otp", new { email });
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);
        var sendJson = await send.Content.ReadFromJsonAsync<JsonElement>();
        var code = sendJson.GetProperty("devCode").GetString()!;

        var verify = await client.PostAsJsonAsync("/api/auth/verify-otp", new { email, code, referrerId });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        var verifyJson = await verify.Content.ReadFromJsonAsync<JsonElement>();
        var token = verifyJson.GetProperty("token").GetString()!;
        var profileId = verifyJson.GetProperty("profile").GetProperty("id").GetGuid();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return new AuthMember(client, profileId, email);
    }

    [Fact]
    public async Task End_to_end_crp_bag_tag_kerbside_manifest_settlement_and_payid_export()
    {
        var admin = await SignUp("admin@crp.test");
        var mafia = await SignUp("mafia@crp.test");
        var sorter = await SignUp("sorter@crp.test", referrerId: mafia.ProfileId);
        var runner = await SignUp("runner@crp.test");

        // 1. Sorter creates residential household in Moorooka
        var createHh = await sorter.Client.PostAsJsonAsync("/api/households", new
        {
            name = "Sorter House",
            address = "42 Beaudesert Rd, Moorooka QLD 4105",
            suburb = "Moorooka",
            street = "Beaudesert Rd",
            lat = -27.535678,
            lng = 153.021234,
            type = "residential",
            councilCollectionDay = 2,
            councilArea = "Brisbane City Council",
            accessConsent = true,
        });
        Assert.Equal(HttpStatusCode.Created, createHh.StatusCode);
        var hhJson = await createHh.Content.ReadFromJsonAsync<JsonElement>();
        var householdId = hhJson.GetProperty("id").GetGuid();

        // 2. Sorter scans 3 aluminium cans, then seals a 300-can Aluminium QR bag on the kerb
        for (var i = 0; i < 3; i++)
        {
            var scanRes = await sorter.Client.PostAsJsonAsync("/api/scans", new
            {
                userId = sorter.ProfileId,
                barcode = $"930067500111{i}",
                containerName = "375mL Can",
                material = "aluminium",
            });
            Assert.Equal(HttpStatusCode.OK, scanRes.StatusCode);
        }

        var bagRes = await sorter.Client.PostAsJsonAsync("/api/bags", new
        {
            stream = "aluminium",
            declaredContainers = 300,
            putOnKerb = true,
        });
        Assert.Equal(HttpStatusCode.Created, bagRes.StatusCode);
        var bagJson = await bagRes.Content.ReadFromJsonAsync<JsonElement>();
        var bagCode = bagJson.GetProperty("code").GetString()!;
        Assert.StartsWith("GSB-ALU-", bagCode);
        Assert.Equal(3, bagJson.GetProperty("linkedScanCount").GetInt32());
        Assert.Equal("on_kerb", bagJson.GetProperty("status").GetString());

        // 3. Public Marketplace Overview shows MOOROOKA with privacy-rounded ~1.1km centroid and zero address leakage
        var anon = _host.CreateClient();
        var overviewRes = await anon.GetAsync("/api/marketplace/overview");
        Assert.Equal(HttpStatusCode.OK, overviewRes.StatusCode);
        var overviewRaw = await overviewRes.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Beaudesert", overviewRaw);
        Assert.DoesNotContain("Sorter House", overviewRaw);
        var overviewJson = JsonDocument.Parse(overviewRaw).RootElement;
        Assert.True(overviewJson.GetProperty("crpActive").GetBoolean());
        var pools = overviewJson.GetProperty("suburbPools").EnumerateArray().ToList();
        Assert.Contains(pools, p => p.GetProperty("suburb").GetString() == "MOOROOKA"
            && p.GetProperty("centroidLat").GetDouble() == -27.54);

        // 4. Register Runner with COEX Scheme ID & seed an available run for that household's bin
        var regRes = await runner.Client.PostAsJsonAsync("/api/runner/register", new
        {
            profileId = runner.ProfileId,
            vehicleType = "car",
            capacityBags = 12,
            serviceRadiusKm = 15.0,
            coexSchemeId = "C109876543",
        });
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);

        Guid runId;
        Guid stopId;
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var bin = await db.Bins.FirstAsync(b => b.HouseholdId == householdId);
            var depot = await db.Depots.FirstOrDefaultAsync() ?? new Depot
            {
                Name = "RECAN Yeerongpilly",
                Address = "993 Fairfield Rd, Yeerongpilly",
                Lat = -27.531,
                Lng = 153.013,
            };
            if (await db.Depots.CountAsync() == 0) db.Depots.Add(depot);

            var run = new Run
            {
                DropPointId = depot.Id,
                AreaName = "MOOROOKA",
                CentroidLat = -27.536,
                CentroidLng = 153.021,
                EstimatedContainers = 300,
                PerContainerCents = 3,
                EstimatedPayoutCents = 900,
                Status = "available",
                ExpiresAt = DateTime.UtcNow.AddHours(6),
            };
            var stop = new RunStop
            {
                RunId = run.Id,
                BinId = bin.Id,
                Lat = -27.5356,
                Lng = 153.0212,
                EstimatedContainers = 300,
                Sequence = 1,
            };
            run.Stops.Add(stop);
            db.Runs.Add(run);
            await db.SaveChangesAsync();
            runId = run.Id;
            stopId = stop.Id;
        }

        // 5. Runner claims, starts, checks manifest, scans QR bag tag, completes stop, delivers, completes & settles
        Assert.Equal(HttpStatusCode.OK, (await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/claim", new { profileId = runner.ProfileId })).StatusCode);

        // Claim recalculates pricing; pin PerContainerCents = 3¢ so we assert exact 3¢ Runner payout
        using (var scope = _host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
            var r = await db.Runs.FindAsync(runId);
            r!.PerContainerCents = 3;
            await db.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.OK, (await runner.Client.PostAsync($"/api/marketplace/runs/{runId}/start", null)).StatusCode);

        var manifestRes = await runner.Client.GetAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/manifest");
        Assert.Equal(HttpStatusCode.OK, manifestRes.StatusCode);
        var manifestJson = await manifestRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Single(manifestJson.GetProperty("bags").EnumerateArray());

        var scanBagRes = await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/scan-bag", new
        {
            bagCode,
            verifiedContainers = 300,
            contaminationFlag = false,
            discrepancyCode = "none",
        });
        Assert.Equal(HttpStatusCode.OK, scanBagRes.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/stops/{stopId}/pickup", new
        {
            actualContainers = 300,
            discrepancyCode = "none",
            contaminationFlag = false,
        })).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await runner.Client.PostAsync($"/api/marketplace/runs/{runId}/deliver", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await runner.Client.PostAsJsonAsync($"/api/marketplace/runs/{runId}/complete", new
        {
            depotVerifiedContainers = 300,
            coexDocketRef = "COEX-DOCKET-777",
        })).StatusCode);

        var settleRes = await runner.Client.PostAsync($"/api/marketplace/runs/{runId}/settle", null);
        Assert.Equal(HttpStatusCode.OK, settleRes.StatusCode);
        var settleJson = await settleRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("coex_crp", settleJson.GetProperty("settlementMode").GetString());
        Assert.Equal(3000, settleJson.GetProperty("householdPayoutCents").GetInt32()); // 300 * 10¢ = $30.00
        Assert.Equal(300, settleJson.GetProperty("containerMafiaCents").GetInt32());   // 300 *  1¢ =  $3.00
        Assert.Equal(900, settleJson.GetProperty("actualPayoutCents").GetInt32());     // 300 *  3¢ =  $9.00
        Assert.Equal(53.04m, settleJson.GetProperty("grossRevenueDollars").GetDecimal()); // 300 * 17.68¢
        Assert.Equal(11.04m, settleJson.GetProperty("netMarginDollars").GetDecimal());    // 300 *  3.68¢

        // 6. Sorter requests $25 PayID payout & Admin downloads NPP PayID CSV + inspects CRP Ledger
        var payIdReq = await sorter.Client.PostAsJsonAsync("/api/cashout/payid", new
        {
            amountCents = 2500,
            payIdType = "email",
            payIdValue = "sorter@crp.test",
            accountName = "SORTER HOUSEHOLD",
        });
        Assert.Equal(HttpStatusCode.OK, payIdReq.StatusCode);

        var ledgerRes = await admin.Client.GetAsync("/api/admin/crp-ledger");
        Assert.Equal(HttpStatusCode.OK, ledgerRes.StatusCode);
        var ledgerJson = await ledgerRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, ledgerJson.GetProperty("totals").GetProperty("settledRuns").GetInt32());
        Assert.Equal(1, ledgerJson.GetProperty("payouts").GetProperty("pendingPayIdCount").GetInt32());

        var csvRes = await admin.Client.GetAsync("/api/admin/payid-export");
        Assert.Equal(HttpStatusCode.OK, csvRes.StatusCode);
        var csvText = await csvRes.Content.ReadAsStringAsync();
        Assert.Contains("SORTER HOUSEHOLD,email,sorter@crp.test,25.00,2500", csvText);
    }
}
