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

    public async Task SendWaitlistJoined(string email, string? name, Household hh, int containers, int needed, Guid? profileId = null)
    {
        var place = TitleSuburb(hh.Suburb);
        var invite = InviteLink.StreetUrl(hh.Suburb, hh.CouncilCollectionDay, profileId);
        var hello = string.IsNullOrWhiteSpace(name) ? "there" : name;
        var status = needed <= 0
            ? $"<b>{place}</b> has enough scanned volume for a driver trip. We'll tell you when to bag out."
            : $"<b>{containers}</b> container{(containers == 1 ? "" : "s")} scanned in {place}. <b>{needed}</b> more and we run a driver trip to the refund point.";
        var subject = needed <= 0
            ? $"{place} volume run is ready — bag out when we say"
            : $"Scan today in {place} — 5¢ each";
        var body = $@"
          <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
            <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Scan. Earn 5¢.</h1>
            <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
            <p style='font-size:14px;line-height:1.55'>You're on the list at <b>{hh.Address}</b>. Scan eligible cans and bottles — sort into four streams at home.</p>
            <p style='font-size:14px;line-height:1.55'>{status}</p>
            <p style='font-size:14px;line-height:1.55'>Invite neighbours to scan. Volume unlocks the run — not city-wide totals.</p>
            <p style='font-size:14px;margin:20px 0 8px'><a href='{WhatsAppInvite(place, invite, containers, needed)}' style='display:inline-block;background:#25D366;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>WhatsApp the street</a></p>
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
            <p style='font-size:14px;line-height:1.55'>Common-area pickups are phase 2. Invite houses on the street to scan — suburb volume unlocks a run first.</p>
            <p style='font-size:14px;margin:20px 0 8px'><a href='{WhatsAppInvite(place, invite)}' style='display:inline-block;background:#25D366;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>WhatsApp the street</a></p>
            <p style='font-size:13px;margin:0 0 20px'><a href='{invite}' style='color:#16a34a;font-weight:600'>Or copy your street link →</a></p>
            <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {place}</p>
          </div>";
        await Send(email, $"Building waitlist in {place}", body);
    }

    public async Task SendAreaUnlocked(string suburb, int day, Guid? excludeProfileId = null)
    {
        var place = TitleSuburb(suburb);
        var members = await _db.Profiles
            .Include(p => p.Household)
            .Where(p => p.Household != null
                        && p.Household.Type == "residential"
                        && p.Household.Suburb != null
                        && p.Household.Suburb.ToUpper() == suburb.ToUpper()
                        && !string.IsNullOrWhiteSpace(p.Email))
            .ToListAsync();

        // The person whose scan crossed the threshold sees it in-app; mailing
        // them "your area unlocked" reads as a mistake.
        foreach (var member in WaitlistNudge.Recipients(members, excludeProfileId))
        {
            var hello = string.IsNullOrWhiteSpace(member.Name) ? "there" : member.Name;
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>{place} has enough volume</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
                <p style='font-size:14px;line-height:1.55'>{place} has about {WaitlistDensity.LiveThreshold} scanned containers — enough for one driver trip. We'll email you when to bag out sorted containers on the kerb.</p>
                <p style='font-size:14px;line-height:1.55'>Invite neighbours to keep scanning so the first trip is full.</p>
                <p style='font-size:14px;margin:20px 0 8px'><a href='{WhatsAppInvite(place, InviteLink.StreetUrl(suburb, day, member.Id))}' style='display:inline-block;background:#25D366;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>WhatsApp the street</a></p>
                <p style='font-size:13px;margin:0 0 20px'><a href='{InviteLink.StreetUrl(suburb, day, member.Id)}' style='color:#16a34a;font-weight:600'>Or copy your street link →</a></p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {place}</p>
              </div>";
            await Send(member.Email!, $"{place} volume run unlocked", body);
        }
    }

    public async Task SendOpsStreetReady(string suburb, int day)
    {
        var to = OpsAlert.Inbox(_config["OPS_ALERT_EMAIL"], _config["ADMIN_SEED_EMAIL"]);
        if (to is null)
        {
            _log.LogWarning("Suburb volume unlocked {Suburb} day={Day} — set ADMIN_SEED_EMAIL or OPS_ALERT_EMAIL so ops can schedule a run", suburb, day);
            return;
        }
        var place = TitleSuburb(suburb);
        var body = $@"
          <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
            <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>{place} hit volume threshold</h1>
            <p style='font-size:14px;line-height:1.55'>About {WaitlistDensity.LiveThreshold} scanned containers in {place} — enough for one driver trip. Suburb volume only; city-wide totals never unlock.</p>
            <p style='font-size:14px;margin:20px 0'><a href='https://thegoodsort.org/admin/waitlist' style='display:inline-block;background:#6d28d9;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>Open the waitlist</a></p>
            <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · ops</p>
          </div>";
        await Send(to, $"{place}: schedule volume run", body);
    }

    public async Task SendWaitlistProgress(string suburb, int day, int containers, int needed, Guid? excludeProfileId)
    {
        if (!WaitlistNudge.ShouldNudgeOthers(containers, live: false)) return;

        var place = TitleSuburb(suburb);
        var members = await _db.Profiles
            .Include(p => p.Household)
            .Where(p => p.Household != null
                        && p.Household.Type == "residential"
                        && p.Household.Suburb != null
                        && p.Household.Suburb.ToUpper() == suburb.ToUpper()
                        && p.Household.BinStatus == BinStatuses.Waitlisted
                        && !string.IsNullOrWhiteSpace(p.Email))
            .ToListAsync();

        var nudgeAt = DateTime.UtcNow;
        var nudged = WaitlistNudge.NudgeRecipients(members, excludeProfileId, nudgeAt);
        foreach (var member in nudged)
        {
            var hello = string.IsNullOrWhiteSpace(member.Name) ? "there" : member.Name;
            var invite = InviteLink.StreetUrl(suburb, day, member.Id);
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>{place} volume moved</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
                <p style='font-size:14px;line-height:1.55'><b>{containers}</b> container{(containers == 1 ? "" : "s")} scanned in {place}. <b>{needed}</b> more and we run a driver trip to the refund point.</p>
                <p style='font-size:14px;line-height:1.55'>A neighbour just joined. WhatsApp the street again — that is how volume builds.</p>
                <p style='font-size:14px;margin:20px 0 8px'><a href='{WhatsAppProgress(place, containers, needed, invite)}' style='display:inline-block;background:#25D366;color:#fff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:12px'>WhatsApp the street</a></p>
                <p style='font-size:13px;margin:0 0 20px'><a href='{invite}' style='color:#16a34a;font-weight:600'>Or copy your street link →</a></p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {place}</p>
              </div>";
            await Send(member.Email!, $"{place}: {needed} more containers for a run", body);
            member.LastNudgedAt = nudgeAt;
        }

        // Stamp once, after the batch. Without this the cooldown never engages
        // and the fan-out stays quadratic in suburb size.
        if (nudged.Count > 0) await _db.SaveChangesAsync();
    }

    public async Task SendBinsOnOrder(string suburb, int? day = null)
    {
        var place = TitleSuburb(suburb);
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
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Volume run is scheduled</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
                <p style='font-size:14px;line-height:1.55'>We're scheduling a driver trip for {place}. We'll tell you when to bag out your sorted containers.</p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {place}</p>
              </div>";
            await Send(member.Email!, $"Volume run scheduled for {place}", body);
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
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Bag out in {place}</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {hello},</p>
                <p style='font-size:14px;line-height:1.55'>We're collecting sorted containers in {place}. Bag out eligible cans and bottles on the kerb when we tell you. We take them to a refund point or depot.</p>
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

        foreach (var member in hh.Members.Where(m => !string.IsNullOrWhiteSpace(m.Email)))
        {
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Containers collected ✨</h1>
                <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {member.Name}, we just collected your sorted containers.</p>
                <div style='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:16px 0'>
                  <p style='font-size:12px;color:#166534;margin:0 0 4px;text-transform:uppercase;letter-spacing:.05em'>Sorting credit on your account</p>
                  <p style='font-size:28px;font-weight:800;color:#166534;margin:0'>${member.ClearedCents / 100.0:F2}</p>
                  <p style='font-size:12px;color:#166534;margin:8px 0 0'>From the runner count at pickup. Bank transfer from $20 once payouts are live.</p>
                </div>
                <p style='font-size:13px;line-height:1.55'>Bring bags back inside when you&apos;re ready.</p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {hh.Address}</p>
              </div>";
            try
            {
                var msg = new EmailMessage(sender, member.Email!, new EmailContent("We picked up your containers — earnings updated") { Html = body });
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

    private static string WhatsAppInvite(string place, string inviteUrl, int containers = 0, int needed = WaitlistDensity.LiveThreshold)
    {
        var text = needed <= 0
            ? $"The Good Sort in {place} has enough scanned volume for a driver trip. Scan for 5¢: {inviteUrl}"
            : $"Scan with The Good Sort in {place}. {containers}/{WaitlistDensity.LiveThreshold} containers — {needed} more for a driver trip: {inviteUrl}";
        return $"https://wa.me/?text={Uri.EscapeDataString(text)}";
    }

    private static string WhatsAppProgress(string place, int containers, int needed, string inviteUrl)
    {
        var text = $"{containers} container{(containers == 1 ? "" : "s")} scanned in {place}. {needed} more and we run a driver trip: {inviteUrl}";
        return $"https://wa.me/?text={Uri.EscapeDataString(text)}";
    }
}
