using Azure.Communication.Email;
using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
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

    public async Task SendWaitlistJoined(string email, string? name, Household hh, int households, int needed, Guid? profileId = null)
    {
        var place = TitleSuburb(hh.Suburb);
        var invite = InviteLink.StreetUrl(hh.Suburb, hh.CouncilCollectionDay, profileId);
        var hello = string.IsNullOrWhiteSpace(name) ? "there" : name;
        var dayName = DayName(hh.CouncilCollectionDay);
        var status = needed <= 0
            ? $"<b>{place}</b> {dayName} now has enough neighbours on the same recycling day. We'll tell you when we collect."
            : $"<b>{households}</b> household{(households == 1 ? "" : "s")} on the {dayName} list in {place}. <b>{needed}</b> more on that recycling day and we start the collection night.";
        var subject = needed <= 0
            ? $"Start sorting — {place} {dayName} can unlock"
            : $"Start sorting today in {place}";
        var body = $@"
          <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
            <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Start sorting today</h1>
            <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
            <p style='font-size:14px;line-height:1.55'>You're on the street list at <b>{hh.Address}</b>. Sort eligible cans and bottles at home — four streams, you manage them.</p>
            <p style='font-size:14px;line-height:1.55'>{status}</p>
            <p style='font-size:14px;line-height:1.55'>We'll tell you the night we collect — the night before {dayName} recycling.</p>
            <p style='font-size:14px;margin:20px 0 8px'><a href='{WhatsAppInvite(place, invite, dayName)}' style='display:inline-block;background:#25D366;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>WhatsApp the street</a></p>
            <p style='font-size:13px;margin:0 0 20px'><a href='{invite}' style='color:#16a34a;font-weight:600'>Or copy your street link →</a></p>
            <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · Brisbane</p>
          </div>";
        await Send(email, subject, body);
    }

    public async Task SendBuildingWaitlisted(string email, string? name, Household hh, Guid? profileId = null)
    {
        var place = TitleSuburb(hh.Suburb);
        var invite = InviteLink.StreetUrl(hh.Suburb, null, profileId);
        var hello = string.IsNullOrWhiteSpace(name) ? "there" : name;
        var building = string.IsNullOrWhiteSpace(hh.BuildingName) ? hh.Name : hh.BuildingName;
        var body = $@"
          <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
            <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>You're on the building list</h1>
            <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
            <p style='font-size:14px;line-height:1.55'>Request received for <b>{building}</b> at <b>{hh.Address}</b>.</p>
            <p style='font-size:14px;line-height:1.55'>{DensityEmailCopy.BuildingInviteLine(place)}</p>
            <p style='font-size:14px;margin:20px 0 8px'><a href='{WhatsAppInvite(place, invite)}' style='display:inline-block;background:#25D366;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>WhatsApp the street</a></p>
            <p style='font-size:13px;margin:0 0 20px'><a href='{invite}' style='color:#16a34a;font-weight:600'>Or copy your street link →</a></p>
            <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {place}</p>
          </div>";
        await Send(email, $"Building list in {place}", body);
    }

    public async Task SendAreaUnlocked(string suburb, int day)
    {
        var place = TitleSuburb(suburb);
        var dayName = DayName(day);
        var members = await _db.Profiles
            .Include(p => p.Household)
            .Where(p => p.Household != null
                        && p.Household.Type == "residential"
                        && p.Household.Suburb != null
                        && p.Household.Suburb.ToUpper() == suburb.ToUpper()
                        && p.Household.CouncilCollectionDay == day
                        && !string.IsNullOrWhiteSpace(p.Email))
            .ToListAsync();

        foreach (var member in members)
        {
            var hello = string.IsNullOrWhiteSpace(member.Name) ? "there" : member.Name;
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>{place} {dayName} has enough neighbours</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
                <p style='font-size:14px;line-height:1.55'>{DensityEmailCopy.UnlockLine(place, dayName)}</p>
                <p style='font-size:14px;line-height:1.55'>Invite the rest of the street so the first night is dense. Keep sorting today.</p>
                <p style='font-size:14px;margin:20px 0 8px'><a href='{WhatsAppInvite(place, InviteLink.StreetUrl(suburb, day, member.Id), dayName)}' style='display:inline-block;background:#25D366;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>WhatsApp the street</a></p>
                <p style='font-size:13px;margin:0 0 20px'><a href='{InviteLink.StreetUrl(suburb, day, member.Id)}' style='color:#16a34a;font-weight:600'>Or copy your street link →</a></p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {place}</p>
              </div>";
            await Send(member.Email!, DensityEmailCopy.UnlockSubject(place, dayName), body);
        }
    }

    public async Task SendOpsStreetReady(string suburb, int day)
    {
        var to = OpsAlert.Inbox(_config["OPS_ALERT_EMAIL"], _config["ADMIN_SEED_EMAIL"]);
        if (to is null)
        {
            _log.LogWarning("Street unlocked {Suburb} day={Day} — set ADMIN_SEED_EMAIL or OPS_ALERT_EMAIL so ops can buy bins", suburb, day);
            return;
        }
        var place = TitleSuburb(suburb);
        var dayName = DayName(day);
        var body = $@"
          <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
            <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>{place} {dayName} hit 12</h1>
            <p style='font-size:14px;line-height:1.55'>Twelve residential households on the same recycling day. That is enough to buy purple bins for that night only — not the suburb, not the city.</p>
            <p style='font-size:14px;margin:20px 0'><a href='https://thegoodsort.org/admin/waitlist' style='display:inline-block;background:#6d28d9;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>Open the waitlist</a></p>
            <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · ops</p>
          </div>";
        await Send(to, $"{place} {dayName}: buy bins", body);
    }

    public async Task SendWaitlistProgress(string suburb, int day, int households, int needed, Guid? excludeProfileId)
    {
        if (!WaitlistNudge.ShouldNudgeOthers(households, live: false)) return;

        var place = TitleSuburb(suburb);
        var dayName = DayName(day);
        var members = await _db.Profiles
            .Include(p => p.Household)
            .Where(p => p.Household != null
                        && p.Household.Type == "residential"
                        && p.Household.Suburb != null
                        && p.Household.Suburb.ToUpper() == suburb.ToUpper()
                        && p.Household.CouncilCollectionDay == day
                        && p.Household.BinStatus == BinStatuses.Waitlisted
                        && !string.IsNullOrWhiteSpace(p.Email))
            .ToListAsync();

        foreach (var member in WaitlistNudge.Recipients(members, excludeProfileId))
        {
            var hello = string.IsNullOrWhiteSpace(member.Name) ? "there" : member.Name;
            var invite = InviteLink.StreetUrl(suburb, day, member.Id);
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>{place} {dayName} moved</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
                <p style='font-size:14px;line-height:1.55'>{DensityEmailCopy.ProgressLine(households, dayName, place, needed)}</p>
                <p style='font-size:14px;line-height:1.55'>{DensityEmailCopy.ProgressInviteLine}</p>
                <p style='font-size:14px;margin:20px 0 8px'><a href='{WhatsAppProgress(place, dayName, households, needed, invite)}' style='display:inline-block;background:#25D366;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>WhatsApp the street</a></p>
                <p style='font-size:13px;margin:0 0 20px'><a href='{invite}' style='color:#16a34a;font-weight:600'>Or copy your street link →</a></p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {place}</p>
              </div>";
            await Send(member.Email!, DensityEmailCopy.ProgressSubject(place, dayName, needed), body);
        }
    }

    public async Task SendBinsOnOrder(string suburb, int? day = null)
    {
        var place = TitleSuburb(suburb);
        var dayName = DayName(day);
        var q = _db.Profiles
            .Include(p => p.Household)
            .Where(p => p.Household != null
                        && p.Household.Type == "residential"
                        && p.Household.Suburb != null
                        && p.Household.Suburb.ToUpper() == suburb.ToUpper()
                        && p.Household.BinStatus == BinStatuses.Allocated
                        && !string.IsNullOrWhiteSpace(p.Email));
        if (day is int d) q = q.Where(p => p.Household!.CouncilCollectionDay == d);
        var members = await q.ToListAsync();

        foreach (var member in members)
        {
            var hello = string.IsNullOrWhiteSpace(member.Name) ? "there" : member.Name;
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Your purple bin is on order</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
                <p style='font-size:14px;line-height:1.55'>We're buying The Good Sort bins for {place}{(day is null ? "" : $" {dayName} recycling")}. Keep sorting in your own bags. We'll tell you when yours is delivered.</p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {place}</p>
              </div>";
            await Send(member.Email!, $"Purple bins on order for {place}", body);
        }
    }

    public async Task SendCollectingNow(Household hh)
    {
        var place = TitleSuburb(hh.Suburb);
        await _db.Entry(hh).Collection(h => h.Members).LoadAsync();
        foreach (var member in hh.Members.Where(m => !string.IsNullOrWhiteSpace(m.Email)))
        {
            var hello = string.IsNullOrWhiteSpace(member.Name) ? "there" : member.Name;
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>We're collecting in {place}</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
                <p style='font-size:14px;line-height:1.55'>Your purple The Good Sort bin is ready. Put it on the kerb the night before council recycling. Eligible cans and bottles go in our bin — not the yellow one.</p>
                <p style='font-size:14px;margin:20px 0'><a href='https://thegoodsort.org/household' style='color:#16a34a;font-weight:600'>Open your household →</a></p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {hh.Address}</p>
              </div>";
            await Send(member.Email!, $"The Good Sort is collecting in {place}", body);
        }
    }

    public async Task SendPickupConfirmation(Guid householdId)
    {
        var hh = await _db.Households.Include(h => h.Members).FirstOrDefaultAsync(h => h.Id == householdId);
        if (hh is null) return;

        var client = MakeClient();
        if (client is null) return;
        var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";

        // Show each member their cleared (cash-out-eligible) balance.
        foreach (var member in hh.Members.Where(m => !string.IsNullOrWhiteSpace(m.Email)))
        {
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Bin collected ✨</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {member.Name}, we just collected your purple The Good Sort bin.</p>
                <div style='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:16px 0'>
                  <p style='font-size:12px;color:#166534;margin:0 0 4px;text-transform:uppercase;letter-spacing:.05em'>Sorting credit on your account</p>
                  <p style='font-size:28px;font-weight:800;color:#166534;margin:0'>${member.ClearedCents / 100.0:F2}</p>
                  <p style='font-size:12px;color:#166534;margin:8px 0 0'>From the runner count at pickup. Bank transfer from $20 once payouts are live.</p>
                </div>
                <p style='font-size:13px;line-height:1.55'>Bring the purple bin back in when you&apos;re ready. Council still empties your yellow recycling bin as usual.</p>
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

    private async Task Send(string to, string subject, string html)
    {
        var client = MakeClient();
        if (client is null) return;
        var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";
        try
        {
            var msg = new EmailMessage(sender, to, new EmailContent(subject) { Html = html });
            await client.SendAsync(Azure.WaitUntil.Started, msg);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Waitlist email failed for {Email} ({Subject})", to, subject);
        }
    }

    private EmailClient? MakeClient()
    {
        var conn = _config["ACS_CONNECTION_STRING"];
        if (string.IsNullOrEmpty(conn)) { _log.LogWarning("ACS_CONNECTION_STRING not set — no email"); return null; }
        return new EmailClient(conn);
    }

    private static string DayName(int? day) => InviteLink.PublicDayName(day) ?? "recycling day";

    private static string TitleSuburb(string? suburb)
    {
        if (string.IsNullOrWhiteSpace(suburb)) return "your suburb";
        return string.Join(' ', suburb.ToLowerInvariant()
            .Split(new[] { ' ', '-' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(w => char.ToUpperInvariant(w[0]) + w[1..]));
    }

    private static string WhatsAppInvite(string place, string inviteUrl, string? dayName = null)
    {
        var day = string.IsNullOrWhiteSpace(dayName) || dayName == "recycling day" ? "the same recycling day" : dayName;
        var text = $"Start sorting with The Good Sort in {place}. 12 neighbours on {day} start the collection night: {inviteUrl}";
        return $"https://wa.me/?text={Uri.EscapeDataString(text)}";
    }

    private static string WhatsAppProgress(string place, string dayName, int households, int needed, string inviteUrl)
    {
        var text = $"{households} household{(households == 1 ? "" : "s")} sorting on {dayName} in {place}. {needed} more on that recycling day start the collection night: {inviteUrl}";
        return $"https://wa.me/?text={Uri.EscapeDataString(text)}";
    }
}
