using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Azure.Communication.Sms;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace GoodSort.Api.Services;

public class AuthService
{
    // In-memory OTP store (use Redis in production at scale)
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

    public async Task<bool> SendOtp(string phone)
    {
        // Generate 6-digit code
        var code = Random.Shared.Next(100000, 999999).ToString();
        _otpStore[phone] = (code, DateTime.UtcNow.AddMinutes(5));

        // Send via Azure Communication Services
        var connectionString = _config["ACS_CONNECTION_STRING"];
        if (string.IsNullOrEmpty(connectionString))
        {
            _logger.LogWarning("ACS_CONNECTION_STRING not set — OTP code for {Phone}: {Code}", phone, code);
            return true; // Dev mode: log the code
        }

        try
        {
            var smsClient = new SmsClient(connectionString);
            var from = _config["ACS_PHONE_NUMBER"] ?? "+18558474356";
            await smsClient.SendAsync(from, phone, $"Your Good Sort code is: {code}");
            _logger.LogInformation("OTP sent to {Phone}", phone);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send OTP to {Phone}", phone);
            return false;
        }
    }

    public async Task<(string? Token, Profile? Profile)> VerifyOtp(string phone, string code)
    {
        if (!_otpStore.TryGetValue(phone, out var stored))
            return (null, null);

        if (stored.Expiry < DateTime.UtcNow || stored.Code != code)
            return (null, null);

        _otpStore.TryRemove(phone, out _);

        // Find or create profile
        var profile = await _db.Profiles.FirstOrDefaultAsync(p => p.Phone == phone);
        if (profile == null)
        {
            profile = new Profile
            {
                Name = "New User",
                Phone = phone,
                Role = "sorter",
            };
            _db.Profiles.Add(profile);
            await _db.SaveChangesAsync();
        }

        // Generate JWT
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
            new Claim("phone", profile.Phone ?? ""),
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
