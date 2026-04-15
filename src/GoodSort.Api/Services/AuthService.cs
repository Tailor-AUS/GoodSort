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

    public AuthService(GoodSortDbContext db, IConfiguration config, ILogger<AuthService> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    public async Task<(bool Success, string? Error)> SendOtp(string email)
    {
        // Rate limit: max 5 OTPs per email per hour
        var oneHourAgo = DateTime.UtcNow.AddHours(-1);
        var recentCount = await _db.OtpCodes.CountAsync(o => o.Email == email && o.CreatedAt > oneHourAgo);
        if (recentCount >= 5)
            return (false, "Too many requests. Try again in an hour.");

        var code = Random.Shared.Next(100000, 999999).ToString();

        // Store in database
        _db.OtpCodes.Add(new OtpCode
        {
            Email = email,
            Code = code,
            ExpiresAt = DateTime.UtcNow.AddMinutes(5),
        });
        await _db.SaveChangesAsync();

        // Send email
        var connectionString = _config["ACS_CONNECTION_STRING"];
        if (string.IsNullOrEmpty(connectionString))
        {
            _logger.LogWarning("ACS_CONNECTION_STRING not set — OTP for {Email}: {Code}", email, code);
            return (true, null);
        }

        try
        {
            var client = new EmailClient(connectionString);
            var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";

            var content = new EmailContent("Your Good Sort verification code")
            {
                Html = $@"
                    <div style='font-family: Inter, system-ui, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;'>
                        <div style='text-align: center; margin-bottom: 30px;'>
                            <div style='width: 48px; height: 48px; background: #16a34a; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;'>
                                <span style='color: white; font-size: 24px; font-weight: 800;'>G</span>
                            </div>
                        </div>
                        <h1 style='text-align: center; font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 8px;'>Your verification code</h1>
                        <p style='text-align: center; color: #64748b; font-size: 14px; margin-bottom: 24px;'>Enter this code in The Good Sort app</p>
                        <div style='text-align: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;'>
                            <span style='font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0f172a;'>{code}</span>
                        </div>
                        <p style='text-align: center; color: #94a3b8; font-size: 12px;'>This code expires in 5 minutes</p>
                    </div>",
            };

            var message = new EmailMessage(sender, email, content);
            await client.SendAsync(Azure.WaitUntil.Started, message);
            _logger.LogInformation("OTP email sent to {Email}", email);
            return (true, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send OTP email to {Email}", email);
            return (false, "Failed to send email. Try again.");
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

        if (otp.Code != code)
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

        var token = GenerateJwt(profile);
        return (token, profile);
    }

    public string GenerateJwt(Profile profile)
    {
        var key = _config["JWT_SECRET"] ?? throw new InvalidOperationException("JWT_SECRET must be configured");
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, profile.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim("email", profile.Phone ?? ""),
            new Claim("name", profile.Name),
            new Claim("role", profile.Role),
        };

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
