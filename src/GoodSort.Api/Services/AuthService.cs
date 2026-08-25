using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Azure.Communication.Email;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace GoodSort.Api.Services;

public class AuthService
{
    private readonly GoodSortDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<AuthService> _logger;
    private readonly IHostEnvironment _env;

    public AuthService(GoodSortDbContext db, IConfiguration config, ILogger<AuthService> logger, IHostEnvironment env)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _env = env;
    }

    public async Task<(bool Success, string? Error, string? DevCode)> SendOtp(string email)
    {
        // Rate limit: max 5 OTPs per email per hour
        var oneHourAgo = DateTime.UtcNow.AddHours(-1);
        var recentCount = await _db.OtpCodes.CountAsync(o => o.Email == email && o.CreatedAt > oneHourAgo);
        if (recentCount >= 5)
            return (false, "Too many requests. Try again in an hour.", null);

        // 6-digit code, cryptographically random — Random.Shared is not secure
        // enough for an auth credential. RandomNumberGenerator gives us a
        // uniform distribution over [100000, 1000000).
        var code = System.Security.Cryptography.RandomNumberGenerator
            .GetInt32(100000, 1000000).ToString();

        // Store only the HMAC of the code. JWT_SECRET keys the HMAC so a
        // DB-only leak can't be brute-forced against the 10^6 OTP space.
        var jwtSecret = _config["JWT_SECRET"]
            ?? throw new InvalidOperationException("JWT_SECRET must be configured");
        _db.OtpCodes.Add(new OtpCode
        {
            Email = email,
            CodeHash = OtpHash.Compute(code, jwtSecret),
            ExpiresAt = DateTime.UtcNow.AddMinutes(5),
        });
        await _db.SaveChangesAsync();

        // Send email
        var connectionString = _config["ACS_CONNECTION_STRING"];
        if (string.IsNullOrEmpty(connectionString))
        {
            if (!_env.IsDevelopment())
            {
                _logger.LogError("ACS_CONNECTION_STRING is not set — refusing OTP");
                return (false, "Email is not configured. Try again shortly.", null);
            }
            _logger.LogWarning("ACS_CONNECTION_STRING not set — OTP issued in Development only");
            return (true, null, code);
        }

        try
        {
            var client = new EmailClient(connectionString);
            var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";

            var content = new EmailContent("Your The Good Sort code")
            {
                Html = $@"
                    <div style='font-family: Inter, system-ui, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;'>
                        <div style='text-align: center; margin-bottom: 30px;'>
                            <div style='width: 48px; height: 48px; background: #16a34a; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;'>
                                <span style='color: white; font-size: 24px; font-weight: 800;'>G</span>
                            </div>
                        </div>
                        <h1 style='text-align: center; font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 8px;'>Your code</h1>
                        <p style='text-align: center; color: #64748b; font-size: 14px; margin-bottom: 24px;'>Enter this to start sorting today. We tell you when we collect.</p>
                        <div style='text-align: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;'>
                            <span style='font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0f172a;'>{code}</span>
                        </div>
                        <p style='text-align: center; color: #94a3b8; font-size: 12px;'>This code expires in 5 minutes</p>
                    </div>",
            };

            var message = new EmailMessage(sender, email, content);
            await client.SendAsync(Azure.WaitUntil.Started, message);
            _logger.LogInformation("OTP email sent to {Email}", email);
            return (true, null, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send OTP email to {Email}", email);
            return (false, "Failed to send email. Try again.", null);
        }
    }

    public async Task<(string? Token, Profile? Profile)> VerifyOtp(string email, string code, Guid? referrerId = null)
    {
        var otp = await _db.OtpCodes
            .Where(o => o.Email == email && !o.Used && o.ExpiresAt > DateTime.UtcNow)
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync();

        if (otp == null)
            return (null, null);

        // Rate limit: max 5 attempts per OTP
        otp.Attempts++;
        if (otp.Attempts > 5)
        {
            otp.Used = true;
            await _db.SaveChangesAsync();
            return (null, null);
        }

        var jwtSecret = _config["JWT_SECRET"]
            ?? throw new InvalidOperationException("JWT_SECRET must be configured");
        if (!OtpHash.Verify(code, otp.CodeHash, jwtSecret))
        {
            await _db.SaveChangesAsync();
            return (null, null);
        }

        // Mark as used
        otp.Used = true;
        await _db.SaveChangesAsync();

        // Find or create profile
        var profile = await _db.Profiles.FirstOrDefaultAsync(p => p.Email == email || p.Phone == email);
        if (profile == null)
        {
            var prefix = email.Split('@')[0].Replace('.', ' ').Replace('_', ' ').Replace('-', ' ');
            var displayName = System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(prefix);

            profile = new Profile
            {
                Name = displayName,
                Email = email,
                Phone = email, // Backward compat
                Role = "sorter",
                ReferrerId = referrerId,
            };
            _db.Profiles.Add(profile);
            await _db.SaveChangesAsync();
        }
        else if (referrerId is Guid rid
                 && rid != profile.Id
                 && profile.HouseholdId is null
                 && profile.ReferrerId is null)
        {
            // Neighbour invite after a first OTP (no household yet) still counts.
            profile.ReferrerId = rid;
            await _db.SaveChangesAsync();
        }

        if (ShouldPromoteSeedAdmin(
                profile.IsAdmin,
                await _db.Profiles.AnyAsync(p => p.IsAdmin),
                profile.Email,
                _config["ADMIN_SEED_EMAIL"]))
        {
            profile.IsAdmin = true;
            await _db.SaveChangesAsync();
            _logger.LogWarning("Seed admin: promoted {Email} ({Id}) because no admin existed", profile.Email, profile.Id);
        }

        var token = GenerateJwt(profile);
        return (token, profile);
    }

    /// <summary>
    /// First matching seed email becomes admin when the table has none.
    /// Set ADMIN_SEED_EMAIL on the Container App after ship; leave unset otherwise.
    /// </summary>
    public static bool ShouldPromoteSeedAdmin(bool profileIsAdmin, bool anyAdminExists, string? profileEmail, string? seedEmail)
    {
        if (profileIsAdmin || anyAdminExists) return false;
        if (string.IsNullOrWhiteSpace(seedEmail) || string.IsNullOrWhiteSpace(profileEmail)) return false;
        return string.Equals(profileEmail.Trim(), seedEmail.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    public string GenerateJwt(Profile profile)
    {
        var key = _config["JWT_SECRET"] ?? throw new InvalidOperationException("JWT_SECRET must be configured");
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, profile.Id.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("email", profile.Email ?? profile.Phone ?? ""),
            new("name", profile.Name),
            new("role", profile.Role),
        };
        // Admin is its own claim — admin endpoints check this, not the user-facing Role.
        if (profile.IsAdmin) claims.Add(new Claim("role", "admin"));

        var token = new JwtSecurityToken(
            issuer: "goodsort-api",
            audience: "goodsort-app",
            claims: claims,
            expires: DateTime.UtcNow.AddDays(30),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
