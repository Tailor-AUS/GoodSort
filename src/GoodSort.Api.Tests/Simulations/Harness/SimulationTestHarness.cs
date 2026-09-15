using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GoodSort.Api.Tests.Simulations.Harness;

/// <summary>
/// Shared test harness utilities for persona journey simulations (R1-R4).
/// Provides standardized test data, Moorooka coordinates, JWT token creation,
/// cryptographic scan token minting, and database state snapshotting.
/// </summary>
public static class SimulationTestHarness
{
    public const string MoorookaAddress = "42 Hamilton Rd, Moorooka QLD 4105";
    public const string MoorookaSuburb = "MOOROOKA";
    public const string MoorookaStreet = "Hamilton Rd";
    public const double MoorookaLat = -27.5342;
    public const double MoorookaLng = 153.0286;
    public const string TestJwtSecret = "test-only-signing-key-not-a-real-secret-0123456789";

    /// <summary>
    /// Creates a valid 30-day HMAC-SHA256 JWT for the specified profile.
    /// </summary>
    public static string CreateJwt(Guid userId, string email, string name, DateTime? expires = null, string? secret = null)
    {
        var key = secret ?? TestJwtSecret;
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("email", email),
            new("name", name),
            new("role", "sorter"),
        };

        var token = new JwtSecurityToken(
            issuer: "goodsort-api",
            audience: "goodsort-app",
            claims: claims,
            expires: expires ?? DateTime.UtcNow.AddDays(30),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Mints a cryptographic HMAC-SHA256 signed ScanToken directly using ScanTokenService.
    /// </summary>
    public static string MintScanToken(
        JourneySimulationHost host,
        Guid userId,
        List<ScanTokenItem>? items = null,
        string? binCode = null,
        double? binLat = null,
        double? binLng = null,
        string? photoHash = null,
        TimeSpan? ttl = null,
        Guid? jti = null)
    {
        var tokens = host.Services.GetRequiredService<ScanTokenService>();
        var payload = new ScanTokenPayload
        {
            Jti = jti ?? Guid.NewGuid(),
            Uid = userId,
            Items = items ?? [new ScanTokenItem { Name = "Coca-Cola 375ml can", Material = "aluminium", Count = 1, Eligible = true }],
            BinCode = binCode,
            BinLat = binLat,
            BinLng = binLng,
            PhotoHash = photoHash,
        };
        return tokens.Issue(payload, ttl ?? TimeSpan.FromMinutes(10));
    }

    /// <summary>
    /// Generates a valid test image encoded as base64 JPEG.
    /// </summary>
    public static string CreateDistinctTestImage(int stripeColumn)
    {
        using var image = new Image<Rgba32>(32, 32);
        for (var y = 0; y < 32; y++)
        {
            for (var x = 0; x < 32; x++)
            {
                var isWhite = (x >= stripeColumn * 6 && x < stripeColumn * 6 + 4);
                image[x, y] = isWhite
                    ? new Rgba32(255, 255, 255)
                    : new Rgba32(0, 0, 0);
            }
        }
        using var ms = new MemoryStream();
        image.SaveAsJpeg(ms);
        return Convert.ToBase64String(ms.ToArray());
    }

    /// <summary>
    /// Captures a database state snapshot for auditing state transitions across journey steps.
    /// </summary>
    public static async Task<StepDbSnapshot> CaptureSnapshotAsync(
        JourneySimulationHost host,
        string stepName,
        string description,
        string email,
        Guid? profileId = null,
        Guid? householdId = null)
    {
        return await host.WithDbContextAsync(async db =>
        {
            var profile = profileId.HasValue
                ? await db.Profiles.FindAsync(profileId.Value)
                : await db.Profiles.FirstOrDefaultAsync(p => p.Email == email);
            var otp = await db.OtpCodes.Where(o => o.Email == email).OrderByDescending(o => o.CreatedAt).FirstOrDefaultAsync();
            var scans = profile != null ? await db.Scans.Where(s => s.UserId == profile.Id).ToListAsync() : [];
            var firstScan = scans.FirstOrDefault();
            var usedTokens = profile != null ? await db.UsedScanTokens.Where(u => u.UserId == profile.Id).ToListAsync() : [];
            var household = householdId.HasValue
                ? await db.Households.FindAsync(householdId.Value)
                : (profile?.HouseholdId != null ? await db.Households.FindAsync(profile.HouseholdId.Value) : null);
            var bin = household != null ? await db.Bins.FirstOrDefaultAsync(b => b.HouseholdId == household.Id) : null;

            return new StepDbSnapshot
            {
                StepName = stepName,
                Description = description,
                ProfileCount = profile != null ? 1 : 0,
                ProfileId = profile?.Id,
                ProfileEmail = profile?.Email,
                ProfileHouseholdId = profile?.HouseholdId,
                ProfilePendingCents = profile?.PendingCents ?? 0,
                ProfileTotalContainers = profile?.TotalContainers ?? 0,
                OtpCodeCount = otp != null ? 1 : 0,
                OtpUsed = otp?.Used,
                OtpAttempts = otp?.Attempts,
                ScanCount = scans.Count,
                OrphanScanCount = scans.Count(s => s.HouseholdId == null),
                AttachedScanCount = scans.Count(s => s.HouseholdId != null),
                FirstScanRefundCents = firstScan?.RefundCents,
                FirstScanStatus = firstScan?.Status,
                UsedScanTokenCount = usedTokens.Count,
                HouseholdCount = household != null ? 1 : 0,
                HouseholdId = household?.Id,
                HouseholdBinStatus = household?.BinStatus,
                HouseholdPendingContainers = household?.PendingContainers ?? 0,
                HouseholdPendingValueCents = household?.PendingValueCents ?? 0,
                BinCount = bin != null ? 1 : 0,
                BinCode = bin?.Code
            };
        });
    }
}
