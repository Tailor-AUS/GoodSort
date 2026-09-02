using System.Text.RegularExpressions;

namespace GoodSort.Api.Tests;

/// <summary>
/// Every configuration key the code reads is either re-applied after a deploy,
/// or written down here as safe to lose.
///
/// azd deploy strips env vars the Aspire manifest does not declare, which is the
/// entire reason infra/restore-secrets.sh exists. It restores nine keys. The
/// code reads about thirty. So the rest are one azd deploy away from reverting
/// to their code default, silently.
///
/// That is mostly fine today, and the checking is the point rather than the
/// count: the defaults that matter fail SAFE. ADMIN_BOOTSTRAP_SECRET unset
/// makes the bootstrap endpoint return 404. ABA payouts stay closed without
/// real remitter details. A missing ops inbox logs a warning naming the fix.
/// The caps fall back to sane numbers.
///
/// What this guards is the next key. One added with a fail-OPEN default, or a
/// production-only value nobody restores, would look identical in a diff and
/// produce no error — it would just quietly behave differently in production
/// than anyone believes. Same shape as the config that never deployed and the
/// migration that added no column.
///
/// Adding a key below is a decision, not paperwork: say why losing it is safe.
/// If it is not safe to lose, it belongs in restore-secrets.sh instead.
/// </summary>
public class ConfigRestoreCoverageTests
{
    /// <summary>Read by the code, deliberately NOT restored, with why that is safe.</summary>
    private static readonly Dictionary<string, string> SafeToDefault = new(StringComparer.Ordinal)
    {
        // Set by the image itself, not by the deploy hook.
        ["GIT_SHA"] = "Baked in by the Dockerfile as a build ARG/ENV; not an azd variable.",
        ["BUILD_TIME"] = "Same - Dockerfile build ARG/ENV.",

        // Fail-closed by design.
        ["ADMIN_BOOTSTRAP_SECRET"] = "Unset means the bootstrap endpoint returns 404. Losing it closes a door rather than opening one, and it is meant to be cleared straight after use.",
        ["ABA_PAYOUTS_ENABLED"] = "PayoutsAreOpen also requires real remitter details, so bank files stay closed. Fail-closed.",
        ["ABA_TRACE_BSB"] = "Part of the same gate - without it payouts stay closed. Never guessed; Knox sets it.",
        ["ABA_TRACE_ACCOUNT"] = "As above.",
        ["ABA_USER_ID"] = "As above.",
        ["ABA_USER_NAME"] = "Descriptive field on the ABA header; payouts are already gated by the trace details.",
        ["ABA_REMITTER"] = "Defaults to THE GOOD SORT on the header. Cosmetic next to the trace gate.",

        // A missing value is announced rather than swallowed.
        ["OPS_ALERT_EMAIL"] = "Falls back to ADMIN_SEED_EMAIL; with neither, SendOpsStreetReady logs a warning naming both variables instead of failing silently.",
        ["ADMIN_SEED_EMAIL"] = "The fallback for the above, same warning path.",

        // Deliberately off, and documented as such.
        ["RECOVERY_EMAIL_ENABLED"] = "Default off on purpose - the code being ready is not a decision to email real members. Requires the literal string true.",
        ["SOVRGN_API_KEY"] = "Revoked consumer (#8). A leftover value is logged and ignored, and the postdeploy hook actively removes it.",

        // Tunables whose code defaults are the intended production values.
        ["LAUNCH_BONUS_CONTAINERS"] = "Falls back to LaunchBonus.DefaultCapContainers, which is the intended cap.",
        ["VISION_DAILY_CAP"] = "Defaults to 2000 - the intended global spend cap.",
        ["VISION_PER_USER_DAILY_CAP"] = "Defaults to 100 - the intended per-member cap.",
        ["SCAN_DAILY_CAP"] = "Defaults to 2000, the documented faucet limit.",
        ["SCAN_RATE_PER_MINUTE"] = "Defaults to 60, the documented faucet limit.",
        ["DEPOSIT_GEOFENCE_RADIUS_M"] = "Defaults to 150m, the intended geofence.",
        ["DEPOSIT_REPLAY_WINDOW_HOURS"] = "Anti-replay window; the code default is the intended value.",
        ["DEPOSIT_REPLAY_HAMMING_MAX"] = "Anti-replay threshold; the code default is the intended value.",
        ["MINIMUM_RUN_PAYOUT_CENTS"] = "Run pricing floor; the code default is intended, and PricingBounds constrains the range.",
        ["RUNNER_STOP_MAX_CONTAINERS"] = "Defaults to 200, the intended per-stop ceiling.",
        ["OSRM_URL"] = "Defaults to the public OSRM demo endpoint, which is what the pilot uses.",
    };

