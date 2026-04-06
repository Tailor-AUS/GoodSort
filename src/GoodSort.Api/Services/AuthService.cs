using System.Collections.Concurrent;
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
    private static readonly ConcurrentDictionary<string, (string Code, DateTime Expiry)> _otpStore = new();

    private readonly GoodSortDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<AuthService> _logger;

    public AuthService(GoodSortDbContext db, IConfiguration config, ILogger<AuthService> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    public async Task<bool> SendOtp(string email)
    {
        var code = Random.Shared.Next(100000, 999999).ToString();
        _otpStore[email.ToLower()] = (code, DateTime.UtcNow.AddMinutes(5));

        var connectionString = _config["ACS_CONNECTION_STRING"];
        if (string.IsNullOrEmpty(connectionString))
        {
            _logger.LogWarning("ACS_CONNECTION_STRING not set — OTP for {Email}: {Code}", email, code);
            return true;
        }

        try
        {
            var client = new EmailClient(connectionString);
            var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@tailor.au";

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
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send OTP email to {Email}", email);
            return false;
        }
    }

    public async Task<(string? Token, Profile? Profile)> VerifyOtp(string email, string code)
    {
        var key = email.ToLower();
        if (!_otpStore.TryGetValue(key, out var stored))
            return (null, null);

        if (stored.Expiry < DateTime.UtcNow || stored.Code != code)
            return (null, null);

        _otpStore.TryRemove(key, out _);

        var profile = await _db.Profiles.FirstOrDefaultAsync(p => p.Phone == key);
        if (profile == null)
        {
            profile = new Profile
            {
                Name = "New User",
                Phone = key, // Using Phone field for email (reusing existing schema)
                Role = "sorter",
            };
            _db.Profiles.Add(profile);
            await _db.SaveChangesAsync();
        }

        var token = GenerateJwt(profile);
        return (token, profile);
    }

    public string GenerateJwt(Profile profile)
    {
        var key = _config["JWT_SECRET"] ?? "goodsort-dev-secret-key-min-32-chars!!";
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
