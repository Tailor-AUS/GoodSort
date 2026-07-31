using Azure.Communication.Email;
using GoodSort.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Centralised email sender — transactional (OTP/pickup) plus admin outreach
/// via Azure Communication Services on thegoodsort.org.
/// </summary>
public class NotificationService
{
    private readonly GoodSortDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<NotificationService> _log;

    public NotificationService(GoodSortDbContext db, IConfiguration config, ILogger<NotificationService> log)
    { _db = db; _config = config; _log = log; }

    /// <summary>
    /// Default From address for transactional mail. Outreach may override via
    /// ACS_OUTREACH_SENDER (e.g. hello@ / admin@) when those MailFroms exist.
    /// </summary>
    public string DefaultSender =>
        _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";

    public string OutreachSender =>
        _config["ACS_OUTREACH_SENDER"]
        ?? _config["ACS_EMAIL_SENDER"]
        ?? "DoNotReply@thegoodsort.org";

    public async Task SendPickupConfirmation(Guid householdId)
    {
        var hh = await _db.Households.Include(h => h.Members).FirstOrDefaultAsync(h => h.Id == householdId);
        if (hh is null) return;

        var client = MakeClient();
        if (client is null) return;
        var sender = DefaultSender;

        // Show each member their cleared (cash-out-eligible) balance.
        foreach (var member in hh.Members.Where(m => !string.IsNullOrWhiteSpace(m.Email)))
        {
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

    /// <summary>
    /// Send an arbitrary email (founder outreach, COEX follow-ups, etc.).
    /// Returns null on success, or an error string.
    /// </summary>
    public async Task<string?> SendOutreachAsync(OutreachEmailRequest req)
    {
        var client = MakeClient();
        if (client is null) return "ACS_CONNECTION_STRING not configured";

        if (string.IsNullOrWhiteSpace(req.To) || !req.To.Contains('@'))
            return "Invalid recipient";
        if (string.IsNullOrWhiteSpace(req.Subject))
            return "Subject required";
        if (string.IsNullOrWhiteSpace(req.HtmlBody) && string.IsNullOrWhiteSpace(req.PlainBody))
            return "Body required";

        var from = string.IsNullOrWhiteSpace(req.From) ? OutreachSender : req.From.Trim();
        // Only allow sending from our domain — stops accidental spoofing via the admin endpoint.
        if (!from.EndsWith("@thegoodsort.org", StringComparison.OrdinalIgnoreCase))
            return "From address must be @thegoodsort.org";

        var content = new EmailContent(req.Subject.Trim());
        if (!string.IsNullOrWhiteSpace(req.HtmlBody)) content.Html = req.HtmlBody;
        if (!string.IsNullOrWhiteSpace(req.PlainBody)) content.PlainText = req.PlainBody;
        // ACS requires at least one of Html/PlainText; if only HTML given, also set a stripped fallback.
        if (string.IsNullOrWhiteSpace(content.PlainText) && !string.IsNullOrWhiteSpace(content.Html))
            content.PlainText = System.Text.RegularExpressions.Regex.Replace(content.Html, "<[^>]+>", " ");

        var msg = new EmailMessage(from, req.To.Trim(), content);
        // Azure.Communication.Email 1.1.0 has no SenderDisplayName on EmailMessage;
        // display name is set at the ACS MailFrom (senderUsername) resource instead.
        // Prefer ACS_OUTREACH_SENDER=hello@ / admin@ with a friendly displayName there.

        foreach (var cc in req.Cc ?? [])
        {
            if (!string.IsNullOrWhiteSpace(cc) && cc.Contains('@'))
                msg.Recipients.CC.Add(new EmailAddress(cc.Trim()));
        }
        foreach (var replyTo in req.ReplyTo ?? [])
        {
            if (!string.IsNullOrWhiteSpace(replyTo) && replyTo.Contains('@'))
                msg.ReplyTo.Add(new EmailAddress(replyTo.Trim()));
        }

        try
        {
            var op = await client.SendAsync(Azure.WaitUntil.Started, msg);
            _log.LogInformation("Outreach email queued to {To} subject={Subject} op={OpId}",
                req.To, req.Subject, op.Id);
            return null;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Outreach email failed to {To}", req.To);
            return ex.Message;
        }
    }

    private EmailClient? MakeClient()
    {
        var conn = _config["ACS_CONNECTION_STRING"];
        if (string.IsNullOrEmpty(conn)) { _log.LogWarning("ACS_CONNECTION_STRING not set — no email"); return null; }
        return new EmailClient(conn);
    }
}

public record OutreachEmailRequest(
    string To,
    string Subject,
    string? HtmlBody = null,
    string? PlainBody = null,
    string? From = null,
    string? SenderDisplayName = null,
    IReadOnlyList<string>? Cc = null,
    IReadOnlyList<string>? ReplyTo = null);

