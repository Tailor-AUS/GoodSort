namespace GoodSort.Api.Data.Entities;

public class OtpCode
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    /// <summary>
    /// HMAC(JWT_SECRET, code) — never the plaintext code. See OtpHash in Services/AuthHelpers.cs.
    /// </summary>
    public string CodeHash { get; set; } = "";
    public int Attempts { get; set; } = 0;
    public DateTime ExpiresAt { get; set; }
    public bool Used { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
