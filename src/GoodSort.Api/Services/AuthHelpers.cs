using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GoodSort.Api.Services;

/// <summary>
/// Centralised auth helpers. The pattern across the API is: never trust a
/// userId / profileId / driverId coming from the request body — read it from
/// the JWT sub claim instead. Otherwise an authenticated user A can pass
/// userId=B in the body and act on B's account.
/// </summary>
public static class AuthHelpers
{
    public const string AdminPolicy = "Admin";

    /// <summary>
    /// Returns the caller's profile id from the JWT sub claim, or null when
    /// the request isn't authenticated. Use this everywhere instead of trusting
    /// a userId / profileId / driverId field in the request body.
    /// </summary>
    public static Guid? GetCallerId(this HttpContext ctx)
    {
        var sub = ctx.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                  ?? ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    /// <summary>True when the caller's JWT carries the "admin" role claim.</summary>
    public static bool IsAdmin(this HttpContext ctx) =>
        ctx.User.FindAll("role").Any(c => c.Value == "admin")
        || ctx.User.IsInRole("admin");

    /// <summary>True when the caller is either the resource owner or an admin.</summary>
    public static bool IsOwnerOrAdmin(this HttpContext ctx, Guid ownerId) =>
        ctx.GetCallerId() == ownerId || ctx.IsAdmin();
}

/// <summary>
/// HMAC-signed token bundle for transient state we need the client to round-trip
/// without us trusting them on the way back. Used by /api/scan/photo (server
/// returns a token committing to the vision result) and /confirm (server reads
/// items from the token, never from the client body).
///
/// Token format: base64url(payload).base64url(hmac_sha256(secret, payload))
/// Payload is a UTF-8 JSON object including an "exp" unix-seconds claim.
/// </summary>
public class ScanTokenService
{
    private readonly byte[] _key;

    public ScanTokenService(IConfiguration config)
    {
        // Reuse JWT_SECRET — same trust boundary, one secret to rotate.
        var jwtSecret = config["JWT_SECRET"]
            ?? throw new InvalidOperationException("JWT_SECRET must be configured");
        _key = Encoding.UTF8.GetBytes(jwtSecret);
    }

    public string Issue(ScanTokenPayload payload, TimeSpan ttl)
    {
        payload.Exp = DateTimeOffset.UtcNow.Add(ttl).ToUnixTimeSeconds();
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        var sig = HMACSHA256.HashData(_key, json);
        return $"{Base64Url(json)}.{Base64Url(sig)}";
    }

    public ScanTokenPayload? Verify(string? token)
    {
        if (string.IsNullOrEmpty(token)) return null;
        var parts = token.Split('.');
        if (parts.Length != 2) return null;

        byte[] payload, sig;
        try
        {
            payload = FromBase64Url(parts[0]);
            sig = FromBase64Url(parts[1]);
        }
        catch { return null; }

        var expected = HMACSHA256.HashData(_key, payload);
        if (!CryptographicOperations.FixedTimeEquals(sig, expected)) return null;

        ScanTokenPayload? parsed;
        try { parsed = JsonSerializer.Deserialize<ScanTokenPayload>(payload); }
        catch { return null; }
        if (parsed is null) return null;

        if (DateTimeOffset.FromUnixTimeSeconds(parsed.Exp) < DateTimeOffset.UtcNow) return null;
        return parsed;
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] FromBase64Url(string s)
    {
        var padded = s.Replace('-', '+').Replace('_', '/');
        padded = (padded.Length % 4) switch
        {
            2 => padded + "==",
            3 => padded + "=",
            _ => padded,
        };
        return Convert.FromBase64String(padded);
    }
}

public class ScanTokenPayload
{
    public Guid Uid { get; set; }
    public List<ScanTokenItem> Items { get; set; } = [];
    public long Exp { get; set; }
}

public class ScanTokenItem
{
    public string Name { get; set; } = "";
    public string Material { get; set; } = "";
    public int Count { get; set; }
    public bool Eligible { get; set; }
}

/// <summary>
/// Hash helpers for OTP codes — DB at rest must not contain plaintext OTPs.
/// HMAC keyed by JWT_SECRET so a DB-only leak doesn't yield brute-forceable
/// 6-digit hashes (search space is only 10^6 — needs a key).
/// </summary>
public static class OtpHash
{
    public static string Compute(string code, string secret)
    {
        var sig = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(code));
        return Convert.ToBase64String(sig);
    }

    public static bool Verify(string code, string hash, string secret)
    {
        var actual = Compute(code, secret);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(actual),
            Encoding.UTF8.GetBytes(hash));
    }
}
