namespace GoodSort.Api.Tests;

/// <summary>
/// Every background pass must be gated by a lease, and each by its own.
///
/// AddHostedService runs in EVERY replica and this app scales to ten. Without
/// coordination, ten copies of the same pass run at once. RunGenerationService
/// would generate runs over the same bins from ten instances — several drivers
/// paid to collect the same containers — and the reminder pass would send ten
/// copies of the same email to a member.
///
/// GrowthEventRetentionHost was registered without one. It mirrored
/// PickupReminderHost in every respect except the part that matters, and the
/// omission is invisible: the rows a delete sweep removes are the same whether
/// one replica or ten run it, so the only symptom is lock contention on the
/// table the funnel writes to on every scan.
///
/// The lease NAME matters as much as its presence. Two passes sharing a name
/// means the second never runs, and it never runs quietly.
/// </summary>
public class BackgroundPassLeaseTests
{
    [Fact]
    public void Every_registered_hosted_service_takes_a_lease()
    {
        var program = File.ReadAllText(FindRepoFile(Path.Combine("src", "GoodSort.Api", "Program.cs")));

        var registered = System.Text.RegularExpressions.Regex
            .Matches(program, @"AddHostedService<(\w+)>")
            .Select(m => m.Groups[1].Value)
            .Distinct()
            .ToList();

        Assert.True(registered.Count > 0, "Found no AddHostedService registrations — the extraction is broken, not the code.");

        var servicesDir = Path.GetDirectoryName(FindRepoFile(Path.Combine("src", "GoodSort.Api", "Services", "SingletonLease.cs")))!;
        var sources = Directory.GetFiles(servicesDir, "*.cs").ToDictionary(f => f, File.ReadAllText);

        var unleased = new List<string>();
        foreach (var host in registered)
        {
            // The class may live in a file named after something else, so find
            // the file that declares it rather than guessing the filename.
            var declaring = sources.FirstOrDefault(kv =>
                kv.Value.Contains($"class {host}", StringComparison.Ordinal));

            Assert.False(declaring.Key is null, $"Could not find the file declaring {host}.");

            if (!declaring.Value.Contains("SingletonLease.TryAcquire", StringComparison.Ordinal))
                unleased.Add(host);
        }

        Assert.True(
            unleased.Count == 0,
            "These hosted services run in every replica with no lease, so all ten do the same work at once: "
                + string.Join(", ", unleased));
    }

    [Fact]
    public void No_two_passes_share_a_lease_name()
    {
        var servicesDir = Path.GetDirectoryName(FindRepoFile(Path.Combine("src", "GoodSort.Api", "Services", "SingletonLease.cs")))!;

        var names = Directory.GetFiles(servicesDir, "*.cs")
            .SelectMany(f => System.Text.RegularExpressions.Regex
                .Matches(File.ReadAllText(f), @"LeaseName\s*=\s*""([^""]+)""")
                .Select(m => (File: Path.GetFileName(f), Name: m.Groups[1].Value)))
            .ToList();

        Assert.True(names.Count >= 2, $"Found {names.Count} lease names — the extraction is broken, not the code.");

        var shared = names.GroupBy(n => n.Name)
            .Where(g => g.Count() > 1)
            .Select(g => $"{g.Key} (in {string.Join(", ", g.Select(x => x.File))})")
            .ToList();

        Assert.True(
            shared.Count == 0,
            "Two passes share a lease name, so one of them silently never runs: " + string.Join("; ", shared));
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