    [Fact]
    public void Every_key_the_code_reads_is_restored_or_declared_safe()
    {
        var read = KeysReadByCode();
        var restored = KeysRestoredAfterDeploy();

        // Two empty sets agree with each other, so prove the extraction works
        // before trusting what it found.
        Assert.True(read.Count >= 20, $"Only found {read.Count} config keys in the source - the extraction is broken, not the code.");
        Assert.True(restored.Count >= 5, $"Only found {restored.Count} keys in restore-secrets.sh - the extraction is broken, not the script.");
        Assert.Contains("JWT_SECRET", restored);

        var undeclared = read
            .Where(k => !restored.Contains(k) && !SafeToDefault.ContainsKey(k))
            .OrderBy(k => k, StringComparer.Ordinal)
            .ToList();

        Assert.True(
            undeclared.Count == 0,
            "These keys are read by the code but neither restored after a deploy nor declared safe to lose:\n  "
                + string.Join("\n  ", undeclared)
                + "\n\nEither add them to infra/restore-secrets.sh, or add them to SafeToDefault with the reason "
                + "losing them is harmless. A key that silently reverts to its default in production is the bug this catches.");
    }

    [Fact]
    public void The_declared_list_does_not_rot()
    {
        // A declaration for a key nobody reads any more is stale documentation
        // that reads as current.
        var read = KeysReadByCode();
        var stale = SafeToDefault.Keys.Where(k => !read.Contains(k)).OrderBy(k => k, StringComparer.Ordinal).ToList();

        Assert.True(
            stale.Count == 0,
            "Declared safe-to-default but no longer read by any code - remove them: " + string.Join(", ", stale));
    }

    [Fact]
    public void Nothing_is_both_restored_and_declared_safe_to_lose()
    {
        // Contradictory statements about one key. Whichever is right, the other
        // misleads whoever reads it next.
        var restored = KeysRestoredAfterDeploy();
        var both = SafeToDefault.Keys.Where(restored.Contains).OrderBy(k => k, StringComparer.Ordinal).ToList();

        Assert.True(
            both.Count == 0,
            "Declared safe to lose, yet restore-secrets.sh restores them anyway: " + string.Join(", ", both));
    }

    private static HashSet<string> KeysReadByCode()
    {
        var api = Path.GetDirectoryName(FindRepoFile(Path.Combine("src", "GoodSort.Api", "Program.cs")))!;
        var found = new HashSet<string>(StringComparer.Ordinal);

        var patterns = new[]
        {
            "(?:cfg|config|_config|Configuration)\\[\"([A-Z][A-Z_0-9]+)\"\\]",
            "builder\\.Configuration\\[\"([A-Z][A-Z_0-9]+)\"\\]",
            "GetEnvironmentVariable\\(\"([A-Z][A-Z_0-9]+)\"\\)",
        };

        var migrations = Path.DirectorySeparatorChar + "Migrations" + Path.DirectorySeparatorChar;
        foreach (var file in Directory.GetFiles(api, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains(migrations, StringComparison.Ordinal)) continue;
            var text = File.ReadAllText(file);
            foreach (var p in patterns)
                foreach (Match m in Regex.Matches(text, p))
                    found.Add(m.Groups[1].Value);
        }
        return found;
    }

    private static HashSet<string> KeysRestoredAfterDeploy()
    {
        var sh = File.ReadAllText(FindRepoFile(Path.Combine("infra", "restore-secrets.sh")));
        var found = new HashSet<string>(StringComparer.Ordinal);

        // The --set-env-vars arguments, e.g. "JWT_SECRET=secretref:jwt-secret".
        foreach (Match m in Regex.Matches(sh, "\"([A-Z][A-Z_0-9]+)="))
            found.Add(m.Groups[1].Value);
        return found;
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
