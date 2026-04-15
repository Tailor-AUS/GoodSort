using Azure.Communication.Email;
using GoodSort.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

/// <summary>
/// Scoped worker that sends day-before pickup reminders to households and
/// their claiming runners. Intended to be run:
///  - automatically at 6pm Brisbane local (via the hosted PickupReminderHost)
///  - manually via POST /api/admin/trigger-pickup-reminders for dry-run testing
/// Idempotent via Household.LastPickupAt.
/// </summary>
public class PickupReminderService
{
    private readonly GoodSortDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<PickupReminderService> _log;
    private static readonly TimeSpan Brisbane = TimeSpan.FromHours(10);

    public PickupReminderService(GoodSortDbContext db, IConfiguration config, ILogger<PickupReminderService> log)
    { _db = db; _config = config; _log = log; }

    /// <summary>Force a reminder pass now, regardless of the time-of-day gate.</summary>
    public async Task<(int households, int runners)> TriggerNow()
    {
        var localToday = (DateTime.UtcNow + Brisbane).Date;
        var tomorrow = localToday.AddDays(1);
        var tomorrowDow = (int)tomorrow.DayOfWeek;
        var hhSent = await NotifyHouseholds(tomorrowDow, tomorrow, forceResend: true);
        var runSent = await NotifyRunners(tomorrowDow, tomorrow);
        return (hhSent, runSent);
    }

    /// <summary>Called by the hosted loop — respects idempotency by date.</summary>
    public async Task<(int households, int runners)> RunIfDue()
    {
        var localNow = DateTime.UtcNow + Brisbane;
        if (localNow.Hour < 18) return (0, 0);
        var tomorrow = localNow.Date.AddDays(1);
        var tomorrowDow = (int)tomorrow.DayOfWeek;
        var hhSent = await NotifyHouseholds(tomorrowDow, tomorrow, forceResend: false);
        var runSent = await NotifyRunners(tomorrowDow, tomorrow);
        return (hhSent, runSent);
    }

    private async Task<int> NotifyHouseholds(int tomorrowDow, DateTime tomorrowLocal, bool forceResend)
    {
        var todayLocal = tomorrowLocal.AddDays(-1);
        var q = _db.Households.Where(h => h.Type == "residential" && h.CouncilCollectionDay == tomorrowDow);
        if (!forceResend) q = q.Where(h => h.LastPickupAt == null || h.LastPickupAt < todayLocal);
        var candidates = await q.Include(h => h.Members).ToListAsync();
        if (candidates.Count == 0) return 0;

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
                        <p style='font-size:14px;margin:12px 0'><a href='https://www.thegoodsort.org/household' style='color:#16a34a;font-weight:600'>Tap here once your bin is on the kerb →</a></p>
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
        await _db.SaveChangesAsync();
        _log.LogInformation("Sent pickup reminders to {Count} households for {Date}", candidates.Count, tomorrowLocal.Date);
        return candidates.Count;
    }

    private async Task<int> NotifyRunners(int tomorrowDow, DateTime tomorrowLocal)
    {
        var runs = await _db.Runs
            .Where(r => r.Status == "claimed" && r.RunnerId != null)
            .Include(r => r.Runner).ThenInclude(rp => rp!.Profile)
            .Include(r => r.Stops)
            .Include(r => r.DropPoint)
            .ToListAsync();
        if (runs.Count == 0) return 0;

        var client = MakeEmailClient();
        var sender = _config["ACS_EMAIL_SENDER"] ?? "DoNotReply@thegoodsort.org";
        var sent = 0;

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
            try { await SendEmail(client, sender, email, subject, body); sent++; }
            catch (Exception ex) { _log.LogError(ex, "Failed to email runner {RunnerId}", run.RunnerId); }
        }
        _log.LogInformation("Sent runner briefings for {Count} claimed runs on {Date}", sent, tomorrowLocal.Date);
        return sent;
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

/// <summary>Hosted loop that calls PickupReminderService.RunIfDue every hour.</summary>
public class PickupReminderHost : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<PickupReminderHost> _log;
    public PickupReminderHost(IServiceProvider services, ILogger<PickupReminderHost> log) { _services = services; _log = log; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _services.CreateScope();
                var svc = scope.ServiceProvider.GetRequiredService<PickupReminderService>();
                await svc.RunIfDue();
            }
            catch (Exception ex) { _log.LogError(ex, "PickupReminderHost pass failed"); }
            await Task.Delay(TimeSpan.FromMinutes(60), stoppingToken);
        }
    }
}
