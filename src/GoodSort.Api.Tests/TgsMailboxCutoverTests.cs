using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using GoodSort.Api.Tests.OpaqueBox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace GoodSort.Api.Tests;

/// <summary>
/// Pins the TGS-only mailbox cutover (TailorAU/tailor-group#612):
/// 1. No hardcoded Tailor mailbox redirect (knox@tailor.au / tailorco.au) remains in GoodSort.Api.
/// 2. ensure-openai-provisioned.sh defaults ADMIN_SEED_EMAIL and OPS_ALERT_EMAIL to hello@thegoodsort.org with LF endings.
/// 3. OpsAlert.Inbox normalizes valid addresses and rejects display-name injection or dotless hosts.
/// 4. AuthService.VerifyOtp resolves admin@thegoodsort.org and hello@thegoodsort.org to the single TGS admin profile.
/// 5. GET /api/admin/stats reports exact nonAdminUsers excluding admin accounts.
/// </summary>
public class TgsMailboxCutoverTests : IClassFixture<OpaqueBoxHost>
{
    private readonly OpaqueBoxHost _host;

    public TgsMailboxCutoverTests(OpaqueBoxHost host) => _host = host;

    [Fact]
    public void Api_source_contains_no_tailor_mailbox_forwarding()
    {
        var apiDir = Path.GetDirectoryName(FindRepoFile(Path.Combine("src", "GoodSort.Api", "Program.cs")))!;
        var migrations = Path.DirectorySeparatorChar + "Migrations" + Path.DirectorySeparatorChar;

        foreach (var file in Directory.GetFiles(apiDir, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains(migrations, StringComparison.Ordinal)) continue;
            var source = File.ReadAllText(file);
            Assert.DoesNotContain("knox@tailor.au", source, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("tailorco.au", source, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Provisioning_script_defaults_admin_and_ops_alerts_to_hello_thegoodsort_org()
    {
        var scriptPath = FindRepoFile(Path.Combine("scripts", "ensure-openai-provisioned.sh"));
        var raw = File.ReadAllText(scriptPath);

        Assert.DoesNotContain("\r", raw, StringComparison.Ordinal);
        Assert.Contains("ADMIN_EMAIL=\"${ADMIN_SEED_EMAIL:-hello@thegoodsort.org}\"", raw, StringComparison.Ordinal);
        Assert.Contains("OPS_EMAIL=\"${OPS_ALERT_EMAIL:-hello@thegoodsort.org}\"", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("knox@tailor.au", raw, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void OpsAlert_normalizes_and_rejects_malformed_or_injected_addresses()
    {
        Assert.Equal("hello@thegoodsort.org", OpsAlert.Inbox("  Hello@TheGoodSort.ORG  ", null));
        Assert.Equal("hello@thegoodsort.org", OpsAlert.Inbox("Evil <hello@thegoodsort.org>", "hello@thegoodsort.org"));
        Assert.Null(OpsAlert.Inbox("Evil <hello@thegoodsort.org>", "ops@localhost"));
        Assert.Null(OpsAlert.Inbox("hello@thegoodsort.org\r\nBcc:evil@example.com", ""));
    }

    [Fact]
    public async Task VerifyOtp_resolves_admin_alias_to_existing_hello_admin_profile_without_duplication()
    {
        var db = new GoodSortDbContext(
            new DbContextOptionsBuilder<GoodSortDbContext>()
                .UseInMemoryDatabase($"tgs-alias-{Guid.NewGuid():N}")
                .Options);

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["JWT_SECRET"] = "test-jwt-secret-key-with-at-least-32-chars!!",
            ["ADMIN_SEED_EMAIL"] = "hello@thegoodsort.org",
        }).Build();

        var existingAdminId = Guid.Parse("4ebefa46-94c4-4df8-aa45-a6dcbde28bbb");
        db.Profiles.Add(new Profile
        {
            Id = existingAdminId,
            Name = "The Good Sort",
            Email = "hello@thegoodsort.org",
            Phone = "hello@thegoodsort.org",
            Role = "sorter",
            IsAdmin = true,
        });
        await db.SaveChangesAsync();

        var env = new FakeHostEnv { EnvironmentName = Environments.Development };
        var auth = new AuthService(db, config, NullLogger<AuthService>.Instance, env);

        var (sent, sendErr, devCode) = await auth.SendOtp("admin@thegoodsort.org");
        Assert.True(sent, sendErr);
        Assert.False(string.IsNullOrWhiteSpace(devCode));

        var (token, profile, verifyErr) = await auth.VerifyOtp("admin@thegoodsort.org", devCode!);
        Assert.Null(verifyErr);
        Assert.NotNull(token);
        Assert.NotNull(profile);
        Assert.Equal(existingAdminId, profile!.Id);
        Assert.True(profile.IsAdmin);
        Assert.Equal("hello@thegoodsort.org", profile.Email);
        Assert.Equal(1, await db.Profiles.CountAsync());
    }

    [Fact]
    public void ShouldPromoteSeedAdmin_matches_hello_and_admin_aliases()
    {
        Assert.True(AuthService.ShouldPromoteSeedAdmin(false, false, "hello@thegoodsort.org", "hello@thegoodsort.org"));
        Assert.True(AuthService.ShouldPromoteSeedAdmin(false, false, "admin@thegoodsort.org", "hello@thegoodsort.org"));
        Assert.True(AuthService.ShouldPromoteSeedAdmin(false, false, "hello@thegoodsort.org", "admin@thegoodsort.org"));
        Assert.False(AuthService.ShouldPromoteSeedAdmin(false, false, "neighbour@thegoodsort.org", "hello@thegoodsort.org"));
    }

    [Fact]
    public async Task AdminStats_reports_exact_nonAdminUsers_excluding_admin_profiles()
    {
        using var scope = _host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();
        var auth = scope.ServiceProvider.GetRequiredService<AuthService>();

        var admin = new Profile
        {
            Name = "The Good Sort",
            Email = $"hello-{Guid.NewGuid():N}@thegoodsort.org",
            Phone = "hello@thegoodsort.org",
            IsAdmin = true,
        };
        var organic = new Profile
        {
            Name = "Organic Member",
            Email = $"organic-{Guid.NewGuid():N}@example.test",
            Phone = "organic@example.test",
            IsAdmin = false,
        };
        db.Profiles.AddRange(admin, organic);
        await db.SaveChangesAsync();

        var expectedNonAdmin = await db.Profiles.CountAsync(p => !p.IsAdmin);
        var expectedTotal = await db.Profiles.CountAsync();
        Assert.True(expectedTotal > expectedNonAdmin);

        using var client = _host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.GenerateJwt(admin));

        var res = await client.GetAsync("/api/admin/stats");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(expectedTotal, body.GetProperty("users").GetInt32());
        Assert.Equal(expectedNonAdmin, body.GetProperty("nonAdminUsers").GetInt32());
    }

    private static string FindRepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, relative)))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, relative);
    }

    private sealed class FakeHostEnv : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "GoodSort.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }
}
