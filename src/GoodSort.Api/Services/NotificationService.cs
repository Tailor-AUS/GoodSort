using Azure.Communication.Email;
using GoodSort.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Centralised transactional email sender — pickup reminders, post-pickup
/// confirmations, anything else we need to throw at Azure Communication Services.
/// </summary>
public class NotificationService
{
    private readonly GoodSortDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<NotificationService> _log;

    public NotificationService(GoodSortDbContext db, IConfiguration config, ILogger<NotificationService> log)
    { _db = db; _config = config; _log = log; }

    public async Task SendPickupConfirmation(Guid householdId)
    {
        var hh = await _db.Households.Include(h => h.Members).FirstOrDefaultAsync(h => h.Id == householdId);
        if (hh is null) return;

        var client = MakeClient();
        if (client is null) return;
        var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";

        // Show each member their share of the newly-cleared earnings (based on scans they contributed)
        foreach (var member in hh.Members.Where(m => !string.IsNullOrWhiteSpace(m.Email)))
        {
            var recentCleared = await _db.Scans
                .Where(s => s.UserId == member.Id && s.HouseholdId == hh.Id && s.Status == "cleared")
                .OrderByDescending(s => s.CreatedAt)
                .Take(200)
                .ToListAsync();
            var memberCleared = recentCleared.Sum(s => s.RefundCents);
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Bin collected ✨</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {member.Name}, we just picked up your yellow bin.</p>
                <div style='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:16px 0'>
                  <p style='font-size:12px;color:#166534;margin:0 0 4px;text-transform:uppercase;letter-spacing:.05em'>Available to cash out</p>
                  <p style='font-size:28px;font-weight:800;color:#166534;margin:0'>${member.ClearedCents / 100.0:F2}</p>
                  <p style='font-size:12px;color:#166534;margin:8px 0 0'>Cash out once you hit $20.</p>
                </div>
                <p style='font-size:13px;line-height:1.55'>Your council truck will be by shortly to grab whatever's left. Put the yellow bin back in tomorrow.</p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {hh.Address}</p>
              </div>";
            try
            {
                var msg = new EmailMessage(sender, member.Email!, new EmailContent("We picked up your bin — earnings updated") { Html = body });
                await client.SendAsync(Azure.WaitUntil.Started, msg);
            }
            catch (Exception ex) { _log.LogError(ex, "Pickup confirmation email failed for {Email}", member.Email); }
        }
    }

    private EmailClient? MakeClient()
    {
        var conn = _config["ACS_CONNECTION_STRING"];
        if (string.IsNullOrEmpty(conn)) { _log.LogWarning("ACS_CONNECTION_STRING not set — no email"); return null; }
        return new EmailClient(conn);
    }
}
