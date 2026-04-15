using Azure.Communication.Email;
using GoodSort.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Every hour, check if the clock has crossed the "reminder window" (default 18:00
/// local Brisbane time) for the day BEFORE a household's council collection day.
/// If so, send two emails:
///   - to every household member whose council pickup is tomorrow: "we're coming
///     for your yellow bin tonight / tomorrow morning"
///   - to every runner with a claimed run due tomorrow: "here are your stops"
///
/// Idempotent via Household.LastPickupAt — once we've notified for a given date,
/// we don't re-notify.
/// </summary>
public class PickupReminderService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<PickupReminderService> _log;
    private readonly IConfiguration _config;

    // Brisbane is UTC+10 year-round (no DST)
    private static readonly TimeSpan Brisbane = TimeSpan.FromHours(10);
    private const int ReminderHourLocal = 18; // 6pm Brisbane

    public PickupReminderService(IServiceProvider services, ILogger<PickupReminderService> log, IConfiguration config)
    {
        _services = services; _log = log; _config = config;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var localNow = DateTime.UtcNow + Brisbane;
                if (localNow.Hour >= ReminderHourLocal) await RunReminderPass(localNow.Date);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "PickupReminderService pass failed");
            }
            await Task.Delay(TimeSpan.FromMinutes(60), stoppingToken);
        }
    }

    private async Task RunReminderPass(DateTime localToday)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GoodSortDbContext>();

        // Tomorrow's day-of-week (0=Sun..6=Sat) in Brisbane local time
        var tomorrow = localToday.AddDays(1);
        var tomorrowDow = (int)tomorrow.DayOfWeek;

        await NotifyHouseholds(db, tomorrowDow, tomorrow);
        await NotifyRunners(db, tomorrowDow, tomorrow);
    }

    private async Task NotifyHouseholds(GoodSortDbContext db, int tomorrowDow, DateTime tomorrowLocal)
    {
        // Find residential households whose council pickup is tomorrow and we
        // haven't already notified for that date.
        var todayLocal = tomorrowLocal.AddDays(-1);
        var candidates = await db.Households
            .Where(h => h.Type == "residential"
                     && h.CouncilCollectionDay == tomorrowDow
                     && (h.LastPickupAt == null || h.LastPickupAt < todayLocal))
            .Include(h => h.Members)
            .ToListAsync();

        if (candidates.Count == 0) return;

        var client = MakeEmailClient();
        var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";

        foreach (var hh in candidates)
        {
            try
            {
                foreach (var member in hh.Members.Where(m => !string.IsNullOrWhiteSpace(m.Email)))
                {
                    var subject = "Your Good Sort pickup is tomorrow 🌱";
                    var body = $@"
                      <div style='font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                        <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Bin out tonight!</h1>
                        <p style='color:#64748b;font-size:14px;margin:0 0 16px'>Hi {member.Name},</p>
                        <p style='font-size:14px;line-height:1.55'>Your council truck comes on <b>{((DayOfWeek)tomorrowDow)}</b>. We'll be by the night before / early morning to pick up your cans &amp; bottles from your yellow bin.</p>
                        <div style='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:16px 0'>
                          <p style='font-size:13px;font-weight:600;color:#166534;margin:0 0 6px'>Quick checklist</p>
                          <ul style='font-size:13px;color:#166534;margin:0;padding-left:20px'>
                            <li>Put your yellow bin out tonight (as usual for council)</li>
                            {(hh.UsesDivider ? "<li>Make sure cans &amp; bottles are on the <b>CDS side</b> of your divider</li>" : "<li>Any cans or bottles in the bin are fine — our runner will spot them</li>")}
                            <li>We extract the 10c items; the truck takes the rest</li>
                          </ul>
                        </div>
                        <p style='font-size:12px;color:#94a3b8;margin-top:24px'>The Good Sort · {hh.Address}</p>
                      </div>";
                    await SendEmail(client, sender, member.Email!, subject, body);
                }
                hh.LastPickupAt = todayLocal;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Failed to notify household {HouseholdId}", hh.Id);
            }
        }
        await db.SaveChangesAsync();
        _log.LogInformation("Sent pickup reminders to {Count} households for {Date}", candidates.Count, tomorrowLocal.Date);
    }

    private async Task NotifyRunners(GoodSortDbContext db, int tomorrowDow, DateTime tomorrowLocal)
    {
        // Runs claimed by a runner with stops whose households collect tomorrow
        var runs = await db.Runs
            .Where(r => r.Status == "claimed" && r.RunnerId != null)
            .Include(r => r.Runner).ThenInclude(rp => rp!.Profile)
            .Include(r => r.Stops)
            .Include(r => r.DropPoint)
            .ToListAsync();
        if (runs.Count == 0) return;

        var client = MakeEmailClient();
        var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";

        foreach (var run in runs)
        {
            var email = run.Runner?.Profile?.Email;
            if (string.IsNullOrWhiteSpace(email)) continue;

            var stopsHtml = string.Join("", run.Stops.Select((s, i) =>
                $"<li>{i + 1}. {s.PickupInstruction ?? $"Stop at {s.Lat:F4},{s.Lng:F4}"} — est. {s.EstimatedContainers} containers</li>"));

            var subject = $"Your Good Sort run tomorrow — {run.Stops.Count} stops";
            var body = $@"
              <div style='font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#0f172a'>
                <h1 style='font-size:22px;font-weight:800;margin:0 0 8px'>Tomorrow's run</h1>
                <p style='font-size:14px;color:#64748b;margin:0 0 12px'>Hi {run.Runner?.Profile?.Name},</p>
                <p style='font-size:14px;line-height:1.55'><b>{run.AreaName}</b> — {run.Stops.Count} stops, est. {run.EstimatedContainers} containers, est. payout <b>${run.EstimatedPayoutCents / 100.0:F2}</b>.</p>
                <ol style='font-size:13px;line-height:1.6;color:#0f172a;padding-left:20px'>{stopsHtml}</ol>
                <p style='font-size:13px;color:#64748b'>Drop off at: <b>{run.DropPoint?.Name}</b> — {run.DropPoint?.Address}</p>
                <p style='font-size:12px;color:#94a3b8;margin-top:24px'>Start in the app when you're ready to roll.</p>
              </div>";

            try { await SendEmail(client, sender, email, subject, body); }
            catch (Exception ex) { _log.LogError(ex, "Failed to email runner {RunnerId}", run.RunnerId); }
        }
        _log.LogInformation("Sent runner briefings for {Count} claimed runs on {Date}", runs.Count, tomorrowLocal.Date);
    }

    private EmailClient? MakeEmailClient()
    {
        var conn = _config["ACS_CONNECTION_STRING"];
        if (string.IsNullOrEmpty(conn)) { _log.LogWarning("ACS_CONNECTION_STRING not set — skipping reminders"); return null; }
        return new EmailClient(conn);
    }

    private async Task SendEmail(EmailClient? client, string from, string to, string subject, string html)
    {
        if (client is null) return;
        var content = new EmailContent(subject) { Html = html };
        var msg = new EmailMessage(from, to, content);
        await client.SendAsync(Azure.WaitUntil.Started, msg);
    }
}
