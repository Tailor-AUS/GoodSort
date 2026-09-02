using System.Text.RegularExpressions;

namespace GoodSort.Api.Tests;

/// <summary>
/// The escalation the deploy points an operator at has to be the one that exists.
///
/// The ACS sender-link step in deploy-api.yml is non-blocking on purpose —
/// failing a deploy on a broken sender link also blocks shipping the fix for a
/// broken sender link. What makes that safe is the escalation the warning names.
/// So the warning has to be accurate, and it was not: it promised the scheduled
/// guard "retries within 30 minutes" while acs-domain-guard.yml runs
/// "0 * /6 * * *" — up to six hours.
///
/// That gap matters at exactly the wrong moment. A broken sender link is the
/// failure that takes every signup down; it happened three times in one day on
/// 2026-08-31. An operator reading "30 minutes" waits instead of running the
/// guard by hand, and waits up to twelve times longer than they think.
///
/// A stale number in an operator-facing message is invisible to every other
/// check: the YAML is valid, the workflow runs, the deploy succeeds. Only
/// someone comparing two files notices, and only if they think to.
/// </summary>
public class AcsEscalationAccuracyTests
{
    [Fact]
    public void The_deploy_warning_states_the_guards_real_cadence()
    {
        var deploy = File.ReadAllText(FindRepoFile(Path.Combine(".github", "workflows", "deploy-api.yml")));
        var guard = File.ReadAllText(FindRepoFile(Path.Combine(".github", "workflows", "acs-domain-guard.yml")));

        // Read the interval out of the cron rather than restating it, so the
        // test cannot drift from the schedule either.
        var cron = Regex.Match(guard, @"cron:\s*""0 \*/(\d+) \* \* \*""");
        Assert.True(cron.Success, "Could not read the guard's cron - if the schedule shape changed, update this test rather than deleting it.");
        var hours = cron.Groups[1].Value;

        var warning = Regex.Match(deploy, @"::warning title=ACS link not repaired::([^""]+)");
        Assert.True(warning.Success, "Could not find the ACS non-repair warning in deploy-api.yml.");
        var text = warning.Groups[1].Value;

        Assert.True(
            text.Contains($"{hours} hours", StringComparison.OrdinalIgnoreCase),
            $"The guard runs every {hours} hours, but the deploy warning says: \"{text}\". "
                + "An operator reads this at the moment signups are down; it has to be the real number.");

        // The specific wrong claim that was there, named so it cannot come back.
        Assert.False(
            text.Contains("30 minutes", StringComparison.OrdinalIgnoreCase),
            "The warning promises a 30-minute retry. The guard moved off that cadence deliberately - its send probe hard-bounces off our own MX, and 48/day on a low-volume sending domain is a ratio ACS can throttle us for.");
    }

    [Fact]
    public void The_warning_gives_an_operator_something_to_do_now()
    {
        // Six hours is a long time to be told to wait. The manual trigger is the
        // actual answer, so the message has to carry it.
        var deploy = File.ReadAllText(FindRepoFile(Path.Combine(".github", "workflows", "deploy-api.yml")));
        var warning = Regex.Match(deploy, @"::warning title=ACS link not repaired::([^""]+)").Groups[1].Value;

        Assert.Contains("acs-domain-guard", warning, StringComparison.OrdinalIgnoreCase);

        var guard = File.ReadAllText(FindRepoFile(Path.Combine(".github", "workflows", "acs-domain-guard.yml")));
        Assert.Contains("workflow_dispatch", guard, StringComparison.Ordinal);
    }

    [Fact]
    public void The_named_alert_is_still_the_one_referenced()
    {
        // gs-otp-email-down exists in Azure (rg-GoodSort, scheduled-query,
        // severity 1, 15-minute evaluation, wired to the enabled goodsort-email
        // action group) — verified with az on 2026-09-02. Nothing in the repo
        // creates it, so this only pins that the deploy and the guard agree on
        // the name; the resource itself is checked by hand.
        var deploy = File.ReadAllText(FindRepoFile(Path.Combine(".github", "workflows", "deploy-api.yml")));

        Assert.Contains("gs-otp-email-down", deploy, StringComparison.Ordinal);
        Assert.Contains("15 minutes", deploy, StringComparison.OrdinalIgnoreCase);
    }

    private static string FindRepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, relative)))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, relative);
    }
}
